<script setup>
import { computed, inject, nextTick, onMounted, onUnmounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { clearSession } from "../../session.js"
import HrIcon from "../hr/ui/HrIcon.vue"
import ChatBubble from "../shared/ChatBubble.vue"
import ChatCalendarCard from "./ChatCalendarCard.vue"
import SelectionStatusChip from "./SelectionStatusChip.vue"
import StudentChangePasswordDialog from "./StudentChangePasswordDialog.vue"

const session = inject("session")
const router = useRouter()
const socket = socketManager.getInstance()

const messages = reactive([])
const newMessageText = ref("")
const selectionStatus = ref(null)
const messagesEndRef = ref(null)
const isSending = ref(false)
const expandedLogs = reactive(new Set())
const passwordDialogOpen = ref(false)
const passwordChangedNotice = ref(false)

const displayName = computed(() => session?.value?.name ?? session?.name ?? "")
const avatarInitial = computed(() => displayName.value.slice(0, 1) || "?")

// 面接の共通情報（面接官画面と同じ固定値。予定ごとに変わらないためDBは持たない）
const MEETING = {
  format: "オンライン（Zoom）",
  zoomUrl: "https://zoom.us/j/9876543210?pwd=sample",
  zoomId: "987 6543 210",
  zoomPasscode: "123456",
  note: "開始5分前までにZoomへ入室してください。接続できない場合は人事担当までご連絡ください。",
}
const copied = ref(false)
const copyZoomUrl = async () => {
  try {
    await navigator.clipboard.writeText(MEETING.zoomUrl)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    copied.value = false
  }
}

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

// 面接官の予定と照合される前なら、送信済みでも候補を選び直せる。
// 照合が始まったかどうかはサーバーしか知らないので、init と calendarRevisable で受け取る
const revisableRequestId = ref(null)
const errorNotice = ref("")
const lastCalendarRequest = computed(() => {
  const index = findLastIndexOf(messages, (m) => m.msg_type === "calendar_request")
  return index === -1 ? null : messages[index]
})
const requestIdOf = (msg) => msg.payload?.requestId ?? msg.request_id
const isRevisableCalendarRequest = (msg) =>
  revisableRequestId.value != null &&
  lastCalendarRequest.value?.id === msg.id &&
  requestIdOf(msg) === revisableRequestId.value
const isEditableCalendarRequest = (msg) => isActiveCalendarRequest(msg) || isRevisableCalendarRequest(msg)

// 候補送信のログはバブルとしては描画せず、対応する依頼カレンダーの下にまとめる
const visibleMessages = computed(() => messages.filter((m) => m.msg_type !== "calendar_submission"))

// 修正すると提出が複数並ぶため、その依頼に対する「最後の」提出を見る
const submissionFor = (msg) => {
  const idx = messages.findIndex((m) => m.id === msg.id)
  if (idx === -1) return null
  const after = messages.slice(idx + 1)
  const lastIdx = findLastIndexOf(after, (m) => m.msg_type === "calendar_submission" && m.request_id === msg.request_id)
  return lastIdx === -1 ? null : after[lastIdx]
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

const onInit = ({ messages: history, selectionStatus: status, revisableRequestId: revisableId }) => {
  messages.splice(0, messages.length, ...history)
  selectionStatus.value = status
  revisableRequestId.value = revisableId ?? null
  scrollToBottom()
}
const onNewMessage = (message) => {
  messages.push(message)
  scrollToBottom()
}
const onCalendarRevisable = ({ requestId, revisable }) => {
  if (revisable) revisableRequestId.value = requestId
  else if (revisableRequestId.value === requestId) revisableRequestId.value = null
}
const onAppError = ({ message }) => {
  errorNotice.value = message ?? "処理に失敗しました"
}

onMounted(() => {
  socket.on("init", onInit)
  socket.on("newMessage", onNewMessage)
  socket.on("calendarRevisable", onCalendarRevisable)
  socket.on("appError", onAppError)
})
onUnmounted(() => {
  socket.off("init", onInit)
  socket.off("newMessage", onNewMessage)
  socket.off("calendarRevisable", onCalendarRevisable)
  socket.off("appError", onAppError)
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
  errorNotice.value = ""
  socket.emit("submitCalendar", { requestId, slots })
}

const logout = () => {
  clearSession()
  socketManager.disconnect()
  router.push({ name: "login" })
}

const onPasswordChanged = () => {
  passwordChangedNotice.value = true
}

const onKeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <div class="student-app">
    <!-- 画面左：ユーザー情報（人事画面のサイドバーと同じ構成） -->
    <aside class="sidebar">
      <div class="brand">
        <span class="brand__mark"><HrIcon name="calendar" :size="25" :stroke-width="2" /></span>
        <div><strong>ミツカル採用</strong><small>面接チャット</small></div>
      </div>

      <div class="identity">
        <div class="identity__head">
          <span class="avatar avatar--student">{{ avatarInitial }}</span>
          <h1 class="identity__name">{{ displayName }}<small>さん</small></h1>
        </div>
        <div class="identity__status">
          <span class="identity__status-label">選考状況</span>
          <SelectionStatusChip :status="selectionStatus" />
        </div>
      </div>

      <div class="account-area">
        <button type="button" class="account-action" @click="passwordDialogOpen = true">
          <HrIcon name="key" :size="18" /><span>パスワード変更</span>
        </button>
        <button type="button" class="logout" @click="logout">
          <HrIcon name="logout" :size="18" /><span>ログアウト</span>
        </button>
      </div>
    </aside>

    <main class="chat-pane">
      <header class="chat-header">
        <span class="chat-header__icon"><HrIcon name="chat" :size="18" /></span>
        <div>
          <h2>面接チャット</h2>
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

            <!-- 日程調整カレンダー：照合が始まるまでは選び直せる。始まったら読み取り専用にする -->
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
                :readonly="!isEditableCalendarRequest(msg)"
                :submitted-slots="submittedSlotsFor(msg)"
                :heading="isRevisableCalendarRequest(msg) ? '面接可能な時間帯を選び直す' : '面接可能な時間帯を選択'"
                :submit-label="isRevisableCalendarRequest(msg) ? 'この内容に修正する' : '確定して送信'"
                @submit="(slots) => submitCalendar(msg.payload.requestId, slots)"
              />

              <p v-if="isRevisableCalendarRequest(msg)" class="revisable-note">
                まだ面接官の予定と照合されていないため、日時を選び直して送り直せます。
              </p>
              <p v-if="isRevisableCalendarRequest(msg) && errorNotice" class="revisable-error">{{ errorNotice }}</p>

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

                <div class="confirmed__meeting">
                  <div class="confirmed__meeting-row">
                    <span class="confirmed__meeting-label">形式</span>
                    <span>{{ MEETING.format }}</span>
                  </div>
                  <div class="confirmed__meeting-row">
                    <span class="confirmed__meeting-label">Zoom URL</span>
                    <span class="confirmed__meeting-link">
                      <a :href="MEETING.zoomUrl" target="_blank" rel="noopener">{{ MEETING.zoomUrl }}</a>
                      <button type="button" class="confirmed__copy" @click="copyZoomUrl">
                        {{ copied ? "コピーしました" : "コピー" }}
                      </button>
                    </span>
                  </div>
                  <div class="confirmed__meeting-row">
                    <span class="confirmed__meeting-label">ミーティングID</span>
                    <span>{{ MEETING.zoomId }}</span>
                  </div>
                  <div class="confirmed__meeting-row">
                    <span class="confirmed__meeting-label">パスコード</span>
                    <span>{{ MEETING.zoomPasscode }}</span>
                  </div>
                  <p class="confirmed__meeting-note">{{ MEETING.note }}</p>
                  <a :href="MEETING.zoomUrl" target="_blank" rel="noopener" class="confirmed__join-btn">
                    Zoomに参加する
                  </a>
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
    </main>

    <StudentChangePasswordDialog v-model="passwordDialogOpen" @changed="onPasswordChanged" />
    <v-snackbar v-model="passwordChangedNotice" color="success" :timeout="3500">
      パスワードを変更しました
    </v-snackbar>
  </div>
</template>

<style scoped>
.student-app {
  position: fixed;
  z-index: 1;
  inset: 0;
  display: grid;
  overflow: hidden;
  grid-template-columns: 236px minmax(0, 1fr);
  background: #f7f9fc;
  color: #1a2235;
  font-family: Inter, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
}
.student-app, .student-app :deep(*) { box-sizing: border-box; }

/* ---- 左サイドバー（人事画面と同じ構成・配色） ---- */
.sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-right: 1px solid #e4e9f1;
  background: #fff;
}
.brand {
  display: flex;
  height: 88px;
  align-items: center;
  gap: 13px;
  padding: 0 22px;
}
.brand__mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  background: #1769ff;
  box-shadow: 0 6px 14px rgb(23 105 255 / 25%);
  color: #fff;
}
.brand div { display: flex; flex-direction: column; }
.brand strong { font-size: 19px; letter-spacing: -.02em; }
.brand small { margin-top: 2px; color: #69758b; font-size: 9px; font-weight: 700; }

.identity {
  display: flex;
  flex-direction: column;
  gap: 11px;
  margin: 0 14px;
  border: 1px solid #e4e9f1;
  border-radius: 11px;
  padding: 14px;
  background: linear-gradient(160deg, #f7faff, #fff);
}
.identity__head {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.avatar {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  font-size: 14px;
  font-weight: 800;
}
.avatar--student { background: #dcf4e9; color: #157653; }
.identity__name {
  overflow: hidden;
  margin: 0;
  font-size: 15px;
  font-weight: 750;
  letter-spacing: -.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity__name small {
  margin-left: 4px;
  color: #69758b;
  font-size: 11px;
  font-weight: 650;
}
.identity__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px dashed #e4e9f1;
  padding-top: 10px;
}
.identity__status-label { color: #69758b; font-size: 10px; font-weight: 750; }

.account-area { display: flex; flex-direction: column; gap: 8px; margin-top: auto; padding: 14px; }
.account-action, .logout {
  display: flex;
  width: 100%;
  min-height: 43px;
  align-items: center;
  gap: 12px;
  border: 1px solid #dee4ed;
  border-radius: 9px;
  padding: 0 13px;
  background: #fff;
  color: #2c3850;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}
.account-action:hover { border-color: #a9c6fa; background: #f4f8ff; color: #1769ff; }
.logout:hover { border-color: #f0b9b9; background: #fff7f7; color: #c03737; }

/* ---- 右：チャット本体（横幅いっぱいを使う） ---- */
.chat-pane {
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 77px minmax(0, 1fr) auto;
  background: #fff;
}
.chat-header {
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid #e4e9f0;
  padding: 0 clamp(16px, 3vw, 34px);
}
.chat-header__icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  background: #edf3ff;
  color: #1769ff;
}
.chat-header h2 { margin: 0; font-size: 15px; font-weight: 750; }
.chat-header p { margin: 3px 0 0; color: #768297; font-size: 11px; }

.chat-messages {
  overflow-y: auto;
  padding: 24px clamp(16px, 3vw, 40px);
  background: #fbfcfe;
}
.messages-container {
  display: flex;
  width: 100%;
  max-width: 1400px;
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
  border-top: 1px solid #e4e9f0;
  padding: 14px clamp(16px, 3vw, 40px);
  background: #fff;
}
.input-container {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

.calendar-intro {
  margin-bottom: 14px;
  color: #42506a;
  font-size: 13px;
  line-height: 1.7;
}
/* 照合が始まるまでの猶予を伝える案内 */
.revisable-note {
  margin: 10px 0 0;
  border: 1px solid #d6e3fb;
  border-radius: 8px;
  padding: 8px 11px;
  background: #f4f8ff;
  color: #1c3a6e;
  font-size: 12px;
  line-height: 1.6;
}
.revisable-error {
  margin: 8px 0 0;
  color: #c9352a;
  font-size: 12px;
  font-weight: 700;
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

.confirmed__meeting {
  margin: 0 20px 20px;
  border: 1px solid #d6e3fb;
  border-radius: 12px;
  padding: 14px 16px;
  background: #f4f8ff;
  text-align: left;
}
.confirmed__meeting-row {
  display: flex;
  gap: 12px;
  padding: 6px 0;
  align-items: baseline;
}
.confirmed__meeting-row + .confirmed__meeting-row {
  border-top: 1px dashed #dbe6fb;
}
.confirmed__meeting-label {
  flex: 0 0 92px;
  color: #4a6ea8;
  font-size: 11px;
  font-weight: 750;
}
.confirmed__meeting-row span:not(.confirmed__meeting-label) {
  overflow-wrap: anywhere;
  color: #1a2235;
  font-size: 12px;
  font-weight: 650;
}
.confirmed__meeting-link {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.confirmed__meeting-link a {
  color: #1769ff;
  font-weight: 650;
  word-break: break-all;
}
.confirmed__copy {
  flex: 0 0 auto;
  border: 1px solid #b9d2ff;
  border-radius: 6px;
  padding: 3px 9px;
  background: #fff;
  color: #1769ff;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
}
.confirmed__copy:hover {
  background: #eaf1ff;
}
.confirmed__meeting-note {
  margin: 10px 0 0;
  color: #69758b;
  font-size: 11px;
  line-height: 1.6;
}
.confirmed__join-btn {
  display: block;
  margin-top: 12px;
  border-radius: 8px;
  padding: 10px;
  background: #1769ff;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 750;
  text-align: center;
  text-decoration: none;
}
.confirmed__join-btn:hover {
  background: #0f5ae0;
  text-decoration: none;
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

@media (max-width: 900px) {
  /* 狭い画面ではサイドバーを上部バーに畳む（名前と選考状況は左に残す） */
  .student-app { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .sidebar { flex-direction: row; align-items: center; gap: 12px; border-right: 0; border-bottom: 1px solid #e4e9f1; padding: 10px 14px; }
  .brand { display: none; }
  .identity { flex: 1; flex-direction: row; align-items: center; justify-content: flex-start; gap: 14px; margin: 0; padding: 8px 12px; }
  .identity__status { border-top: 0; border-left: 1px dashed #e4e9f1; padding: 0 0 0 12px; }
  .account-area { margin: 0; padding: 0; }
  .logout { width: auto; }
  .logout span { display: none; }
  .chat-pane { grid-template-rows: 64px minmax(0, 1fr) auto; }
  .chat-header p { display: none; }
}
</style>
