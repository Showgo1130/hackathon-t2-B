import { studentsRepo, SELECTION_STATUSES } from "../server/repositories/students.js"
import { interviewersRepo } from "../server/repositories/interviewers.js"
import { conversationsRepo } from "../server/repositories/conversations.js"
import { messagesRepo } from "../server/repositories/messages.js"
import { interviewRequestsRepo } from "../server/repositories/interviewRequests.js"

const roomOf = (conversationId) => `conv:${conversationId}`
const scheduledReminders = new Set()

const scheduleReminder = (io, calendarMessage) => {
  const reminderAt = calendarMessage?.payload?.reminderAt
  if (!reminderAt || calendarMessage.payload.reminderSent || scheduledReminders.has(calendarMessage.id)) return
  scheduledReminders.add(calendarMessage.id)
  const delay = Math.max(0, new Date(reminderAt).getTime() - Date.now())
  const timerDelay = Math.min(delay, 2_147_000_000)
  setTimeout(async () => {
    scheduledReminders.delete(calendarMessage.id)
    if (delay > timerDelay) return scheduleReminder(io, calendarMessage)
    try {
      const request = await interviewRequestsRepo.findById(calendarMessage.request_id)
      if (request?.status !== "awaiting_student") return
      const conversation = await conversationsRepo.findOrCreateForStudent(request.student_id, request.hr_id)
      const reminder = await messagesRepo.create({
        conversationId: conversation.id, senderKind: "system", senderId: null,
        body: "面接候補日時の提出期限まで、あと1日です。", msgType: "system_notice",
        payload: { reminderFor: request.id }, requestId: request.id,
      })
      await messagesRepo.updatePayload(calendarMessage.id, { ...calendarMessage.payload, reminderSent: true })
      io.to(roomOf(conversation.id)).emit("newMessage", reminder)
    } catch (error) { console.error("[schedule reminder] error", error) }
  }, timerDelay)
}

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
  const calendarRequests = await messagesRepo.listCalendarRequests()
  calendarRequests.forEach((message) => scheduleReminder(io, message))

  socket.on("loadDashboard", sendDashboard)

  // 選考状況（1次／2次／最終／内定／不採用）の更新
  socket.on("updateSelectionStatus", async ({ studentId, status }) => {
    const isUuid =
      typeof studentId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)
    if (!isUuid || !SELECTION_STATUSES.includes(status)) return
    try {
      await studentsRepo.updateSelectionStatus(studentId, status)
      await sendDashboard()
    } catch (err) {
      console.error("updateSelectionStatus failed", err)
    }
  })

  socket.on("openConversation", async ({ conversationId }) => {
    const messages = await messagesRepo.listForConversation(conversationId)
    socket.emit("conversationMessages", { conversationId, messages })
  })

  socket.on("openPartyConversation", async ({ kind, partyId }) => {
    if (!partyId || !["student", "interviewer"].includes(kind)) return
    const conversation = kind === "student"
      ? await conversationsRepo.findOrCreateForStudent(partyId, hrId)
      : await conversationsRepo.findOrCreateForInterviewer(partyId, hrId)
    socket.join(roomOf(conversation.id))
    const history = await messagesRepo.listForConversation(conversation.id)
    socket.emit("conversationReady", { conversation, messages: history })
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
  const createRequest = async ({ studentId, interviewerIds, rangeStart, rangeEnd, requiredInterviewerCount, durationMinutes, responseDeadline, message }) => {
    if (!studentId || !Array.isArray(interviewerIds) || interviewerIds.length === 0 || !rangeStart || !rangeEnd) return

    const [studentConversation, student] = await Promise.all([
      conversationsRepo.findOrCreateForStudent(studentId, hrId), studentsRepo.findById(studentId),
    ])
    socket.join(roomOf(studentConversation.id))
    const interviewerConversations = []
    for (const interviewerId of interviewerIds) {
      const interviewerConversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, hrId)
      socket.join(roomOf(interviewerConversation.id))
      interviewerConversations.push(interviewerConversation)
    }

    const request = await interviewRequestsRepo.create({ studentId, hrId, interviewerIds, rangeStart, rangeEnd })

    const deadlineDate = new Date(responseDeadline)
    const reminderAt = Number.isNaN(deadlineDate.getTime()) ? null : new Date(deadlineDate.getTime() - 86_400_000).toISOString()
    const calendarMessage = await messagesRepo.create({
      conversationId: studentConversation.id,
      senderKind: "system",
      senderId: null,
      body: message?.trim() || `面接可能な日時を ${rangeStart} 〜 ${rangeEnd} の期間で選んでください`,
      msgType: "calendar_request",
      payload: { requestId: request.id, rangeStart, rangeEnd, requiredInterviewerCount, durationMinutes, responseDeadline, reminderAt, reminderSent: false },
      requestId: request.id,
    })
    io.to(roomOf(studentConversation.id)).emit("newMessage", calendarMessage)
    for (const interviewerConversation of interviewerConversations) {
      const interviewerMessage = await messagesRepo.create({
        conversationId: interviewerConversation.id, senderKind: "system", senderId: null,
        body: `${student?.name ?? "候補者"}さんの日程調整を開始しました。候補日時の回答後に参加可否をご確認ください。`,
        msgType: "system_notice", payload: { requestId: request.id, rangeStart, rangeEnd, durationMinutes, requiredInterviewerCount }, requestId: request.id,
      })
      io.to(roomOf(interviewerConversation.id)).emit("newMessage", interviewerMessage)
    }
    scheduleReminder(io, calendarMessage)
    socket.emit("requestCreated", request)
    return request
  }

  socket.on("createRequest", createRequest)

  socket.on("createBulkRequests", async (payload = {}, acknowledge) => {
    const studentIds = [...new Set(Array.isArray(payload.studentIds) ? payload.studentIds : [])]
    const interviewerIds = [...new Set(Array.isArray(payload.interviewerIds) ? payload.interviewerIds : [])]
    const requiredCount = Number(payload.requiredInterviewerCount)
    const duration = Number(payload.durationMinutes)
    if (!studentIds.length || !interviewerIds.length || !payload.rangeStart || !payload.rangeEnd || !payload.responseDeadline
      || !Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > interviewerIds.length
      || !Number.isInteger(duration) || duration < 1 || duration > 60) {
      acknowledge?.({ ok: false, error: "invalid_fields" }); return
    }
    try {
      const requests = []
      for (const studentId of studentIds) requests.push(await createRequest({ ...payload, studentId, interviewerIds }))
      socket.emit("bulkRequestsCreated", { requests })
      acknowledge?.({ ok: true, count: requests.length })
      await sendDashboard()
    } catch (error) {
      console.error("[createBulkRequests] error", error)
      acknowledge?.({ ok: false, error: "internal_error" })
    }
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
