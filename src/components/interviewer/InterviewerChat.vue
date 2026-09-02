<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue"
import socketManager from "../../socketManager.js"

const socket = socketManager.getInstance()

const messages = reactive([])
const newMessageText = ref("")

const answeredKeys = computed(
  () => new Set(messages.filter((m) => m.msg_type === "availability_answer").map((m) => `${m.payload.slotDate}_${m.payload.slotHour}`))
)

const isAnswered = (msg) => answeredKeys.value.has(`${msg.payload.slotDate}_${msg.payload.slotHour}`)

const senderLabel = (msg) => {
  if (msg.sender_kind === "interviewer") return "あなた"
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

const answer = (msg, isAvailable) => {
  socket.emit("answerAvailability", {
    slotDate: msg.payload.slotDate,
    slotHour: msg.payload.slotHour,
    isAvailable,
    requestId: msg.request_id,
  })
}
</script>

<template>
  <div>
    <v-card class="pa-4 mb-4" style="max-height: 480px; overflow-y: auto">
      <div v-for="msg in messages" :key="msg.id" class="mb-3">
        <div class="text-caption text-medium-emphasis">{{ senderLabel(msg) }}</div>
        <div>{{ msg.body }}</div>
        <div v-if="msg.msg_type === 'availability_check' && !isAnswered(msg)" class="mt-1 d-flex ga-2">
          <v-btn size="small" color="success" @click="answer(msg, true)">空いています</v-btn>
          <v-btn size="small" color="error" @click="answer(msg, false)">空いていません</v-btn>
        </div>
      </div>
      <div v-if="messages.length === 0" class="text-medium-emphasis">まだメッセージはありません</div>
    </v-card>

    <v-form @submit.prevent="sendMessage" class="d-flex ga-2">
      <v-text-field v-model="newMessageText" placeholder="メッセージを入力（はい/いいえ でも回答できます）" hide-details density="compact" />
      <v-btn type="submit" color="primary">送信</v-btn>
    </v-form>
  </div>
</template>

<style scoped>
</style>
