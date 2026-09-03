<script setup>
import { computed, inject, onMounted, onUnmounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { clearSession } from "../../session.js"
import ChatBubble from "../shared/ChatBubble.vue"
import ChatCalendarCard from "../student/ChatCalendarCard.vue"

const session = inject("session")
const router = useRouter()
const socket = socketManager.getInstance()

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

const bubbleAlign = (msg) => {
  if (msg.sender_kind === "system") return "center"
  return msg.sender_kind === "hr" ? "right" : "left"
}
const bubbleVariant = (msg) => (msg.sender_kind === "system" ? "system" : "default")

const shortDate = (date) => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`
}
const slotChips = (msg) => (msg.payload?.slots ?? []).map((s) => `${shortDate(s.slotDate)} ${s.slotHour}:00`)

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
  <div class="mx-auto my-5 px-4">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h5 font-weight-medium">{{ session?.name }} さん（人事）</h1>
      <v-btn variant="text" @click="logout">ログアウト</v-btn>
    </div>

    <div class="d-flex ga-4">
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

        <v-card variant="outlined" rounded="xl" class="pa-4 mb-4 chat-panel" style="max-height: 420px; overflow-y: auto">
          <template v-for="msg in messages" :key="msg.id">
            <ChatBubble
              v-if="msg.msg_type === 'calendar_request'"
              :align="bubbleAlign(msg)"
              :sender-label="senderLabel(msg)"
            >
              <ChatCalendarCard
                :range-start="msg.payload.rangeStart"
                :range-end="msg.payload.rangeEnd"
                :readonly="true"
              />
            </ChatBubble>

            <ChatBubble
              v-else-if="msg.msg_type === 'calendar_submission'"
              :align="bubbleAlign(msg)"
              :sender-label="senderLabel(msg)"
            >
              <div class="mb-1">候補日時が送信されました</div>
              <div class="d-flex flex-wrap ga-1">
                <v-chip v-for="(chip, idx) in slotChips(msg)" :key="idx" size="x-small" color="primary" variant="tonal">
                  {{ chip }}
                </v-chip>
              </div>
            </ChatBubble>

            <ChatBubble
              v-else
              :align="bubbleAlign(msg)"
              :variant="bubbleVariant(msg)"
              :sender-label="senderLabel(msg)"
              :is-confirmed-notice="msg.msg_type === 'system_notice' && msg.body.includes('確定')"
            >
              {{ msg.body }}
            </ChatBubble>
          </template>
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
.chat-panel {
  background: #f4f6fb;
}
</style>
