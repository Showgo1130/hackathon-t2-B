<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"

const router = useRouter()
const socket = socketManager.getInstance()

const messages = reactive([])
const newMessageText = ref("")

// 同じ日時が別の依頼で来ることがあるため、依頼IDまで含めてキーにする
const keyOf = (msg) => `${msg.request_id}_${msg.payload.slotDate}_${msg.payload.slotHour}`
const keysOf = (predicate) => computed(() => new Set(messages.filter(predicate).map(keyOf)))

// マッチング結果への承認依頼（system_notice + payload.kind で判別する）
const isApprovalRequest = (msg) => msg.msg_type === "system_notice" && msg.payload?.kind === "match_approval"

const answeredKeys = keysOf((m) => m.msg_type === "availability_answer")
const approvedKeys = keysOf((m) => m.msg_type === "result" && m.payload?.kind === "match_approval_answer")
const cancelledKeys = keysOf((m) => m.msg_type === "system_notice" && m.payload?.kind === "match_approval_cancelled")

// 日程が確定した依頼。残っている空き確認への回答ボタンはもう押させない
const settledRequestIds = computed(
  () =>
    new Set(
      messages
        .filter((m) => m.msg_type === "system_notice" && m.payload?.confirmedDate)
        .map((m) => m.request_id)
    )
)

const isCheckOpen = (msg) => !answeredKeys.value.has(keyOf(msg)) && !settledRequestIds.value.has(msg.request_id)
const isApprovalOpen = (msg) => !approvedKeys.value.has(keyOf(msg)) && !cancelledKeys.value.has(keyOf(msg))

const senderLabel = (msg) => {
  if (msg.sender_kind === "interviewer") return "あなた"
  if (msg.sender_kind === "hr") return "人事"
  return "システム"
}

// 日程が決定したときに出すオーバーレイ（履歴の読み込みでは出さない）
const decidedDialog = ref(false)
const decidedText = ref("")

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]
const formatDecided = ({ confirmedDate, confirmedHour }) => {
  const d = new Date(`${confirmedDate}T${String(confirmedHour).padStart(2, "0")}:00:00`)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）${String(confirmedHour).padStart(2, "0")}:00`
}

const onInit = ({ messages: history }) => {
  messages.splice(0, messages.length, ...history)
}
const onNewMessage = (message) => {
  messages.push(message)
  if (message.msg_type === "system_notice" && message.payload?.confirmedDate) {
    decidedText.value = formatDecided(message.payload)
    decidedDialog.value = true
  }
}

const openSchedule = () => {
  decidedDialog.value = false
  router.push({ name: "interviewer-schedules" })
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

const respondToMatch = (msg, approved) => {
  socket.emit("respondToMatch", {
    requestId: msg.request_id,
    slotDate: msg.payload.slotDate,
    slotHour: msg.payload.slotHour,
    approved,
  })
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
  <div class="iv-page">
    <header class="page-header">
      <span class="eyebrow">NOTIFICATIONS</span>
      <h1>通知・チャット</h1>
      <p>日程の確認依頼や確定通知が届きます。人事とのやり取りもここから行えます。</p>
    </header>

    <v-card class="pa-4 mb-4" style="max-height: 480px; overflow-y: auto">
      <div v-for="msg in messages" :key="msg.id" class="mb-3">
        <div class="text-caption text-medium-emphasis">{{ senderLabel(msg) }}</div>
        <div>{{ msg.body }}</div>
        <div v-if="msg.msg_type === 'availability_check' && isCheckOpen(msg)" class="mt-1 d-flex ga-2">
          <v-btn size="small" color="success" @click="answer(msg, true)">空いています</v-btn>
          <v-btn size="small" color="error" @click="answer(msg, false)">空いていません</v-btn>
        </div>
        <div v-if="isApprovalRequest(msg) && isApprovalOpen(msg)" class="mt-1 d-flex ga-2">
          <v-btn size="small" color="primary" @click="respondToMatch(msg, true)">この日程で承認</v-btn>
          <v-btn size="small" color="error" variant="tonal" @click="respondToMatch(msg, false)">この日程を見送る</v-btn>
        </div>
      </div>
      <div v-if="messages.length === 0" class="text-medium-emphasis">まだメッセージはありません</div>
    </v-card>

    <v-form @submit.prevent="sendMessage" class="d-flex ga-2">
      <v-text-field v-model="newMessageText" placeholder="メッセージを入力（はい/いいえ でも回答できます）" hide-details density="compact" />
      <v-btn type="submit" color="primary">送信</v-btn>
    </v-form>

    <v-dialog v-model="decidedDialog" max-width="420" persistent>
      <v-card class="pa-6 text-center">
        <div class="text-h6 font-weight-medium mb-1">面接日程が決定しました</div>
        <div class="text-h5 font-weight-medium text-primary my-4">{{ decidedText }}</div>
        <div class="text-body-2 text-medium-emphasis mb-5">予定一覧から詳細（Zoom URL など）を確認できます</div>
        <div class="d-flex ga-2 justify-center">
          <v-btn variant="text" @click="decidedDialog = false">閉じる</v-btn>
          <v-btn color="primary" @click="openSchedule">予定一覧を見る</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.iv-page {
  height: 100%;
  overflow-y: auto;
  padding: 26px 30px 40px;
  background: #f7f9fc;
}
.iv-page .page-header { margin-bottom: 22px; }
.iv-page .eyebrow { color: #7a8699; font-size: 10px; font-weight: 750; letter-spacing: .12em; }
.iv-page h1 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -.02em; }
.iv-page .page-header p { margin: 0; color: #69758b; font-size: 12px; }

@media (max-width: 820px) {
  .iv-page { padding: 22px 18px 34px; }
}
</style>
