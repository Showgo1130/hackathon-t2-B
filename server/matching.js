import { availabilityRepo } from "./repositories/availability.js"
import { interviewRequestsRepo } from "./repositories/interviewRequests.js"
import { candidateSlotsRepo } from "./repositories/candidateSlots.js"
import { conversationsRepo } from "./repositories/conversations.js"
import { messagesRepo } from "./repositories/messages.js"

const roomOf = (conversationId) => `conv:${conversationId}`

// messages.msg_type / interview_requests.status のCHECK制約は変更しないため、
// 承認依頼は system_notice、承認回答は result に payload.kind を付けて区別する
const APPROVAL_REQUEST = "match_approval"
const APPROVAL_ANSWER = "match_approval_answer"

const slotLabel = (slotDate, slotHour) => `${slotDate} ${String(slotHour).padStart(2, "0")}:00`

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

const keyOf = (interviewerId, slotDate, slotHour) => `${interviewerId}_${slotDate}_${slotHour}`
const slotKeyOf = (slotDate, slotHour) => `${slotDate}_${slotHour}`

// 日時ごとに、別の面接で埋まっている面接官を集める（ダブルブッキング防止）
const collectBusyInterviewers = async (interviewerIds) => {
  const confirmed = await interviewRequestsRepo.listConfirmed()
  const bySlot = new Map()
  for (const request of confirmed) {
    const busyIds = request.interviewer_ids.filter((id) => interviewerIds.includes(id))
    if (busyIds.length) {
      const key = slotKeyOf(request.confirmed_date, request.confirmed_hour)
      if (!bySlot.has(key)) bySlot.set(key, new Set())
      busyIds.forEach((id) => bySlot.get(key).add(id))
    }
  }
  return bySlot
}

const requiredCountFor = async (request) => {
  const requestMessage = await messagesRepo.findCalendarRequest(request.id)
  const configured = Number(requestMessage?.payload?.requiredInterviewerCount)
  return Math.min(request.interviewer_ids.length,
    Number.isInteger(configured) && configured > 0 ? configured : request.interviewer_ids.length)
}

// 各面接官の承認回答（true=承認 / false=否認 / 未回答はキーなし）と、
// 未回答のまま残っている承認依頼を、面接官チャットの履歴から集める
const loadApprovalState = async (request) => {
  const answers = new Map()
  const openRequests = new Set()
  for (const interviewerId of request.interviewer_ids) {
    const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
    const history = await messagesRepo.listForConversation(conversation.id)
    const mine = history.filter((m) => m.request_id === request.id)
    mine
      .filter((m) => m.msg_type === "result" && m.payload?.kind === APPROVAL_ANSWER)
      .forEach((m) => answers.set(keyOf(interviewerId, m.payload.slotDate, m.payload.slotHour), m.payload.approved))
    mine
      .filter((m) => m.msg_type === "system_notice" && m.payload?.kind === APPROVAL_REQUEST)
      .forEach((m) => {
        const key = keyOf(interviewerId, m.payload.slotDate, m.payload.slotHour)
        if (!answers.has(key)) openRequests.add(key)
      })
  }
  return { answers, openRequests }
}

// ④ 全員の空きが合ったので、各面接官に承認を依頼する（まだ確定はしない）
const requestApproval = async (io, request, slot, approvalState, interviewerIds = request.interviewer_ids) => {
  for (const interviewerId of interviewerIds) {
    const key = keyOf(interviewerId, slot.slot_date, slot.slot_hour)
    if (approvalState.answers.has(key) || approvalState.openRequests.has(key)) continue

    const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
    await postMessage(io, conversation.id, {
      senderKind: "system",
      senderId: null,
      body: `${slotLabel(slot.slot_date, slot.slot_hour)} で日程が合いました。この日程で確定してよろしいですか？`,
      msgType: "system_notice",
      payload: {
        kind: APPROVAL_REQUEST,
        slotDate: slot.slot_date,
        slotHour: slot.slot_hour,
        candidateSlotId: slot.id,
      },
      requestId: request.id,
    })
  }
}

// ⑤ 全員の承認が揃ったので確定し、学生と面接官の双方に通知する
const finalize = async (io, request, slot) => {
  const confirmed = await interviewRequestsRepo.confirm(request.id, {
    slotDate: slot.slot_date,
    slotHour: slot.slot_hour,
  })
  const body = `面接日程が確定しました: ${slotLabel(slot.slot_date, slot.slot_hour)}`
  const payload = { confirmedDate: slot.slot_date, confirmedHour: slot.slot_hour }

  const studentConversation = await conversationsRepo.findOrCreateForStudent(request.student_id, request.hr_id)
  await postMessage(io, studentConversation.id, {
    senderKind: "system",
    senderId: null,
    body,
    msgType: "system_notice",
    payload,
    requestId: request.id,
  })

  for (const interviewerId of request.interviewer_ids) {
    const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
    await postMessage(io, conversation.id, {
      senderKind: "system",
      senderId: null,
      body,
      msgType: "system_notice",
      payload,
      requestId: request.id,
    })
  }
  return confirmed
}

// 候補が尽きたので、学生に候補日時の追加を依頼する
const requestAdditionalSlots = async (io, request) => {
  await interviewRequestsRepo.setStatus(request.id, "awaiting_student")
  const studentConversation = await conversationsRepo.findOrCreateForStudent(request.student_id, request.hr_id)
  await postMessage(io, studentConversation.id, {
    senderKind: "system",
    senderId: null,
    body: `提示いただいた候補では日程を確定できませんでした。お手数ですが ${request.range_start} 〜 ${request.range_end} の期間で、別の候補日時をいくつか追加で選んでください`,
    msgType: "calendar_request",
    payload: { requestId: request.id, rangeStart: request.range_start, rangeEnd: request.range_end },
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
    body: `${slotLabel(slot.slot_date, slot.slot_hour)} は面接可能ですか？`,
    msgType: "availability_check",
    payload: { slotDate: slot.slot_date, slotHour: slot.slot_hour, candidateSlotId: slot.id },
    requestId: request.id,
  })
}

// ③ 学生提示の候補スロットと面接官の空き予定を照合する
export const evaluateRequest = async (io, request) => {
  const slots = await candidateSlotsRepo.listForRequest(request.id)
  // 承認待ちの枠があるうちは再照合しない（承認依頼の二重送信を防ぐ）
  if (slots.some((s) => s.status === "available_confirmed")) return

  const pendingSlots = slots.filter((s) => s.status === "pending_check")
  const approvalState = await loadApprovalState(request)
  const busyInterviewers = await collectBusyInterviewers(request.interviewer_ids)
  const requiredCount = await requiredCountFor(request)

  for (const slot of pendingSlots) {
    const answers = await collectAnswers(request.interviewer_ids, slot.slot_date, slot.slot_hour)
    const busyIds = busyInterviewers.get(slotKeyOf(slot.slot_date, slot.slot_hour)) ?? new Set()
    const isEligible = (id) => !busyIds.has(id) && approvalState.answers.get(keyOf(id, slot.slot_date, slot.slot_hour)) !== false
    const availableIds = Object.entries(answers).filter(([id, value]) => value === true && isEligible(id)).map(([id]) => id)
    const undecidedIds = Object.entries(answers).filter(([id, value]) => value === null && isEligible(id)).map(([id]) => id)

    if (availableIds.length >= requiredCount) {
      await candidateSlotsRepo.setStatus(slot.id, "available_confirmed")
      const approvedCount = availableIds.filter((id) => approvalState.answers.get(keyOf(id, slot.slot_date, slot.slot_hour)) === true).length
      if (approvedCount >= requiredCount) {
        await finalize(io, request, slot)
      } else {
        await requestApproval(io, request, slot, approvalState, availableIds)
      }
      return
    }

    if (availableIds.length + undecidedIds.length < requiredCount) {
      await candidateSlotsRepo.setStatus(slot.id, "rejected")
      continue
    }
    for (const interviewerId of undecidedIds) {
      await sendAvailabilityCheck(io, request, interviewerId, slot)
    }
  }

  const refreshed = await candidateSlotsRepo.listForRequest(request.id)
  const stillOpen = refreshed.some((s) => s.status === "pending_check")
  if (!stillOpen) {
    const anyConfirmed = refreshed.some((s) => s.status === "available_confirmed")
    if (!anyConfirmed) {
      await requestAdditionalSlots(io, request)
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

// ④' 面接官がマッチング結果を承認／否認した
export const respondToMatchApproval = async (io, { interviewerId, requestId, slotDate, slotHour, approved }) => {
  const request = await interviewRequestsRepo.findById(requestId)
  if (!request || request.status !== "matching") return
  if (!request.interviewer_ids.includes(interviewerId)) return

  const { answers } = await loadApprovalState(request)
  if (answers.has(keyOf(interviewerId, slotDate, slotHour))) return

  const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
  await postMessage(io, conversation.id, {
    senderKind: "interviewer",
    senderId: interviewerId,
    body: `${slotLabel(slotDate, slotHour)} の日程を${approved ? "承認" : "見送り"}しました`,
    msgType: "result",
    payload: { kind: APPROVAL_ANSWER, slotDate, slotHour, approved },
    requestId,
  })
  // 自分の回答を書いた後に読み直す。こうすると同時承認でも、
  // 後に投稿した側が必ず全員分の回答を読めるため確定が取りこぼされない
  const { answers: latest } = await loadApprovalState(request)
  latest.set(keyOf(interviewerId, slotDate, slotHour), approved)

  const slot = await candidateSlotsRepo.findByRequestAndSlot(requestId, slotDate, slotHour)
  if (!slot) return
  const requiredCount = await requiredCountFor(request)

  if (!approved) {
    const availability = await collectAnswers(request.interviewer_ids, slotDate, slotHour)
    const busy = (await collectBusyInterviewers(request.interviewer_ids)).get(slotKeyOf(slotDate, slotHour)) ?? new Set()
    const possibleCount = request.interviewer_ids.filter((id) => availability[id] === true && !busy.has(id)
      && latest.get(keyOf(id, slotDate, slotHour)) !== false).length
    if (possibleCount < requiredCount) {
      await candidateSlotsRepo.setStatus(slot.id, "rejected")
      for (const otherId of request.interviewer_ids) {
        if (otherId === interviewerId || latest.has(keyOf(otherId, slotDate, slotHour))) continue
        const otherConversation = await conversationsRepo.findOrCreateForInterviewer(otherId, request.hr_id)
        await postMessage(io, otherConversation.id, {
          senderKind: "system", senderId: null,
          body: `${slotLabel(slotDate, slotHour)} は必要人数を満たせないため、この日程の承認は不要になりました`,
          msgType: "system_notice", payload: { kind: "match_approval_cancelled", slotDate, slotHour }, requestId,
        })
      }
      await evaluateRequest(io, request)
    }
    return
  }

  const approvedCount = request.interviewer_ids.filter((id) => latest.get(keyOf(id, slotDate, slotHour)) === true).length
  if (approvedCount >= requiredCount) {
    // 同時承認で finalize が二重に走らないよう、直前に状態を取り直す
    const fresh = await interviewRequestsRepo.findById(requestId)
    if (fresh?.status !== "matching") return
    await finalize(io, request, slot)
  }
}
