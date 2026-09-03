<script setup>
import { ref, watch } from "vue"
import {
  isApprovalRequest,
  needsAction,
  useNotifications,
} from "./notificationStore.js"

const { messages, loaded, pendingItems, pendingCount, historyItems, answerAvailability, respondToMatch } =
  useNotifications()

const senderLabel = (msg) => {
  if (msg.sender_kind === "interviewer") return "あなた"
  if (msg.sender_kind === "hr") return "人事"
  return "システム"
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]
const pad = (n) => String(n).padStart(2, "0")

// 届いた時刻。今日なら時刻だけ、それ以外は日付も出す
const formatReceived = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${time}`
}

const formatDecided = ({ confirmedDate, confirmedHour }) => {
  const d = new Date(`${confirmedDate}T${pad(confirmedHour)}:00:00`)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）${pad(confirmedHour)}:00`
}

// 日程が決定したときに出すオーバーレイ（履歴の読み込みでは出さない）
const decidedDialog = ref(false)
const decidedText = ref("")

watch(
  () => messages.length,
  (length, previous) => {
    if (!previous) return // 初回の履歴読み込みでは出さない
    const message = messages[length - 1]
    if (message?.msg_type === "system_notice" && message.payload?.confirmedDate) {
      decidedText.value = formatDecided(message.payload)
      decidedDialog.value = true
    }
  }
)
</script>

<template>
  <section class="notification-panel">
    <div class="panel-head">
      <div>
        <div class="panel-title">通知</div>
        <div class="panel-sub">日程の確認依頼と確定通知が届きます</div>
      </div>
      <span v-if="pendingCount > 0" class="pending-badge">未対応 {{ pendingCount }}</span>
    </div>

    <div class="panel-body">
      <div v-if="!loaded" class="placeholder">読み込み中...</div>

      <template v-else>
        <!-- 未対応は常に先頭に固定する -->
        <div v-if="pendingCount > 0" class="section">
          <div class="section-label">対応が必要です</div>
          <div v-for="msg in pendingItems" :key="msg.id" class="message message--action">
            <div class="message-meta">
              <span>{{ senderLabel(msg) }}</span>
              <time>{{ formatReceived(msg.created_at) }}</time>
            </div>
            <div class="text-body-2">{{ msg.body }}</div>

            <div v-if="msg.msg_type === 'availability_check'" class="mt-2 d-flex ga-2 flex-wrap">
              <v-btn size="small" color="success" @click="answerAvailability(msg, true)">空いています</v-btn>
              <v-btn size="small" color="error" variant="tonal" @click="answerAvailability(msg, false)">
                空いていません
              </v-btn>
            </div>
            <div v-else-if="isApprovalRequest(msg)" class="mt-2 d-flex ga-2 flex-wrap">
              <v-btn size="small" color="primary" @click="respondToMatch(msg, true)">この日程で承認</v-btn>
              <v-btn size="small" color="error" variant="tonal" @click="respondToMatch(msg, false)">
                この日程を見送る
              </v-btn>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-label">履歴</div>
          <div v-for="msg in historyItems" :key="msg.id" class="message">
            <div class="message-meta">
              <span>{{ senderLabel(msg) }}</span>
              <time>{{ formatReceived(msg.created_at) }}</time>
            </div>
            <div class="text-body-2">{{ msg.body }}</div>
          </div>
          <div v-if="historyItems.length === 0" class="placeholder">履歴はありません</div>
        </div>
      </template>
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
.notification-panel {
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

.panel-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding-top: 12px;
}
.section + .section { margin-top: 18px; }
.section-label {
  margin-bottom: 8px;
  color: #69758b;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .04em;
}
.message { margin-bottom: 12px; }
.message--action {
  border-left: 3px solid #1769ff;
  border-radius: 0 8px 8px 0;
  background: #f5f8ff;
  padding: 10px 12px;
}
.message-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  color: #69758b;
  font-size: 11px;
}
.placeholder { color: #69758b; font-size: 13px; }
</style>
