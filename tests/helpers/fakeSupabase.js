// Supabase クライアントのインメモリ版。
// リポジトリ層（server/repositories/*.js）を本物のまま動かしてテストするために、
// 実際に使われているクエリビルダのメソッドだけを再現している。
const TABLES = [
  "students",
  "interviewers",
  "hr_staff",
  "availability",
  "interview_requests",
  "candidate_slots",
  "conversations",
  "messages",
]

export const db = {}

let idCounter = 0
let clock = 0

// created_at の順序が一意に定まらないとメッセージ履歴の並びが不安定になるため、
// 挿入ごとに必ず進む時計を使う
const nextTimestamp = () => new Date(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString()
const nextId = () => `id-${++idCounter}`

export const resetDb = () => {
  TABLES.forEach((table) => (db[table] = []))
  idCounter = 0
  clock = 0
}
resetDb()

// テストからレコードを直接置くためのヘルパー
export const seed = (table, row) => {
  const record = { id: row.id ?? nextId(), created_at: nextTimestamp(), updated_at: nextTimestamp(), ...row }
  db[table].push(record)
  return record
}

const clone = (value) => (value === null || value === undefined ? value : JSON.parse(JSON.stringify(value)))

// jsonb の部分一致（payload に {slotDate, slotHour} を含むか）と配列の包含の両方を担う
const containsMatch = (actual, expected) => {
  if (Array.isArray(expected)) return expected.every((item) => (actual ?? []).includes(item))
  if (expected && typeof expected === "object") {
    return Object.entries(expected).every(([key, value]) => (actual ?? {})[key] === value)
  }
  return actual === expected
}

const FILTERS = {
  eq: (actual, value) => actual === value,
  in: (actual, values) => values.includes(actual),
  gte: (actual, value) => actual >= value,
  lte: (actual, value) => actual <= value,
  contains: containsMatch,
}

// "*, students(id, name)" のような埋め込み選択を、students → student_id の外部キーで解決する
const parseSelect = (select) => {
  const embeds = []
  const rest = (select ?? "*").replace(/([a-z_]+)\(([^)]*)\)/g, (_, table, columns) => {
    embeds.push({ table, columns: columns.split(",").map((c) => c.trim()) })
    return ""
  })
  const columns = rest
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
  return { columns, embeds }
}

const project = (row, select) => {
  const { columns, embeds } = parseSelect(select)
  const picked = columns.includes("*") || columns.length === 0
    ? { ...row }
    : Object.fromEntries(columns.filter((c) => c in row).map((c) => [c, row[c]]))

  for (const embed of embeds) {
    const foreignKey = `${embed.table.replace(/s$/, "")}_id`
    const target = db[embed.table]?.find((candidate) => candidate.id === row[foreignKey])
    picked[embed.table] = target
      ? Object.fromEntries(embed.columns.map((c) => [c, target[c]]))
      : null
  }
  return clone(picked)
}

class Query {
  constructor(table) {
    this.table = table
    this.mode = "select"
    this.selectColumns = "*"
    this.filters = []
    this.orders = []
    this.limitCount = null
    this.singleMode = null
    this.returning = false
  }

  #matches(row) {
    return this.filters.every(({ op, column, value }) => FILTERS[op](row[column], value))
  }

  #rows() {
    let rows = db[this.table].filter((row) => this.#matches(row))
    for (const { column, ascending } of this.orders) {
      // 後から指定した order ほど優先度が低くなるよう、安定ソートを逆順に重ねる
      rows = [...rows].sort((a, b) => {
        if (a[column] === b[column]) return 0
        return (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)
      })
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)
    return rows
  }

  select(columns = "*") {
    if (this.mode === "select") this.selectColumns = columns
    this.returning = true
    return this
  }

  insert(payload) {
    this.mode = "insert"
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
      id: nextId(),
      created_at: nextTimestamp(),
      updated_at: nextTimestamp(),
      ...row,
    }))
    db[this.table].push(...rows)
    this.result = rows
    return this
  }

  upsert(payload, { onConflict } = {}) {
    this.mode = "upsert"
    const keys = (onConflict ?? "id").split(",").map((k) => k.trim())
    const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => {
      const existing = db[this.table].find((candidate) => keys.every((key) => candidate[key] === row[key]))
      if (existing) {
        Object.assign(existing, row)
        return existing
      }
      const created = { id: nextId(), created_at: nextTimestamp(), ...row }
      db[this.table].push(created)
      return created
    })
    this.result = rows
    return this
  }

  update(fields) {
    this.mode = "update"
    this.updateFields = fields
    return this
  }

  delete() {
    this.mode = "delete"
    return this
  }

  eq(column, value) { this.filters.push({ op: "eq", column, value }); return this }
  in(column, value) { this.filters.push({ op: "in", column, value }); return this }
  gte(column, value) { this.filters.push({ op: "gte", column, value }); return this }
  lte(column, value) { this.filters.push({ op: "lte", column, value }); return this }
  contains(column, value) { this.filters.push({ op: "contains", column, value }); return this }

  order(column, { ascending = true } = {}) { this.orders.push({ column, ascending }); return this }
  limit(count) { this.limitCount = count; return this }
  maybeSingle() { this.singleMode = "maybe"; return this }
  single() { this.singleMode = "one"; return this }

  #finish() {
    let rows
    if (this.mode === "insert" || this.mode === "upsert") {
      rows = this.result.map((row) => project(row, this.selectColumns))
    } else if (this.mode === "update") {
      const targets = db[this.table].filter((row) => this.#matches(row))
      targets.forEach((row) => Object.assign(row, this.updateFields))
      rows = targets.map((row) => project(row, this.selectColumns))
    } else if (this.mode === "delete") {
      const survivors = db[this.table].filter((row) => !this.#matches(row))
      const removed = db[this.table].filter((row) => this.#matches(row))
      db[this.table] = survivors
      rows = removed.map((row) => project(row, this.selectColumns))
    } else {
      rows = this.#rows().map((row) => project(row, this.selectColumns))
    }

    if (this.singleMode === "maybe") return { data: rows[0] ?? null, error: null }
    if (this.singleMode === "one") {
      if (rows.length !== 1) return { data: null, error: { message: "expected single row" } }
      return { data: rows[0], error: null }
    }
    return { data: rows, error: null }
  }

  then(resolve, reject) {
    try {
      resolve(this.#finish())
    } catch (error) {
      reject(error)
    }
  }
}

export const supabase = {
  from: (table) => new Query(table),
}
