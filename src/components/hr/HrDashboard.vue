<script setup>
import { computed, inject, onMounted, onUnmounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { clearSession } from "../../session.js"

const session = inject("session")
const router = useRouter()
const socket = socketManager.getInstance()

const activeTab = ref("chat")

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

// 日程調整状況（interview_requests から導出。DB変更なし）
const SCHEDULE_STATUS_META = {
  none: { label: "未送信", color: "#64748b", bg: "#eef0f3", icon: "📨", action: "日程調整依頼を送信してください", desc: "まだ日程調整を開始していません" },
  awaiting_student: { label: "候補者回答待ち", color: "#1d63d1", bg: "#e8f0fe", icon: "🧑", action: "候補者の回答を待っています", desc: "候補者の回答を待っています" },
  matching: { label: "自動調整中", color: "#c2740a", bg: "#fdf1e0", icon: "🔄", action: "自動調整中です。しばらくお待ちください", desc: "空き時間を調整しています" },
  confirmed: { label: "確定済み", color: "#1a8a4c", bg: "#e6f6ec", icon: "✅", action: "確定済みです", desc: "面接日程が確定しています" },
  cancelled: { label: "自動調整不可", color: "#c62828", bg: "#fdecea", icon: "⚠️", action: "候補者または面接官の予定をご確認ください", desc: "日程が合いませんでした" },
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

// ダッシュボード上部の集計カード（選考ステップ別／日程調整状況別の人数）
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
const unsentStudents = computed(() => students.filter((s) => scheduleStatusKey(s.id) === "none"))

const lastUpdatedAt = (studentId) => {
  const [latest] = requestsByStudent(studentId)
  return latest?.updated_at ?? students.find((s) => s.id === studentId)?.created_at ?? null
}
const lastUpdated = (studentId) => relativeTime(lastUpdatedAt(studentId))

// 一覧のソート（選考ステップ／ステータス／最終更新）
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

const sortedStudents = computed(() => {
  if (!sortKey.value) return students
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

const openChat = (student) => {
  activeTab.value = "chat"
  openConversation("student", student)
}

const students = reactive([])
const interviewers = reactive([])
const requests = reactive([])
const messages = reactive([])

const selected = ref(null) // { kind: 'student'|'interviewer', id, name, conversationId }
const newMessageText = ref("")

const dialogOpen = ref(false)
const dialogInterviewerIds = ref([])
const dialogRangeStart = ref("")
const dialogRangeEnd = ref("")
const dialogRequestId = ref(null)

const toIso = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
const defaultRangeStart = () => toIso(new Date())
const defaultRangeEnd = () => {
  const d = new Date()
  d.setDate(d.getDate() + 13)
  return toIso(d)
}

const requestsByStudent = (studentId) =>
  requests.filter((r) => r.student_id === studentId).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))

const STATUS_LABEL = {
  awaiting_student: "学生回答待ち",
  matching: "面接官確認中",
  confirmed: "確定",
  cancelled: "キャンセル",
}

const statusLabel = (studentId) => {
  const [latest] = requestsByStudent(studentId)
  if (!latest) return "未送信"
  if (latest.status === "confirmed") {
    return `確定 (${latest.confirmed_date} ${String(latest.confirmed_hour).padStart(2, "0")}:00)`
  }
  return STATUS_LABEL[latest.status] ?? latest.status
}

const conversationIdOf = (kind, entity) => {
  const conv = conversations.find((c) => c.kind === kind && (kind === "student" ? c.student_id === entity.id : c.interviewer_id === entity.id))
  return conv?.id ?? null
}

const conversations = reactive([])

const openConversation = (kind, entity) => {
  const conversationId = conversationIdOf(kind, entity)
  selected.value = { kind, id: entity.id, name: entity.name, conversationId }
  messages.splice(0, messages.length)
  if (conversationId) {
    socket.emit("openConversation", { conversationId })
  }
}

const onDashboardData = (data) => {
  students.splice(0, students.length, ...data.students)
  interviewers.splice(0, interviewers.length, ...data.interviewers)
  requests.splice(0, requests.length, ...data.requests)
  conversations.splice(0, conversations.length, ...data.conversations)

  if (selected.value && !selected.value.conversationId) {
    const entity = selected.value.kind === "student" ? students.find((s) => s.id === selected.value.id) : interviewers.find((i) => i.id === selected.value.id)
    const conversationId = entity ? conversationIdOf(selected.value.kind, entity) : null
    if (conversationId) {
      selected.value = { ...selected.value, conversationId }
      socket.emit("openConversation", { conversationId })
    }
  }
}
const onConversationMessages = ({ conversationId, messages: history }) => {
  if (selected.value?.conversationId !== conversationId) return
  messages.splice(0, messages.length, ...history)
}
const onNewMessage = (message) => {
  if (selected.value?.conversationId === message.conversation_id) {
    messages.push(message)
  }
  socket.emit("loadDashboard")
}
const onRequestCreated = () => {
  socket.emit("loadDashboard")
}

onMounted(() => {
  socket.on("dashboardData", onDashboardData)
  socket.on("conversationMessages", onConversationMessages)
  socket.on("newMessage", onNewMessage)
  socket.on("requestCreated", onRequestCreated)
  socket.emit("loadDashboard")
})
onUnmounted(() => {
  socket.off("dashboardData", onDashboardData)
  socket.off("conversationMessages", onConversationMessages)
  socket.off("newMessage", onNewMessage)
  socket.off("requestCreated", onRequestCreated)
})

const senderLabel = (msg) => {
  if (msg.sender_kind === "hr") return "あなた"
  if (msg.sender_kind === "student") return "学生"
  if (msg.sender_kind === "interviewer") return "面接官"
  return "システム"
}

const sendMessage = () => {
  if (!newMessageText.value.trim() || !selected.value?.conversationId) return
  socket.emit("sendMessage", { conversationId: selected.value.conversationId, body: newMessageText.value })
  newMessageText.value = ""
}

const openCreateDialog = () => {
  const [latest] = requestsByStudent(selected.value.id)
  dialogRequestId.value = latest?.id ?? null
  dialogInterviewerIds.value = latest?.interviewer_ids ?? []
  dialogRangeStart.value = defaultRangeStart()
  dialogRangeEnd.value = defaultRangeEnd()
  dialogOpen.value = true
}

const submitDialog = () => {
  if (dialogInterviewerIds.value.length === 0 || !dialogRangeStart.value || !dialogRangeEnd.value) return
  const payload = {
    interviewerIds: dialogInterviewerIds.value,
    rangeStart: dialogRangeStart.value,
    rangeEnd: dialogRangeEnd.value,
  }
  if (dialogRequestId.value) {
    socket.emit("resendRequest", { requestId: dialogRequestId.value, ...payload })
  } else {
    socket.emit("createRequest", { studentId: selected.value.id, ...payload })
  }
  dialogOpen.value = false
}

const logout = () => {
  clearSession()
  socketManager.disconnect()
  router.push({ name: "login" })
}
</script>

<template>
  <div class="my-4 px-2">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h5 font-weight-medium">{{ session?.name }} さん（人事）</h1>
      <v-btn variant="text" @click="logout">ログアウト</v-btn>
    </div>

    <v-tabs v-model="activeTab" color="primary" class="mb-4">
      <v-tab value="chat">チャット</v-tab>
      <v-tab value="dashboard">選考ダッシュボード</v-tab>
    </v-tabs>

    <div v-if="activeTab === 'dashboard'" class="d-flex ga-4">
    <v-card class="pa-4 flex-grow-1" style="min-width: 0">
      <div class="text-subtitle-2 font-weight-medium mb-3 text-medium-emphasis">選考ステップ別 人数</div>
      <div class="summary-grid mb-6">
        <div v-for="opt in selectionStepSummary" :key="opt.value" class="summary-card">
          <div class="d-flex align-center ga-2">
            <div class="summary-icon" :style="{ background: opt.bg, color: opt.color }">{{ opt.icon }}</div>
            <div class="summary-count">{{ opt.count }}<span class="text-caption font-weight-regular">件</span></div>
          </div>
          <div class="font-weight-medium mt-2">{{ opt.title }}</div>
        </div>
      </div>

      <div class="text-subtitle-2 font-weight-medium mb-3 text-medium-emphasis">日程調整状況別 人数</div>
      <div class="summary-grid mb-6">
        <div v-for="item in scheduleStatusSummary" :key="item.key" class="summary-card">
          <div class="d-flex align-center ga-2">
            <div class="summary-icon" :style="{ background: item.bg, color: item.color }">{{ item.icon }}</div>
            <div class="summary-count">{{ item.count }}<span class="text-caption font-weight-regular">件</span></div>
          </div>
          <div class="font-weight-medium mt-2">{{ item.label }}</div>
          <div class="text-caption text-medium-emphasis">{{ item.desc }}</div>
        </div>
      </div>

      <div class="text-subtitle-1 font-weight-medium mb-4">学生ステータス一覧</div>

      <div v-if="students.length === 0" class="text-medium-emphasis pa-4">学生が登録されていません</div>

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

        <template v-for="s in sortedStudents" :key="s.id">
          <div class="dash-cell">
            <div class="d-flex align-center ga-3">
              <div class="avatar-circle" :style="{ background: avatarColor(s.name) }">{{ initials(s.name) }}</div>
              <div>
                <div class="font-weight-medium">{{ s.name }}</div>
                <div class="text-caption text-medium-emphasis">{{ s.email }}</div>
              </div>
            </div>
          </div>

          <div class="dash-cell">{{ SELECTION_STATUS_LABEL[s.selection_status] ?? s.selection_status }}</div>

          <div class="dash-cell dash-cell--column">
            <span class="status-chip" :style="{ color: scheduleMeta(s.id).color, background: scheduleMeta(s.id).bg }">
              {{ scheduleMeta(s.id).icon }} {{ scheduleMeta(s.id).label }}
            </span>
            <span class="text-caption text-medium-emphasis mt-1">{{ scheduleMeta(s.id).desc }}</span>
          </div>

          <div class="dash-cell text-caption text-medium-emphasis">{{ lastUpdated(s.id) }}</div>

          <div class="dash-cell justify-end ga-1">
            <v-btn size="small" variant="text" title="チャットを開く" @click="openChat(s)">💬</v-btn>
            <v-menu>
              <template #activator="{ props }">
                <v-btn size="small" variant="text" v-bind="props">⋮</v-btn>
              </template>
              <v-list density="compact">
                <v-list-item @click="openEditDialog(s)">選考状況を編集</v-list-item>
                <v-list-item @click="openChat(s)">チャットを開く</v-list-item>
              </v-list>
            </v-menu>
          </div>
        </template>
      </div>
    </v-card>

      <v-card class="pa-4 unsent-panel">
        <div class="text-subtitle-2 font-weight-medium mb-3">
          未送信の学生
          <span class="text-caption text-medium-emphasis">（{{ unsentStudents.length }}件）</span>
        </div>
        <div v-if="unsentStudents.length === 0" class="text-caption text-medium-emphasis">
          未送信の学生はいません
        </div>
        <v-list v-else density="compact" class="pa-0">
          <v-list-item v-for="s in unsentStudents" :key="s.id" class="px-0">
            <div class="d-flex align-center ga-2">
              <div class="avatar-circle avatar-circle--sm" :style="{ background: avatarColor(s.name) }">
                {{ initials(s.name) }}
              </div>
              <div class="flex-grow-1" style="min-width: 0">
                <div class="font-weight-medium text-body-2 text-truncate">{{ s.name }}</div>
                <div class="text-caption text-medium-emphasis">
                  {{ SELECTION_STATUS_LABEL[s.selection_status] ?? s.selection_status }}
                </div>
              </div>
              <v-btn size="x-small" variant="text" title="チャットを開く" @click="openChat(s)">💬</v-btn>
            </div>
          </v-list-item>
        </v-list>
      </v-card>
    </div>

    <div v-if="activeTab === 'chat'" class="d-flex ga-4">
      <v-card class="pa-3" style="width: 280px">
        <div class="text-subtitle-2 mb-2">学生</div>
        <v-list density="compact">
          <v-list-item
            v-for="s in students"
            :key="s.id"
            :active="selected?.kind === 'student' && selected?.id === s.id"
            @click="openConversation('student', s)"
          >
            <v-list-item-title>{{ s.name }}</v-list-item-title>
            <v-list-item-subtitle>{{ statusLabel(s.id) }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>

        <div class="text-subtitle-2 mt-4 mb-2">面接官</div>
        <v-list density="compact">
          <v-list-item
            v-for="i in interviewers"
            :key="i.id"
            :active="selected?.kind === 'interviewer' && selected?.id === i.id"
            @click="openConversation('interviewer', i)"
          >
            <v-list-item-title>{{ i.name }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card v-if="selected" class="pa-4 flex-grow-1">
        <div class="d-flex align-center justify-space-between mb-2">
          <div class="text-subtitle-1">{{ selected.name }} さん</div>
          <v-btn v-if="selected.kind === 'student'" size="small" color="primary" @click="openCreateDialog">
            日程を送る
          </v-btn>
        </div>

        <v-card variant="outlined" class="pa-4 mb-4" style="max-height: 420px; overflow-y: auto">
          <div v-for="msg in messages" :key="msg.id" class="mb-3">
            <div class="text-caption text-medium-emphasis">{{ senderLabel(msg) }}</div>
            <div>{{ msg.body }}</div>
          </div>
          <div v-if="messages.length === 0" class="text-medium-emphasis">まだメッセージはありません</div>
        </v-card>

        <v-form @submit.prevent="sendMessage" class="d-flex ga-2">
          <v-text-field
            v-model="newMessageText"
            placeholder="メッセージを入力（結果報告もここから送信できます）"
            hide-details
            density="compact"
          />
          <v-btn type="submit" color="primary">送信</v-btn>
        </v-form>
      </v-card>
      <v-card v-else class="pa-4 flex-grow-1 d-flex align-center justify-center text-medium-emphasis">
        左のリストから学生または面接官を選んでください
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

    <v-dialog v-model="dialogOpen" max-width="480">
      <v-card class="pa-4">
        <div class="text-h6 mb-4">面接日程を{{ dialogRequestId ? "再送" : "送信" }}</div>
        <v-select
          v-model="dialogInterviewerIds"
          :items="interviewers.map((i) => ({ title: i.name, value: i.id }))"
          label="面接官（複数選択可）"
          multiple
          chips
        />
        <v-text-field v-model="dialogRangeStart" type="date" label="開始日" />
        <v-text-field v-model="dialogRangeEnd" type="date" label="終了日" />
        <div class="d-flex justify-end ga-2 mt-2">
          <v-btn variant="text" @click="dialogOpen = false">キャンセル</v-btn>
          <v-btn color="primary" @click="submitDialog">送信</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.dash-grid {
  display: grid;
  grid-template-columns: 2fr 0.9fr 1.6fr 0.9fr 0.7fr;
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}
.dash-head {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  background: #fafafa;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
}
.dash-head--sortable {
  cursor: pointer;
  user-select: none;
}
.dash-head--sortable:hover {
  color: #374151;
}
.sort-arrow {
  font-size: 0.65rem;
}
.dash-cell {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f1f3;
  display: flex;
  align-items: center;
}
.dash-cell--column {
  flex-direction: column;
  align-items: flex-start;
}
.avatar-circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}
.avatar-circle--sm {
  width: 28px;
  height: 28px;
  font-size: 0.8rem;
}
.unsent-panel {
  width: 280px;
  flex-shrink: 0;
  align-self: flex-start;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.summary-card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 14px 16px;
  background: #fff;
}
.summary-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  flex-shrink: 0;
}
.summary-count {
  font-size: 1.5rem;
  font-weight: 700;
  line-height: 1;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}
</style>
