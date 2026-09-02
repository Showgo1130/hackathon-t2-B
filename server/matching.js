import { availabilityRepo } from "./repositories/availability.js"
import { interviewRequestsRepo } from "./repositories/interviewRequests.js"
import { candidateSlotsRepo } from "./repositories/candidateSlots.js"
import { conversationsRepo } from "./repositories/conversations.js"
import { messagesRepo } from "./repositories/messages.js"

const roomOf = (conversationId) => `conv:${conversationId}`

const postMessage = async (io, conversationId, messageData) => {
  const message = await messagesRepo.create({ conversationId, ...messageData })
  io.to(roomOf(conversationId)).emit("newMessage", message)
  return message
}

// 候補スロットに対する各面接官の空き状況（true/false/null=未登録）を取得する
const collectAnswers = async (interviewerIds, slotDate, slotHour) => {
  const answers = {}
  for (const interviewerId of interviewerIds) {
    answers[interviewerId] = await availabilityRepo.findOne(interviewerId, slotDate, slotHour)
  }
  return answers
}

const finalize = async (io, request, slot) => {
  const confirmed = await interviewRequestsRepo.confirm(request.id, { slotDate: slot.slot_date, slotHour: slot.slot_hour })
  const studentConversation = await conversationsRepo.findOrCreateForStudent(request.student_id, request.hr_id)
  await postMessage(io, studentConversation.id, {
    senderKind: "system",
    senderId: null,
    body: `面接日程が確定しました: ${slot.slot_date} ${String(slot.slot_hour).padStart(2, "0")}:00`,
    msgType: "system_notice",
    payload: { confirmedDate: slot.slot_date, confirmedHour: slot.slot_hour },
    requestId: request.id,
  })
  return confirmed
}

const notifyNoMatch = async (io, request) => {
  await interviewRequestsRepo.setStatus(request.id, "awaiting_student")
  const studentConversation = await conversationsRepo.findOrCreateForStudent(request.student_id, request.hr_id)
  await postMessage(io, studentConversation.id, {
    senderKind: "system",
    senderId: null,
    body: "提示された期間内では確定できる時間が見つかりませんでした。人事担当者が新しい期間を提示するまでお待ちください。",
    msgType: "system_notice",
    payload: null,
    requestId: request.id,
  })
}

const sendAvailabilityCheck = async (io, request, interviewerId, slot) => {
  const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
  const existing = await messagesRepo.findPendingAvailabilityCheck(conversation.id, request.id, slot.slot_date, slot.slot_hour)
  if (existing) return

  await postMessage(io, conversation.id, {
    senderKind: "system",
    senderId: null,
    body: `${slot.slot_date} ${String(slot.slot_hour).padStart(2, "0")}:00 は面接可能ですか？`,
    msgType: "availability_check",
    payload: { slotDate: slot.slot_date, slotHour: slot.slot_hour, candidateSlotId: slot.id },
    requestId: request.id,
  })
}

// ③ 学生提示の候補スロットと面接官の空き予定を照合する
export const evaluateRequest = async (io, request) => {
  const slots = await candidateSlotsRepo.listForRequest(request.id)
  const pendingSlots = slots.filter((s) => s.status === "pending_check")

  for (const slot of pendingSlots) {
    const answers = await collectAnswers(request.interviewer_ids, slot.slot_date, slot.slot_hour)
    const values = Object.values(answers)

    if (values.some((v) => v === false)) {
      await candidateSlotsRepo.setStatus(slot.id, "rejected")
      continue
    }

    if (values.every((v) => v === true)) {
      await candidateSlotsRepo.setStatus(slot.id, "available_confirmed")
      await finalize(io, request, slot)
      return
    }

    const unknownInterviewerIds = Object.entries(answers)
      .filter(([, v]) => v === null)
      .map(([id]) => id)
    for (const interviewerId of unknownInterviewerIds) {
      await sendAvailabilityCheck(io, request, interviewerId, slot)
    }
  }

  const refreshed = await candidateSlotsRepo.listForRequest(request.id)
  const stillOpen = refreshed.some((s) => s.status === "pending_check")
  if (!stillOpen) {
    const anyConfirmed = refreshed.some((s) => s.status === "available_confirmed")
    if (!anyConfirmed) {
      await notifyNoMatch(io, request)
    }
  }
}

// ② 学生が候補スロットを提出した
export const submitStudentSlots = async (io, request, slots) => {
  await interviewRequestsRepo.setStatus(request.id, "matching")
  await candidateSlotsRepo.replaceForRequest(request.id, slots)
  await evaluateRequest(io, request)
}

// 面接官がavailability_checkに回答した（ボタン／チャット返信どちらも同じ経路を通る）
export const answerAvailability = async (io, { interviewerId, slotDate, slotHour, isAvailable }) => {
  await availabilityRepo.upsert({ interviewerId, slotDate, slotHour, isAvailable })

  const activeRequests = await interviewRequestsRepo.listActiveForInterviewer(interviewerId)
  for (const request of activeRequests) {
    const slot = await candidateSlotsRepo.findByRequestAndSlot(request.id, slotDate, slotHour)
    if (slot && slot.status === "pending_check") {
      await evaluateRequest(io, request)
    }
  }
}
