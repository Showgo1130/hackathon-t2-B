<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import HrIcon from "./ui/HrIcon.vue"

const router = useRouter()
const socket = socketManager.getInstance()

const students = reactive([])
const requests = reactive([])
// 提出期限と再依頼回数は依頼IDごと、未返信のメッセージは会話IDごとにサーバーから届く
const requestMeta = reactive({})
const conversations = reactive([])
const unrepliedMessages = reactive([])

const requestsByStudent = (studentId) =>
  requests.filter((r) => r.student_id === studentId).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))

// ---- 選考ステップ ----
const SELECTION_STATUS_LABEL = {
  first_interview: "1次",
  second_interview: "2次",
  final_interview: "最終",
  offered: "内定",
  rejected: "不採用",
}
const SELECTION_STATUS_OPTIONS = Object.entries(SELECTION_STATUS_LABEL).map(([value, title]) => ({ title, value }))
const SELECTION_STATUS_META = {
  first_interview: { color: "#1d63d1", bg: "#e8f0fe", icon: "👤" },
  second_interview: { color: "#c2740a", bg: "#fdf1e0", icon: "👤" },
  final_interview: { color: "#7c3aed", bg: "#f1e9fe", icon: "👤" },
  offered: { color: "#1a8a4c", bg: "#e6f6ec", icon: "🎉" },
  rejected: { color: "#c62828", bg: "#fdecea", icon: "👤" },
}

const updateSelectionStatus = (studentId, status) => {
  socket.emit("updateSelectionStatus", { studentId, status })
}

// 編集ダイアログ → 確認ダイアログの2段階でヒューマンエラーを防ぐ
const editDialogOpen = ref(false)
const editTarget = ref(null)
const editDraftStatus = ref(null)
const confirmDialogOpen = ref(false)
const pendingChange = ref(null)

const openEditDialog = (student) => {
  editTarget.value = student
  editDraftStatus.value = student.selection_status
  editDialogOpen.value = true
}
const closeEditDialog = () => {
  editDialogOpen.value = false
  editTarget.value = null
}
const requestSaveFromDialog = () => {
  if (editDraftStatus.value === editTarget.value.selection_status) {
    closeEditDialog()
    return
  }
  pendingChange.value = {
    studentId: editTarget.value.id,
    name: editTarget.value.name,
    from: editTarget.value.selection_status,
    to: editDraftStatus.value,
  }
  editDialogOpen.value = false
  confirmDialogOpen.value = true
}
const cancelConfirm = () => {
  confirmDialogOpen.value = false
  pendingChange.value = null
  editTarget.value = null
}
const confirmSave = () => {
  updateSelectionStatus(pendingChange.value.studentId, pendingChange.value.to)
  confirmDialogOpen.value = false
  pendingChange.value = null
  editTarget.value = null
}

// ---- 日程調整状況（interview_requests から導出。DB変更なし）----
const SCHEDULE_STATUS_META = {
  none: { label: "未送信", color: "#64748b", bg: "#eef0f3", icon: "📨", desc: "まだ日程調整を開始していません" },
  awaiting_student: { label: "候補者回答待ち", color: "#1d63d1", bg: "#e8f0fe", icon: "🧑", desc: "候補者の回答を待っています" },
  matching: { label: "自動調整中", color: "#c2740a", bg: "#fdf1e0", icon: "🔄", desc: "空き時間を調整しています" },
  confirmed: { label: "確定済み", color: "#1a8a4c", bg: "#e6f6ec", icon: "✅", desc: "面接日程が確定しています" },
  cancelled: { label: "自動調整不可", color: "#c62828", bg: "#fdecea", icon: "⚠️", desc: "日程が合いませんでした" },
}

const scheduleStatusKey = (studentId) => requestsByStudent(studentId)[0]?.status ?? "none"

const scheduleMeta = (studentId) => {
  const [latest] = requestsByStudent(studentId)
  const key = latest?.status ?? "none"
  const meta = SCHEDULE_STATUS_META[key] ?? SCHEDULE_STATUS_META.none
  if (key === "confirmed" && latest?.confirmed_date && latest?.confirmed_hour != null) {
    return { ...meta, desc: `${latest.confirmed_date} ${String(latest.confirmed_hour).padStart(2, "0")}:00 に確定` }
  }
  return meta
}

// ---- 上部の集計カード ----
const selectionStepSummary = computed(() =>
  SELECTION_STATUS_OPTIONS.map((opt) => ({
    ...opt,
    ...SELECTION_STATUS_META[opt.value],
    count: students.filter((s) => s.selection_status === opt.value).length,
  }))
)
const scheduleStatusSummary = computed(() =>
  Object.entries(SCHEDULE_STATUS_META).map(([key, meta]) => ({
    key,
    ...meta,
    count: students.filter((s) => scheduleStatusKey(s.id) === key).length,
  }))
)
// 「まだ依頼が無い人」だけを未送信にすると、1次が確定して2次に進んだ候補者が
// いつまでも「確定済み」のまま抜け落ちる。選考ステップに必要な回数と、
// 確定済みの面接数を突き合わせて「次の依頼が必要か」で判定する
const REQUIRED_ROUNDS = { first_interview: 1, second_interview: 2, final_interview: 3 }
const confirmedCount = (studentId) => requestsByStudent(studentId).filter((r) => r.status === "confirmed").length
const activeRequest = (studentId) =>
  requestsByStudent(studentId).find((r) => r.status === "awaiting_student" || r.status === "matching") ?? null
const roundLabel = (round) => (round >= 3 ? "最終面接" : `${round}次面接`)
const nextRoundLabel = (studentId) => roundLabel(confirmedCount(studentId) + 1)
const needsNewRequest = (student) => {
  const required = REQUIRED_ROUNDS[student.selection_status]
  if (!required) return false // 内定・不採用は日程調整の対象外
  if (activeRequest(student.id)) return false
  return confirmedCount(student.id) < required
}
const unsentStudents = computed(() => students.filter((student) => needsNewRequest(student)))
const unsentSearch = ref("")
const unsentSelectionFilter = ref("all")
const unsentPage = ref(1)
const unsentPageSize = 10
const filteredUnsentStudents = computed(() => {
  const query = unsentSearch.value.trim().toLowerCase()
  return unsentStudents.value.filter((student) =>
    (unsentSelectionFilter.value === "all" || student.selection_status === unsentSelectionFilter.value)
    && (!query || student.name.toLowerCase().includes(query) || student.email.toLowerCase().includes(query)))
})
const unsentTotalPages = computed(() => Math.max(1, Math.ceil(filteredUnsentStudents.value.length / unsentPageSize)))
const paginatedUnsentStudents = computed(() => filteredUnsentStudents.value.slice((unsentPage.value - 1) * unsentPageSize, unsentPage.value * unsentPageSize))
watch([unsentSearch, unsentSelectionFilter], () => { unsentPage.value = 1 })
watch(unsentTotalPages, (pages) => { if (unsentPage.value > pages) unsentPage.value = pages })

const lastUpdatedAt = (studentId) => {
  const [latest] = requestsByStudent(studentId)
  return latest?.updated_at ?? students.find((s) => s.id === studentId)?.created_at ?? null
}
const lastUpdated = (studentId) => relativeTime(lastUpdatedAt(studentId))

// ---- やること（要対応キュー）----
// 集計だけでは「次に何をするか」が分からないので、候補者ごとに1件だけ
// 実行できる作業を決めて、緊急度の高い順に並べる
const now = ref(Date.now())
let clockTimer = null
onMounted(() => { clockTimer = window.setInterval(() => { now.value = Date.now() }, 60_000) })
onUnmounted(() => window.clearInterval(clockTimer))

const DAY_MS = 86_400_000
const STALLED_DAYS = 2 // 面接官の回答が何日止まったら要対応にするか

const TASK_TYPES = [
  { key: "reply", icon: "💬", tone: "info", label: "まだ返信していません", action: "返信する" },
  { key: "overdue", icon: "⏰", tone: "danger", label: "提出期限が過ぎています", action: "催促する" },
  { key: "dueToday", icon: "📅", tone: "warn", label: "本日が提出期限です", action: "催促する" },
  { key: "resubmit", icon: "🔁", tone: "warn", label: "候補が合わず、再提出を依頼中です", action: "期間を変えて再送" },
  { key: "stalled", icon: "🔄", tone: "warn", label: "面接官の回答が止まっています", action: "期間を変えて再送" },
  { key: "unsent", icon: "📨", tone: "muted", label: "日程調整がまだ送られていません", action: "日程調整を送る" },
]

const studentIdByConversation = computed(() =>
  new Map(conversations.filter((c) => c.student_id).map((c) => [c.id, c.student_id])))
// 「人事が返していない候補者のメッセージ」。既読かどうかではなく返したかどうかで見るので、
// 端末をまたいでも、人事が複数人いても同じ結果になる
const unrepliedByStudent = computed(() => {
  const map = new Map()
  for (const message of unrepliedMessages) {
    const studentId = studentIdByConversation.value.get(message.conversation_id)
    if (studentId) map.set(studentId, message)
  }
  return map
})
const unrepliedMessage = (studentId) => unrepliedByStudent.value.get(studentId) ?? null

const formatDateTime = (value) =>
  new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(new Date(value))
const isSameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
const elapsedLabel = (ms) => {
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return "1時間未満"
  if (hours < 24) return `${hours}時間`
  return `${Math.floor(hours / 24)}日`
}

const buildTask = (student) => {
  const request = activeRequest(student.id)
  const meta = request ? requestMeta[request.id] : null
  const deadline = meta?.responseDeadline ? new Date(meta.responseDeadline).getTime() : null
  const unreplied = unrepliedMessage(student.id)
  const base = { student, request, unreplied: Boolean(unreplied), roundLabel: nextRoundLabel(student.id) }

  // 候補者が書いてきたなら、まず読んで返すのが次の一手。期限切れより先に立てる
  if (unreplied) {
    return { ...base, key: "reply", detail: `${formatDateTime(unreplied.created_at)}「${(unreplied.body ?? "").slice(0, 40)}」`, sortAt: new Date(unreplied.created_at).getTime() }
  }
  if (request?.status === "awaiting_student" && deadline && deadline < now.value) {
    return { ...base, key: "overdue", detail: `提出期限 ${formatDateTime(deadline)} を ${elapsedLabel(now.value - deadline)} 過ぎています`, sortAt: deadline }
  }
  if (request?.status === "awaiting_student" && deadline && isSameDay(deadline, now.value)) {
    return { ...base, key: "dueToday", detail: `提出期限は本日 ${formatDateTime(deadline)} です`, sortAt: deadline }
  }
  if (request?.status === "awaiting_student" && (meta?.calendarCount ?? 0) >= 2) {
    return { ...base, key: "resubmit", detail: `${meta.calendarCount - 1}回目の再提出依頼を ${formatDateTime(meta.lastSentAt)} に送信済みです`, sortAt: new Date(meta.lastSentAt).getTime() }
  }
  if (request?.status === "matching") {
    const stoppedFor = now.value - new Date(request.updated_at).getTime()
    if (stoppedFor >= STALLED_DAYS * DAY_MS) {
      return { ...base, key: "stalled", detail: `${elapsedLabel(stoppedFor)} 動きがありません（面接官の可否・承認待ち）`, sortAt: new Date(request.updated_at).getTime() }
    }
  }
  if (needsNewRequest(student)) {
    return { ...base, key: "unsent", detail: `選考ステップは「${SELECTION_STATUS_LABEL[student.selection_status]}」。${nextRoundLabel(student.id)}の日程調整が必要です`, sortAt: new Date(student.created_at ?? 0).getTime() }
  }
  return null
}

const tasks = computed(() => {
  const order = TASK_TYPES.map((t) => t.key)
  return students
    .map(buildTask)
    .filter(Boolean)
    .map((task) => ({ ...task, ...TASK_TYPES[order.indexOf(task.key)], priority: order.indexOf(task.key) }))
    .sort((a, b) => (a.priority - b.priority) || (a.sortAt - b.sortAt))
})
// 1件ずつ全部並べると、未送信が多い日は画面がそれだけで埋まって
// 本当に手を動かす作業が埋もれる。人事の動きに合わせて4つにまとめ、
// 中身は開いたときだけ見せる
const TASK_GROUPS = [
  { key: "reply", types: ["reply"], icon: "💬", jump: "一覧で返信する" },
  { key: "nudge", types: ["overdue", "dueToday"], icon: "⏰", jump: null },
  { key: "stuck", types: ["resubmit", "stalled"], icon: "🔁", jump: null },
  { key: "unsent", types: ["unsent"], icon: "📨", jump: "まとめて送る" },
]

const countOf = (items, key) => items.filter((item) => item.key === key).length

const describeGroup = (key, items) => {
  if (key === "reply") {
    return {
      tone: "info",
      title: "候補者にまだ返信していません",
      note: `いちばん古いメッセージは ${elapsedLabel(now.value - items[0].sortAt)} 前に届いています`,
    }
  }
  if (key === "nudge") {
    const overdue = countOf(items, "overdue")
    const dueToday = countOf(items, "dueToday")
    return {
      tone: overdue > 0 ? "danger" : "warn",
      title: "候補者から回答が届いていません",
      note: [overdue ? `提出期限切れ ${overdue}人` : "", dueToday ? `本日が期限 ${dueToday}人` : ""]
        .filter(Boolean).join("／"),
    }
  }
  if (key === "stuck") {
    const resubmit = countOf(items, "resubmit")
    const stalled = countOf(items, "stalled")
    return {
      tone: "warn",
      title: "日程調整が前に進んでいません",
      note: [resubmit ? `候補が合わず再提出待ち ${resubmit}人` : "", stalled ? `面接官の回答待ち ${stalled}人` : ""]
        .filter(Boolean).join("／"),
    }
  }
  const secondRound = items.filter((item) => confirmedCount(item.student.id) > 0).length
  return {
    tone: "muted",
    title: "日程調整をまだ送っていません",
    note: secondRound > 0 ? `初回 ${items.length - secondRound}人／次の面接ぶん ${secondRound}人` : "全員が初回の日程調整です",
  }
}

const taskGroups = computed(() =>
  TASK_GROUPS
    .map((group) => {
      const items = tasks.value.filter((task) => group.types.includes(task.key))
      return items.length ? { ...group, items, count: items.length, ...describeGroup(group.key, items) } : null
    })
    .filter(Boolean))

const openGroup = ref(null)
const toggleGroup = (key) => { openGroup.value = openGroup.value === key ? null : key }
const TASK_PREVIEW = 5
const showAllTasks = ref(false)
watch(openGroup, () => { showAllTasks.value = false })
const openItems = computed(() => {
  const group = taskGroups.value.find((item) => item.key === openGroup.value)
  if (!group) return []
  return showAllTasks.value ? group.items : group.items.slice(0, TASK_PREVIEW)
})
const openGroupTotal = computed(() =>
  taskGroups.value.find((group) => group.key === openGroup.value)?.count ?? 0)

// グループごとの一括導線。個別に開き直さなくても、その作業の場所へ直接入れる
const runGroup = (group) => {
  if (group.key === "reply") {
    router.push({ name: "hr-chat", query: { filter: "unreplied" } })
    return
  }
  if (group.key === "unsent") {
    router.push({ name: "hr-schedule-create", query: { students: group.items.map((item) => item.student.id).join(",") } })
  }
}

// 催促は文面を用意した状態でチャットを開く。人事が毎回書き起こさなくていいようにする
const nudgeDraft = (student) =>
  `${student.name} さん\nお送りしている面接候補日時について、ご回答をお待ちしております。ご都合が合わない場合もお知らせください。`

const runTask = (task) => {
  if (task.key === "unsent") {
    router.push({ name: "hr-schedule-create", query: { students: task.student.id } })
    return
  }
  if (task.key === "resubmit" || task.key === "stalled") {
    openResend(task)
    return
  }
  const query = task.key === "reply" ? {} : { draft: nudgeDraft(task.student) }
  router.push({ name: "hr-chat-room", params: { role: "student", id: task.student.id }, query })
}

// ---- 期間を変えて再送 ----
const resendOpen = ref(false)
const resendTarget = ref(null)
const resendSending = ref(false)
const resendError = ref("")
const toIsoDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const resendForm = reactive({ rangeStart: "", rangeEnd: "", deadlineDate: "", deadlineTime: "23:59" })

const openResend = (task) => {
  const start = new Date()
  const end = new Date(start.getTime() + 13 * DAY_MS)
  const deadline = new Date(start.getTime() + 2 * DAY_MS)
  resendTarget.value = task
  resendForm.rangeStart = toIsoDate(start)
  resendForm.rangeEnd = toIsoDate(end)
  resendForm.deadlineDate = toIsoDate(deadline)
  resendForm.deadlineTime = "23:59"
  resendError.value = ""
  resendOpen.value = true
}
const resendValid = computed(() =>
  resendForm.rangeStart && resendForm.rangeEnd && resendForm.rangeStart <= resendForm.rangeEnd
  && resendForm.deadlineDate && resendForm.deadlineTime && !resendSending.value)

const submitResend = () => {
  if (!resendValid.value || !resendTarget.value?.request) return
  resendSending.value = true
  resendError.value = ""
  socket.emit("resendRequest", {
    requestId: resendTarget.value.request.id,
    interviewerIds: resendTarget.value.request.interviewer_ids,
    rangeStart: resendForm.rangeStart,
    rangeEnd: resendForm.rangeEnd,
    responseDeadline: new Date(`${resendForm.deadlineDate}T${resendForm.deadlineTime}:00`).toISOString(),
  }, (result) => {
    resendSending.value = false
    if (!result?.ok) { resendError.value = "再送できませんでした。通信状況を確認してください。"; return }
    resendOpen.value = false
    toast.value = `${resendTarget.value.student.name}さんへ新しい期間で再送しました`
    window.setTimeout(() => { toast.value = "" }, 2800)
  })
}

// ---- 一覧のソート ----
const SELECTION_STATUS_ORDER = SELECTION_STATUS_OPTIONS.map((o) => o.value)
const SCHEDULE_STATUS_ORDER = Object.keys(SCHEDULE_STATUS_META)

const sortKey = ref(null) // 'selection_status' | 'schedule_status' | 'last_updated'
const sortDir = ref("asc")

const toggleSort = (key) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc"
  } else {
    sortKey.value = key
    sortDir.value = "asc"
  }
}
const sortIndicator = (key) => (sortKey.value !== key ? "" : sortDir.value === "asc" ? "▲" : "▼")

const taskByStudent = computed(() => new Map(tasks.value.map((task) => [task.student.id, task])))
const taskOf = (studentId) => taskByStudent.value.get(studentId) ?? null
const urgencyOf = (studentId) => taskOf(studentId)?.priority ?? TASK_TYPES.length

const sortedStudents = computed(() => {
  // 並び替えを指定していないときは、要対応の緊急度順にする
  if (!sortKey.value) return [...students].sort((a, b) => urgencyOf(a.id) - urgencyOf(b.id))
  const dir = sortDir.value === "asc" ? 1 : -1
  return [...students].sort((a, b) => {
    let av, bv
    if (sortKey.value === "selection_status") {
      av = SELECTION_STATUS_ORDER.indexOf(a.selection_status)
      bv = SELECTION_STATUS_ORDER.indexOf(b.selection_status)
    } else if (sortKey.value === "schedule_status") {
      av = SCHEDULE_STATUS_ORDER.indexOf(scheduleStatusKey(a.id))
      bv = SCHEDULE_STATUS_ORDER.indexOf(scheduleStatusKey(b.id))
    } else {
      av = new Date(lastUpdatedAt(a.id) ?? 0).getTime()
      bv = new Date(lastUpdatedAt(b.id) ?? 0).getTime()
    }
    return (av - bv) * dir
  })
})

// ---- 一覧の絞り込み・ページ送り（表示のみ。DB取得方法は変更しない）----
const dashboardSearch = ref("")
const selectionFilter = ref("all")
const scheduleFilter = ref("all")
const currentPage = ref(1)
const pageSize = 10
const filteredStudents = computed(() => {
  const query = dashboardSearch.value.trim().toLowerCase()
  return sortedStudents.value.filter((student) =>
    (selectionFilter.value === "all" || student.selection_status === selectionFilter.value)
    && (scheduleFilter.value === "all" || scheduleStatusKey(student.id) === scheduleFilter.value)
    && (!query || student.name.toLowerCase().includes(query) || student.email.toLowerCase().includes(query)))
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredStudents.value.length / pageSize)))
const paginatedStudents = computed(() => filteredStudents.value.slice((currentPage.value - 1) * pageSize, currentPage.value * pageSize))
watch([dashboardSearch, selectionFilter, scheduleFilter], () => { currentPage.value = 1 })
watch(totalPages, (pages) => { if (currentPage.value > pages) currentPage.value = pages })

const relativeTime = (dateStr) => {
  if (!dateStr) return "-"
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "たった今"
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  return `${days}日前`
}

const AVATAR_COLORS = ["#3498db", "#9b59b6", "#e67e22", "#16a085", "#e74c3c", "#2c3e50"]
const initials = (name) => (name ?? "").trim().charAt(0) || "?"
const avatarColor = (name) => {
  const code = (name ?? "").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

// 一覧から相手を選び直させず、その学生とのチャットへ直接入る
const goToChat = (student) =>
  router.push({ name: "hr-chat-room", params: { role: "student", id: student.id } })

// ---- サーバーからの一覧データ ----
const onDashboardData = (data) => {
  students.splice(0, students.length, ...data.students)
  requests.splice(0, requests.length, ...data.requests)
  conversations.splice(0, conversations.length, ...(data.conversations ?? []))
  unrepliedMessages.splice(0, unrepliedMessages.length, ...(data.unrepliedMessages ?? []))
  Object.keys(requestMeta).forEach((key) => delete requestMeta[key])
  Object.assign(requestMeta, data.requestMeta ?? {})
}
const onNewMessage = () => socket.emit("loadDashboard")

onMounted(() => {
  socket.on("dashboardData", onDashboardData)
  socket.on("newMessage", onNewMessage)
  socket.emit("loadDashboard")
})
onUnmounted(() => {
  socket.off("dashboardData", onDashboardData)
  socket.off("newMessage", onNewMessage)
})

// 再送の結果など、この画面の操作の確認に使う
const toast = ref("")
</script>

<template>
  <div class="dashboard-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">DASHBOARD</span>
        <h1>ダッシュボード</h1>
        <p>候補者の選考ステップと日程調整の進み具合を一覧で確認できます。</p>
      </div>
    </header>

    <v-card class="pa-4 mb-4 task-card">
      <div class="task-head">
        <div>
          <div class="text-subtitle-1 font-weight-medium">やること</div>
          <small class="text-caption text-medium-emphasis">
            人事が手を動かさないと止まるものだけを、上から順に並べています。
          </small>
        </div>
        <div class="task-total" :class="{ 'task-total--zero': tasks.length === 0 }">
          <strong>{{ tasks.length }}</strong><span>人</span>
          <small>対応が必要な候補者</small>
        </div>
      </div>

      <p v-if="!taskGroups.length" class="task-empty">✅ いま手を動かす必要のある候補者はいません。</p>

      <ul v-else class="group-list">
        <li v-for="group in taskGroups" :key="group.key" :class="`group group--${group.tone}`">
          <div class="group__head">
            <button
              type="button"
              class="group__row"
              :aria-expanded="openGroup === group.key"
              @click="toggleGroup(group.key)"
            >
              <span class="group__icon">{{ group.icon }}</span>
              <span class="group__text">
                <strong>{{ group.title }}</strong>
                <small>{{ group.note }}</small>
              </span>
              <span :class="`group__count group__count--${group.tone}`">
                <b>{{ group.count }}</b>人
              </span>
              <span class="group__toggle">{{ openGroup === group.key ? "閉じる ▲" : "内訳 ▼" }}</span>
            </button>
            <button v-if="group.jump" type="button" class="group__jump" @click="runGroup(group)">
              {{ group.jump }}
            </button>
          </div>

          <ul v-if="openGroup === group.key" class="task-list">
            <li v-for="task in openItems" :key="task.student.id" :class="`task task--${task.tone}`">
              <span class="task__icon">{{ task.icon }}</span>
              <div class="task__body">
                <div class="task__title">
                  <strong>{{ task.student.name }}</strong>
                  <span class="task__round">{{ task.roundLabel }}</span>
                  <span v-if="task.unreplied" class="task__unreplied">未返信</span>
                </div>
                <div class="task__label">{{ task.label }}</div>
                <div class="task__detail">{{ task.detail }}</div>
              </div>
              <div class="task__actions">
                <button type="button" class="task__primary" @click="runTask(task)">{{ task.action }}</button>
                <button
                  type="button"
                  class="icon-btn"
                  :title="`${task.student.name} さんとのチャットを開く`"
                  :aria-label="`${task.student.name} さんとのチャットを開く`"
                  @click="goToChat(task.student)"
                ><HrIcon name="chat" :size="17" /></button>
              </div>
            </li>
          </ul>

          <button
            v-if="openGroup === group.key && openGroupTotal > TASK_PREVIEW"
            type="button"
            class="task-more"
            @click="showAllTasks = !showAllTasks"
          >{{ showAllTasks ? "折りたたむ" : `残り ${openGroupTotal - TASK_PREVIEW} 人を表示` }}</button>
        </li>
      </ul>
    </v-card>

    <div class="dashboard-body">
      <v-card class="pa-4 flex-grow-1" style="min-width: 0">
        <div class="text-subtitle-2 font-weight-medium mb-3 text-medium-emphasis">選考ステップ別 人数</div>
        <div class="summary-grid mb-6">
          <button
            v-for="opt in selectionStepSummary"
            :key="opt.value"
            type="button"
            class="summary-card"
            :class="{ 'summary-card--active': selectionFilter === opt.value }"
            @click="selectionFilter = selectionFilter === opt.value ? 'all' : opt.value"
          >
            <div class="d-flex align-center ga-2">
              <div class="summary-icon" :style="{ background: opt.bg, color: opt.color }">{{ opt.icon }}</div>
              <div class="summary-count">{{ opt.count }}<span class="text-caption font-weight-regular">件</span></div>
            </div>
            <div class="font-weight-medium mt-2">{{ opt.title }}</div>
          </button>
        </div>

        <div class="text-subtitle-2 font-weight-medium mb-3 text-medium-emphasis">日程調整状況別 人数</div>
        <div class="summary-grid mb-6">
          <button
            v-for="item in scheduleStatusSummary"
            :key="item.key"
            type="button"
            class="summary-card"
            :class="{ 'summary-card--active': scheduleFilter === item.key }"
            @click="scheduleFilter = scheduleFilter === item.key ? 'all' : item.key"
          >
            <div class="d-flex align-center ga-2">
              <div class="summary-icon" :style="{ background: item.bg, color: item.color }">{{ item.icon }}</div>
              <div class="summary-count">{{ item.count }}<span class="text-caption font-weight-regular">件</span></div>
            </div>
            <div class="font-weight-medium mt-2">{{ item.label }}</div>
            <div class="text-caption text-medium-emphasis">{{ item.desc }}</div>
          </button>
        </div>

        <div class="student-list-title"><div><div class="text-subtitle-1 font-weight-medium">学生ステータス一覧</div><small>{{ filteredStudents.length }}件中 {{ paginatedStudents.length }}件を表示</small></div><div class="student-filters"><label><HrIcon name="search" :size="15" /><input v-model="dashboardSearch" type="search" placeholder="名前・メールで検索" /></label><select v-model="selectionFilter"><option value="all">すべての選考段階</option><option v-for="option in SELECTION_STATUS_OPTIONS" :key="option.value" :value="option.value">{{ option.title }}</option></select><select v-model="scheduleFilter"><option value="all">すべての日程状況</option><option v-for="(meta, key) in SCHEDULE_STATUS_META" :key="key" :value="key">{{ meta.label }}</option></select></div></div>

        <div v-if="students.length === 0" class="text-medium-emphasis pa-4">学生が登録されていません</div>
        <div v-else-if="filteredStudents.length === 0" class="text-medium-emphasis pa-4">条件に一致する学生はいません</div>

        <div v-else class="dash-grid">
          <div class="dash-head">候補者名</div>
          <div class="dash-head dash-head--sortable" @click="toggleSort('selection_status')">
            選考ステップ <span class="sort-arrow">{{ sortIndicator("selection_status") }}</span>
          </div>
          <div class="dash-head dash-head--sortable" @click="toggleSort('schedule_status')">
            ステータス <span class="sort-arrow">{{ sortIndicator("schedule_status") }}</span>
          </div>
          <div class="dash-head dash-head--sortable" @click="toggleSort('last_updated')">
            最終更新 <span class="sort-arrow">{{ sortIndicator("last_updated") }}</span>
          </div>
          <div class="dash-head text-right">操作</div>

          <template v-for="s in paginatedStudents" :key="s.id">
            <div class="dash-cell">
              <div class="dash-person">
                <div class="avatar-circle" :style="{ background: avatarColor(s.name) }">{{ initials(s.name) }}</div>
                <div class="dash-person__text">
                  <div class="dash-person__line">
                    <span class="dash-person__name" :title="s.name">{{ s.name }}</span>
                    <span
                      v-if="taskOf(s.id)"
                      :class="`row-flag row-flag--${taskOf(s.id).tone}`"
                      :title="taskOf(s.id).label"
                    >{{ taskOf(s.id).icon }} {{ taskOf(s.id).action }}</span>
                  </div>
                  <div class="dash-person__mail text-caption text-medium-emphasis" :title="s.email">{{ s.email }}</div>
                </div>
              </div>
            </div>

            <div class="dash-cell dash-cell--column">
              <span>{{ SELECTION_STATUS_LABEL[s.selection_status] ?? s.selection_status }}</span>
              <span
                class="text-caption text-medium-emphasis"
                :title="needsNewRequest(s) ? `次は${nextRoundLabel(s.id)}（未送信）` : `確定済み ${confirmedCount(s.id)}件`"
              >{{ needsNewRequest(s) ? `次は${nextRoundLabel(s.id)}（未送信）` : `確定済み ${confirmedCount(s.id)}件` }}</span>
            </div>

            <div class="dash-cell dash-cell--column">
              <span class="status-chip" :style="{ color: scheduleMeta(s.id).color, background: scheduleMeta(s.id).bg }">
                {{ scheduleMeta(s.id).icon }} {{ scheduleMeta(s.id).label }}
              </span>
              <span class="text-caption text-medium-emphasis mt-1" :title="scheduleMeta(s.id).desc">{{ scheduleMeta(s.id).desc }}</span>
            </div>

            <div class="dash-cell text-caption text-medium-emphasis">{{ lastUpdated(s.id) }}</div>

            <div class="dash-cell justify-end ga-2">
              <button
                type="button"
                class="icon-btn"
                :title="`${s.name} さんとのチャットを開く`"
                :aria-label="`${s.name} さんとのチャットを開く`"
                @click="goToChat(s)"
              ><HrIcon name="chat" :size="17" /></button>
              <v-menu>
                <template #activator="{ props }">
                  <button type="button" class="icon-btn icon-btn--more" aria-label="その他の操作" v-bind="props">⋮</button>
                </template>
                <v-list density="compact">
                  <v-list-item @click="openEditDialog(s)">選考状況を編集</v-list-item>
                  <v-list-item @click="goToChat(s)">{{ s.name }} さんとのチャットを開く</v-list-item>
                </v-list>
              </v-menu>
            </div>
          </template>
        </div>
        <nav v-if="filteredStudents.length > pageSize" class="pagination" aria-label="学生一覧のページ送り"><button type="button" :disabled="currentPage === 1" @click="currentPage--">‹ 前へ</button><span>{{ currentPage }} / {{ totalPages }}</span><button type="button" :disabled="currentPage === totalPages" @click="currentPage++">次へ ›</button></nav>
      </v-card>

      <v-card class="pa-4 unsent-panel">
        <div class="text-subtitle-2 font-weight-medium mb-1">
          日程調整が必要な候補者
          <span class="text-caption text-medium-emphasis">（{{ unsentStudents.length }}件）</span>
        </div>
        <p class="text-caption text-medium-emphasis mb-3">
          まだ依頼していない人と、次の面接の依頼がまだの人を表示します。
        </p>
        <button
          v-if="unsentStudents.length"
          type="button"
          class="bulk-send"
          @click="router.push({ name: 'hr-schedule-create', query: { students: filteredUnsentStudents.map((s) => s.id).join(',') } })"
        >表示中の {{ filteredUnsentStudents.length }}名にまとめて送る</button>
        <div class="unsent-filters"><label><HrIcon name="search" :size="14" /><input v-model="unsentSearch" type="search" placeholder="名前・メールで検索" /></label><select v-model="unsentSelectionFilter"><option value="all">すべての選考段階</option><option v-for="option in SELECTION_STATUS_OPTIONS" :key="option.value" :value="option.value">{{ option.title }}</option></select></div>
        <div v-if="unsentStudents.length === 0" class="text-caption text-medium-emphasis">
          未送信の学生はいません
        </div>
        <div v-else-if="filteredUnsentStudents.length === 0" class="text-caption text-medium-emphasis">条件に一致する学生はいません</div>
        <v-list v-else density="compact" class="pa-0">
          <v-list-item v-for="s in paginatedUnsentStudents" :key="s.id" class="px-0 unsent-item">
            <div class="d-flex align-center ga-2">
              <div class="avatar-circle avatar-circle--sm" :style="{ background: avatarColor(s.name) }">
                {{ initials(s.name) }}
              </div>
              <div class="flex-grow-1" style="min-width: 0">
                <div class="font-weight-medium text-body-2 text-truncate">{{ s.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ SELECTION_STATUS_LABEL[s.selection_status] ?? s.selection_status }}・次は{{ nextRoundLabel(s.id) }}
                </div>
              </div>
              <button
                type="button"
                class="unsent-send"
                @click="router.push({ name: 'hr-schedule-create', query: { students: s.id } })"
              >送る</button>
              <button
                type="button"
                class="icon-btn icon-btn--sm"
                :title="`${s.name} さんとのチャットを開く`"
                :aria-label="`${s.name} さんとのチャットを開く`"
                @click="goToChat(s)"
              ><HrIcon name="chat" :size="15" /></button>
            </div>
          </v-list-item>
        </v-list>
        <nav v-if="filteredUnsentStudents.length > unsentPageSize" class="pagination pagination--unsent" aria-label="未送信学生のページ送り"><button type="button" :disabled="unsentPage === 1" @click="unsentPage--">‹</button><span>{{ unsentPage }} / {{ unsentTotalPages }}</span><button type="button" :disabled="unsentPage === unsentTotalPages" @click="unsentPage++">›</button></nav>
      </v-card>
    </div>

    <v-dialog v-model="editDialogOpen" max-width="360">
      <v-card class="pa-4">
        <div class="text-h6 mb-4">選考状況を編集</div>
        <div class="text-body-2 mb-2">{{ editTarget?.name }} さん</div>
        <v-select
          v-model="editDraftStatus"
          :items="SELECTION_STATUS_OPTIONS"
          density="compact"
          variant="outlined"
          hide-details
        />
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="closeEditDialog">キャンセル</v-btn>
          <v-btn color="primary" @click="requestSaveFromDialog">保存</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="confirmDialogOpen" max-width="400">
      <v-card class="pa-4">
        <div class="text-h6 mb-4">選考状況を変更しますか？</div>
        <div class="mb-4">
          {{ pendingChange?.name }} さん：
          {{ SELECTION_STATUS_LABEL[pendingChange?.from] ?? pendingChange?.from }}
          →
          {{ SELECTION_STATUS_LABEL[pendingChange?.to] ?? pendingChange?.to }}
        </div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="cancelConfirm">キャンセル</v-btn>
          <v-btn color="primary" @click="confirmSave">保存する</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="resendOpen" max-width="430">
      <v-card class="pa-5">
        <div class="text-h6 mb-1">期間を変えて再送</div>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ resendTarget?.student.name }} さんに、新しい候補期間で回答を依頼し直します。
          面接官はこれまでと同じ {{ resendTarget?.request?.interviewer_ids?.length ?? 0 }}名です。
        </p>
        <label class="resend-field">
          <span>候補日時の期間</span>
          <div class="resend-range">
            <input v-model="resendForm.rangeStart" type="date" />
            <em>〜</em>
            <input v-model="resendForm.rangeEnd" type="date" />
          </div>
        </label>
        <label class="resend-field">
          <span>提出期限</span>
          <div class="resend-range resend-range--deadline">
            <input v-model="resendForm.deadlineDate" type="date" />
            <input v-model="resendForm.deadlineTime" type="time" />
          </div>
        </label>
        <p class="text-caption text-medium-emphasis mt-2 mb-0">期限の24時間前にリマインドが自動送信されます。</p>
        <p v-if="resendError" class="resend-error">{{ resendError }}</p>
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="resendOpen = false">キャンセル</v-btn>
          <v-btn color="primary" :disabled="!resendValid" :loading="resendSending" @click="submitResend">再送する</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>

<style scoped>
.dashboard-page {
  height: 100%;
  overflow-y: auto;
  padding: 26px 30px 40px;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.eyebrow { color: #7a8699; font-size: 10px; font-weight: 750; letter-spacing: .12em; }
.page-header h1 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -.02em; }
.page-header p { margin: 0; color: #69758b; font-size: 12px; }
.dashboard-body { display: flex; gap: 16px; align-items: flex-start; }
.unsent-panel { width: 260px; flex: 0 0 auto; }

.summary-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(125px, 1fr));
}
.summary-grid.mb-6 { margin-bottom: 16px !important; }
/* 集計カードは押すと一覧を絞り込むボタンにした */
.summary-card {
  display: block; min-height: 78px; border: 1px solid #e4e9f1; border-radius: 9px; padding: 9px 10px;
  background: #fff; color: inherit; font: inherit; text-align: left; cursor: pointer;
  transition: border-color .15s, box-shadow .15s;
}
.summary-card:hover { border-color: #b7c9e9; }
.summary-card--active { border-color: #1769ff; box-shadow: 0 0 0 2px rgb(23 105 255 / 12%); }
.summary-icon { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 7px; font-size: 12px; }
.summary-count { font-size: 18px; font-weight: 700; line-height: 1; }
.summary-card > .font-weight-medium { margin-top: 6px !important; font-size: 12px; line-height: 1.25; }
.summary-card > .text-caption { margin-top: 2px; font-size: 9px !important; line-height: 1.3; }
.student-list-title { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.student-list-title small { color: #8490a3; font-size: 10px; }
.student-filters { display: flex; gap: 7px; }
.student-filters label { display: flex; width: 190px; height: 34px; align-items: center; gap: 6px; border: 1px solid #dce3ed; border-radius: 8px; padding: 0 9px; color: #8490a3; }
.student-filters input { min-width: 0; flex: 1; border: 0; outline: 0; font: inherit; font-size: 10px; }
.student-filters select { height: 34px; border: 1px solid #dce3ed; border-radius: 8px; padding: 0 8px; background: #fff; color: #536077; font-size: 10px; }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 14px; }
.pagination button { height: 32px; border: 1px solid #dce3ed; border-radius: 7px; padding: 0 12px; background: #fff; color: #43516a; font-size: 10px; cursor: pointer; }
.pagination button:disabled { opacity: .42; cursor: default; }.pagination span { color: #758197; font-size: 10px; }

.dash-grid {
  display: grid;
  grid-template-columns: minmax(230px, 2.2fr) 140px minmax(190px, 1.6fr) 104px 96px;
  align-items: center;
  /* 列幅を保ったまま、狭い画面では表だけを横スクロールさせる */
  overflow-x: auto;
}
.dash-head {
  border-bottom: 1px solid #e4e9f1;
  padding: 10px 8px;
  color: #69758b;
  font-size: 12px;
  font-weight: 700;
}
.dash-head--sortable { cursor: pointer; user-select: none; }
.dash-head--sortable:hover { color: #1769ff; }
.sort-arrow { font-size: 10px; }
.dash-cell { display: flex; min-width: 0; min-height: 48px; align-items: center; border-bottom: 1px solid #f0f3f8; padding: 7px 8px; font-size: 12px; white-space: nowrap; }
.dash-cell--column { flex-direction: column; align-items: flex-start; justify-content: center; }
/* 列幅に収まらない文は折り返さず省略する。全文は title で読める */
.dash-cell--column > * { overflow: hidden; max-width: 100%; text-overflow: ellipsis; }
.status-chip { flex: 0 0 auto; border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 650; }

/* 候補者名：名前・メール・要対応バッジが改行で崩れないよう、1行ずつ省略表示にする */
.dash-person { display: flex; min-width: 0; width: 100%; align-items: center; gap: 11px; }
.dash-person__text { min-width: 0; flex: 1; }
.dash-person__line { display: flex; min-width: 0; align-items: center; gap: 7px; }
.dash-person__name { overflow: hidden; font-weight: 500; text-overflow: ellipsis; }
.dash-person__mail { overflow: hidden; text-overflow: ellipsis; }
.avatar-circle {
  display: grid;
  width: 29px;
  height: 29px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.avatar-circle--sm { width: 26px; height: 26px; font-size: 11px; }
.unsent-filters { display: grid; gap: 6px; margin-bottom: 12px; }.unsent-filters label { display: flex; height: 31px; align-items: center; gap: 6px; border: 1px solid #dce3ed; border-radius: 7px; padding: 0 8px; color: #8490a3; }.unsent-filters input { min-width: 0; flex: 1; border: 0; outline: 0; font: inherit; font-size: 9px; }.unsent-filters select { height: 31px; border: 1px solid #dce3ed; border-radius: 7px; padding: 0 7px; background: #fff; color: #536077; font-size: 9px; }.unsent-item { min-height: 42px!important; }.pagination--unsent { justify-content: center; padding-top: 9px; }.pagination--unsent button { width: 30px; padding: 0; }

/* やること（要対応キュー） */
.task-card { border: 1px solid #e2e8f2; }
.task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.task-total { flex-shrink: 0; text-align: right; line-height: 1; }
.task-total strong { color: #1769ff; font-size: 32px; font-variant-numeric: tabular-nums; }
.task-total span { margin-left: 3px; color: #7b879b; font-size: 12px; }
.task-total small { display: block; margin-top: 5px; color: #7b879b; font-size: 10px; }
.task-total--zero strong { color: #1a8a4c; }
/* 4つの作業のまとまり。中身は開いたときだけ出す */
.group-list { display: flex; flex-direction: column; gap: 8px; margin: 14px 0 0; padding: 0; list-style: none; }
.group { border: 1px solid #e5eaf2; border-left: 4px solid #cbd5e3; border-radius: 10px; background: #fff; }
.group--danger { border-left-color: #c9352a; }
.group--warn { border-left-color: #e0930f; }
.group--info { border-left-color: #1769ff; }
.group--muted { border-left-color: #94a2b8; }
/* まとまりが4つ並ぶので、件数・内訳・ボタンは行が変わっても同じ位置に来るよう固定列にする */
.group__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 136px;
  align-items: center;
  gap: 10px;
  padding: 4px 12px 4px 4px;
}
.group__row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 74px 62px;
  min-width: 0;
  align-items: center;
  gap: 12px;
  border: 0; border-radius: 8px; padding: 11px 10px; background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.group__row:hover { background: #f6f9fe; }
.group__icon { flex-shrink: 0; font-size: 19px; }
.group__text { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.group__text strong { font-size: 14px; }
.group__text small { margin-top: 2px; color: #6b7789; font-size: 12px; }
/* 件数はひと目で拾えるよう、文章から出して数字だけを立てる */
.group__count {
  display: inline-flex;
  width: 100%;
  align-items: baseline;
  justify-content: flex-end;
  gap: 2px;
  border-radius: 8px;
  padding: 4px 10px;
  background: #eef1f6;
  color: #55637c;
  font-size: 11px;
  font-weight: 700;
}
.group__count b { font-size: 20px; font-variant-numeric: tabular-nums; line-height: 1; }
.group__count--danger { background: #fdeceb; color: #c9352a; }
.group__count--warn { background: #fdf4e7; color: #a86408; }
.group__count--info { background: #eaf2ff; color: #1156c9; }
.group__count--muted { background: #eef1f6; color: #55637c; }
.group__toggle { color: #6b7789; font-size: 11px; font-weight: 700; text-align: right; }
.group__jump {
  width: 100%; min-height: 34px; border: 0; border-radius: 8px; padding: 0 10px;
  background: #1769ff; color: #fff; font: inherit; font-size: 12px; font-weight: 700;
  white-space: nowrap; cursor: pointer;
}
.group__jump:hover { background: #0f57d8; }

.task-list { margin: 0; padding: 0 12px 10px; list-style: none; }
.task {
  display: flex; align-items: center; gap: 12px;
  border: 1px solid #e5eaf2; border-left: 4px solid #cbd5e3; border-radius: 10px;
  margin-bottom: 8px; padding: 11px 13px; background: #fff;
}
.task--danger { border-left-color: #c9352a; background: #fffafa; }
.task--warn { border-left-color: #e0930f; background: #fffdf7; }
.task--info { border-left-color: #1769ff; background: #f9fbff; }
.task--muted { border-left-color: #94a2b8; }
.task__icon { font-size: 19px; }
.task__body { min-width: 0; flex: 1; }
.task__title { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.task__title strong { font-size: 14px; }
.task__round { border-radius: 6px; background: #eef1f6; padding: 2px 7px; color: #55637c; font-size: 11px; font-weight: 700; }
.task__unreplied { border-radius: 6px; background: #1769ff; padding: 2px 7px; color: #fff; font-size: 11px; font-weight: 700; }
.task__label { margin-top: 3px; color: #2b3a52; font-size: 12px; font-weight: 700; }
.task__detail { margin-top: 2px; color: #6b7789; font-size: 12px; }
.task__actions { display: flex; flex-shrink: 0; align-items: center; gap: 6px; }
.task__primary {
  min-height: 34px; border: 0; border-radius: 8px; padding: 0 14px;
  background: #1769ff; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
}
.task__primary:hover { background: #0f57d8; }
/* チャットを開く印。絵文字は小さく薄く出て押せると分からないので、
   画面内の他のアイコンと同じ線画にして枠と色の変化を付ける */
.icon-btn {
  display: grid; width: 34px; height: 34px; flex-shrink: 0; place-items: center;
  border: 1px solid #cfd8e6; border-radius: 8px; background: #fff;
  color: #4c5a72; font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
}
.icon-btn:hover { border-color: #1769ff; background: #f2f7ff; color: #1769ff; }
.icon-btn:focus-visible { outline: 3px solid rgb(23 105 255 / 35%); outline-offset: 2px; }
.icon-btn--sm { width: 30px; height: 30px; }
.icon-btn--more { color: #8490a3; font-size: 17px; font-weight: 700; }
.task-empty { margin: 12px 0 0; color: #6b7789; font-size: 13px; }
.task-more {
  width: calc(100% - 24px); border: 1px dashed #cfd8e6; border-radius: 8px; margin: 0 12px 12px; padding: 8px;
  background: #fff; color: #4c5a72; font-size: 12px; font-weight: 700; cursor: pointer;
}
.task-more:hover { border-color: #1769ff; color: #1769ff; }

.row-flag { flex: 0 0 auto; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; }
.row-flag--danger { background: #fdeceb; color: #c9352a; }
.row-flag--warn { background: #fdf4e7; color: #a86408; }
.row-flag--info { background: #eaf2ff; color: #1156c9; }
.row-flag--muted { background: #eef1f6; color: #55637c; }

.bulk-send {
  width: 100%; border: 1px solid #1769ff; border-radius: 8px; margin-bottom: 10px; padding: 8px;
  background: #f2f7ff; color: #1769ff; font-size: 12px; font-weight: 700; cursor: pointer;
}
.bulk-send:hover { background: #e4eeff; }
.unsent-send {
  flex-shrink: 0; border: 1px solid #1769ff; border-radius: 7px; padding: 4px 10px;
  background: #1769ff; color: #fff; font-size: 11px; font-weight: 700; cursor: pointer;
}
.unsent-send:hover { background: #0f57d8; }

.resend-field { display: block; margin-top: 12px; }
.resend-field > span { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 700; }
.resend-range { display: grid; grid-template-columns: 1fr 16px 1fr; align-items: center; gap: 5px; }
.resend-range--deadline { grid-template-columns: 1.4fr 1fr; }
.resend-range input { height: 38px; border: 1px solid #dce3ed; border-radius: 8px; padding: 0 9px; font: inherit; font-size: 13px; }
.resend-range em { text-align: center; font-style: normal; color: #7b879b; }
.resend-error { margin: 10px 0 0; color: #c9352a; font-size: 12px; }

.toast {
  position: fixed;
  z-index: 40;
  right: 26px;
  bottom: 26px;
  border-radius: 10px;
  background: #1a2235;
  padding: 12px 18px;
  color: #fff;
  box-shadow: 0 10px 26px rgb(20 38 75 / 22%);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .dashboard-body { flex-direction: column; }
  .unsent-panel { width: 100%; }
}
@media (max-width: 860px) {
  .group__head { grid-template-columns: minmax(0, 1fr); }
  .group__row { grid-template-columns: 24px minmax(0, 1fr) auto; }
  .group__toggle { display: none; }
}

@media (max-width: 820px) {
  .dashboard-page { padding: 22px 18px 34px; }
  .student-list-title { align-items: stretch; flex-direction: column; }.student-filters { flex-wrap: wrap; }.student-filters label { width: 100%; }.student-filters select { flex: 1; }
  .dash-grid { grid-template-columns: minmax(180px, 2fr) 104px minmax(150px, 1.4fr) 92px 88px; overflow-x: auto; }
}
</style>
