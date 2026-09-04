import { conversationsRepo } from "../server/repositories/conversations.js"
import { messagesRepo } from "../server/repositories/messages.js"
import { interviewRequestsRepo } from "../server/repositories/interviewRequests.js"
import { studentsRepo } from "../server/repositories/students.js"
import { canReviseSlots, submitStudentSlots } from "../server/matching.js"

const roomOf = (conversationId) => `conv:${conversationId}`

export default async (io, socket) => {
  const { id: studentId } = socket.data.user

  const conversation = await conversationsRepo.findOrCreateForStudent(studentId, null)
  socket.join(roomOf(conversation.id))

  const [history, student] = await Promise.all([
    messagesRepo.listForConversation(conversation.id),
    studentsRepo.findById(studentId),
  ])
  // 直近の依頼が「面接官の予定と照合される前」なら、学生は候補を選び直せる
  const revisableRequestId = async () => {
    const lastRequest = [...history].reverse().find((m) => m.msg_type === "calendar_request")
    const requestId = lastRequest?.payload?.requestId ?? lastRequest?.request_id
    if (!requestId) return null
    const request = await interviewRequestsRepo.findById(requestId)
    return request && request.student_id === studentId && (await canReviseSlots(request)) ? request.id : null
  }

  socket.emit("init", {
    conversationId: conversation.id,
    messages: history,
    selectionStatus: student?.selection_status ?? null,
    revisableRequestId: await revisableRequestId(),
  })

  socket.on("sendMessage", async ({ body }) => {
    if (!body || !body.trim()) return
    const message = await messagesRepo.create({
      conversationId: conversation.id,
      senderKind: "student",
      senderId: studentId,
      body: body.trim(),
      msgType: "text",
    })
    io.to(roomOf(conversation.id)).emit("newMessage", message)
  })

  // ②学生がカレンダーで選んだ候補スロットを提出する。
  // 提出済みでも、面接官の予定と照合される前なら同じ経路で選び直せる
  socket.on("submitCalendar", async ({ requestId, slots }) => {
    if (!requestId || !Array.isArray(slots) || slots.length === 0) return
    const request = await interviewRequestsRepo.findById(requestId)
    if (!request || request.student_id !== studentId) return

    const isRevision = request.status === "matching"
    if (isRevision && !(await canReviseSlots(request))) {
      // 照合が進んだあとの修正は受け付けない。画面側も締め切られた状態に戻す
      socket.emit("calendarRevisable", { requestId, revisable: false })
      socket.emit("appError", { message: "面接官の予定との照合が始まったため、候補日時は変更できません" })
      return
    }
    if (!isRevision && request.status !== "awaiting_student") return

    const summary = slots
      .map(({ slotDate, slotHour }) => `${slotDate} ${String(slotHour).padStart(2, "0")}:00`)
      .join(" / ")
    const message = await messagesRepo.create({
      conversationId: conversation.id,
      senderKind: "student",
      senderId: studentId,
      body: `${isRevision ? "候補日時を修正しました" : "候補日時を送信しました"}: ${summary}`,
      msgType: "calendar_submission",
      payload: { slots, revised: isRevision },
      requestId,
    })
    io.to(roomOf(conversation.id)).emit("newMessage", message)

    await submitStudentSlots(io, request, slots)
  })
}
