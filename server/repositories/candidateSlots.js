import { supabase } from "../supabaseClient.js"

export const candidateSlotsRepo = {
  async replaceForRequest(requestId, slots) {
    const { error: delError } = await supabase.from("candidate_slots").delete().eq("request_id", requestId)
    if (delError) throw delError

    if (slots.length === 0) return []

    const rows = slots.map(({ slotDate, slotHour }) => ({
      request_id: requestId,
      slot_date: slotDate,
      slot_hour: slotHour,
      status: "pending_check",
    }))
    const { data, error } = await supabase.from("candidate_slots").insert(rows).select()
    if (error) throw error
    return data
  },

  async listForRequest(requestId) {
    const { data, error } = await supabase
      .from("candidate_slots")
      .select("*")
      .eq("request_id", requestId)
      .order("slot_date")
      .order("slot_hour")
    if (error) throw error
    return data
  },

  async setStatus(id, status) {
    const { error } = await supabase.from("candidate_slots").update({ status }).eq("id", id)
    if (error) throw error
  },

  async findByRequestAndSlot(requestId, slotDate, slotHour) {
    const { data, error } = await supabase
      .from("candidate_slots")
      .select("*")
      .eq("request_id", requestId)
      .eq("slot_date", slotDate)
      .eq("slot_hour", slotHour)
      .maybeSingle()
    if (error) throw error
    return data
  },
}
