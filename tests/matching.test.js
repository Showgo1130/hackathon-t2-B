// 照合エンジン（server/matching.js）の総合テスト。
// リポジトリ層は本物のまま、Supabase だけインメモリに差し替えて動かしている。
import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import {
  db,
  loadServer,
  makeIo,
  messagesFor,
  resetDb,
  seed as seedRow,
  setAvailability,
  setupRequest,
} from "./helpers/harness.js"

const SLOT_A = { slotDate: "2026-09-10", slotHour: 14 }
const SLOT_B = { slotDate: "2026-09-11", slotHour: 10 }
const SLOT_C = { slotDate: "2026-09-12", slotHour: 16 }

let matching
let interviewRequestsRepo
let candidateSlotsRepo
let conversationsRepo

const typesOf = (io, conversationId) => messagesFor(io, conversationId).map((m) => m.msg_type)
const kindsOf = (io, conversationId) => messagesFor(io, conversationId).map((m) => m.payload?.kind ?? m.msg_type)

const slotStatus = async (requestId, { slotDate, slotHour }) =>
  (await candidateSlotsRepo.findByRequestAndSlot(requestId, slotDate, slotHour))?.status

const conversationOf = (interviewerId) =>
  db.conversations.find((c) => c.kind === "interviewer" && c.interviewer_id === interviewerId).id
const conversationOfStudent = (studentId) =>
  db.conversations.find((c) => c.kind === "student" && c.student_id === studentId).id

const reload = (requestId) => interviewRequestsRepo.findById(requestId)

beforeEach(async () => {
  resetDb()
  const loaded = await loadServer()
  matching = loaded.matching
  interviewRequestsRepo = loaded.interviewRequestsRepo
  candidateSlotsRepo = loaded.candidateSlotsRepo
  conversationsRepo = loaded.conversationsRepo
})

describe("② 学生の候補提出 → ③ 面接官への空き確認", () => {
  it("空き未登録の面接官全員に、候補日時ごとの空き確認が飛ぶ", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 1 })
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A, SLOT_B])

    const checks = io.messages().filter((m) => m.msg_type === "availability_check")
    assert.equal(checks.length, 6, "3人 × 2候補 = 6件の確認が飛ぶ")
    for (const interviewer of interviewers) {
      assert.equal(messagesFor(io, conversationOf(interviewer.id)).length, 2)
    }
    assert.equal((await reload(request.id)).status, "matching")
  })

  it("すでに「不可」と登録済みの面接官には確認を送らない", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, false)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])

    assert.deepEqual(typesOf(io, conversationOf(interviewers[0].id)), [])
    assert.deepEqual(typesOf(io, conversationOf(interviewers[1].id)), ["availability_check"])
    assert.deepEqual(typesOf(io, conversationOf(interviewers[2].id)), ["availability_check"])
  })

  it("すでに「可能」と登録済みなら確認を飛ばさず、そのまま承認依頼に進む", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])

    assert.deepEqual(kindsOf(io, conversationOf(interviewers[0].id)), ["match_approval"])
    assert.equal(await slotStatus(request.id, SLOT_A), "available_confirmed")
    // 承認待ちに入った枠があるので、他の面接官に空き確認は飛ばさない
    assert.deepEqual(typesOf(io, conversationOf(interviewers[1].id)), [])
  })

  it("必要人数を満たしようがない候補は却下され、候補が尽きたら学生に追加提出を促す", async () => {
    const { request, interviewers, studentConversation } = await setupRequest({
      interviewerCount: 2,
      requiredInterviewerCount: 1,
    })
    interviewers.forEach((i) => setAvailability(i.id, SLOT_A.slotDate, SLOT_A.slotHour, false))
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])

    assert.equal(await slotStatus(request.id, SLOT_A), "rejected")
    assert.deepEqual(typesOf(io, studentConversation.id), ["calendar_request"])
    assert.equal((await reload(request.id)).status, "awaiting_student")
  })

  it("同じ候補への空き確認は二重送信しない", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 2, requiredInterviewerCount: 1 })
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.evaluateRequest(io, await reload(request.id))

    assert.equal(io.messages().filter((m) => m.msg_type === "availability_check").length, 2)
    assert.equal(messagesFor(io, conversationOf(interviewers[0].id)).length, 1)
  })
})

describe("③ 空き確認への回答", () => {
  it("必要人数に届いた時点で承認依頼へ進む（必要1名）", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 1 })
    const io = makeIo()
    await matching.submitStudentSlots(io, request, [SLOT_A])
    io.emitted.length = 0

    await matching.answerAvailability(io, {
      interviewerId: interviewers[0].id,
      ...SLOT_A,
      isAvailable: true,
    })

    assert.equal(await slotStatus(request.id, SLOT_A), "available_confirmed")
    assert.deepEqual(kindsOf(io, conversationOf(interviewers[0].id)), ["match_approval"])
    assert.deepEqual(kindsOf(io, conversationOf(interviewers[1].id)), [], "必要人数を満たしたので他には出さない")
  })

  it("必要2名なら、2人目が「可能」と答えるまで承認依頼を出さない", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 2 })
    const io = makeIo()
    await matching.submitStudentSlots(io, request, [SLOT_A])
    io.emitted.length = 0

    await matching.answerAvailability(io, { interviewerId: interviewers[0].id, ...SLOT_A, isAvailable: true })
    assert.equal(await slotStatus(request.id, SLOT_A), "pending_check")
    assert.equal(io.messages().filter((m) => m.payload?.kind === "match_approval").length, 0)

    await matching.answerAvailability(io, { interviewerId: interviewers[1].id, ...SLOT_A, isAvailable: true })
    assert.equal(await slotStatus(request.id, SLOT_A), "available_confirmed")
    const approvals = io.messages().filter((m) => m.payload?.kind === "match_approval")
    assert.equal(approvals.length, 2, "空いている2人だけに承認依頼が飛ぶ")
    assert.deepEqual(kindsOf(io, conversationOf(interviewers[2].id)), [])
  })

  it("「不可」の回答が積み重なって必要人数を満たせなくなったら、次の候補に移る", async () => {
    const { request, interviewers } = await setupRequest({ interviewerCount: 2, requiredInterviewerCount: 2 })
    const io = makeIo()
    await matching.submitStudentSlots(io, request, [SLOT_A, SLOT_B])
    io.emitted.length = 0

    await matching.answerAvailability(io, { interviewerId: interviewers[0].id, ...SLOT_A, isAvailable: false })

    assert.equal(await slotStatus(request.id, SLOT_A), "rejected")
    assert.equal(await slotStatus(request.id, SLOT_B), "pending_check")
  })
})

describe("④ 承認と確定", () => {
  const reachApproval = async (io, options) => {
    const context = await setupRequest(options)
    await matching.submitStudentSlots(io, context.request, [SLOT_A, SLOT_B])
    for (const interviewer of context.interviewers.slice(0, options.availableCount ?? 1)) {
      await matching.answerAvailability(io, { interviewerId: interviewer.id, ...SLOT_A, isAvailable: true })
    }
    io.emitted.length = 0
    return context
  }

  it("必要1名なら1人の承認で確定し、学生と承認した面接官に確定通知が届く", async () => {
    const io = makeIo()
    const { request, interviewers, studentConversation } = await reachApproval(io, {
      interviewerCount: 3,
      requiredInterviewerCount: 1,
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id,
      requestId: request.id,
      ...SLOT_A,
      approved: true,
    })

    const stored = await reload(request.id)
    assert.equal(stored.status, "confirmed")
    assert.equal(stored.confirmed_date, SLOT_A.slotDate)
    assert.equal(stored.confirmed_hour, SLOT_A.slotHour)

    const studentNotice = messagesFor(io, studentConversation.id).at(-1)
    assert.equal(studentNotice.msg_type, "system_notice")
    assert.equal(studentNotice.payload.confirmedDate, SLOT_A.slotDate)
    assert.equal(studentNotice.payload.round, 1)

    const noticesFor = (interviewer) =>
      messagesFor(io, conversationOf(interviewer.id)).filter((m) => m.payload?.confirmedDate)
    assert.equal(noticesFor(interviewers[0]).length, 1, "承認した面接官には確定通知が届く")
    assert.equal(noticesFor(interviewers[1]).length, 0, "承認していない面接官には送らない")
    assert.deepEqual(stored.interviewer_ids, [interviewers[0].id])
  })

  it("必要2名なら、2人目の承認が揃うまで確定しない", async () => {
    const io = makeIo()
    const { request, interviewers } = await reachApproval(io, {
      interviewerCount: 3,
      requiredInterviewerCount: 2,
      availableCount: 2,
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    assert.equal((await reload(request.id)).status, "matching")

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[1].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    assert.equal((await reload(request.id)).status, "confirmed")
  })

  it("同じ面接官が二度承認しても、確定は一度しか起きない", async () => {
    const io = makeIo()
    const { request, interviewers } = await reachApproval(io, {
      interviewerCount: 3,
      requiredInterviewerCount: 2,
      availableCount: 2,
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })

    assert.equal((await reload(request.id)).status, "matching", "同じ人の2回目は無視される")
    const answers = io.messages().filter((m) => m.payload?.kind === "match_approval_answer")
    assert.equal(answers.length, 1)
  })

  it("確定後に届いた承認・見送りは無視される", async () => {
    const io = makeIo()
    const { request, interviewers } = await reachApproval(io, {
      interviewerCount: 3,
      requiredInterviewerCount: 1,
      availableCount: 2,
    })
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    const before = io.messages().length

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[1].id, requestId: request.id, ...SLOT_A, approved: false,
    })

    assert.equal(io.messages().length, before, "確定済みなので何も起きない")
    assert.equal((await reload(request.id)).confirmed_date, SLOT_A.slotDate)
  })

  it("依頼に含まれていない面接官の回答は受け付けない", async () => {
    const io = makeIo()
    const { request } = await reachApproval(io, { interviewerCount: 2, requiredInterviewerCount: 1 })

    await matching.respondToMatchApproval(io, {
      interviewerId: "not-in-this-request", requestId: request.id, ...SLOT_A, approved: true,
    })

    assert.equal((await reload(request.id)).status, "matching")
    assert.equal(io.messages().length, 0)
  })
})

describe("④' 見送り", () => {
  const reachApproval = async (io, { interviewerCount, requiredInterviewerCount, availableCount, slots }) => {
    const context = await setupRequest({ interviewerCount, requiredInterviewerCount })
    await matching.submitStudentSlots(io, context.request, slots)
    for (const interviewer of context.interviewers.slice(0, availableCount)) {
      await matching.answerAvailability(io, { interviewerId: interviewer.id, ...slots[0], isAvailable: true })
    }
    io.emitted.length = 0
    return context
  }

  it("残りの面接官で必要人数を満たせるなら、候補は承認待ちのまま残る", async () => {
    const io = makeIo()
    const { request, interviewers } = await reachApproval(io, {
      interviewerCount: 3, requiredInterviewerCount: 1, availableCount: 3, slots: [SLOT_A, SLOT_B],
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: false,
    })

    assert.equal(await slotStatus(request.id, SLOT_A), "available_confirmed")
    assert.equal((await reload(request.id)).status, "matching")
    const answer = messagesFor(io, conversationOf(interviewers[0].id)).at(-1)
    assert.equal(answer.payload.kind, "match_approval_answer")
    assert.equal(answer.payload.approved, false)
    const cancels = io.messages().filter((m) => m.payload?.kind === "match_approval_cancelled")
    assert.equal(cancels.length, 0, "他の人はまだ承認できるのでキャンセルしない")
  })

  it("必要人数を満たせなくなったら候補を却下し、未回答者の承認依頼を取り消して次の候補へ進む", async () => {
    const io = makeIo()
    const { request, interviewers } = await reachApproval(io, {
      interviewerCount: 2, requiredInterviewerCount: 2, availableCount: 2, slots: [SLOT_A, SLOT_B],
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: false,
    })

    assert.equal(await slotStatus(request.id, SLOT_A), "rejected")
    const cancels = io.messages().filter((m) => m.payload?.kind === "match_approval_cancelled")
    assert.equal(cancels.length, 1)
    assert.equal(cancels[0].conversation_id, conversationOf(interviewers[1].id))
    // 次の候補は生きたまま残る（空き確認は候補提出時に送信済みなので二重送信しない）
    assert.equal(await slotStatus(request.id, SLOT_B), "pending_check")
    assert.equal(io.messages().filter((m) => m.msg_type === "availability_check").length, 0)
    assert.equal((await reload(request.id)).status, "matching")
  })

  it("見送りで候補が尽きたら、学生に追加の候補提出を依頼する", async () => {
    const io = makeIo()
    const { request, interviewers, studentConversation } = await reachApproval(io, {
      interviewerCount: 2, requiredInterviewerCount: 2, availableCount: 2, slots: [SLOT_A],
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: false,
    })

    assert.equal(await slotStatus(request.id, SLOT_A), "rejected")
    assert.deepEqual(typesOf(io, studentConversation.id), ["calendar_request"])
    assert.equal((await reload(request.id)).status, "awaiting_student")
  })

  it("見送った面接官は、確定後の参加者に含まれない", async () => {
    const io = makeIo()
    const { request, interviewers } = await reachApproval(io, {
      interviewerCount: 3, requiredInterviewerCount: 1, availableCount: 3, slots: [SLOT_A],
    })

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: false,
    })
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[1].id, requestId: request.id, ...SLOT_A, approved: true,
    })

    const stored = await reload(request.id)
    assert.equal(stored.status, "confirmed")
    assert.ok(
      !stored.interviewer_ids.includes(interviewers[0].id),
      "見送った面接官が参加者に残ると、その人の予定一覧にも出てしまう"
    )
  })

  it("確定したら、未回答のまま残った承認依頼を取り消す", async () => {
    // 3人とも空き登録済みなので、必要2名でも3人に承認依頼が飛ぶ
    const { request, interviewers } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 2 })
    interviewers.forEach((i) => setAvailability(i.id, SLOT_A.slotDate, SLOT_A.slotHour, true))
    const io = makeIo()
    await matching.submitStudentSlots(io, request, [SLOT_A])
    assert.equal(io.messages().filter((m) => m.payload?.kind === "match_approval").length, 3)
    io.emitted.length = 0

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[1].id, requestId: request.id, ...SLOT_A, approved: true,
    })

    assert.equal((await reload(request.id)).status, "confirmed")
    const cancelled = messagesFor(io, conversationOf(interviewers[2].id))
      .some((m) => m.payload?.kind === "match_approval_cancelled")
    assert.ok(cancelled, "確定後も承認依頼が未対応のまま残ると、通知バッジが消えない")
    assert.deepEqual((await reload(request.id)).interviewer_ids, [interviewers[0].id, interviewers[1].id])
  })
})

describe("ダブルブッキング防止", () => {
  it("同じ日時に別の面接が確定している面接官は候補から外れる", async () => {
    const first = await setupRequest({ interviewerCount: 2, requiredInterviewerCount: 1 })
    const io = makeIo()
    await matching.submitStudentSlots(io, first.request, [SLOT_A])
    await matching.answerAvailability(io, { interviewerId: first.interviewers[0].id, ...SLOT_A, isAvailable: true })
    await matching.respondToMatchApproval(io, {
      interviewerId: first.interviewers[0].id, requestId: first.request.id, ...SLOT_A, approved: true,
    })
    assert.equal((await reload(first.request.id)).status, "confirmed")

    // 同じ面接官に、同じ日時で別の学生の依頼を出す
    const busyInterviewer = first.interviewers[0]
    const student2 = db.students[0]
    const second = db.interview_requests[0]
    const request2 = {
      ...second,
      id: "request-2",
    }
    db.interview_requests.push({
      ...request2,
      student_id: student2.id,
      status: "awaiting_student",
      confirmed_date: null,
      confirmed_hour: null,
      interviewer_ids: [busyInterviewer.id],
    })
    db.messages.push({
      id: "calendar-2",
      created_at: new Date().toISOString(),
      conversation_id: first.studentConversation.id,
      msg_type: "calendar_request",
      request_id: "request-2",
      payload: { requiredInterviewerCount: 1 },
    })
    // その面接官はその時間を「可能」と登録済み
    setAvailability(busyInterviewer.id, SLOT_A.slotDate, SLOT_A.slotHour, true)

    const io2 = makeIo()
    await matching.submitStudentSlots(io2, await reload("request-2"), [SLOT_A])

    assert.equal(await slotStatus("request-2", SLOT_A), "rejected", "埋まっている面接官は数えない")
  })
})

describe("何次面接の判定", () => {
  it("1件目の確定通知は「1次面接」として届く", async () => {
    const io = makeIo()
    const { request, interviewers, studentConversation } = await setupRequest({
      interviewerCount: 1,
      requiredInterviewerCount: 1,
    })
    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.answerAvailability(io, { interviewerId: interviewers[0].id, ...SLOT_A, isAvailable: true })

    const approval = io.messages().find((m) => m.payload?.kind === "match_approval")
    assert.equal(approval.payload.round, 1, "承認依頼の時点では1次面接")

    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })

    const notice = messagesFor(io, studentConversation.id).at(-1)
    assert.equal(notice.payload.round, 1, "確定通知でも1次面接のまま届くこと")
  })

  it("同じ学生の2件目の確定は「2次面接」として通知される", async () => {
    const io = makeIo()
    const first = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    await matching.submitStudentSlots(io, first.request, [SLOT_A])
    await matching.answerAvailability(io, { interviewerId: first.interviewers[0].id, ...SLOT_A, isAvailable: true })
    await matching.respondToMatchApproval(io, {
      interviewerId: first.interviewers[0].id, requestId: first.request.id, ...SLOT_A, approved: true,
    })

    const request2 = {
      ...first.request,
      id: "request-2",
      status: "awaiting_student",
      confirmed_date: null,
      confirmed_hour: null,
    }
    db.interview_requests.push(request2)
    db.messages.push({
      id: "calendar-2",
      created_at: new Date().toISOString(),
      conversation_id: first.studentConversation.id,
      msg_type: "calendar_request",
      request_id: "request-2",
      payload: { requiredInterviewerCount: 1 },
    })
    setAvailability(first.interviewers[0].id, SLOT_C.slotDate, SLOT_C.slotHour, true)

    io.emitted.length = 0
    await matching.submitStudentSlots(io, request2, [SLOT_C])

    const approval = io.messages().find((m) => m.payload?.kind === "match_approval")
    assert.equal(approval.payload.round, 2)
    assert.match(approval.body, /2次面接/)
  })
})

describe("複数の学生へ同時に送ったときの照合", () => {
  // 人事が同じ面接官の集合に対して、複数の学生の依頼を並行して回す状況をつくる
  const addRequest = (id, name, interviewers, hrId, requiredInterviewerCount) => {
    const student = seedRow("students", { name, email: `${name}@example.com` })
    const request = seedRow("interview_requests", {
      id,
      student_id: student.id,
      hr_id: hrId,
      interviewer_ids: interviewers.map((i) => i.id),
      range_start: "2026-09-07",
      range_end: "2026-09-20",
      status: "awaiting_student",
    })
    seedRow("conversations", { kind: "student", student_id: student.id, hr_id: hrId })
    seedRow("messages", {
      conversation_id: "calendar-holder",
      msg_type: "calendar_request",
      request_id: id,
      payload: { requiredInterviewerCount },
    })
    return { student, request }
  }

  it("確定した面接に、承認していない面接官まで参加者として残さない", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 4, requiredInterviewerCount: 2 })
    interviewers.forEach((i) => setAvailability(i.id, SLOT_A.slotDate, SLOT_A.slotHour, true))
    const io = makeIo()

    // 学生1：4人に依頼して、そのうち2人の承認で確定させる
    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[1].id, requestId: request.id, ...SLOT_A, approved: true,
    })
    assert.equal((await reload(request.id)).status, "confirmed")

    // 学生2：同じ枠を希望。まだ承認していない面接官3・4が空いているので成立するはず
    addRequest("request-2", "学生2", interviewers, hr.id, 2)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])

    assert.notEqual(
      await slotStatus("request-2", SLOT_A),
      "rejected",
      "承認していない面接官まで埋まった扱いになると、他の学生の日程が組めなくなる"
    )
  })

  it("学生ごとに依頼は独立していて、片方の確定が他方の候補を消さない", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 2, requiredInterviewerCount: 1 })
    const io = makeIo()

    const second = addRequest("request-2", "学生2", interviewers, hr.id, 1)
    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_B])

    // 面接官1が学生1の枠に「可能」と答えても、学生2の候補には影響しない
    await matching.answerAvailability(io, { interviewerId: interviewers[0].id, ...SLOT_A, isAvailable: true })

    assert.equal(await slotStatus(request.id, SLOT_A), "available_confirmed")
    assert.equal(await slotStatus("request-2", SLOT_B), "pending_check")
    assert.equal((await reload(second.request.id)).status, "matching")
  })

  it("別々の日時なら、同じ面接官が続けて2人の面接を確定できる", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    setAvailability(interviewers[0].id, SLOT_B.slotDate, SLOT_B.slotHour, true)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })

    addRequest("request-2", "学生2", interviewers, hr.id, 1)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_B])
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: "request-2", ...SLOT_B, approved: true,
    })

    assert.equal((await reload(request.id)).status, "confirmed")
    assert.equal((await reload("request-2")).status, "confirmed")
    assert.equal((await reload("request-2")).confirmed_date, SLOT_B.slotDate)
  })

  it("同じ日時に2人目を入れようとすると、埋まっている面接官として弾かれる", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.respondToMatchApproval(io, {
      interviewerId: interviewers[0].id, requestId: request.id, ...SLOT_A, approved: true,
    })

    addRequest("request-2", "学生2", interviewers, hr.id, 1)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])

    assert.equal(await slotStatus("request-2", SLOT_A), "rejected")
    assert.equal((await reload("request-2")).status, "awaiting_student")
  })
})

describe("ダブルブッキング防止（重点確認）", () => {
  // 同じ面接官の集合に対して、2件目の依頼を用意する
  const addRequest = (id, name, interviewers, hrId, requiredInterviewerCount, student = null) => {
    const target = student ?? seedRow("students", { name, email: `${name}@example.com` })
    const request = seedRow("interview_requests", {
      id,
      student_id: target.id,
      hr_id: hrId,
      interviewer_ids: interviewers.map((i) => i.id),
      range_start: "2026-09-07",
      range_end: "2026-09-20",
      status: "awaiting_student",
    })
    seedRow("conversations", { kind: "student", student_id: target.id, hr_id: hrId })
    seedRow("messages", {
      conversation_id: "calendar-holder",
      msg_type: "calendar_request",
      request_id: id,
      payload: { requiredInterviewerCount },
    })
    return { student: target, request }
  }

  const approve = (io, requestId, interviewerId, slot) =>
    matching.respondToMatchApproval(io, { interviewerId, requestId, ...slot, approved: true })

  it("承認依頼が2件同時に出ていても、先に確定した枠は後から二重に埋まらない", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    const second = addRequest("request-2", "学生2", interviewers, hr.id, 1)
    const io = makeIo()

    // 2件とも「空いている」と判定され、承認依頼が出た状態にする
    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])
    assert.equal(await slotStatus(request.id, SLOT_A), "available_confirmed")
    assert.equal(await slotStatus("request-2", SLOT_A), "available_confirmed")

    await approve(io, request.id, interviewers[0].id, SLOT_A)
    assert.equal((await reload(request.id)).status, "confirmed")

    // ここで2件目も承認してしまうと、同じ面接官の同じ時間が二重に埋まる
    await approve(io, "request-2", interviewers[0].id, SLOT_A)

    assert.notEqual(
      (await reload("request-2")).status,
      "confirmed",
      "同じ面接官・同じ日時の面接が2件確定してしまっている"
    )
  })

  it("枠が先に埋まったら、その依頼は次の候補日時へ回る", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    setAvailability(interviewers[0].id, SLOT_B.slotDate, SLOT_B.slotHour, true)
    addRequest("request-2", "学生2", interviewers, hr.id, 1)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    // 2件目は第1候補が同じ、第2候補は別の日時
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A, SLOT_B])

    await approve(io, request.id, interviewers[0].id, SLOT_A)
    io.emitted.length = 0
    await approve(io, "request-2", interviewers[0].id, SLOT_A)

    assert.equal(await slotStatus("request-2", SLOT_A), "rejected")
    // 取り下げたことを面接官に伝えたうえで、次の候補の承認依頼を出す
    const cancels = io.messages().filter((m) => m.payload?.kind === "match_approval_cancelled")
    assert.equal(cancels.length, 1)
    assert.match(cancels[0].body, /別の面接が入った/)
    const nextApproval = io.messages().find((m) => m.payload?.kind === "match_approval")
    assert.equal(nextApproval.payload.slotDate, SLOT_B.slotDate)
    assert.equal(await slotStatus("request-2", SLOT_B), "available_confirmed")
  })

  it("次の候補も無ければ、学生に追加の候補提出を依頼する", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    const second = addRequest("request-2", "学生2", interviewers, hr.id, 1)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])

    await approve(io, request.id, interviewers[0].id, SLOT_A)
    io.emitted.length = 0
    await approve(io, "request-2", interviewers[0].id, SLOT_A)

    assert.equal((await reload("request-2")).status, "awaiting_student")
    const followUp = io
      .messages()
      .find((m) => m.msg_type === "calendar_request" && m.request_id === "request-2")
    assert.ok(followUp, "候補が尽きたので学生に選び直しを依頼する")
    assert.equal(followUp.conversation_id, conversationOfStudent(second.student.id))
  })

  it("必要2名のうち1名が別件で埋まっていると、その枠では成立しない", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 2, requiredInterviewerCount: 1 })
    interviewers.forEach((i) => setAvailability(i.id, SLOT_A.slotDate, SLOT_A.slotHour, true))
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await approve(io, request.id, interviewers[0].id, SLOT_A)
    assert.deepEqual((await reload(request.id)).interviewer_ids, [interviewers[0].id])

    // 2件目は必要2名。面接官1は同じ時間に埋まっているので足りない
    addRequest("request-2", "学生2", interviewers, hr.id, 2)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])

    assert.equal(await slotStatus("request-2", SLOT_A), "rejected")
  })

  it("埋まっていない面接官だけで必要人数を満たせれば成立する", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 3, requiredInterviewerCount: 1 })
    interviewers.forEach((i) => setAvailability(i.id, SLOT_A.slotDate, SLOT_A.slotHour, true))
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await approve(io, request.id, interviewers[0].id, SLOT_A)

    addRequest("request-2", "学生2", interviewers, hr.id, 2)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])

    // 面接官2・3が空いているので、必要2名でも成立して承認待ちに進む
    assert.equal(await slotStatus("request-2", SLOT_A), "available_confirmed")
    const approvals = io.messages().filter((m) => m.payload?.kind === "match_approval" && m.request_id === "request-2")
    assert.deepEqual(
      approvals.map((m) => m.conversation_id).sort(),
      [conversationOf(interviewers[1].id), conversationOf(interviewers[2].id)].sort(),
      "埋まっている面接官には承認依頼を出さない"
    )
  })

  it("同じ学生の面接を、同じ日時に二重に入れない", async () => {
    const { request, interviewers, hr, student } = await setupRequest({
      interviewerCount: 2,
      requiredInterviewerCount: 1,
    })
    interviewers.forEach((i) => setAvailability(i.id, SLOT_A.slotDate, SLOT_A.slotHour, true))
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await approve(io, request.id, interviewers[0].id, SLOT_A)

    // 同じ学生に、同じ時間帯で別の面接（次の選考など）を回す
    addRequest("request-2", "同一学生の2件目", interviewers, hr.id, 1, student)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])
    await approve(io, "request-2", interviewers[1].id, SLOT_A)

    assert.notEqual(
      (await reload("request-2")).status,
      "confirmed",
      "同じ学生が同じ日時に2件の面接を持ってしまっている"
    )
  })

  it("面接官が空きを取り消しても、確定済みの予定は別依頼の候補にならない", async () => {
    const { request, interviewers, hr } = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    setAvailability(interviewers[0].id, SLOT_A.slotDate, SLOT_A.slotHour, true)
    const io = makeIo()

    await matching.submitStudentSlots(io, request, [SLOT_A])
    await approve(io, request.id, interviewers[0].id, SLOT_A)

    addRequest("request-2", "学生2", interviewers, hr.id, 1)
    await matching.submitStudentSlots(io, await reload("request-2"), [SLOT_A])

    assert.equal(await slotStatus("request-2", SLOT_A), "rejected")
    assert.equal(
      io.messages().filter((m) => m.msg_type === "availability_check" && m.request_id === "request-2").length,
      0,
      "埋まっている面接官に空き確認を送らない"
    )
  })
})
