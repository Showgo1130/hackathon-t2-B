import { availabilityRepo } from "./repositories/availability.js"
import { interviewRequestsRepo } from "./repositories/interviewRequests.js"
import { candidateSlotsRepo } from "./repositories/candidateSlots.js"
import { conversationsRepo } from "./repositories/conversations.js"
import { messagesRepo } from "./repositories/messages.js"
import { studentsRepo } from "./repositories/students.js"

const roomOf = (conversationId) => `conv:${conversationId}`

// messages.msg_type / interview_requests.status のCHECK制約は変更しないため、
// 承認依頼は system_notice、承認回答は result に payload.kind を付けて区別する
const APPROVAL_REQUEST = "match_approval"
const APPROVAL_ANSWER = "match_approval_answer"
const APPROVAL_CANCELLED = "match_approval_cancelled"
// 学生が候補を選び直したことで不要になった空き確認
const CHECK_WITHDRAWN = "availability_check_withdrawn"

const slotLabel = (slotDate, slotHour) => `${slotDate} ${String(slotHour).padStart(2, "0")}:00`
const roundLabel = (round) => (round >= 3 ? "最終面接" : `${round}次面接`)

// 面接官への通知に「誰との何次面接か」を載せる。
// 何次面接かはカラムが無いため、その学生の確定済み面接の数から求める
const describeRequest = async (request) => {
  const [student, confirmed] = await Promise.all([
    studentsRepo.findById(request.student_id),
    interviewRequestsRepo.listConfirmed(),
  ])
  const round = confirmed.filter((r) => r.student_id === request.student_id).length + 1
  return { studentName: student?.name ?? "候補者", round }
}

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

// その学生が別の面接で既に埋めている日時（学生自身のダブルブッキング防止）
const collectStudentBusySlots = async (studentId, exceptRequestId) => {
  const confirmed = await interviewRequestsRepo.listConfirmed()
  return new Set(
    confirmed
      .filter((r) => r.student_id === studentId && r.id !== exceptRequestId)
      .map((r) => slotKeyOf(r.confirmed_date, r.confirmed_hour))
  )
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
  const { studentName, round } = await describeRequest(request)
  for (const interviewerId of interviewerIds) {
    const key = keyOf(interviewerId, slot.slot_date, slot.slot_hour)
    if (approvalState.answers.has(key) || approvalState.openRequests.has(key)) continue

    const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
    await postMessage(io, conversation.id, {
      senderKind: "system",
      senderId: null,
      body: `${studentName} さん（${roundLabel(round)}）の日程が ${slotLabel(slot.slot_date, slot.slot_hour)} で合いました。この日程で確定してよろしいですか？`,
      msgType: "system_notice",
      payload: {
        kind: APPROVAL_REQUEST,
        slotDate: slot.slot_date,
        slotHour: slot.slot_hour,
        candidateSlotId: slot.id,
        studentName,
        round,
      },
      requestId: request.id,
    })
  }
}

// 承認が不要になったことを面接官に伝える（未回答のまま残った承認依頼を閉じる）
const cancelOpenApproval = async (io, request, interviewerId, slotDate, slotHour, reason) => {
  const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
  await postMessage(io, conversation.id, {
    senderKind: "system",
    senderId: null,
    body: `${slotLabel(slotDate, slotHour)} は${reason}ため、この日程の承認は不要になりました`,
    msgType: "system_notice",
    payload: { kind: APPROVAL_CANCELLED, slotDate, slotHour },
    requestId: request.id,
  })
}

// 承認を待っている間に、その日時が別の面接で埋まっていないかを確定の直前に確かめる。
// 照合の時点では空いていても、同じ枠の承認依頼が複数の依頼で並行して出ていることがある
const findSlotConflict = async (request, slot, attendeeIds, requiredCount) => {
  const slotKey = slotKeyOf(slot.slot_date, slot.slot_hour)

  const studentBusySlots = await collectStudentBusySlots(request.student_id, request.id)
  if (studentBusySlots.has(slotKey)) return { reason: "候補者に別の面接が入った", freeIds: [] }

  const busy = (await collectBusyInterviewers(attendeeIds)).get(slotKey) ?? new Set()
  const freeIds = attendeeIds.filter((id) => !busy.has(id))
  if (freeIds.length < requiredCount) return { reason: "面接官に別の面接が入った", freeIds }

  return { freeIds }
}

// ⑤ 必要人数の承認が揃ったので確定し、学生と面接官の双方に通知する
const finalize = async (io, request, slot) => {
  // 何次面接かは確定させる前に数える。確定してから数えると、この面接自身を含めて1つずれる
  const { studentName, round } = await describeRequest(request)

  // 参加者はこの枠を承認した面接官だけにする。依頼した全員を残すと、
  // 承認していない人の予定一覧に出てしまい、他の学生の照合でも埋まった扱いになる
  const { answers, openRequests } = await loadApprovalState(request)
  const approvedIds = request.interviewer_ids.filter(
    (id) => answers.get(keyOf(id, slot.slot_date, slot.slot_hour)) === true
  )
  const requiredCount = await requiredCountFor(request)
  const conflict = await findSlotConflict(
    request,
    slot,
    approvedIds.length ? approvedIds : request.interviewer_ids,
    requiredCount
  )

  // 先に別の面接が確定していたら、この枠は使えないので取り下げて次の候補へ回す
  if (conflict.reason) {
    await candidateSlotsRepo.setStatus(slot.id, "rejected")
    for (const interviewerId of request.interviewer_ids) {
      const key = keyOf(interviewerId, slot.slot_date, slot.slot_hour)
      if (!openRequests.has(key) && answers.get(key) !== true) continue
      await cancelOpenApproval(io, request, interviewerId, slot.slot_date, slot.slot_hour, conflict.reason)
    }
    await evaluateRequest(io, request)
    return null
  }

  const attendeeIds = conflict.freeIds
  const confirmed = await interviewRequestsRepo.confirm(request.id, {
    slotDate: slot.slot_date,
    slotHour: slot.slot_hour,
    interviewerIds: attendeeIds,
  })
  const body = `面接日程が確定しました: ${slotLabel(slot.slot_date, slot.slot_hour)}`
  const interviewerBody = `${studentName} さん（${roundLabel(round)}）の面接日程が確定しました: ${slotLabel(slot.slot_date, slot.slot_hour)}`
  const payload = { confirmedDate: slot.slot_date, confirmedHour: slot.slot_hour, studentName, round }

  const studentConversation = await conversationsRepo.findOrCreateForStudent(request.student_id, request.hr_id)
  await postMessage(io, studentConversation.id, {
    senderKind: "system",
    senderId: null,
    body,
    msgType: "system_notice",
    payload,
    requestId: request.id,
  })

  for (const interviewerId of attendeeIds) {
    const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
    await postMessage(io, conversation.id, {
      senderKind: "system",
      senderId: null,
      body: interviewerBody,
      msgType: "system_notice",
      payload,
      requestId: request.id,
    })
  }

  // 承認依頼が未回答のまま残っている面接官は、そのままだと未対応が消えないので閉じる
  for (const interviewerId of request.interviewer_ids) {
    if (attendeeIds.includes(interviewerId)) continue
    if (!openRequests.has(keyOf(interviewerId, slot.slot_date, slot.slot_hour))) continue
    await cancelOpenApproval(io, request, interviewerId, slot.slot_date, slot.slot_hour, "必要人数の承認が揃った")
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

  const { studentName, round } = await describeRequest(request)
  await postMessage(io, conversation.id, {
    senderKind: "system",
    senderId: null,
    body: `${studentName} さん（${roundLabel(round)}）の面接候補です。${slotLabel(slot.slot_date, slot.slot_hour)} は面接可能ですか？`,
    msgType: "availability_check",
    payload: { slotDate: slot.slot_date, slotHour: slot.slot_hour, candidateSlotId: slot.id, studentName, round },
    requestId: request.id,
  })
}

// ③ 学生提示の候補スロットと面接官の空き予定を照合する
export const evaluateRequest = async (io, request) => {
  await runEvaluation(io, request)
  await notifyRevisable(io, request)
}

const runEvaluation = async (io, request) => {
  const slots = await candidateSlotsRepo.listForRequest(request.id)
  // 承認待ちの枠があるうちは再照合しない（承認依頼の二重送信を防ぐ）
  if (slots.some((s) => s.status === "available_confirmed")) return

  const pendingSlots = slots.filter((s) => s.status === "pending_check")
  const approvalState = await loadApprovalState(request)
  const busyInterviewers = await collectBusyInterviewers(request.interviewer_ids)
  const studentBusySlots = await collectStudentBusySlots(request.student_id, request.id)
  const requiredCount = await requiredCountFor(request)

  for (const slot of pendingSlots) {
    // その学生が別の面接で埋めている時間は、面接官の空きに関係なく候補から外す
    if (studentBusySlots.has(slotKeyOf(slot.slot_date, slot.slot_hour))) {
      await candidateSlotsRepo.setStatus(slot.id, "rejected")
      continue
    }
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

// 学生が出した候補を修正できるのは「面接官の予定と照合される前」まで。
// 面接官が1件でも可否を答えているか、どれかの候補の照合が進んでいたら修正できない
export const canReviseSlots = async (request) => {
  if (!request || request.status !== "matching") return false
  const slots = await candidateSlotsRepo.listForRequest(request.id)
  if (slots.length === 0) return false
  if (slots.some((slot) => slot.status !== "pending_check")) return false
  for (const slot of slots) {
    const answers = await collectAnswers(request.interviewer_ids, slot.slot_date, slot.slot_hour)
    if (Object.values(answers).some((value) => value !== null)) return false
  }
  return true
}

// 修正できる間かどうかを学生の画面に伝える（送信直後は修正可、面接官が答えたら不可になる）
const notifyRevisable = async (io, request) => {
  const latest = (await interviewRequestsRepo.findById(request.id)) ?? request
  const conversation = await conversationsRepo.findOrCreateForStudent(latest.student_id, latest.hr_id)
  io.to(roomOf(conversation.id)).emit("calendarRevisable", {
    requestId: latest.id,
    revisable: await canReviseSlots(latest),
  })
}

// 学生が候補から外した日時の空き確認は、面接官側でも閉じる（答えても使われないため）
const withdrawStaleChecks = async (io, request, slots) => {
  const kept = new Set(slots.map(({ slotDate, slotHour }) => slotKeyOf(slotDate, Number(slotHour))))
  for (const interviewerId of request.interviewer_ids) {
    const conversation = await conversationsRepo.findOrCreateForInterviewer(interviewerId, request.hr_id)
    const history = await messagesRepo.listForConversation(conversation.id)
    const mine = history.filter((m) => m.request_id === request.id)
    const closed = new Set(
      mine
        .filter((m) => m.msg_type === "availability_answer" || m.payload?.kind === CHECK_WITHDRAWN)
        .map((m) => slotKeyOf(m.payload.slotDate, Number(m.payload.slotHour)))
    )
    for (const check of mine.filter((m) => m.msg_type === "availability_check")) {
      const { slotDate, slotHour } = check.payload
      const key = slotKeyOf(slotDate, Number(slotHour))
      if (kept.has(key) || closed.has(key)) continue
      closed.add(key)
      await postMessage(io, conversation.id, {
        senderKind: "system",
        senderId: null,
        body: `${slotLabel(slotDate, slotHour)} は候補者が候補から外したため、この日時の確認は不要になりました`,
        msgType: "system_notice",
        payload: { kind: CHECK_WITHDRAWN, slotDate, slotHour },
        requestId: request.id,
      })
    }
  }
}

// ② 学生が候補スロットを提出した（照合前の選び直しも同じ経路を通る）
export const submitStudentSlots = async (io, request, slots) => {
  await withdrawStaleChecks(io, request, slots)
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
        await cancelOpenApproval(io, request, otherId, slotDate, slotHour, "必要人数を満たせない")
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
