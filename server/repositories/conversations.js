import { supabase } from "../supabaseClient.js"

export const conversationsRepo = {
  async findOrCreateForStudent(studentId, hrId) {
    const { data: existing, error: findError } = await supabase
      .from("conversations")
      .select("*")
      .eq("kind", "student")
      .eq("student_id", studentId)
      .maybeSingle()
    if (findError) throw findError
    if (existing) return existing

    const { data, error } = await supabase
      .from("conversations")
      .insert({ kind: "student", student_id: studentId, hr_id: hrId })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async findOrCreateForInterviewer(interviewerId, hrId) {
    const { data: existing, error: findError } = await supabase
      .from("conversations")
      .select("*")
      .eq("kind", "interviewer")
      .eq("interviewer_id", interviewerId)
      .maybeSingle()
    if (findError) throw findError
    if (existing) return existing

    const { data, error } = await supabase
      .from("conversations")
      .insert({ kind: "interviewer", interviewer_id: interviewerId, hr_id: hrId })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async findById(id) {
    const { data, error } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
  },

  async listAll() {
    const { data, error } = await supabase
      .from("conversations")
      .select("*, students(id, name), interviewers(id, name)")
      .order("created_at")
    if (error) throw error
    return data
  },
}
