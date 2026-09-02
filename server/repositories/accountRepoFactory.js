import { supabase } from "../supabaseClient.js"

// students / interviewers / hr_staff は同一のカラム構成なので生成関数で共通化する
export const makeAccountRepo = (table) => ({
  async findByEmail(email) {
    const { data, error } = await supabase.from(table).select("*").eq("email", email).maybeSingle()
    if (error) throw error
    return data
  },

  async findById(id) {
    const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
  },

  async list() {
    const { data, error } = await supabase.from(table).select("id, name, email, created_at").order("name")
    if (error) throw error
    return data
  },

  async create({ name, email, passwordHash }) {
    const { data, error } = await supabase
      .from(table)
      .insert({ name, email, password_hash: passwordHash })
      .select()
      .single()
    if (error) throw error
    return data
  },
})
