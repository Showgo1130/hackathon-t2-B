<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { session } from "../../session.js"
import socketManager from "../../socketManager.js"
import HrIcon from "./ui/HrIcon.vue"

const route = useRoute()
const router = useRouter()
const getSocket = () => { try { return socketManager.getInstance() } catch { return socketManager.connect(session.value.token) } }
const socket = getSocket()
const party = ref(null)
const conversation = ref(null)
const messages = ref([])
const input = ref("")
const loading = ref(true)
const chatBody = ref(null)
const role = computed(() => route.params.role)
const roleLabel = computed(() => role.value === "student" ? "学生" : "面接官")
const selectionLabels = { first_interview: "一次面接", second_interview: "二次面接", final_interview: "最終面接", offered: "内定", rejected: "不採用" }
const partyStatus = computed(() => role.value === "student" ? selectionLabels[party.value?.selection_status] ?? "" : "面接官")

const scrollBottom = async () => { await nextTick(); chatBody.value?.scrollTo({ top: chatBody.value.scrollHeight, behavior: "smooth" }) }
const onDashboard = (data) => {
  const source = role.value === "student" ? data.students : data.interviewers
  party.value = source?.find((item) => item.id === route.params.id) ?? null
}
const onReady = ({ conversation: readyConversation, messages: history }) => {
  conversation.value = readyConversation; messages.value = history ?? []; loading.value = false; scrollBottom()
}
const onNewMessage = (message) => {
  if (message.conversation_id !== conversation.value?.id || messages.value.some((item) => item.id === message.id)) return
  messages.value.push(message); scrollBottom()
}
onMounted(() => {
  socket.on("dashboardData", onDashboard); socket.on("conversationReady", onReady); socket.on("newMessage", onNewMessage)
  socket.emit("loadDashboard"); socket.emit("openPartyConversation", { kind: role.value, partyId: route.params.id })
})
onUnmounted(() => {
  socket.off("dashboardData", onDashboard); socket.off("conversationReady", onReady); socket.off("newMessage", onNewMessage)
})
const send = () => {
  const body = input.value.trim()
  if (!body || !conversation.value) return
  socket.emit("sendMessage", { conversationId: conversation.value.id, body }); input.value = ""
}
const formatTime = (value) => value ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : ""
const deadlineLabel = (message) => message.payload?.responseDeadline ? formatTime(message.payload.responseDeadline) : "設定なし"
</script>

<template>
  <div class="chat-page">
    <header class="chat-header">
      <button type="button" aria-label="トークルーム一覧へ戻る" @click="router.push({ name: 'hr-chat' })"><HrIcon name="back" :size="20" /></button>
      <span :class="['avatar', `avatar--${role}`]">{{ party?.name?.slice(0, 1) || "?" }}</span>
      <div><h1>{{ party?.name || "読み込み中" }}<small>さん</small></h1><p>{{ roleLabel }}<template v-if="partyStatus">・{{ partyStatus }}</template><template v-if="party?.email">・{{ party.email }}</template></p></div>
      <RouterLink v-if="role === 'student'" :to="{ name: 'hr-schedule-create' }" class="schedule-link"><HrIcon name="calendar" :size="16" />日程調整を作成</RouterLink>
    </header>

    <main ref="chatBody" class="chat-body">
      <div v-if="loading" class="empty">DBからメッセージを読み込んでいます…</div>
      <div v-else-if="!messages.length" class="empty"><span><HrIcon name="chat" :size="24" /></span><strong>まだメッセージはありません</strong><p>下の入力欄から最初のメッセージを送信できます。</p></div>
      <article v-for="message in messages" :key="message.id" :class="['message-row', { mine: message.sender_kind === 'hr', system: message.sender_kind === 'system' }]">
        <span v-if="message.sender_kind !== 'hr'" class="message-avatar">{{ message.sender_kind === 'system' ? 'S' : party?.name?.slice(0, 1) }}</span>
        <div class="message-wrap"><div class="bubble"><p>{{ message.body }}</p>
          <section v-if="message.msg_type === 'calendar_request'" class="schedule-summary">
            <header><HrIcon name="calendar" :size="17" /><strong>日程調整</strong></header>
            <dl><div><dt>候補期間</dt><dd>{{ message.payload?.rangeStart }} 〜 {{ message.payload?.rangeEnd }}</dd></div><div><dt>面接時間</dt><dd>{{ message.payload?.durationMinutes || 60 }}分</dd></div><div><dt>提出期限</dt><dd>{{ deadlineLabel(message) }}</dd></div><div><dt>必要面接官</dt><dd>{{ message.payload?.requiredInterviewerCount || '—' }}名</dd></div></dl>
            <small>提出期限の24時間前にリマインドを1回送信します。</small>
          </section>
        </div><time>{{ formatTime(message.created_at) }}</time></div>
      </article>
    </main>

    <form class="composer" @submit.prevent="send">
      <input v-model="input" type="text" placeholder="メッセージを入力…" :disabled="!conversation" />
      <button type="submit" :disabled="!input.trim() || !conversation" aria-label="送信"><HrIcon name="send" :size="19" /></button>
    </form>
  </div>
</template>

<style scoped>
.chat-page,.chat-page *{box-sizing:border-box}.chat-page{display:grid;height:100%;grid-template-rows:77px minmax(0,1fr) 73px;background:#fff;color:#273348}.chat-header{display:flex;align-items:center;gap:11px;border-bottom:1px solid #e4e9f0;padding:0 22px}.chat-header>button{display:grid;width:34px;height:34px;place-items:center;border:0;border-radius:8px;background:transparent;color:#42506a;cursor:pointer}.chat-header>button:hover{background:#f1f4f8}.avatar{display:grid;width:39px;height:39px;place-items:center;border-radius:50%;font-size:12px;font-weight:800}.avatar--student{background:#dcf4e9;color:#157653}.avatar--interviewer{background:#ffead3;color:#a85c11}.chat-header>div{min-width:0}.chat-header h1{margin:0;font-size:13px}.chat-header h1 small{margin-left:3px;font-size:9px}.chat-header p{overflow:hidden;margin:4px 0 0;color:#768297;font-size:8px;text-overflow:ellipsis;white-space:nowrap}.schedule-link{display:flex;height:36px;align-items:center;gap:7px;margin-left:auto;border-radius:8px;padding:0 12px;background:#1769ff;color:#fff;font-size:8px;font-weight:750;text-decoration:none}.chat-body{overflow-y:auto;padding:24px clamp(25px,7vw,90px);background:#fbfcfe}.empty{display:flex;height:100%;flex-direction:column;align-items:center;justify-content:center;color:#8994a6;font-size:9px}.empty>span{display:grid;width:48px;height:48px;place-items:center;border-radius:13px;background:#edf2f8}.empty strong{margin-top:10px;color:#536077}.empty p{margin:5px 0}.message-row{display:flex;align-items:flex-end;gap:8px;margin:0 0 17px}.message-row.mine{justify-content:flex-end}.message-avatar{display:grid;width:27px;height:27px;flex:0 0 auto;place-items:center;border-radius:50%;background:#e9eef5;color:#607087;font-size:8px;font-weight:800}.message-wrap{max-width:min(620px,75%)}.bubble{border:1px solid #e5e9ef;border-radius:5px 13px 13px 13px;padding:10px 13px;background:#fff;box-shadow:0 2px 8px rgb(35 49 75 / 3%)}.mine .bubble{border-color:#d6e3fb;border-radius:13px 5px 13px 13px;background:#edf3ff;color:#163f82}.system .bubble{background:#f7f9fc}.bubble>p{margin:0;white-space:pre-wrap;font-size:10px;line-height:1.75}.message-wrap time{display:block;margin-top:4px;color:#929bad;font-size:7px}.mine time{text-align:right}.schedule-summary{min-width:min(440px,60vw);margin-top:10px;border:1px solid #dce5f5;border-radius:10px;padding:11px;background:#fff;color:#273348}.schedule-summary header{display:flex;align-items:center;gap:6px;color:#1769ff}.schedule-summary header strong{font-size:10px}.schedule-summary dl{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0}.schedule-summary dl div{border-radius:7px;padding:7px;background:#f7f9fc}.schedule-summary dt{color:#8994a6;font-size:7px}.schedule-summary dd{margin:3px 0 0;font-size:8px;font-weight:700}.schedule-summary>small{color:#758197;font-size:7px}.composer{display:flex;align-items:center;gap:9px;border-top:1px solid #e4e9f0;padding:0 clamp(22px,6vw,80px);background:#fff}.composer input{height:40px;min-width:0;flex:1;border:1px solid #dce3ed;border-radius:20px;padding:0 16px;outline:0;font:inherit;font-size:9px}.composer input:focus{border-color:#1769ff;box-shadow:0 0 0 3px rgb(23 105 255 / 7%)}.composer button{display:grid;width:40px;height:40px;place-items:center;border:0;border-radius:50%;background:#1769ff;color:#fff;cursor:pointer}.composer button:disabled{background:#c8d3e5;cursor:not-allowed}@media(max-width:600px){.chat-header{padding:0 12px 0 60px}.schedule-link{width:37px;padding:0;justify-content:center;font-size:0}.chat-body{padding:18px 12px}.message-wrap{max-width:88%}.schedule-summary{min-width:0}.schedule-summary dl{grid-template-columns:1fr}.composer{padding:0 12px}}
</style>
