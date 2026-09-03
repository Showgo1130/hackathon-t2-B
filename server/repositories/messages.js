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

  // 学生から届いた最新メッセージを会話ごとに1件返す（ダッシュボードの未読判定用）。
  // 未読の判定にしか使わないので、全件ではなく直近分だけを見る
  async listLatestStudentMessages(limit = 500) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_id, body, msg_type, created_at")
      .eq("sender_kind", "student")
      // 候補日時の提出は自動で照合まで進むので、人が読む必要のある本文だけを対象にする
      .eq("msg_type", "text")
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) throw error
    const latest = new Map()
    for (const message of data) {
      if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message)
    }
    return [...latest.values()]
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
