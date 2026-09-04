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

  // 人事がまだ返していない、候補者からのメッセージを会話ごとに1件返す。
  // 候補日時の提出は自動で照合まで進むので、人が読んで返す必要のある本文だけを見る。
  // 会話ごとの最後の本文が候補者のものなら、人事はまだ返していない
  async listUnrepliedStudentMessages(limit = 800) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_kind, body, created_at")
      .in("sender_kind", ["student", "hr"])
      .eq("msg_type", "text")
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) throw error
    const latest = new Map()
    for (const message of data) {
      if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, message)
    }
    return [...latest.values()].filter((message) => message.sender_kind === "student")
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
