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
const expandedLogs = reactive(new Set())

const displayName = computed(() => session?.value?.name ?? session?.name ?? "")
const avatarInitial = computed(() => displayName.value.slice(0, 1) || "?")

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

// 候補送信のログはバブルとしては描画せず、対応する依頼カレンダーの下にまとめる
const visibleMessages = computed(() => messages.filter((m) => m.msg_type !== "calendar_submission"))

const submissionFor = (msg) => {
  const idx = messages.findIndex((m) => m.id === msg.id)
  if (idx === -1) return null
  return (
    messages
      .slice(idx + 1)
      .find((m) => m.msg_type === "calendar_submission" && m.request_id === msg.request_id) ?? null
  )
}
const submittedSlotsFor = (msg) => submissionFor(msg)?.payload?.slots ?? []

const toggleLog = (id) => {
  if (expandedLogs.has(id)) expandedLogs.delete(id)
  else expandedLogs.add(id)
}

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

const isConfirmedNotice = (msg) =>
  msg.msg_type === "system_notice" && (msg.payload?.confirmedDate != null || (msg.body ?? "").includes("確定しました"))

const shortDate = (date) => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`
}
const longDate = (date) => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}月${d.getDate()}日(${"日月火水木金土"[d.getDay()]})`
}
const hourLabel = (hour) => `${String(hour).padStart(2, "0")}:00`

// 送信済み候補を日付ごとにまとめて、ログとして読みやすい形にする
const groupedSlots = (msg) => {
  const byDate = new Map()
  submittedSlotsFor(msg).forEach(({ slotDate, slotHour }) => {
    if (!byDate.has(slotDate)) byDate.set(slotDate, [])
    byDate.get(slotDate).push(Number(slotHour))
  })
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, hours]) => ({ date, hours: hours.sort((a, b) => a - b) }))
}

// 確定通知は payload の日時を優先し、無い場合は本文から拾う
const confirmedSlot = (msg) => {
  let date = msg.payload?.confirmedDate ?? null
  let hour = msg.payload?.confirmedHour ?? null
  if (date == null || hour == null) {
    const matched = (msg.body ?? "").match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/)
    if (!matched) return null
    date = matched[1]
    hour = Number(matched[2])
  }
  return { date, hour }
}
const confirmedLabel = (msg) => {
  const slot = confirmedSlot(msg)
  if (!slot) return msg.body
  return `${longDate(slot.date)} ${hourLabel(slot.hour)}`
}
const confirmedYear = (msg) => {
  const slot = confirmedSlot(msg)
  return slot ? `${new Date(`${slot.date}T00:00:00`).getFullYear()}年` : ""
}

const formatTime = (createdAt) => {
  if (!createdAt) return ""
  const d = new Date(createdAt)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

const showDateDivider = (msg, idx) => {
  if (idx === 0) return true
  const prev = visibleMessages.value[idx - 1]
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
          <span class="avatar avatar--student">{{ avatarInitial }}</span>
          <div class="identity">
            <h1 class="identity__name">{{ displayName }}<small>さん</small></h1>
            <div class="identity__meta">
              <span class="identity__meta-label">選考状況</span>
              <SelectionStatusChip :status="selectionStatus" />
            </div>
          </div>
        </div>
        <button type="button" class="logout" @click="logout">ログアウト</button>
      </div>
    </header>

    <!-- Messages Area -->
    <div class="chat-messages">
      <div class="messages-container">
        <div v-if="visibleMessages.length === 0" class="empty-state">
          まだメッセージがありません
        </div>

        <template v-for="(msg, idx) in visibleMessages" :key="msg.id">
          <div v-if="showDateDivider(msg, idx)" class="date-divider">
            <span>{{ formatDateLabel(msg.created_at) }}</span>
          </div>

          <!-- 日程調整カレンダー：送信後も表示したまま（読み取り専用）にする -->
          <ChatBubble
            v-if="msg.msg_type === 'calendar_request'"
            :align="bubbleAlign(msg)"
            :sender-label="senderLabel(msg)"
            wide
          >
            <div class="calendar-intro">{{ msg.body }}</div>
            <ChatCalendarCard
              :range-start="msg.payload.rangeStart"
              :range-end="msg.payload.rangeEnd"
              :readonly="!isActiveCalendarRequest(msg)"
              :submitted-slots="submittedSlotsFor(msg)"
              @submit="(slots) => submitCalendar(msg.payload.requestId, slots)"
            />

            <div v-if="submissionFor(msg)" class="submit-log">
              <button type="button" class="submit-log__toggle" @click="toggleLog(msg.id)">
                <span class="submit-log__badge">送信済み</span>
                <span class="submit-log__text">
                  希望日時 {{ submittedSlotsFor(msg).length }} 件を送信しました
                </span>
                <span class="submit-log__time">{{ formatTime(submissionFor(msg).created_at) }}</span>
                <span class="submit-log__chevron" :class="{ 'is-open': expandedLogs.has(msg.id) }">▾</span>
              </button>
              <div v-if="expandedLogs.has(msg.id)" class="submit-log__body">
                <div v-for="group in groupedSlots(msg)" :key="group.date" class="submit-log__row">
                  <span class="submit-log__date">{{ shortDate(group.date) }}</span>
                  <span class="submit-log__hours">
                    <span v-for="hour in group.hours" :key="hour" class="submit-log__hour">{{ hourLabel(hour) }}</span>
                  </span>
                </div>
              </div>
            </div>

            <div class="msg-time">{{ formatTime(msg.created_at) }}</div>
          </ChatBubble>

          <!-- 面接日程の確定通知 -->
          <ChatBubble
            v-else-if="isConfirmedNotice(msg)"
            align="center"
            :variant="bubbleVariant(msg)"
            is-confirmed-notice
          >
            <div class="confirmed">
              <div class="confirmed__head">面接日程が確定しました</div>
              <div class="confirmed__body">
                <div class="confirmed__year">{{ confirmedYear(msg) }}</div>
                <div class="confirmed__value">{{ confirmedLabel(msg) }}</div>
                <div class="confirmed__note">当日は時間に余裕をもってご参加ください。</div>
              </div>
            </div>
          </ChatBubble>

          <ChatBubble
            v-else
            :align="bubbleAlign(msg)"
            :variant="bubbleVariant(msg)"
            :sender-label="senderLabel(msg)"
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
        <v-form @submit.prevent="sendMessage" class="d-flex ga-3 align-end">
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
          <v-btn
            type="submit"
            color="primary"
            height="40"
            class="px-6 text-none font-weight-bold"
            :disabled="!newMessageText.trim() || isSending"
          >
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
  height: 100vh;
  flex-direction: column;
  background-color: #f7f9fc;
  color: #1a2235;
  font-family: Inter, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
}
.chat-app, .chat-app :deep(*) { box-sizing: border-box; }

.chat-header {
  display: flex;
  height: 76px;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid #e4e9f1;
  padding: 0 clamp(16px, 4vw, 40px);
  background-color: #ffffff;
}

.header-content {
  display: flex;
  width: 100%;
  max-width: 1240px;
  align-items: center;
  justify-content: space-between;
  margin: 0 auto;
}

.header-left {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.avatar {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  font-size: 15px;
  font-weight: 800;
}
.avatar--student {
  background: #dcf4e9;
  color: #157653;
}
.identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.identity__name {
  overflow: hidden;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity__name small {
  margin-left: 4px;
  color: #69758b;
  font-size: 12px;
  font-weight: 650;
}
.identity__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.identity__meta-label {
  color: #69758b;
  font-size: 11px;
  font-weight: 700;
}

.logout {
  display: flex;
  min-height: 38px;
  align-items: center;
  border: 1px solid #dee4ed;
  border-radius: 9px;
  padding: 0 14px;
  background: #fff;
  color: #2c3850;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}
.logout:hover {
  border-color: #f0b9b9;
  background: #fff7f7;
  color: #c03737;
}

.chat-messages {
  flex-grow: 1;
  overflow-y: auto;
  padding: 24px clamp(16px, 5vw, 56px);
  background: #fbfcfe;
}

.messages-container {
  display: flex;
  max-width: 1240px;
  flex-direction: column;
  margin: 0 auto;
}

.empty-state {
  margin-top: 48px;
  color: #8994a6;
  font-size: 13px;
  text-align: center;
}

.chat-input-area {
  flex-shrink: 0;
  border-top: 1px solid #e4e9f1;
  padding: 16px clamp(16px, 5vw, 56px);
  background-color: #ffffff;
}

.input-container {
  max-width: 1240px;
  margin: 0 auto;
}

.calendar-intro {
  margin-bottom: 14px;
  color: #42506a;
  font-size: 13px;
  line-height: 1.7;
}

.submit-log {
  margin-top: 16px;
  border: 1px solid #d6e3fb;
  border-radius: 10px;
  background: #f4f8ff;
  overflow: hidden;
}
.submit-log__toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 0;
  padding: 10px 12px;
  background: transparent;
  color: #1c3a6e;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.submit-log__toggle:hover {
  background: #eaf1ff;
}
.submit-log__badge {
  flex: 0 0 auto;
  border-radius: 5px;
  padding: 3px 8px;
  background: #1769ff;
  color: #fff;
  font-size: 10px;
  font-weight: 750;
}
.submit-log__text {
  flex: 1;
  font-weight: 650;
}
.submit-log__time {
  color: #7d8aa2;
  font-size: 11px;
}
.submit-log__chevron {
  color: #4a6ea8;
  font-size: 13px;
  transition: transform .18s ease;
}
.submit-log__chevron.is-open {
  transform: rotate(180deg);
}
.submit-log__body {
  border-top: 1px solid #dbe6fb;
  padding: 10px 12px 12px;
  background: #fff;
}
.submit-log__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 0;
}
.submit-log__row + .submit-log__row {
  border-top: 1px dashed #eef1f6;
}
.submit-log__date {
  flex: 0 0 74px;
  color: #1a2235;
  font-size: 12px;
  font-weight: 750;
}
.submit-log__hours {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 6px;
}
.submit-log__hour {
  border: 1px solid #dce5f5;
  border-radius: 5px;
  padding: 2px 7px;
  background: #f7f9fc;
  color: #42506a;
  font-size: 11px;
  font-weight: 650;
}

.confirmed {
  text-align: center;
}
.confirmed__head {
  padding: 9px 16px;
  background: linear-gradient(90deg, #1769ff, #4a8bff);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: .04em;
}
.confirmed__body {
  padding: 18px 20px 20px;
}
.confirmed__year {
  color: #69758b;
  font-size: 12px;
  font-weight: 700;
}
.confirmed__value {
  margin-top: 4px;
  color: #10357a;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.confirmed__note {
  margin-top: 10px;
  color: #69758b;
  font-size: 11px;
}

.date-divider {
  position: relative;
  margin: 16px 0;
  color: #8994a6;
  font-size: 11px;
  text-align: center;
}
.date-divider::before,
.date-divider::after {
  content: "";
  position: absolute;
  top: 50%;
  width: 40%;
  height: 1px;
  background-color: #e4e9f1;
}
.date-divider::before {
  left: 0;
}
.date-divider::after {
  right: 0;
}
.msg-time {
  margin-top: 6px;
  color: #929bad;
  font-size: 11px;
  text-align: right;
}

@media (max-width: 600px) {
  .chat-header { height: 68px; }
  .identity__name { font-size: 15px; }
}
</style>
