// npm run db:backup で保存した JSON をそのまま書き戻す。
// 実行: npm run db:restore -- backups/<日時>
// 既存の行は先に消してから入れ直すので、バックアップ時点の状態に戻る。
import { readFile } from "node:fs/promises"
import path from "node:path"
import { supabase } from "../server/supabaseClient.js"
import { clearDatabase } from "./clear-db.js"
import { TABLES } from "./dbTables.js"

const CHUNK = 500

export const restoreDatabase = async (dir) => {
  const rowsByTable = {}
  for (const table of TABLES) {
    rowsByTable[table] = JSON.parse(await readFile(path.join(dir, `${table}.json`), "utf8"))
  }

  await clearDatabase()

  const counts = {}
  // 外部キーの参照先から順に入れる
  for (const table of TABLES) {
    const rows = rowsByTable[table]
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from(table).insert(rows.slice(i, i + CHUNK))
      if (error) throw new Error(`${table}: ${error.message}`)
    }
    counts[table] = rows.length
  }
  return counts
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]
  if (!dir) {
    console.error("復元元のディレクトリを指定してください: npm run db:restore -- backups/<日時>")
    process.exit(1)
  }
  const counts = await restoreDatabase(dir)
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`)
  console.log(`restore done <- ${dir}`)
}
