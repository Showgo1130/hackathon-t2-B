<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue"
import socketManager from "../../socketManager.js"

const socket = socketManager.getInstance()

const messages = reactive([])

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

const openActions = computed(() =>
  messages.filter(
    (m) => (m.msg_type === "availability_check" && isCheckOpen(m)) || (isApprovalRequest(m) && isApprovalOpen(m))
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



onMounted(() => {
  socket.on("init", onInit)
  socket.on("newMessage", onNewMessage)
})
onUnmounted(() => {
  socket.off("init", onInit)
  socket.off("newMessage", onNewMessage)
})

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
  <section class="chat-panel">
    <div class="panel-head">
      <div>
        <div class="panel-title">通知</div>
        <div class="panel-sub">日程の確認依頼と確定通知が届きます</div>
      </div>
      <span v-if="openActions.length > 0" class="pending-badge">未対応 {{ openActions.length }}</span>
    </div>

    <div class="message-list">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="message"
        :class="{ 'message--action': (msg.msg_type === 'availability_check' && isCheckOpen(msg)) || (isApprovalRequest(msg) && isApprovalOpen(msg)) }"
      >
        <div class="text-caption text-medium-emphasis">{{ senderLabel(msg) }}</div>
        <div class="text-body-2">{{ msg.body }}</div>
        <div v-if="msg.msg_type === 'availability_check' && isCheckOpen(msg)" class="mt-2 d-flex ga-2 flex-wrap">
          <v-btn size="small" color="success" @click="answer(msg, true)">空いています</v-btn>
          <v-btn size="small" color="error" variant="tonal" @click="answer(msg, false)">空いていません</v-btn>
        </div>
        <div v-if="isApprovalRequest(msg) && isApprovalOpen(msg)" class="mt-2 d-flex ga-2 flex-wrap">
          <v-btn size="small" color="primary" @click="respondToMatch(msg, true)">この日程で承認</v-btn>
          <v-btn size="small" color="error" variant="tonal" @click="respondToMatch(msg, false)">この日程を見送る</v-btn>
        </div>
      </div>
      <div v-if="messages.length === 0" class="text-medium-emphasis text-body-2">通知はありません</div>
    </div>

    <v-dialog v-model="decidedDialog" max-width="420" persistent>
      <v-card class="pa-6 text-center">
        <div class="text-h6 font-weight-medium mb-1">面接日程が決定しました</div>
        <div class="text-h5 font-weight-medium text-primary my-4">{{ decidedText }}</div>
        <div class="text-body-2 text-medium-emphasis mb-5">予定一覧に追加されました。詳細から Zoom URL を確認できます</div>
        <v-btn color="primary" @click="decidedDialog = false">閉じる</v-btn>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  border: 1px solid #e4e9f1;
  border-radius: 10px;
  background: #fff;
  padding: 16px;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eef1f6;
}
.panel-title { font-size: 14px; font-weight: 700; }
.panel-sub { margin-top: 3px; color: #69758b; font-size: 11px; }
.pending-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #fdf1e0;
  padding: 4px 10px;
  color: #c2740a;
  font-size: 11px;
  font-weight: 700;
}

.message-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
}
.message { margin-bottom: 12px; }
.message--action {
  border-left: 3px solid #1769ff;
  border-radius: 0 8px 8px 0;
  background: #f5f8ff;
  padding: 10px 12px;
}
</style>
