// テスト用の下ごしらえ。
// server/supabaseClient.js だけを差し替えることで、リポジトリ層から
// マッチングエンジンまでを本物のコードのまま動かす。
import { mock } from "node:test"
import { db, resetDb, seed, supabase } from "./fakeSupabase.js"

mock.module(new URL("../../server/supabaseClient.js", import.meta.url).href, {
  namedExports: { supabase },
})

export { db, resetDb, seed }

// 実際の io の代わりに、どのルームへ何が飛んだかを記録するだけのオブジェクト
export const makeIo = () => {
  const emitted = []
  return {
    emitted,
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
    messages: () => emitted.filter((e) => e.event === "newMessage").map((e) => e.payload),
  }
}

export const loadServer = async () => ({
  matching: await import("../../server/matching.js"),
  interviewRequestsRepo: (await import("../../server/repositories/interviewRequests.js")).interviewRequestsRepo,
  candidateSlotsRepo: (await import("../../server/repositories/candidateSlots.js")).candidateSlotsRepo,
  availabilityRepo: (await import("../../server/repositories/availability.js")).availabilityRepo,
  messagesRepo: (await import("../../server/repositories/messages.js")).messagesRepo,
  conversationsRepo: (await import("../../server/repositories/conversations.js")).conversationsRepo,
})

// 人事が日程調整依頼を作ったところまでを再現する（socket_event/hr.js の createRequest 相当）
export const setupRequest = async ({
  interviewerCount = 3,
  requiredInterviewerCount = 1,
  rangeStart = "2026-09-07",
  rangeEnd = "2026-09-20",
  studentName = "学生 太郎",
} = {}) => {
  const hr = seed("hr_staff", { name: "人事 花子", email: "hr@example.com" })
  const student = seed("students", { name: studentName, email: "student@example.com", selection_status: "first_interview" })
  const interviewers = Array.from({ length: interviewerCount }, (_, index) =>
    seed("interviewers", { name: `面接官${index + 1}`, email: `iv${index + 1}@example.com` })
  )

  const request = seed("interview_requests", {
    student_id: student.id,
    hr_id: hr.id,
    interviewer_ids: interviewers.map((i) => i.id),
    range_start: rangeStart,
    range_end: rangeEnd,
    status: "awaiting_student",
  })

  const studentConversation = seed("conversations", { kind: "student", student_id: student.id, hr_id: hr.id })
  const interviewerConversations = interviewers.map((interviewer) =>
    seed("conversations", { kind: "interviewer", interviewer_id: interviewer.id, hr_id: hr.id })
  )

  // 必要人数は学生へのカレンダー依頼メッセージの payload に入っている
  seed("messages", {
    conversation_id: studentConversation.id,
    sender_kind: "system",
    sender_id: null,
    body: "面接可能な日時を選んでください",
    msg_type: "calendar_request",
    payload: { requestId: request.id, rangeStart, rangeEnd, requiredInterviewerCount, durationMinutes: 60 },
    request_id: request.id,
  })

  return { hr, student, interviewers, request, studentConversation, interviewerConversations }
}

// 面接官の空き予定を事前登録する（⓪の画面で登録した状態）
export const setAvailability = (interviewerId, slotDate, slotHour, isAvailable) =>
  seed("availability", {
    interviewer_id: interviewerId,
    slot_date: slotDate,
    slot_hour: slotHour,
    is_available: isAvailable,
  })

// あるルームに飛んだメッセージだけを取り出す
export const messagesFor = (io, conversationId) =>
  io.messages().filter((message) => message.conversation_id === conversationId)

export const typesFor = (io, conversationId) => messagesFor(io, conversationId).map((m) => m.msg_type)
