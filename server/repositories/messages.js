import { supabase } from "../supabaseClient.js"

export const messagesRepo = {
  async create({ conversationId, senderKind, senderId, body, msgType = "text", payload = null, requestId = null }) {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_kind: senderKind,
        sender_id: senderId,
        body,
        msg_type: msgType,
        payload,
        request_id: requestId,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async listForConversation(conversationId) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at")
    if (error) throw error
    return data
  },

  async findCalendarRequest(requestId) {
    const { data, error } = await supabase.from("messages").select("*")
      .eq("request_id", requestId).eq("msg_type", "calendar_request")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    return data
  },

  async listCalendarRequests() {
    const { data, error } = await supabase.from("messages").select("*")
      .eq("msg_type", "calendar_request").order("created_at")
    if (error) throw error
    return data
  },

  async updatePayload(id, payload) {
    const { data, error } = await supabase.from("messages").update({ payload }).eq("id", id).select().single()
    if (error) throw error
    return data
  },

  // 同じスロットへの確認メッセージを二重送信しないためのチェック
  async findPendingAvailabilityCheck(conversationId, requestId, slotDate, slotHour) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("request_id", requestId)
      .eq("msg_type", "availability_check")
      .contains("payload", { slotDate, slotHour })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data
  },
}
