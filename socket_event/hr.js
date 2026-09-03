import { studentsRepo, SELECTION_STATUSES } from "../server/repositories/students.js"
import { interviewersRepo } from "../server/repositories/interviewers.js"
import { conversationsRepo } from "../server/repositories/conversations.js"
import { messagesRepo } from "../server/repositories/messages.js"
import { interviewRequestsRepo } from "../server/repositories/interviewRequests.js"

const roomOf = (conversationId) => `conv:${conversationId}`

export default async (io, socket) => {
  const { id: hrId } = socket.data.user

  const joinAllConversations = async () => {
    const conversations = await conversationsRepo.listAll()
    conversations.forEach((c) => socket.join(roomOf(c.id)))
    return conversations
  }

  const sendDashboard = async () => {
    const [students, interviewers, requests, conversations] = await Promise.all([
      studentsRepo.list(),
      interviewersRepo.list(),
      interviewRequestsRepo.listForHr(hrId),
      joinAllConversations(),
    ])
    socket.emit("dashboardData", { students, interviewers, requests, conversations })
  }

  await sendDashboard()

  socket.on("loadDashboard", sendDashboard)

  // 選考状況（1次／2次／最終／内定／不採用）の更新
  socket.on("updateSelectionStatus", async ({ studentId, status }) => {
    if (!studentId || !SELECTION_STATUSES.includes(status)) return
    await studentsRepo.updateSelectionStatus(studentId, status)
    await sendDashboard()
  })

  socket.on("openConversation", async ({ conversationId }) => {
    const messages = await messagesRepo.listForConversation(conversationId)
    socket.emit("conversationMessages", { conversationId, messages })
  })

  socket.on("sendMessage", async ({ conversationId, body }) => {
    if (!conversationId || !body || !body.trim()) return
    const message = await messagesRepo.create({
      conversationId,
      senderKind: "hr",
      senderId: hrId,
      body: body.trim(),
      msgType: "text",
    })
    io.to(roomOf(conversationId)).emit("newMessage", message)
  })

  // ①学生への日程調整依頼を作成し、チャット上にカレンダーを送る
  socket.on("createRequest", async ({ studentId, interviewerIds, rangeStart, rangeEnd }) => {
    if (!studentId || !Array.isArray(interviewerIds) || interviewerIds.length === 0 || !rangeStart || !rangeEnd) return

    const studentConversation = await conversationsRepo.findOrCreateForStudent(studentId, hrId)
    socket.join(roomOf(studentConversation.id))
    for (const interviewerId of interviewerIds) {
      const interviewerConversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, hrId)
      socket.join(roomOf(interviewerConversation.id))
    }

    const request = await interviewRequestsRepo.create({ studentId, hrId, interviewerIds, rangeStart, rangeEnd })

    const message = await messagesRepo.create({
      conversationId: studentConversation.id,
      senderKind: "system",
      senderId: null,
      body: `面接可能な日時を ${rangeStart} 〜 ${rangeEnd} の期間で選んでください`,
      msgType: "calendar_request",
      payload: { requestId: request.id, rangeStart, rangeEnd },
      requestId: request.id,
    })
    io.to(roomOf(studentConversation.id)).emit("newMessage", message)
    socket.emit("requestCreated", request)
  })

  // ①ループバック：条件が合わなかった依頼を新しい期間で再送する
  socket.on("resendRequest", async ({ requestId, interviewerIds, rangeStart, rangeEnd }) => {
    const existing = await interviewRequestsRepo.findById(requestId)
    if (!existing) return

    const request = await interviewRequestsRepo.resend(requestId, { rangeStart, rangeEnd, interviewerIds })
    const studentConversation = await conversationsRepo.findOrCreateForStudent(request.student_id, hrId)
    for (const interviewerId of interviewerIds) {
      const interviewerConversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, hrId)
      socket.join(roomOf(interviewerConversation.id))
    }

    const message = await messagesRepo.create({
      conversationId: studentConversation.id,
      senderKind: "system",
      senderId: null,
      body: `面接可能な日時を ${rangeStart} 〜 ${rangeEnd} の期間で選び直してください`,
      msgType: "calendar_request",
      payload: { requestId: request.id, rangeStart, rangeEnd },
      requestId: request.id,
    })
    io.to(roomOf(studentConversation.id)).emit("newMessage", message)
    socket.emit("requestCreated", request)
  })
}
