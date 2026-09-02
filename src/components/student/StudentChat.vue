<script setup>
import { computed, inject, onMounted, onUnmounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { clearSession } from "../../session.js"
import CalendarPicker from "../shared/CalendarPicker.vue"

const session = inject("session")
const router = useRouter()
const socket = socketManager.getInstance()

const messages = reactive([])
const newMessageText = ref("")
const selection = reactive(new Set())

const submittedRequestIds = computed(
  () => new Set(messages.filter((m) => m.msg_type === "calendar_submission").map((m) => m.request_id))
)

const pendingCalendarRequest = computed(() => {
  const candidates = messages.filter(
    (m) => m.msg_type === "calendar_request" && !submittedRequestIds.value.has(m.request_id)
  )
  return candidates[candidates.length - 1] ?? null
})

const senderLabel = (msg) => {
  if (msg.sender_kind === "student") return "あなた"
  if (msg.sender_kind === "hr") return "人事"
  return "システム"
}

const onInit = ({ messages: history }) => {
  messages.splice(0, messages.length, ...history)
}
const onNewMessage = (message) => {
  messages.push(message)
}

onMounted(() => {
  socket.on("init", onInit)
  socket.on("newMessage", onNewMessage)
})
onUnmounted(() => {
  socket.off("init", onInit)
  socket.off("newMessage", onNewMessage)
})

const sendMessage = () => {
  if (!newMessageText.value.trim()) return
  socket.emit("sendMessage", { body: newMessageText.value })
  newMessageText.value = ""
}

const cellState = (date, hour) => (selection.has(`${date}_${hour}`) ? "selected" : "unset")
const toggleCell = ({ date, hour }) => {
  const key = `${date}_${hour}`
  if (selection.has(key)) selection.delete(key)
  else selection.add(key)
}
const submitCalendar = (requestId) => {
  const slots = [...selection].map((key) => {
    const [slotDate, hourStr] = key.split("_")
    return { slotDate, slotHour: Number(hourStr) }
  })
  if (slots.length === 0) return
  socket.emit("submitCalendar", { requestId, slots })
  selection.clear()
}

const logout = () => {
  clearSession()
  socketManager.disconnect()
  router.push({ name: "login" })
}
</script>

<template>
  <div class="mx-auto my-5 px-4" style="max-width: 900px">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h5 font-weight-medium">{{ session?.name }} さんの面接日程チャット</h1>
      <v-btn variant="text" @click="logout">ログアウト</v-btn>
    </div>

    <v-card class="pa-4 mb-4" style="max-height: 480px; overflow-y: auto">
      <div v-for="msg in messages" :key="msg.id" class="mb-3">
        <div class="text-caption text-medium-emphasis">{{ senderLabel(msg) }}</div>
        <div v-if="msg.msg_type === 'system_notice'" class="system-notice">{{ msg.body }}</div>
        <div v-else>{{ msg.body }}</div>
      </div>
      <div v-if="messages.length === 0" class="text-medium-emphasis">まだメッセージはありません</div>
    </v-card>

    <v-card v-if="pendingCalendarRequest" class="pa-4 mb-4">
      <p class="mb-2">面接可能な時間帯を選んで送信してください</p>
      <CalendarPicker
        :range-start="pendingCalendarRequest.payload.rangeStart"
        :range-end="pendingCalendarRequest.payload.rangeEnd"
        :cell-state="cellState"
        @cell-click="toggleCell"
      />
      <v-btn class="mt-3" color="primary" @click="submitCalendar(pendingCalendarRequest.payload.requestId)">
        この内容で送信する
      </v-btn>
    </v-card>

    <v-form @submit.prevent="sendMessage" class="d-flex ga-2">
      <v-text-field v-model="newMessageText" placeholder="メッセージを入力" hide-details density="compact" />
      <v-btn type="submit" color="primary">送信</v-btn>
    </v-form>
  </div>
</template>

<style scoped>
.system-notice {
  color: #2c7a4b;
  font-weight: 600;
}
</style>
