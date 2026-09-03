// 全テーブルの中身を空にする（テーブル定義は消さない）。
// 実行: npm run db:clear -- --yes
// 取り返しがつかないので、必ず先に npm run db:backup を取ること。
import { supabase } from "../server/supabaseClient.js"
import { TABLES } from "./dbTables.js"

const IMPOSSIBLE_ID = "00000000-0000-0000-0000-000000000000"

export const clearDatabase = async () => {
  const counts = {}
  // 外部キーの参照先を後に消すため、依存順の逆から削除する
  for (const table of [...TABLES].reverse()) {
    const { data, error } = await supabase.from(table).delete().neq("id", IMPOSSIBLE_ID).select("id")
    if (error) throw new Error(`${table}: ${error.message}`)
    counts[table] = data.length
  }
  return counts
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv.includes("--yes")) {
    console.error("中身を全部消します。先に npm run db:backup を実行し、--yes を付けて再実行してください。")
    process.exit(1)
  }
  const counts = await clearDatabase()
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: -${count}`)
  console.log("clear done")
}
