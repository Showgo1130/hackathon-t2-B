<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { session } from "../../session.js"
import HrCreateUserDialog from "./HrCreateUserDialog.vue"
import HrIcon from "./ui/HrIcon.vue"

const router = useRouter()
const socket = socketManager.getInstance()

const students = reactive([])
const requests = reactive([])

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
const unsentStudents = computed(() => students.filter((s) => scheduleStatusKey(s.id) === "none"))
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

// ---- ユーザー作成 ----
const createDialogOpen = ref(false)
const isCreating = ref(false)
const createError = ref("")
const toast = ref("")

const openCreateDialog = () => {
  createError.value = ""
  createDialogOpen.value = true
}

const createUser = async (user) => {
  isCreating.value = true
  createError.value = ""
  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value?.token ?? ""}`,
      },
      body: JSON.stringify({
        role: user.role,
        name: user.name,
        email: user.email,
        password: user.password,
      }),
    })

    const result = await response.json()
    if (!response.ok) {
      createError.value = result.error === "email_already_exists"
        ? "このメールアドレスは、選択したユーザー種別ですでに登録されています。"
        : result.error === "forbidden"
          ? "ユーザーを作成する権限がありません。"
          : "ユーザーの作成に失敗しました。入力内容を確認してください。"
      return
    }

    createDialogOpen.value = false
    toast.value = `${result.name}さんの${user.roleLabel}アカウントを作成しました`
    window.setTimeout(() => { toast.value = "" }, 2800)
    socket.emit("loadDashboard") // 学生を作成した場合は一覧に反映する
  } catch {
    createError.value = "サーバーに接続できませんでした。しばらくしてから再度お試しください。"
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="dashboard-page">
    <header class="page-header">
      <div>
        <span class="eyebrow">DASHBOARD</span>
        <h1>ダッシュボード</h1>
        <p>候補者の選考ステップと日程調整の進み具合を一覧で確認できます。</p>
      </div>
      <button class="add-button" type="button" @click="openCreateDialog">
        <HrIcon name="user-plus" :size="18" />ユーザーを作成
      </button>
    </header>

    <div class="dashboard-body">
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
              <v-btn
                size="small"
                variant="text"
                :title="`${s.name} さんとのチャットを開く`"
                :aria-label="`${s.name} さんとのチャットを開く`"
                @click="goToChat(s)"
              >💬</v-btn>
              <v-menu>
                <template #activator="{ props }">
                  <v-btn size="small" variant="text" v-bind="props">⋮</v-btn>
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
        <div class="text-subtitle-2 font-weight-medium mb-3">
          未送信の学生
          <span class="text-caption text-medium-emphasis">（{{ unsentStudents.length }}件）</span>
        </div>
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
                  {{ SELECTION_STATUS_LABEL[s.selection_status] ?? s.selection_status }}
                </div>
              </div>
              <v-btn
                size="x-small"
                variant="text"
                :title="`${s.name} さんとのチャットを開く`"
                :aria-label="`${s.name} さんとのチャットを開く`"
                @click="goToChat(s)"
              >💬</v-btn>
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

    <HrCreateUserDialog
      :open="createDialogOpen"
      :submitting="isCreating"
      :server-error="createError"
      @close="createDialogOpen = false"
      @create="createUser"
    />

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
.add-button {
  display: flex;
  min-height: 40px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  border: none;
  border-radius: 9px;
  background: #1769ff;
  padding: 0 16px;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
}
.add-button:hover { background: #0f57dd; }

.dashboard-body { display: flex; gap: 16px; align-items: flex-start; }
.unsent-panel { width: 260px; flex: 0 0 auto; }

.summary-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fill, minmax(125px, 1fr));
}
.summary-grid.mb-6 { margin-bottom: 16px !important; }
.summary-card { min-height: 78px; border: 1px solid #e4e9f1; border-radius: 9px; padding: 9px 10px; }
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
  grid-template-columns: minmax(180px, 2fr) 110px minmax(180px, 1.6fr) 110px 100px;
  align-items: center;
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
.dash-cell { display: flex; min-width: 0; min-height: 48px; align-items: center; border-bottom: 1px solid #f0f3f8; padding: 7px 8px; font-size: 12px; }
.dash-cell--column { flex-direction: column; align-items: flex-start; }
.status-chip { border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 650; }
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
@media (max-width: 820px) {
  .dashboard-page { padding: 22px 18px 34px; }
  .student-list-title { align-items: stretch; flex-direction: column; }.student-filters { flex-wrap: wrap; }.student-filters label { width: 100%; }.student-filters select { flex: 1; }
  .dash-grid { grid-template-columns: minmax(140px, 2fr) 90px minmax(140px, 1.4fr) 90px 90px; overflow-x: auto; }
}
</style>
