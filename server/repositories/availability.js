import { supabase } from "../supabaseClient.js"

export const availabilityRepo = {
  async upsert({ interviewerId, slotDate, slotHour, isAvailable }) {
    const { data, error } = await supabase
      .from("availability")
      .upsert(
        { interviewer_id: interviewerId, slot_date: slotDate, slot_hour: slotHour, is_available: isAvailable, updated_at: new Date().toISOString() },
        { onConflict: "interviewer_id,slot_date,slot_hour" }
      )
      .select()
      .single()
    if (error) throw error
    return data
  },

  async listForInterviewer(interviewerId, rangeStart, rangeEnd) {
    let query = supabase.from("availability").select("*").eq("interviewer_id", interviewerId)
    if (rangeStart) query = query.gte("slot_date", rangeStart)
    if (rangeEnd) query = query.lte("slot_date", rangeEnd)
    const { data, error } = await query
    if (error) throw error
    return data
  },

  // 指定した面接官・日付・時間について、登録済みなら true/false、未登録なら null を返す
  async findOne(interviewerId, slotDate, slotHour) {
    const { data, error } = await supabase
      .from("availability")
      .select("is_available")
      .eq("interviewer_id", interviewerId)
      .eq("slot_date", slotDate)
      .eq("slot_hour", slotHour)
      .maybeSingle()
    if (error) throw error
    return data ? data.is_available : null
  },
}
