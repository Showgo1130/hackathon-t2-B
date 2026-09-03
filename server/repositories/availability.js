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

  // 複数スロットをまとめて同じ空き状況で登録する（カレンダーの範囲選択用）
  async upsertMany({ interviewerId, cells, isAvailable }) {
    if (cells.length === 0) return []
    const updatedAt = new Date().toISOString()
    const rows = cells.map(({ slotDate, slotHour }) => ({
      interviewer_id: interviewerId,
      slot_date: slotDate,
      slot_hour: slotHour,
      is_available: isAvailable,
      updated_at: updatedAt,
    }))
    const { data, error } = await supabase
      .from("availability")
      .upsert(rows, { onConflict: "interviewer_id,slot_date,slot_hour" })
      .select()
    if (error) throw error
    return data
  },

  // 登録を取り消して未登録（null）状態に戻す
  async deleteMany({ interviewerId, cells }) {
    const hoursByDate = new Map()
    cells.forEach(({ slotDate, slotHour }) => {
      if (!hoursByDate.has(slotDate)) hoursByDate.set(slotDate, [])
      hoursByDate.get(slotDate).push(slotHour)
    })
    for (const [slotDate, hours] of hoursByDate) {
      const { error } = await supabase
        .from("availability")
        .delete()
        .eq("interviewer_id", interviewerId)
        .eq("slot_date", slotDate)
        .in("slot_hour", hours)
      if (error) throw error
    }
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
