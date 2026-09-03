import { supabase } from "../supabaseClient.js"
import { makeAccountRepo } from "./accountRepoFactory.js"

export const SELECTION_STATUSES = ["first_interview", "second_interview", "final_interview", "offered", "rejected"]

export const studentsRepo = {
  ...makeAccountRepo("students"),

  async list() {
    const { data, error } = await supabase
      .from("students")
      .select("id, name, email, selection_status, created_at")
      .order("name")
    if (error) throw error
    return data
  },

  async updateSelectionStatus(id, status) {
    const { data, error } = await supabase
      .from("students")
      .update({ selection_status: status })
      .eq("id", id)
      .select("id, selection_status")
      .single()
    if (error) throw error
    return data
  },
}
