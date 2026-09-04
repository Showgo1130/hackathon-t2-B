// 人事ダッシュボードの「やること」を全種類そろえて確認するためのデモデータ。
// 実行: npm run demo:seed  ／ 片付け: npm run demo:clean
//
// 作るのは demo-*@example.com の学生だけで、既存のデータには触らない。
// 学生を消すと依頼・会話・メッセージ・候補スロットも外部キーで一緒に消えるため、
// 片付けは学生の削除だけで完結する。
import { hashPassword } from "../server/auth.js"
import { supabase } from "../server/supabaseClient.js"

const EMAIL_PREFIX = "demo-"
const PASSWORD = "password123"
const DAY = 86_400_000

const iso = (date) => date.toISOString()
const isoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const daysFromNow = (days) => new Date(Date.now() + days * DAY)
const endOfToday = () => {
  const date = new Date()
  date.setHours(23, 59, 0, 0)
  return date
}

const insert = async (table, row) => {
  const { data, error } = await supabase.from(table).insert(row).select().single()
  if (error) throw new Error(`${table}: ${error.message}`)
  return data
}

// ---- 片付け ----
export const cleanDemo = async () => {
  const { data, error } = await supabase
    .from("students")
    .delete()
    .like("email", `${EMAIL_PREFIX}%@example.com`)
    .select("id, name")
  if (error) throw new Error(`students: ${error.message}`)
  return data
}

// ---- 下ごしらえ ----
const requireBaseAccounts = async () => {
  const { data: hr, error: hrError } = await supabase.from("hr_staff").select("id, name").limit(1).maybeSingle()
  if (hrError) throw new Error(`hr_staff: ${hrError.message}`)
  const { data: interviewers, error: ivError } = await supabase.from("interviewers").select("id, name").limit(2)
  if (ivError) throw new Error(`interviewers: ${ivError.message}`)
  if (!hr || !interviewers?.length) {
    throw new Error("人事と面接官のアカウントが必要です。先に `node server/seed.js` を実行してください。")
  }
  return { hr, interviewerIds: interviewers.map(({ id }) => id) }
}

const createStudent = async ({ name, key, selectionStatus }) =>
  insert("students", {
    name,
    email: `${EMAIL_PREFIX}${key}@example.com`,
    password_hash: await hashPassword(PASSWORD),
    selection_status: selectionStatus,
  })

const createConversation = (studentId, hrId) =>
  insert("conversations", { kind: "student", student_id: studentId, hr_id: hrId })

const createRequest = ({ studentId, hrId, interviewerIds, status, rangeStart, rangeEnd, updatedAt, confirmed }) =>
  insert("interview_requests", {
    student_id: studentId,
    hr_id: hrId,
    interviewer_ids: interviewerIds,
    range_start: isoDate(rangeStart),
    range_end: isoDate(rangeEnd),
    status,
    confirmed_date: confirmed ? isoDate(confirmed.date) : null,
    confirmed_hour: confirmed ? confirmed.hour : null,
    ...(updatedAt ? { updated_at: iso(updatedAt) } : {}),
  })

// 提出期限はカラムではなく calendar_request の payload にあるので、ここでも同じ形で入れる
const createCalendarRequest = ({ conversationId, requestId, rangeStart, rangeEnd, deadline, body, createdAt }) =>
  insert("messages", {
    conversation_id: conversationId,
    sender_kind: "system",
    sender_id: null,
    body,
    msg_type: "calendar_request",
    payload: {
      requestId,
      rangeStart: isoDate(rangeStart),
      rangeEnd: isoDate(rangeEnd),
      requiredInterviewerCount: 1,
      durationMinutes: 60,
      responseDeadline: deadline ? iso(deadline) : null,
      reminderAt: deadline ? iso(new Date(deadline.getTime() - DAY)) : null,
      reminderSent: true,
    },
    request_id: requestId,
    ...(createdAt ? { created_at: iso(createdAt) } : {}),
  })

// ---- 6種類の要対応をそれぞれ1件ずつ作る ----
const CASES = [
  {
    key: "overdue",
    name: "デモ 青木 拓真",
    selectionStatus: "first_interview",
    expect: "⏰ 提出期限が過ぎています",
    build: async (ctx) => {
      const request = await createRequest({ ...ctx, status: "awaiting_student", rangeStart: daysFromNow(-9), rangeEnd: daysFromNow(5) })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-9), rangeEnd: daysFromNow(5), deadline: daysFromNow(-2),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-9),
      })
    },
  },
  {
    key: "reply",
    name: "デモ 井上 陽菜",
    selectionStatus: "second_interview",
    expect: "💬 まだ返信していません（日時提出は含めない）",
    build: async (ctx) => {
      const request = await createRequest({ ...ctx, status: "awaiting_student", rangeStart: daysFromNow(-1), rangeEnd: daysFromNow(13) })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-1), rangeEnd: daysFromNow(13), deadline: daysFromNow(5),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-1),
      })
      // 未返信の判定対象は、候補者本人が書いた本文だけ。候補日時の提出は含めない
      await insert("messages", {
        conversation_id: ctx.conversationId,
        sender_kind: "student",
        sender_id: ctx.studentId,
        body: "候補日を出したのですが、来週以降でも大丈夫でしょうか。",
        msg_type: "text",
        created_at: iso(new Date(Date.now() - 3 * 3_600_000)),
      })
      // 提出そのものは自動で照合まで進むので、これがあっても未返信にはならない
      await insert("messages", {
        conversation_id: ctx.conversationId,
        sender_kind: "student",
        sender_id: ctx.studentId,
        body: "候補日時を提出しました",
        msg_type: "calendar_submission",
        payload: { slots: [{ slotDate: isoDate(daysFromNow(4)), slotHour: 10 }] },
        created_at: iso(new Date(Date.now() - 2 * 3_600_000)),
      })
    },
  },
  {
    key: "duetoday",
    name: "デモ 大野 悠",
    selectionStatus: "first_interview",
    expect: "📅 本日が提出期限です",
    build: async (ctx) => {
      const request = await createRequest({ ...ctx, status: "awaiting_student", rangeStart: daysFromNow(-2), rangeEnd: daysFromNow(12) })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-2), rangeEnd: daysFromNow(12), deadline: endOfToday(),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-2),
      })
    },
  },
  {
    key: "resubmit",
    name: "デモ 川島 芽衣",
    selectionStatus: "second_interview",
    expect: "🔁 候補が合わず、再提出を依頼中です",
    build: async (ctx) => {
      const request = await createRequest({ ...ctx, status: "awaiting_student", rangeStart: daysFromNow(-6), rangeEnd: daysFromNow(8) })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-6), rangeEnd: daysFromNow(8), deadline: daysFromNow(5),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-6),
      })
      // 候補が全滅すると matching.js が同じ依頼にもう一度カレンダーを送る。この2通目が再提出の目印になる
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-6), rangeEnd: daysFromNow(8), deadline: null,
        body: "提示いただいた候補では日程を確定できませんでした。別の候補日時を追加で選んでください",
        createdAt: daysFromNow(-1),
      })
    },
  },
  {
    key: "stalled",
    name: "デモ 佐久間 悠真",
    selectionStatus: "final_interview",
    expect: "🔄 面接官の回答が止まっています",
    build: async (ctx) => {
      const request = await createRequest({
        ...ctx, status: "matching", rangeStart: daysFromNow(-7), rangeEnd: daysFromNow(7),
        updatedAt: daysFromNow(-3),
      })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-7), rangeEnd: daysFromNow(7), deadline: daysFromNow(5),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-7),
      })
      // 学生は回答済みで、面接官の可否待ちのまま止まっている状態
      const slotDate = isoDate(daysFromNow(4))
      for (const hour of [10, 14]) {
        await insert("candidate_slots", { request_id: request.id, slot_date: slotDate, slot_hour: hour, status: "pending_check" })
      }
    },
  },
  {
    key: "second-round",
    name: "デモ 千葉 真希",
    selectionStatus: "second_interview",
    expect: "📨 日程調整がまだ送られていません（1次は確定済み・2次が未送信）",
    build: async (ctx) => {
      // 1次は確定済み。旧ロジックではこの学生が「確定済み」のまま一覧から消えていた
      const request = await createRequest({
        ...ctx, status: "confirmed", rangeStart: daysFromNow(-14), rangeEnd: daysFromNow(-1),
        updatedAt: daysFromNow(-4), confirmed: { date: daysFromNow(-3), hour: 14 },
      })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-14), rangeEnd: daysFromNow(-1), deadline: daysFromNow(-10),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-14),
      })
    },
  },
  {
    key: "settled",
    name: "デモ 中村 光",
    selectionStatus: "first_interview",
    expect: "（対応不要。返信済みなのでキューに出ないことの確認用）",
    build: async (ctx) => {
      const request = await createRequest({
        ...ctx, status: "confirmed", rangeStart: daysFromNow(-10), rangeEnd: daysFromNow(4),
        updatedAt: daysFromNow(-2), confirmed: { date: daysFromNow(3), hour: 11 },
      })
      // 候補者が質問し、人事が返している。あとに人事の本文があるので未返信にはならない
      await insert("messages", {
        conversation_id: ctx.conversationId, sender_kind: "student", sender_id: ctx.studentId,
        body: "当日の持ち物はありますか。", msg_type: "text",
        created_at: iso(daysFromNow(-2)),
      })
      await insert("messages", {
        conversation_id: ctx.conversationId, sender_kind: "hr", sender_id: ctx.hrId,
        body: "特にありません。当日はお気をつけてお越しください。", msg_type: "text",
        created_at: iso(new Date(daysFromNow(-2).getTime() + 3_600_000)),
      })
      await createCalendarRequest({
        conversationId: ctx.conversationId, requestId: request.id,
        rangeStart: daysFromNow(-10), rangeEnd: daysFromNow(4), deadline: daysFromNow(-6),
        body: "面接可能な日時を選んでください", createdAt: daysFromNow(-10),
      })
    },
  },
]

export const seedDashboardDemo = async () => {
  const { hr, interviewerIds } = await requireBaseAccounts()
  // 何度実行しても同じ状態になるよう、前回のデモデータを消してから作り直す
  const removed = await cleanDemo()

  const created = []
  for (const demoCase of CASES) {
    const student = await createStudent({
      name: demoCase.name, key: demoCase.key, selectionStatus: demoCase.selectionStatus,
    })
    const conversation = await createConversation(student.id, hr.id)
    await demoCase.build({
      studentId: student.id, hrId: hr.id, interviewerIds,
      conversationId: conversation.id,
    })
    created.push({ name: student.name, expect: demoCase.expect })
  }
  return { removed: removed.length, created, hrName: hr.name }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--clean")) {
    const removed = await cleanDemo()
    console.log(`デモデータを削除しました: ${removed.length}名`)
    for (const student of removed) console.log(`  - ${student.name}`)
    process.exit(0)
  }

  const { removed, created, hrName } = await seedDashboardDemo()
  if (removed) console.log(`前回のデモデータを削除: ${removed}名`)
  console.log(`人事「${hrName}」のダッシュボードに、以下が出ます:\n`)
  for (const { name, expect } of created) console.log(`  ${name.padEnd(14, "　")} → ${expect}`)
  console.log(`\nログイン: hr1@example.com / ${PASSWORD}`)
  console.log("片付け: npm run demo:clean")
}
