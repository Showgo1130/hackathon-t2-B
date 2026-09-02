import { conversationsRepo } from "../server/repositories/conversations.js"
import { messagesRepo } from "../server/repositories/messages.js"
import { availabilityRepo } from "../server/repositories/availability.js"
import { answerAvailability } from "../server/matching.js"

const roomOf = (conversationId) => `conv:${conversationId}`

const YES_WORDS = ["はい", "可能", "大丈夫", "OK", "ok", "○", "空いて"]
const NO_WORDS = ["いいえ", "不可", "無理", "NG", "ng", "×", "埋まって"]

const parseYesNo = (text) => {
  if (YES_WORDS.some((w) => text.includes(w))) return true
  if (NO_WORDS.some((w) => text.includes(w))) return false
  return null
}

// 未回答のavailability_checkのうち最新のものを探す（チャット直接返信の対象を特定する）
const findUnansweredCheck = async (conversationId) => {
  const history = await messagesRepo.listForConversation(conversationId)
  const answeredKeys = new Set(
    history
      .filter((m) => m.msg_type === "availability_answer")
      .map((m) => `${m.payload.slotDate}_${m.payload.slotHour}`)
  )
  const checks = history.filter((m) => m.msg_type === "availability_check")
  for (let i = checks.length - 1; i >= 0; i -= 1) {
    const key = `${checks[i].payload.slotDate}_${checks[i].payload.slotHour}`
    if (!answeredKeys.has(key)) return checks[i]
  }
  return null
}

export default async (io, socket) => {
  const { id: interviewerId } = socket.data.user

  const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, null)
  socket.join(roomOf(conversation.id))

  const history = await messagesRepo.listForConversation(conversation.id)
  socket.emit("init", { conversationId: conversation.id, messages: history })

  const respondToCheck = async (check, isAvailable) => {
    const { slotDate, slotHour } = check.payload
    const message = await messagesRepo.create({
      conversationId: conversation.id,
      senderKind: "interviewer",
      senderId: interviewerId,
      body: `${slotDate} ${String(slotHour).padStart(2, "0")}:00 は${isAvailable ? "可能" : "不可"}と回答しました`,
      msgType: "availability_answer",
      payload: { slotDate, slotHour, isAvailable },
      requestId: check.request_id,
    })
    io.to(roomOf(conversation.id)).emit("newMessage", message)
    await answerAvailability(io, { interviewerId, slotDate, slotHour, isAvailable })
  }

  socket.on("sendMessage", async ({ body }) => {
    if (!body || !body.trim()) return
    const text = body.trim()
    const message = await messagesRepo.create({
      conversationId: conversation.id,
      senderKind: "interviewer",
      senderId: interviewerId,
      body: text,
      msgType: "text",
    })
    io.to(roomOf(conversation.id)).emit("newMessage", message)

    const isAvailable = parseYesNo(text)
    if (isAvailable !== null) {
      const check = await findUnansweredCheck(conversation.id)
      if (check) await respondToCheck(check, isAvailable)
    }
  })

  // 通知内のワンクリックボタンからの回答
  socket.on("answerAvailability", async ({ slotDate, slotHour, isAvailable, requestId }) => {
    const check = { payload: { slotDate, slotHour }, request_id: requestId ?? null }
    await respondToCheck(check, isAvailable)
  })

  // ⓪ 自分の空き予定カレンダー登録
  socket.on("loadAvailability", async ({ rangeStart, rangeEnd }) => {
    const rows = await availabilityRepo.listForInterviewer(interviewerId, rangeStart, rangeEnd)
    socket.emit("availabilityData", rows)
  })

  socket.on("setAvailability", async ({ slotDate, slotHour, isAvailable }) => {
    const row = await availabilityRepo.upsert({ interviewerId, slotDate, slotHour, isAvailable })
    socket.emit("availabilityUpdated", row)
  })
}
