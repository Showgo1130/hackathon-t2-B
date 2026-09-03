import { conversationsRepo } from "../server/repositories/conversations.js"
import { messagesRepo } from "../server/repositories/messages.js"
import { interviewRequestsRepo } from "../server/repositories/interviewRequests.js"
import { studentsRepo } from "../server/repositories/students.js"
import { submitStudentSlots } from "../server/matching.js"

const roomOf = (conversationId) => `conv:${conversationId}`

export default async (io, socket) => {
  const { id: studentId } = socket.data.user

  const conversation = await conversationsRepo.findOrCreateForStudent(studentId, null)
  socket.join(roomOf(conversation.id))

  const [history, student] = await Promise.all([
    messagesRepo.listForConversation(conversation.id),
    studentsRepo.findById(studentId),
  ])
  socket.emit("init", {
    conversationId: conversation.id,
    messages: history,
    selectionStatus: student?.selection_status ?? null,
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

  // ②学生がカレンダーで選んだ候補スロットを提出する
  socket.on("submitCalendar", async ({ requestId, slots }) => {
    if (!requestId || !Array.isArray(slots) || slots.length === 0) return
    const request = await interviewRequestsRepo.findById(requestId)
    if (!request || request.student_id !== studentId) return

    const summary = slots
      .map(({ slotDate, slotHour }) => `${slotDate} ${String(slotHour).padStart(2, "0")}:00`)
      .join(" / ")
    const message = await messagesRepo.create({
      conversationId: conversation.id,
      senderKind: "student",
      senderId: studentId,
      body: `候補日時を送信しました: ${summary}`,
      msgType: "calendar_submission",
      payload: { slots },
      requestId,
    })
    io.to(roomOf(conversation.id)).emit("newMessage", message)

    await submitStudentSlots(io, request, slots)
  })
}
