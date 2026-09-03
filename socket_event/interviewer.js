import { conversationsRepo } from "../server/repositories/conversations.js"
import { messagesRepo } from "../server/repositories/messages.js"
import { availabilityRepo } from "../server/repositories/availability.js"
import { interviewRequestsRepo } from "../server/repositories/interviewRequests.js"
import { interviewersRepo } from "../server/repositories/interviewers.js"
import { answerAvailability, respondToMatchApproval } from "../server/matching.js"

const roomOf = (conversationId) => `conv:${conversationId}`

const YES_WORDS = ["はい", "可能", "大丈夫", "OK", "ok", "○", "空いて"]
const NO_WORDS = ["いいえ", "不可", "無理", "NG", "ng", "×", "埋まって"]

export const parseYesNo = (text) => {
  if (YES_WORDS.some((w) => text.includes(w))) return true
  if (NO_WORDS.some((w) => text.includes(w))) return false
  return null
}

// 未回答のavailability_checkのうち最新のものを探す（チャット直接返信の対象を特定する）
const findUnansweredCheck = async (conversationId) => {
  const history = await messagesRepo.listForConversation(conversationId)
  // 同じ日時が別の依頼で来ることがあるため、依頼IDまで含めてキーにする
  const keyOf = (m) => `${m.request_id}_${m.payload.slotDate}_${m.payload.slotHour}`
  const answeredKeys = new Set(
    history.filter((m) => m.msg_type === "availability_answer").map(keyOf)
  )
  const checks = history.filter((m) => m.msg_type === "availability_check")
  for (let i = checks.length - 1; i >= 0; i -= 1) {
    const key = keyOf(checks[i])
    if (!answeredKeys.has(key)) return checks[i]
  }
  return null
}

export default async (io, socket) => {
  const { id: interviewerId } = socket.data.user

  // ハンドラ内の例外でプロセスが落ちないように包む
  const safe = (handler) => async (payload) => {
    try {
      await handler(payload)
    } catch (err) {
      console.error("[interviewer]", err)
      socket.emit("appError", { message: "処理に失敗しました。時間をおいて再度お試しください" })
    }
  }

  // 会話の取得を待つ前にハンドラを登録する。await を挟むと、その間に届いた
  // loadSchedules などのイベントが受け手不在で捨てられてしまう
  const conversationPromise = conversationsRepo.findOrCreateForInterviewer(interviewerId, null)

  const respondToCheck = async (check, isAvailable) => {
    const conversation = await conversationPromise
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

  socket.on("sendMessage", safe(async ({ body }) => {
    if (!body || !body.trim()) return
    const conversation = await conversationPromise
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
  }))

  // 通知内のワンクリックボタンからの回答
  socket.on("answerAvailability", safe(async ({ slotDate, slotHour, isAvailable, requestId }) => {
    const check = { payload: { slotDate, slotHour }, request_id: requestId ?? null }
    await respondToCheck(check, isAvailable)
  }))

  // ⓪ 自分の空き予定カレンダー登録
  socket.on("loadAvailability", safe(async ({ rangeStart, rangeEnd }) => {
    const rows = await availabilityRepo.listForInterviewer(interviewerId, rangeStart, rangeEnd)
    socket.emit("availabilityData", rows)
  }))

  // 単一セルも範囲選択もこの経路を通る。isAvailable が null のときは登録を取り消す
  socket.on("setAvailability", safe(async ({ cells, isAvailable }) => {
    if (!Array.isArray(cells) || cells.length === 0) return
    if (isAvailable === null) {
      await availabilityRepo.deleteMany({ interviewerId, cells })
      socket.emit("availabilityCleared", cells)
      return
    }
    const rows = await availabilityRepo.upsertMany({ interviewerId, cells, isAvailable })
    socket.emit("availabilityUpdated", rows)
  }))

  // ④' マッチング結果への承認／見送りの回答
  socket.on("respondToMatch", safe(async ({ requestId, slotDate, slotHour, approved }) => {
    if (!requestId || !slotDate || slotHour === undefined || typeof approved !== "boolean") return
    await respondToMatchApproval(io, { interviewerId, requestId, slotDate, slotHour, approved })
  }))

  // 予定一覧：照合と承認で確定した面接を返す
  const sendSchedules = async () => {
    const [confirmed, interviewers] = await Promise.all([
      interviewRequestsRepo.listConfirmed(),
      interviewersRepo.list(),
    ])
    const nameOf = new Map(interviewers.map((i) => [i.id, i.name]))

    // 同じ学生への確定済み面接を日時順に数えて「何次面接」を決める
    const roundCounter = new Map()
    const schedules = []
    for (const request of confirmed) {
      const round = (roundCounter.get(request.student_id) ?? 0) + 1
      roundCounter.set(request.student_id, round)
      if (!request.interviewer_ids.includes(interviewerId)) continue

      schedules.push({
        id: request.id,
        studentName: request.students?.name ?? "（学生）",
        round,
        confirmedDate: request.confirmed_date,
        confirmedHour: request.confirmed_hour,
        attendees: [
          request.students?.name ?? "（学生）",
          ...request.interviewer_ids.map((id) => nameOf.get(id)).filter(Boolean),
        ],
      })
    }
    socket.emit("scheduleData", schedules)
  }

  socket.on("loadSchedules", safe(sendSchedules))

  // 通知の履歴。接続時に自動で送るが、購読を始めるのが遅れて取りこぼした
  // クライアントからも取り直せるようにしておく
  const sendInit = async () => {
    const conversation = await conversationPromise
    const history = await messagesRepo.listForConversation(conversation.id)
    socket.emit("init", { conversationId: conversation.id, messages: history })
  }

  socket.on("loadInit", safe(sendInit))

  const conversation = await conversationPromise
  socket.join(roomOf(conversation.id))
  await sendInit()
}
