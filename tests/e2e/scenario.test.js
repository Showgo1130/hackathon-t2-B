// 実際の Supabase と開発サーバーに対して、業務の流れをそのまま再現する通しテスト。
// 実行: npm run test:e2e （別ターミナルで npm start しておくこと）
// 実データを書き込むので、事前に npm run db:backup を取っておく。
import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import {
  closeAllSockets,
  connectAs,
  createUser,
  ensureServerUp,
  isApprovalRequest,
  isAvailabilityCheck,
  isCalendarRequest,
  isConfirmed,
  listUsers,
  login,
  once,
  request,
  sleep,
  staysAbsent,
  uniqueEmail,
  waitForMessage,
} from "./helpers.js"

const DAY = 24 * 60 * 60 * 1000
const iso = (date) => date.toISOString().slice(0, 10)
// 過去日を候補にすると画面側で選べないので、必ず先の日付を使う
const dayAfter = (days) => iso(new Date(Date.now() + days * DAY))

let hr
let hrSocket

before(async () => {
  await ensureServerUp()
  // 人事アカウントは seed 済みのものを使う（実運用でも人事は先に存在する前提）
  hr = await login("hr", "hr1@example.com")
  hrSocket = await connectAs(hr.token, { waitInit: false })
  await once(hrSocket, "dashboardData")
})

after(() => closeAllSockets())

// 人事が面接官と学生のアカウントを用意するところから始める
const setupTeam = async ({ interviewerCount, studentCount, label }) => {
  const interviewers = []
  for (let i = 1; i <= interviewerCount; i += 1) {
    const account = await createUser(hr.token, {
      role: "interviewer",
      name: `${label}面接官${i}`,
      email: uniqueEmail(`iv${i}`),
    })
    interviewers.push({ ...account, session: await login("interviewer", account.email) })
  }
  const students = []
  for (let i = 1; i <= studentCount; i += 1) {
    const account = await createUser(hr.token, {
      role: "student",
      name: `${label}学生${i}`,
      email: uniqueEmail(`st${i}`),
    })
    students.push({ ...account, session: await login("student", account.email) })
  }
  return { interviewers, students }
}

// ⓪ 面接官が自分の空き予定を登録する
const registerAvailability = async (socket, cells, isAvailable = true) => {
  socket.emit("setAvailability", { cells, isAvailable })
  return once(socket, "availabilityUpdated")
}

// ① 人事が対象の学生へ日程調整を送る
const sendRequests = async ({ students, interviewers, requiredInterviewerCount, rangeStart, rangeEnd }) => {
  // bulkRequestsCreated は ack より先に飛ぶので、送る前に受け口を用意しておく
  const created = once(hrSocket, "bulkRequestsCreated")
  const result = await request(hrSocket, "createBulkRequests", {
    studentIds: students.map((s) => s.id),
    interviewerIds: interviewers.map((i) => i.id),
    requiredInterviewerCount,
    durationMinutes: 60,
    rangeStart,
    rangeEnd,
    responseDeadline: new Date(Date.now() + 2 * DAY).toISOString(),
    message: "",
  })
  assert.equal(result.ok, true, `日程調整の送信に失敗: ${JSON.stringify(result)}`)
  const { requests } = await created
  return requests
}

const scheduleFor = async (socket) => {
  socket.emit("loadSchedules")
  return once(socket, "scheduleData")
}

const dashboard = async () => {
  hrSocket.emit("loadDashboard")
  return once(hrSocket, "dashboardData")
}

describe("シナリオ1：一次面接を3名まとめて調整する", () => {
  it("空き登録 → 一括送信 → 候補提出 → 承認 → 確定 まで通る", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 2, studentCount: 3, label: "S1" })
    const rangeStart = dayAfter(7)
    const rangeEnd = dayAfter(21)
    const slotDate = dayAfter(8)

    // ⓪ 面接官1だけが 10時 を「空き」として登録しておく
    const iv1 = await connectAs(interviewers[0].session.token)
    const iv2 = await connectAs(interviewers[1].session.token)
    await registerAvailability(iv1, [{ slotDate, slotHour: 10 }])

    // ① 人事が3名へ一括送信（必要人数1名）
    const requests = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 1,
      rangeStart,
      rangeEnd,
    })
    assert.equal(requests.length, 3)

    // 面接官には「調整を開始しました」の予告が届く
    await waitForMessage(iv1, (m) => m.msg_type === "system_notice" && m.payload?.rangeStart === rangeStart, {
      label: "調整開始の予告",
    })

    // ② 学生1が候補を提出。面接官1は登録済みなので、そのまま承認依頼まで進む
    const student1 = await connectAs(students[0].session.token)
    const request1 = requests.find((r) => r.student_id === students[0].id)
    student1.emit("submitCalendar", {
      requestId: request1.id,
      slots: [{ slotDate, slotHour: 10 }],
    })

    const approval = await waitForMessage(iv1, isApprovalRequest, { label: "承認依頼" })
    assert.equal(approval.payload.slotDate, slotDate)
    assert.equal(approval.payload.slotHour, 10)
    assert.equal(approval.payload.round, 1, "1件目なので1次面接")
    assert.ok(
      await staysAbsent(iv2, isApprovalRequest),
      "必要人数を満たしているので、もう1人には承認依頼を出さない"
    )

    // ④ 面接官1が承認 → 確定
    iv1.emit("respondToMatch", {
      requestId: request1.id,
      slotDate,
      slotHour: 10,
      approved: true,
    })

    const studentNotice = await waitForMessage(student1, isConfirmed, { label: "学生への確定通知" })
    assert.equal(studentNotice.payload.confirmedDate, slotDate)
    assert.equal(studentNotice.payload.round, 1, "確定通知の何次面接がずれていない")
    await waitForMessage(iv1, isConfirmed, { label: "面接官への確定通知" })

    // 面接官1の予定一覧に出る／面接官2には出ない
    const schedules1 = await scheduleFor(iv1)
    const mine = schedules1.find((s) => s.id === request1.id)
    assert.ok(mine, "承認した面接官の予定一覧に入る")
    assert.equal(mine.confirmedHour, 10)
    assert.deepEqual(mine.attendees, [students[0].name, interviewers[0].name])

    const schedules2 = await scheduleFor(iv2)
    assert.ok(
      !schedules2.some((s) => s.id === request1.id),
      "承認していない面接官の予定一覧には入らない"
    )

    // 人事のダッシュボードにも確定として反映される
    const data = await dashboard()
    const listed = data.requests.find((r) => r.id === request1.id)
    assert.equal(listed.status, "confirmed")
    assert.equal(listed.confirmed_date, slotDate)
  })
})

describe("シナリオ2：同じ枠に2人目が来てもダブルブッキングしない", () => {
  it("先に確定した面接官は埋まり、もう1人の面接官で組み直される", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 2, studentCount: 2, label: "S2" })
    const rangeStart = dayAfter(7)
    const rangeEnd = dayAfter(21)
    const slotDate = dayAfter(9)

    const iv1 = await connectAs(interviewers[0].session.token)
    const iv2 = await connectAs(interviewers[1].session.token)
    // 2人とも同じ枠を空きにしている
    await registerAvailability(iv1, [{ slotDate, slotHour: 13 }])
    await registerAvailability(iv2, [{ slotDate, slotHour: 13 }])

    const requests = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 1,
      rangeStart,
      rangeEnd,
    })

    // 学生1が提出 → 面接官1が承認して確定
    const student1 = await connectAs(students[0].session.token)
    const request1 = requests.find((r) => r.student_id === students[0].id)
    student1.emit("submitCalendar", { requestId: request1.id, slots: [{ slotDate, slotHour: 13 }] })
    await waitForMessage(iv1, isApprovalRequest, { label: "学生1の承認依頼" })
    iv1.emit("respondToMatch", { requestId: request1.id, slotDate, slotHour: 13, approved: true })
    await waitForMessage(student1, isConfirmed, { label: "学生1の確定通知" })

    // 学生2が同じ枠を提出 → 面接官1は埋まっているので、面接官2に承認依頼が行く
    const student2 = await connectAs(students[1].session.token)
    const request2 = requests.find((r) => r.student_id === students[1].id)
    student2.emit("submitCalendar", { requestId: request2.id, slots: [{ slotDate, slotHour: 13 }] })

    const approval2 = await waitForMessage(
      iv2,
      (m) => isApprovalRequest(m) && m.request_id === request2.id,
      { label: "学生2の承認依頼（面接官2宛）" }
    )
    assert.equal(approval2.payload.slotHour, 13)
    assert.ok(
      await staysAbsent(iv1, (m) => isApprovalRequest(m) && m.request_id === request2.id),
      "すでに埋まっている面接官には承認依頼を出さない"
    )

    iv2.emit("respondToMatch", { requestId: request2.id, slotDate, slotHour: 13, approved: true })
    await waitForMessage(student2, isConfirmed, { label: "学生2の確定通知" })

    // 同じ時間に2件確定しているが、担当している面接官は別々
    const schedules1 = await scheduleFor(iv1)
    const schedules2 = await scheduleFor(iv2)
    assert.equal(schedules1.filter((s) => s.confirmedDate === slotDate && s.confirmedHour === 13).length, 1)
    assert.equal(schedules2.filter((s) => s.confirmedDate === slotDate && s.confirmedHour === 13).length, 1)
    assert.notEqual(schedules1[0].id, schedules2.find((s) => s.id === request2.id)?.id)
  })
})

describe("シナリオ3：面接官が見送って別の日程になる", () => {
  it("見送りで候補が落ち、次の候補で確定する", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 1, studentCount: 1, label: "S3" })
    const rangeStart = dayAfter(7)
    const rangeEnd = dayAfter(21)
    const first = dayAfter(10)
    const second = dayAfter(11)

    const iv1 = await connectAs(interviewers[0].session.token)
    await registerAvailability(iv1, [
      { slotDate: first, slotHour: 15 },
      { slotDate: second, slotHour: 15 },
    ])

    const [req] = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 1,
      rangeStart,
      rangeEnd,
    })

    const student = await connectAs(students[0].session.token)
    student.emit("submitCalendar", {
      requestId: req.id,
      slots: [
        { slotDate: first, slotHour: 15 },
        { slotDate: second, slotHour: 15 },
      ],
    })

    await waitForMessage(iv1, (m) => isApprovalRequest(m) && m.payload.slotDate === first, {
      label: "第1候補の承認依頼",
    })

    // 見送る
    iv1.emit("respondToMatch", { requestId: req.id, slotDate: first, slotHour: 15, approved: false })

    // 第2候補で承認依頼が出直す
    const next = await waitForMessage(iv1, (m) => isApprovalRequest(m) && m.payload.slotDate === second, {
      label: "第2候補の承認依頼",
    })
    assert.equal(next.payload.slotHour, 15)

    iv1.emit("respondToMatch", { requestId: req.id, slotDate: second, slotHour: 15, approved: true })
    const confirmed = await waitForMessage(student, isConfirmed, { label: "確定通知" })
    assert.equal(confirmed.payload.confirmedDate, second, "見送った第1候補ではなく第2候補で確定する")
  })
})

describe("シナリオ4：候補が合わず、学生に選び直してもらう", () => {
  it("全員が不可なら学生に追加提出を依頼し、出し直した候補で確定する", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 1, studentCount: 1, label: "S4" })
    const rangeStart = dayAfter(7)
    const rangeEnd = dayAfter(21)
    const ngDate = dayAfter(12)
    const okDate = dayAfter(13)

    const iv1 = await connectAs(interviewers[0].session.token)
    await registerAvailability(iv1, [{ slotDate: ngDate, slotHour: 9 }], false) // 明示的に「不可」
    await registerAvailability(iv1, [{ slotDate: okDate, slotHour: 9 }], true)

    const [req] = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 1,
      rangeStart,
      rangeEnd,
    })

    const student = await connectAs(students[0].session.token)
    student.emit("submitCalendar", { requestId: req.id, slots: [{ slotDate: ngDate, slotHour: 9 }] })

    // 面接官には確認を送らず、学生に選び直しを依頼する
    const followUp = await waitForMessage(
      student,
      (m) => isCalendarRequest(m) && m.request_id === req.id && m.body.includes("追加"),
      { label: "候補の再提出依頼" }
    )
    assert.ok(followUp)
    assert.ok(
      await staysAbsent(iv1, isAvailabilityCheck),
      "不可と分かっている面接官に空き確認は送らない"
    )

    // 学生が別の日を出し直す
    student.emit("submitCalendar", { requestId: req.id, slots: [{ slotDate: okDate, slotHour: 9 }] })
    await waitForMessage(iv1, isApprovalRequest, { label: "出し直し後の承認依頼" })
    iv1.emit("respondToMatch", { requestId: req.id, slotDate: okDate, slotHour: 9, approved: true })
    const confirmed = await waitForMessage(student, isConfirmed, { label: "確定通知" })
    assert.equal(confirmed.payload.confirmedDate, okDate)
  })
})

describe("シナリオ5：空き未登録の面接官に確認を送って回答をもらう", () => {
  it("必要2名のうち未登録の面接官へ確認が飛び、回答が揃うと承認依頼になる", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 2, studentCount: 1, label: "S5" })
    const rangeStart = dayAfter(7)
    const rangeEnd = dayAfter(21)
    const slotDate = dayAfter(14)

    const iv1 = await connectAs(interviewers[0].session.token)
    const iv2 = await connectAs(interviewers[1].session.token)
    // どちらも空き未登録のまま送る

    const [req] = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 2,
      rangeStart,
      rangeEnd,
    })

    const student = await connectAs(students[0].session.token)
    student.emit("submitCalendar", { requestId: req.id, slots: [{ slotDate, slotHour: 16 }] })

    // 両方に「空いていますか」が飛ぶ
    const check1 = await waitForMessage(iv1, isAvailabilityCheck, { label: "面接官1への空き確認" })
    await waitForMessage(iv2, isAvailabilityCheck, { label: "面接官2への空き確認" })
    assert.equal(check1.payload.slotDate, slotDate)

    // 面接官1だけが「空いています」→ 必要2名に届かないので承認依頼はまだ出ない
    iv1.emit("answerAvailability", { slotDate, slotHour: 16, isAvailable: true, requestId: req.id })
    assert.ok(await staysAbsent(iv1, isApprovalRequest), "1人だけでは必要人数に届かない")

    // 面接官2も回答すると承認依頼になる
    iv2.emit("answerAvailability", { slotDate, slotHour: 16, isAvailable: true, requestId: req.id })
    await waitForMessage(iv1, isApprovalRequest, { label: "面接官1への承認依頼" })
    await waitForMessage(iv2, isApprovalRequest, { label: "面接官2への承認依頼" })

    // 1人承認しただけでは確定しない
    iv1.emit("respondToMatch", { requestId: req.id, slotDate, slotHour: 16, approved: true })
    assert.ok(await staysAbsent(student, isConfirmed), "必要2名なので1人では確定しない")

    iv2.emit("respondToMatch", { requestId: req.id, slotDate, slotHour: 16, approved: true })
    await waitForMessage(student, isConfirmed, { label: "確定通知" })

    const schedules = await scheduleFor(iv1)
    const mine = schedules.find((s) => s.id === req.id)
    assert.equal(mine.attendees.length, 3, "学生＋面接官2名")
  })
})

describe("シナリオ6：面接官のチャット返信は回答として扱わない", () => {
  it("「空いていません」と書いても空き予定は書き換わらない", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 1, studentCount: 1, label: "S6" })
    const slotDate = dayAfter(15)

    const iv1 = await connectAs(interviewers[0].session.token)
    const [req] = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 1,
      rangeStart: dayAfter(7),
      rangeEnd: dayAfter(21),
    })

    const student = await connectAs(students[0].session.token)
    student.emit("submitCalendar", { requestId: req.id, slots: [{ slotDate, slotHour: 11 }] })
    await waitForMessage(iv1, isAvailabilityCheck, { label: "空き確認" })

    iv1.emit("sendMessage", { body: "その時間は空いていません" })
    await waitForMessage(iv1, (m) => m.msg_type === "text", { label: "自分の発言" })

    assert.ok(
      await staysAbsent(iv1, (m) => m.msg_type === "availability_answer"),
      "本文からは可否を判断しない"
    )
    iv1.emit("loadAvailability", { rangeStart: dayAfter(7), rangeEnd: dayAfter(21) })
    const availability = await once(iv1, "availabilityData")
    assert.equal(availability.length, 0, "空き予定は登録されていないまま")
  })
})

describe("シナリオ7：確定後にリロードしても表示が戻る", () => {
  it("接続し直すと、通知の履歴と予定一覧が読み直される", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 1, studentCount: 1, label: "S7" })
    const slotDate = dayAfter(16)

    const iv1 = await connectAs(interviewers[0].session.token)
    await registerAvailability(iv1, [{ slotDate, slotHour: 14 }])
    const [req] = await sendRequests({
      students,
      interviewers,
      requiredInterviewerCount: 1,
      rangeStart: dayAfter(7),
      rangeEnd: dayAfter(21),
    })
    const student = await connectAs(students[0].session.token)
    student.emit("submitCalendar", { requestId: req.id, slots: [{ slotDate, slotHour: 14 }] })
    await waitForMessage(iv1, isApprovalRequest, { label: "承認依頼" })
    iv1.emit("respondToMatch", { requestId: req.id, slotDate, slotHour: 14, approved: true })
    await waitForMessage(iv1, isConfirmed, { label: "確定通知" })

    // ブラウザのリロード相当：接続し直して、接続前に読み込みを投げる
    const reloaded = await connectAs(interviewers[0].session.token, { waitInit: false })
    reloaded.emit("loadSchedules")
    const [init, schedules] = await Promise.all([once(reloaded, "init"), once(reloaded, "scheduleData")])

    assert.ok(init.messages.length > 0, "通知の履歴が読み込まれる")
    assert.ok(init.messages.some((m) => m.payload?.confirmedDate === slotDate), "確定通知が履歴に残っている")
    assert.ok(schedules.some((s) => s.id === req.id), "予定一覧も読み込まれる")

    // loadInit でも取り直せる
    reloaded.emit("loadInit")
    const again = await once(reloaded, "init")
    assert.equal(again.messages.length, init.messages.length)
  })
})

describe("シナリオ8：人事の運用まわり", () => {
  it("選考状況の更新と、学生への結果報告メッセージが届く", async () => {
    const { interviewers, students } = await setupTeam({ interviewerCount: 1, studentCount: 1, label: "S8" })
    const student = await connectAs(students[0].session.token)

    // 人事が学生とのチャットを開いて結果を送る
    hrSocket.emit("openPartyConversation", { kind: "student", partyId: students[0].id })
    const { conversation } = await once(hrSocket, "conversationReady")
    hrSocket.emit("sendMessage", { conversationId: conversation.id, body: "最終選考の結果、内定となりました。" })
    const report = await waitForMessage(student, (m) => m.msg_type === "text" && m.body.includes("内定"), {
      label: "結果報告",
    })
    assert.equal(report.sender_kind, "hr")

    // 選考状況を更新するとダッシュボードに反映される
    hrSocket.emit("updateSelectionStatus", { studentId: students[0].id, status: "offered" })
    await sleep(1200)
    const data = await dashboard()
    const listed = data.students.find((s) => s.id === students[0].id)
    assert.equal(listed.selection_status, "offered")

    // 作成したアカウントは一覧に出る
    const { users } = await listUsers(hr.token)
    assert.ok(users.some((u) => u.id === interviewers[0].id && u.role === "interviewer"))
    assert.ok(users.some((u) => u.id === students[0].id && u.role === "student"))
  })

  it("権限のないロールはユーザーを作成できない", async () => {
    const { students } = await setupTeam({ interviewerCount: 0, studentCount: 1, label: "S8b" })
    const res = await fetch(`${process.env.E2E_BASE_URL ?? "http://localhost:3000"}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${students[0].session.token}` },
      body: JSON.stringify({ role: "student", name: "不正", email: uniqueEmail("bad"), password: "password123" }),
    })
    assert.equal(res.status, 403)
  })
})
