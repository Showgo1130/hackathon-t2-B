import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabaseClient] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。.env を確認してください。")
}

// サーバー側専用。service role key はブラウザに絶対に渡さない
// .env未設定でもdevサーバー自体は起動できるよう、ダミーのURLにフォールバックする（実際のDB呼び出しは失敗する）
export const supabase = createClient(SUPABASE_URL ?? "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY ?? "dummy-key", {
  auth: { persistSession: false },
})
