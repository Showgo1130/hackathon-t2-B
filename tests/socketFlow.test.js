// Socket.io のハンドラ（socket_event/*.js）を実サーバー・実クライアントで通しでテストする。
// DB だけインメモリに差し替え、イベントの往復は本物の socket.io を使う。
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { after, afterEach, before, beforeEach, describe, it } from "node:test"
import { Server } from "socket.io"
import { io as connectClient } from "socket.io-client"
import { db, resetDb, seed, setupRequest } from "./helpers/harness.js"

let httpServer
let port
const clients = []

const nextEvent = (socket, event, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`"${event}" が ${timeoutMs}ms 以内に届かなかった`)), timeoutMs)
    socket.once(event, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })

// 接続だけして、最初の emit はテスト側で行う（リロード時の順序を再現するため）
const openSocket = (user) => {
  const socket = connectClient(`http://localhost:${port}`, { auth: { user }, forceNew: true })
  clients.push(socket)
  return socket
}

const connectAs = async (user) => {
  const socket = openSocket(user)
  const init = await nextEvent(socket, "init")
  return { socket, init }
}

before(async () => {
  const { default: socketEvents } = await import("../socket_event/index.js")
  httpServer = createServer()
  const io = new Server(httpServer)
  io.use((socket, next) => {
    socket.data.user = socket.handshake.auth.user
    next()
  })
  io.on("connection", (socket) => socketEvents(io, socket))
  await new Promise((resolve) => httpServer.listen(0, resolve))
  port = httpServer.address().port
})

after(() => httpServer?.close())

beforeEach(() => resetDb())
afterEach(() => {
  clients.splice(0).forEach((socket) => socket.close())
})

const interviewerUser = (interviewer) => ({ id: interviewer.id, role: "interviewer", name: interviewer.name })
const studentUser = (student) => ({ id: student.id, role: "student", name: student.name })
const hrUser = (hr) => ({ id: hr.id, role: "hr", name: hr.name })

const wait = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

describe("接続とロール振り分け", () => {
  it("面接官は接続すると会話が作られ、履歴つきの init が届く", async () => {
    const interviewer = seed("interviewers", { name: "面接官A", email: "a@example.com" })
    const { init } = await connectAs(interviewerUser(interviewer))

    assert.ok(init.conversationId)
    assert.deepEqual(init.messages, [])
    assert.equal(db.conversations.length, 1)
    assert.equal(db.conversations[0].interviewer_id, interviewer.id)
  })

  it("知らないロールの接続は切断される", async () => {
    const socket = openSocket({ id: "x", role: "admin", name: "?" })
    const reason = await nextEvent(socket, "disconnect")
    assert.equal(reason, "io server disconnect")
  })
})

describe("面接官：リロード直後のデータ読み込み", () => {
  it("接続が完了する前に送った loadSchedules も取りこぼさない", async () => {
    const { interviewers } = await setupRequest({ interviewerCount: 1 })
    const socket = openSocket(interviewerUser(interviewers[0]))
    // ブラウザのリロード時と同じく、connect を待たずに emit する
    socket.emit("loadSchedules")

    const schedules = await nextEvent(socket, "scheduleData")
    assert.deepEqual(schedules, [])
  })

  it("loadInit で通知の履歴を取り直せる", async () => {
    const interviewer = seed("interviewers", { name: "面接官A", email: "a@example.com" })
    const { socket, init } = await connectAs(interviewerUser(interviewer))

    seed("messages", {
      conversation_id: init.conversationId,
      sender_kind: "system",
      sender_id: null,
      body: "あとから届いた通知",
      msg_type: "system_notice",
      payload: {},
    })

    socket.emit("loadInit")
    const reloaded = await nextEvent(socket, "init")
    assert.equal(reloaded.messages.length, 1)
    assert.equal(reloaded.messages[0].body, "あとから届いた通知")
  })

  it("確定済みの面接のうち、自分が担当のものだけが予定一覧に返る", async () => {
    const { interviewers, student, request } = await setupRequest({ interviewerCount: 2 })
    db.interview_requests.find((r) => r.id === request.id).status = "confirmed"
    Object.assign(db.interview_requests.find((r) => r.id === request.id), {
      confirmed_date: "2026-09-10",
      confirmed_hour: 14,
      interviewer_ids: [interviewers[0].id],
    })

    const mine = await connectAs(interviewerUser(interviewers[0]))
    mine.socket.emit("loadSchedules")
    const schedules = await nextEvent(mine.socket, "scheduleData")

    assert.equal(schedules.length, 1)
    assert.equal(schedules[0].studentName, student.name)
    assert.equal(schedules[0].round, 1)
    assert.deepEqual(schedules[0].attendees, [student.name, interviewers[0].name])

    const other = await connectAs(interviewerUser(interviewers[1]))
    other.socket.emit("loadSchedules")
    assert.deepEqual(await nextEvent(other.socket, "scheduleData"), [], "担当外の面接は返さない")
  })
})

describe("面接官：空き予定の登録", () => {
  it("登録・取得・取り消しが往復する", async () => {
    const interviewer = seed("interviewers", { name: "面接官A", email: "a@example.com" })
    const { socket } = await connectAs(interviewerUser(interviewer))
    const cells = [
      { slotDate: "2026-09-10", slotHour: 10 },
      { slotDate: "2026-09-10", slotHour: 11 },
    ]

    socket.emit("setAvailability", { cells, isAvailable: true })
    const updated = await nextEvent(socket, "availabilityUpdated")
    assert.equal(updated.length, 2)
    assert.ok(updated.every((row) => row.is_available === true))

    socket.emit("loadAvailability", { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" })
    const listed = await nextEvent(socket, "availabilityData")
    assert.equal(listed.length, 2)

    socket.emit("setAvailability", { cells: [cells[0]], isAvailable: null })
    const cleared = await nextEvent(socket, "availabilityCleared")
    assert.equal(cleared.length, 1)
    assert.equal(db.availability.length, 1)
  })

  it("範囲外の日付は取得結果に含まれない", async () => {
    const interviewer = seed("interviewers", { name: "面接官A", email: "a@example.com" })
    const { socket } = await connectAs(interviewerUser(interviewer))
    socket.emit("setAvailability", {
      cells: [{ slotDate: "2026-09-10", slotHour: 10 }, { slotDate: "2026-10-05", slotHour: 10 }],
      isAvailable: true,
    })
    await nextEvent(socket, "availabilityUpdated")

    socket.emit("loadAvailability", { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" })
    const listed = await nextEvent(socket, "availabilityData")
    assert.equal(listed.length, 1)
    assert.equal(listed[0].slot_date, "2026-09-10")
  })
})

describe("学生の候補提出から面接官への確認まで", () => {
  it("学生が候補を送ると、面接官に空き確認が届く", async () => {
    const { student, interviewers, request } = await setupRequest({ interviewerCount: 2, requiredInterviewerCount: 1 })
    const interviewerSocket = (await connectAs(interviewerUser(interviewers[0]))).socket
    const { socket: studentSocket } = await connectAs(studentUser(student))

    const incoming = []
    interviewerSocket.on("newMessage", (message) => incoming.push(message))

    studentSocket.emit("submitCalendar", {
      requestId: request.id,
      slots: [{ slotDate: "2026-09-10", slotHour: 14 }],
    })

    const submission = await nextEvent(studentSocket, "newMessage")
    assert.equal(submission.msg_type, "calendar_submission")

    await new Promise((resolve) => setTimeout(resolve, 150))
    const checks = incoming.filter((m) => m.msg_type === "availability_check")
    assert.equal(checks.length, 1)
    assert.equal(checks[0].payload.slotDate, "2026-09-10")
    assert.equal(db.candidate_slots.length, 1)
  })

  it("他人の依頼IDを指定した提出は無視される", async () => {
    const { request } = await setupRequest({ interviewerCount: 1 })
    const intruder = seed("students", { name: "別の学生", email: "other@example.com" })
    const { socket } = await connectAs(studentUser(intruder))

    socket.emit("submitCalendar", { requestId: request.id, slots: [{ slotDate: "2026-09-10", slotHour: 14 }] })
    await new Promise((resolve) => setTimeout(resolve, 150))

    assert.equal(db.candidate_slots.length, 0)
  })
})

describe("学生：面接官と照合される前の候補日時の修正", () => {
  const SLOT_A = { slotDate: "2026-09-10", slotHour: 14 }
  const SLOT_B = { slotDate: "2026-09-11", slotHour: 10 }

  // 候補を1件出して、面接官がまだ何も答えていない状態まで進める
  const submitOnce = async ({ interviewerCount = 1 } = {}) => {
    const context = await setupRequest({ interviewerCount, requiredInterviewerCount: 1 })
    const { socket: interviewerSocket } = await connectAs(interviewerUser(context.interviewers[0]))
    const { socket: studentSocket } = await connectAs(studentUser(context.student))
    const incoming = []
    interviewerSocket.on("newMessage", (message) => incoming.push(message))

    studentSocket.emit("submitCalendar", { requestId: context.request.id, slots: [SLOT_A] })
    const state = await nextEvent(studentSocket, "calendarRevisable")
    await wait()
    return { ...context, interviewerSocket, studentSocket, incoming, state }
  }

  it("面接官が答える前なら修正できる状態として学生に伝わる", async () => {
    const { state, request } = await submitOnce()

    assert.equal(state.requestId, request.id)
    assert.equal(state.revisable, true)
  })

  it("候補を選び直すと、候補日時が差し替わり外した日時の空き確認は取り下げられる", async () => {
    const { studentSocket, request, incoming } = await submitOnce()
    incoming.length = 0

    studentSocket.emit("submitCalendar", { requestId: request.id, slots: [SLOT_B] })
    await wait()

    assert.deepEqual(
      db.candidate_slots.map((slot) => `${slot.slot_date} ${slot.slot_hour}`),
      ["2026-09-11 10"],
      "候補は選び直した内容だけになる"
    )
    assert.ok(
      incoming.some((m) => m.payload?.kind === "availability_check_withdrawn" && m.payload.slotDate === "2026-09-10"),
      "外した日時の空き確認は不要になったと面接官へ伝える"
    )
    assert.ok(
      incoming.some((m) => m.msg_type === "availability_check" && m.payload.slotDate === "2026-09-11"),
      "選び直した日時の空き確認が新たに飛ぶ"
    )
    const submissions = db.messages.filter((m) => m.msg_type === "calendar_submission")
    assert.equal(submissions.length, 2)
    assert.match(submissions[1].body, /修正しました/)
  })

  it("面接官が空きを答えたあとは修正できない", async () => {
    const { studentSocket, interviewerSocket, request } = await submitOnce()

    interviewerSocket.emit("answerAvailability", { ...SLOT_A, isAvailable: true, requestId: request.id })
    const locked = await nextEvent(studentSocket, "calendarRevisable")
    assert.equal(locked.revisable, false)

    studentSocket.emit("submitCalendar", { requestId: request.id, slots: [SLOT_B] })
    const error = await nextEvent(studentSocket, "appError")

    assert.match(error.message, /変更できません/)
    assert.deepEqual(db.candidate_slots.map((slot) => slot.slot_date), ["2026-09-10"], "候補は書き換わらない")
  })

  it("再接続したときの init も、修正できるかどうかを伝える", async () => {
    const { student, request } = await submitOnce()

    const reconnected = await connectAs(studentUser(student))
    assert.equal(reconnected.init.revisableRequestId, request.id)
  })
})

describe("面接官の空き回答", () => {
  const prepareCheck = async () => {
    const context = await setupRequest({ interviewerCount: 1, requiredInterviewerCount: 1 })
    const { socket } = await connectAs(interviewerUser(context.interviewers[0]))
    const { socket: studentSocket } = await connectAs(studentUser(context.student))
    const received = []
    socket.on("newMessage", (message) => received.push(message))
    studentSocket.emit("submitCalendar", {
      requestId: context.request.id,
      slots: [{ slotDate: "2026-09-10", slotHour: 14 }],
    })
    await wait()
    received.length = 0
    return { ...context, socket, received }
  }

  it("ボタンからの「空いています」で回答が記録され、承認依頼に進む", async () => {
    const { socket, received } = await prepareCheck()

    socket.emit("answerAvailability", {
      slotDate: "2026-09-10",
      slotHour: 14,
      isAvailable: true,
      requestId: db.interview_requests[0].id,
    })
    await wait()

    assert.ok(received.some((m) => m.msg_type === "availability_answer" && m.payload.isAvailable === true))
    assert.ok(received.some((m) => m.payload?.kind === "match_approval"))
    assert.equal(db.availability[0].is_available, true)
  })

  // 本文の言い回しで可否を推測すると取り違えるため、チャットは回答として扱わない
  for (const body of ["はい、大丈夫です", "その日は無理です", "空いていません", "承知しました、確認します"]) {
    it(`チャットの「${body}」は回答として扱わない`, async () => {
      const { socket, received } = await prepareCheck()

      socket.emit("sendMessage", { body })
      await wait()

      assert.ok(received.some((m) => m.msg_type === "text" && m.body === body), "本文はそのまま投稿される")
      assert.equal(received.filter((m) => m.msg_type === "availability_answer").length, 0)
      assert.equal(db.availability.length, 0, "空き予定も書き換わらない")
    })
  }
})

describe("人事：複数の学生へまとめて日程調整を送る", () => {
  const seedPeople = (studentCount, interviewerCount) => {
    const hr = seed("hr_staff", { name: "人事 花子", email: "hr@example.com" })
    const students = Array.from({ length: studentCount }, (_, i) =>
      seed("students", { name: `学生${i + 1}`, email: `s${i + 1}@example.com`, selection_status: "first_interview" })
    )
    const interviewers = Array.from({ length: interviewerCount }, (_, i) =>
      seed("interviewers", { name: `面接官${i + 1}`, email: `iv${i + 1}@example.com` })
    )
    return { hr, students, interviewers }
  }

  const bulkPayload = (students, interviewers, overrides = {}) => ({
    studentIds: students.map((s) => s.id),
    interviewerIds: interviewers.map((i) => i.id),
    requiredInterviewerCount: 1,
    durationMinutes: 60,
    rangeStart: "2026-09-07",
    rangeEnd: "2026-09-20",
    responseDeadline: new Date("2026-09-05T23:59:00Z").toISOString(),
    message: "",
    ...overrides,
  })

  it("接続すると人事ダッシュボードのデータが届く", async () => {
    const { hr, students } = seedPeople(2, 1)
    const socket = openSocket(hrUser(hr))
    const data = await nextEvent(socket, "dashboardData")

    assert.equal(data.students.length, students.length)
    assert.equal(data.interviewers.length, 1)
    assert.deepEqual(data.requests, [])
  })

  it("3人の学生へ一括送信すると、依頼が3件と各学生・全面接官へのメッセージが作られる", async () => {
    const { hr, students, interviewers } = seedPeople(3, 2)
    const socket = openSocket(hrUser(hr))
    await nextEvent(socket, "dashboardData")

    const result = await new Promise((resolve) =>
      socket.emit("createBulkRequests", bulkPayload(students, interviewers), resolve)
    )

    assert.deepEqual(result, { ok: true, count: 3 })
    assert.equal(db.interview_requests.length, 3)
    assert.ok(db.interview_requests.every((r) => r.status === "awaiting_student"))
    assert.ok(db.interview_requests.every((r) => r.interviewer_ids.length === 2))

    // 学生には候補選択のカレンダー、面接官には開始の予告が届く
    assert.equal(db.messages.filter((m) => m.msg_type === "calendar_request").length, 3)
    assert.equal(db.messages.filter((m) => m.msg_type === "system_notice").length, 6, "3依頼 × 面接官2人")
    assert.equal(db.conversations.filter((c) => c.kind === "student").length, 3)
    assert.equal(db.conversations.filter((c) => c.kind === "interviewer").length, 2, "面接官の会話は使い回す")
  })

  it("必要人数が面接官の数を超える指定は弾く", async () => {
    const { hr, students, interviewers } = seedPeople(2, 2)
    const socket = openSocket(hrUser(hr))
    await nextEvent(socket, "dashboardData")

    const result = await new Promise((resolve) =>
      socket.emit("createBulkRequests", bulkPayload(students, interviewers, { requiredInterviewerCount: 3 }), resolve)
    )

    assert.deepEqual(result, { ok: false, error: "invalid_fields" })
    assert.equal(db.interview_requests.length, 0)
  })

  it("学生も面接官も空なら送信しない", async () => {
    const { hr, students, interviewers } = seedPeople(1, 1)
    const socket = openSocket(hrUser(hr))
    await nextEvent(socket, "dashboardData")

    const noStudents = await new Promise((resolve) =>
      socket.emit("createBulkRequests", bulkPayload([], interviewers), resolve)
    )
    const noInterviewers = await new Promise((resolve) =>
      socket.emit("createBulkRequests", bulkPayload(students, []), resolve)
    )

    assert.equal(noStudents.ok, false)
    assert.equal(noInterviewers.ok, false)
    assert.equal(db.interview_requests.length, 0)
  })

  it("一括送信した3人がそれぞれ候補を出すと、依頼ごとに独立して照合される", async () => {
    const { hr, students, interviewers } = seedPeople(3, 2)
    const hrSocket = openSocket(hrUser(hr))
    await nextEvent(hrSocket, "dashboardData")
    await new Promise((resolve) =>
      hrSocket.emit("createBulkRequests", bulkPayload(students, interviewers, { requiredInterviewerCount: 2 }), resolve)
    )

    // 面接官1は10日を可、面接官2は10日を不可として登録済み
    seed("availability", { interviewer_id: interviewers[0].id, slot_date: "2026-09-10", slot_hour: 14, is_available: true })
    seed("availability", { interviewer_id: interviewers[1].id, slot_date: "2026-09-10", slot_hour: 14, is_available: false })

    const requestOf = (student) => db.interview_requests.find((r) => r.student_id === student.id)
    for (const student of students) {
      const { socket } = await connectAs(studentUser(student))
      socket.emit("submitCalendar", {
        requestId: requestOf(student).id,
        slots: [{ slotDate: "2026-09-10", slotHour: 14 }],
      })
    }
    await wait(400)

    // 必要2名に対して1名が不可なので、3件とも候補は却下され学生に再提出を促す
    assert.equal(db.candidate_slots.length, 3)
    assert.ok(db.candidate_slots.every((slot) => slot.status === "rejected"))
    assert.equal(db.interview_requests.filter((r) => r.status === "awaiting_student").length, 3)
    assert.equal(db.messages.filter((m) => m.msg_type === "availability_check").length, 0, "不可が確定しているので確認は送らない")
    // 学生ごとに「追加の候補を選んでください」が1通ずつ
    const followUps = db.messages.filter((m) => m.msg_type === "calendar_request")
    assert.equal(followUps.length, 6, "初回3通 + 再提出依頼3通")
  })

  it("再送すると同じ依頼が学生の候補待ちに戻る", async () => {
    const { hr, students, interviewers } = seedPeople(1, 1)
    const socket = openSocket(hrUser(hr))
    await nextEvent(socket, "dashboardData")
    await new Promise((resolve) =>
      socket.emit("createBulkRequests", bulkPayload(students, interviewers), resolve)
    )
    const request = db.interview_requests[0]
    Object.assign(request, { status: "confirmed", confirmed_date: "2026-09-10", confirmed_hour: 14 })

    socket.emit("resendRequest", {
      requestId: request.id,
      interviewerIds: interviewers.map((i) => i.id),
      rangeStart: "2026-09-21",
      rangeEnd: "2026-09-30",
    })
    await nextEvent(socket, "requestCreated")

    assert.equal(db.interview_requests.length, 1, "依頼は増やさず使い回す")
    assert.equal(request.status, "awaiting_student")
    assert.equal(request.confirmed_date, null)
    assert.equal(request.range_start, "2026-09-21")
  })
})
