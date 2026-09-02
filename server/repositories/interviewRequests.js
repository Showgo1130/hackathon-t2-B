import { supabase } from "../supabaseClient.js"

export const interviewRequestsRepo = {
  async create({ studentId, hrId, interviewerIds, rangeStart, rangeEnd }) {
    const { data, error } = await supabase
      .from("interview_requests")
      .insert({
        student_id: studentId,
        hr_id: hrId,
        interviewer_ids: interviewerIds,
        range_start: rangeStart,
        range_end: rangeEnd,
        status: "awaiting_student",
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  // 同じ学生への依頼を再送する場合は既存レコードを更新して使い回す
  async resend(id, { rangeStart, rangeEnd, interviewerIds }) {
    const { data, error } = await supabase
      .from("interview_requests")
      .update({
        range_start: rangeStart,
        range_end: rangeEnd,
        interviewer_ids: interviewerIds,
        status: "awaiting_student",
        confirmed_date: null,
        confirmed_hour: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async findById(id) {
    const { data, error } = await supabase.from("interview_requests").select("*").eq("id", id).maybeSingle()
    if (error) throw error
    return data
  },

  async listActiveForInterviewer(interviewerId) {
    const { data, error } = await supabase
      .from("interview_requests")
      .select("*")
      .contains("interviewer_ids", [interviewerId])
      .eq("status", "matching")
    if (error) throw error
    return data
  },

  async setStatus(id, status) {
    const { data, error } = await supabase
      .from("interview_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async confirm(id, { slotDate, slotHour }) {
    const { data, error } = await supabase
      .from("interview_requests")
      .update({
        status: "confirmed",
        confirmed_date: slotDate,
        confirmed_hour: slotHour,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async listForHr(hrId) {
    const { data, error } = await supabase
      .from("interview_requests")
      .select("*, students(id, name)")
      .eq("hr_id", hrId)
      .order("updated_at", { ascending: false })
    if (error) throw error
    return data
  },
}
