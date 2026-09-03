// Supabase の全テーブルの中身を JSON に書き出す。
// 実行: npm run db:backup [出力先ディレクトリ]
// 出力先を省略すると backups/<日時>/ に保存する。
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { supabase } from "../server/supabaseClient.js"
import { TABLES } from "./dbTables.js"

const PAGE_SIZE = 1000

const fetchAll = async (table) => {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

export const backupDatabase = async (outDir) => {
  const target = outDir ?? path.join("backups", timestamp())
  await mkdir(target, { recursive: true })

  const counts = {}
  for (const table of TABLES) {
    const rows = await fetchAll(table)
    counts[table] = rows.length
    await writeFile(path.join(target, `${table}.json`), `${JSON.stringify(rows, null, 2)}\n`, "utf8")
  }
  await writeFile(
    path.join(target, "meta.json"),
    `${JSON.stringify({ createdAt: new Date().toISOString(), counts }, null, 2)}\n`,
    "utf8"
  )
  return { dir: target, counts }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dir, counts } = await backupDatabase(process.argv[2])
  console.log(`backup -> ${dir}`)
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`)
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  console.log(`  合計 ${total} 行`)
}
