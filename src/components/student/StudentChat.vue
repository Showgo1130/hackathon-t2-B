<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { clearSession } from "../../session.js"
import ChatBubble from "../shared/ChatBubble.vue"
import ChatCalendarCard from "./ChatCalendarCard.vue"
import SelectionStatusChip from "./SelectionStatusChip.vue"

const session = inject("session")
const router = useRouter()
const socket = socketManager.getInstance()

const messages = reactive([])
const newMessageText = ref("")
const selectionStatus = ref(null)
const messagesEndRef = ref(null)
const isSending = ref(false)

// 同じ依頼に対して候補の追加を求められることがあるため、提出済みかどうかは
// request_id ではなく「その依頼メッセージより後に提出があるか」で判定する
const findLastIndexOf = (list, predicate) => {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (predicate(list[i])) return i
  }
  return -1
}

const pendingCalendarRequest = computed(() => {
  const lastRequestIndex = findLastIndexOf(messages, (m) => m.msg_type === "calendar_request")
  if (lastRequestIndex === -1) return null
  const submittedAfter = messages
    .slice(lastRequestIndex + 1)
    .some((m) => m.msg_type === "calendar_submission" && m.request_id === messages[lastRequestIndex].request_id)
  return submittedAfter ? null : messages[lastRequestIndex]
})

const isActiveCalendarRequest = (msg) => pendingCalendarRequest.value?.id === msg.id

const senderLabel = (msg) => {
  if (msg.sender_kind === "student") return "あなた"
  if (msg.sender_kind === "hr") return "人事"
  return "システム"
}

const bubbleAlign = (msg) => {
  if (msg.sender_kind === "system") return "center"
  return msg.sender_kind === "student" ? "right" : "left"
}
const bubbleVariant = (msg) => (msg.sender_kind === "system" ? "system" : "default")

const shortDate = (date) => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`
}
const slotChips = (msg) => (msg.payload?.slots ?? []).map((s) => `${shortDate(s.slotDate)} ${s.slotHour}:00`)

const formatTime = (createdAt) => {
  if (!createdAt) return ""
  const d = new Date(createdAt)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const showDateDivider = (msg, idx) => {
  if (idx === 0) return true
  const prev = messages[idx - 1]
  const prevDate = new Date(prev.created_at).toDateString()
  const curDate = new Date(msg.created_at).toDateString()
  return prevDate !== curDate
}

const formatDateLabel = (createdAt) => {
  if (!createdAt) return ""
  const d = new Date(createdAt)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "今日"
  if (d.toDateString() === yesterday.toDateString()) return "昨日"
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const scrollToBottom = () => {
  nextTick(() => {
    if (messagesEndRef.value) {
      messagesEndRef.value.scrollIntoView({ behavior: "smooth" })
    }
  })
}

const onInit = ({ messages: history, selectionStatus: status }) => {
  messages.splice(0, messages.length, ...history)
  selectionStatus.value = status
  scrollToBottom()
}
const onNewMessage = (message) => {
  messages.push(message)
  scrollToBottom()
}

onMounted(() => {
  socket.on("init", onInit)
  socket.on("newMessage", onNewMessage)
})
onUnmounted(() => {
  socket.off("init", onInit)
  socket.off("newMessage", onNewMessage)
})

const sendMessage = async () => {
  if (!newMessageText.value.trim() || isSending.value) return
  isSending.value = true
  socket.emit("sendMessage", { body: newMessageText.value })
  newMessageText.value = ""
  setTimeout(() => { isSending.value = false }, 300)
}


// 候補日時の選択は ChatCalendarCard 側が持ち、確定分が submit で渡ってくる
const submitCalendar = (requestId, slots) => {
  if (!Array.isArray(slots) || slots.length === 0) return
  socket.emit("submitCalendar", { requestId, slots })
}

const logout = () => {
  clearSession()
  socketManager.disconnect()
  router.push({ name: "login" })
}

const onKeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <div class="chat-app">
    <!-- Header -->
    <header class="chat-header">
      <div class="header-content">
        <div class="header-left">
          <h1 class="text-h6 font-weight-bold ma-0">{{ session?.name }} さんの面接チャット</h1>
          <div class="d-flex align-center ga-2 ml-4">
            <span class="text-body-2 text-medium-emphasis">選考状況:</span>
            <SelectionStatusChip :status="selectionStatus" />
          </div>
        </div>
        <v-btn variant="outlined" size="small" @click="logout">ログアウト</v-btn>
      </div>
    </header>

    <!-- Messages Area -->
    <div class="chat-messages">
      <div class="messages-container">
        <div v-if="messages.length === 0" class="text-center text-medium-emphasis mt-10">
          まだメッセージがありません
        </div>

        <template v-for="(msg, idx) in messages" :key="msg.id">
          <div v-if="showDateDivider(msg, idx)" class="date-divider text-caption text-center my-4 text-medium-emphasis">
            <span>{{ formatDateLabel(msg.created_at) }}</span>
          </div>

          <ChatBubble
            v-if="msg.msg_type === 'calendar_request' && isActiveCalendarRequest(msg)"
            :align="bubbleAlign(msg)"
            :sender-label="senderLabel(msg)"
          >
            <ChatCalendarCard
              :range-start="msg.payload.rangeStart"
              :range-end="msg.payload.rangeEnd"
              @submit="(slots) => submitCalendar(msg.payload.requestId, slots)"
            />
            <div class="msg-time">{{ formatTime(msg.created_at) }}</div>
          </ChatBubble>

          <ChatBubble
            v-else-if="msg.msg_type === 'calendar_request'"
            :align="bubbleAlign(msg)"
            :sender-label="senderLabel(msg)"
          >
            <div class="text-body-2 text-medium-emphasis mb-1">{{ msg.body }}</div>
            <v-chip size="x-small" variant="tonal" color="grey">回答済み</v-chip>
            <div class="msg-time">{{ formatTime(msg.created_at) }}</div>
          </ChatBubble>

          <ChatBubble
            v-else-if="msg.msg_type === 'calendar_submission'"
            :align="bubbleAlign(msg)"
            :sender-label="senderLabel(msg)"
          >
            <div class="text-body-2 mb-2">候補日時を送信しました</div>
            <div class="d-flex flex-wrap ga-1">
              <v-chip v-for="(chip, chipIdx) in slotChips(msg)" :key="chipIdx" size="small" variant="outlined">
                {{ chip }}
              </v-chip>
            </div>
            <div class="msg-time">{{ formatTime(msg.created_at) }}</div>
          </ChatBubble>

          <ChatBubble
            v-else
            :align="bubbleAlign(msg)"
            :variant="bubbleVariant(msg)"
            :sender-label="senderLabel(msg)"
            :is-confirmed-notice="msg.msg_type === 'system_notice' && msg.body.includes('確定')"
          >
            {{ msg.body }}
            <div v-if="msg.sender_kind !== 'system'" class="msg-time">{{ formatTime(msg.created_at) }}</div>
          </ChatBubble>
        </template>
        <div ref="messagesEndRef" />
      </div>
    </div>

    <!-- Input Area -->
    <footer class="chat-input-area">
      <div class="input-container">
        <v-form @submit.prevent="sendMessage" class="d-flex ga-2 align-end">
          <v-textarea
            v-model="newMessageText"
            placeholder="メッセージを入力... (Shift+Enterで改行)"
            hide-details
            variant="outlined"
            density="compact"
            rows="1"
            max-rows="4"
            auto-grow
            bg-color="white"
            @keydown="onKeydown"
          />
          <v-btn type="submit" color="black" height="40" class="px-6" :disabled="!newMessageText.trim() || isSending">
            送信
          </v-btn>
        </v-form>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.chat-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #f9fafb;
}

.chat-header {
  background-color: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 24px;
  height: 64px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
}

.chat-messages {
  flex-grow: 1;
  overflow-y: auto;
  padding: 24px;
}

.messages-container {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}

.chat-input-area {
  background-color: #ffffff;
  border-top: 1px solid #e5e7eb;
  padding: 16px 24px;
  flex-shrink: 0;
}

.input-container {
  max-width: 800px;
  margin: 0 auto;
}

.date-divider {
  position: relative;
}
.date-divider::before,
.date-divider::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 40%;
  height: 1px;
  background-color: #e5e7eb;
}
.date-divider::before {
  left: 0;
}
.date-divider::after {
  right: 0;
}
.msg-time {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  text-align: right;
}
</style>
