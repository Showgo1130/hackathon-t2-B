<script setup>
import { computed, nextTick, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import HrCalendarCard from "./HrCalendarCard.vue"
import HrScheduleDialog from "./HrScheduleDialog.vue"
import HrIcon from "./ui/HrIcon.vue"
import { findHrChatRoom, hrChatRooms } from "./hrChatMockData.js"

const route = useRoute()
const router = useRouter()
const selectedRoom = computed(() => findHrChatRoom(route.params.id) || hrChatRooms[0])

const initialMessage = (room) => {
  if (room.role === "student") return `${room.name}さん\n二次面接の日程調整のご案内です。\nご都合の良い日時をカレンダーから選択してください。`
  if (room.role === "interviewer") return `${room.name}さん\n面接日程についてご確認をお願いします。`
  return `${room.name}さん\n候補者の選考状況を共有します。`
}

const scheduleOpen = ref(false)
const scheduleSent = ref(false)
const sentMessage = ref(initialMessage(selectedRoom.value))
const scheduleDeadline = ref("2026-09-07T23:59")
const input = ref("")
const chatBody = ref(null)
const toastVisible = ref(false)
const customMessages = ref([])
const deliveredInterviewers = ref([])
const toastMessage = ref("")

const now = new Date()
const calendarDate = ref({ year: now.getFullYear(), month: now.getMonth() + 1 })
const selectedDay = ref(now.getDate())
const formattedToday = computed(() => `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${"日月火水木金土"[now.getDay()]}）`)
const formattedDeadline = computed(() => {
  const date = new Date(scheduleDeadline.value)
  if (Number.isNaN(date.getTime())) return "未設定"
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
})

const submitSchedule = async ({ message, deadline, interviewerRecipients }) => {
  sentMessage.value = message
  scheduleDeadline.value = deadline
  deliveredInterviewers.value = interviewerRecipients
  scheduleOpen.value = false
  scheduleSent.value = true
  toastMessage.value = interviewerRecipients.length
    ? `候補者と面接官候補${interviewerRecipients.length}名へ送信しました`
    : "候補者へ日程調整を送信しました"
  toastVisible.value = true
  window.setTimeout(() => { toastVisible.value = false }, 2600)
  await nextTick()
  chatBody.value?.scrollTo({ top: 0, behavior: "smooth" })
}

const changeMonth = (delta) => {
  const next = new Date(calendarDate.value.year, calendarDate.value.month - 1 + delta, 1)
  calendarDate.value = { year: next.getFullYear(), month: next.getMonth() + 1 }
  selectedDay.value = 1
}

const sendText = async () => {
  const body = input.value.trim()
  if (!body) return
  customMessages.value.push({ id: Date.now(), body })
  input.value = ""
  await nextTick()
  chatBody.value?.scrollTo({ top: chatBody.value.scrollHeight, behavior: "smooth" })
}
</script>

<template>
  <div class="chat-page">
    <header class="chat-header">
      <button class="icon-button chat-header__back" type="button" aria-label="トークルーム一覧へ戻る" @click="router.push({ name: 'hr-chat' })"><HrIcon name="back" /></button>
      <span class="avatar" :class="`avatar--${selectedRoom.role}`">{{ selectedRoom.name.slice(0, 1) }}</span>
      <div class="candidate">
        <strong>{{ selectedRoom.name }} さん</strong>
        <span>{{ selectedRoom.roleLabel }} <i></i> {{ selectedRoom.status }}</span>
      </div>
      <div class="chat-header__actions">
        <button class="icon-button" type="button" aria-label="検索"><HrIcon name="search" /></button>
        <button class="icon-button" type="button" aria-label="電話"><HrIcon name="phone" /></button>
        <button class="icon-button" type="button" aria-label="その他"><HrIcon name="more" /></button>
      </div>
    </header>

    <section ref="chatBody" class="chat-body" :aria-label="`${selectedRoom.name}さんとのチャット`">
      <div class="date-divider"><span>{{ formattedToday }}</span></div>

      <div class="message-row message-row--mine" :class="{ 'message-row--schedule': scheduleSent }">
        <div class="message-stack">
          <div class="bubble bubble--mine" :class="{ 'bubble--schedule': scheduleSent }">
            <p v-for="line in sentMessage.split('\n')" :key="line">{{ line }}</p>
            <HrCalendarCard
              v-if="scheduleSent"
              :year="calendarDate.year"
              :month="calendarDate.month"
              :selected-day="selectedDay"
              :deadline-label="formattedDeadline"
              @update:month="changeMonth"
              @select="selectedDay = $event"
            />
          </div>
          <div v-if="scheduleSent && deliveredInterviewers.length" class="delivery-note">
            <HrIcon name="users" :size="13" />
            <span>{{ selectedRoom.name }}さんと面接官候補{{ deliveredInterviewers.length }}名へ同じ内容を自動送信</span>
            <span class="delivery-avatars">
              <i v-for="interviewer in deliveredInterviewers" :key="interviewer.id" :title="interviewer.name">{{ interviewer.name.slice(0, 1) }}</i>
            </span>
          </div>
          <span class="timestamp">10:30 <i><HrIcon name="check" :size="12" /><HrIcon name="check" :size="12" /></i></span>
        </div>
      </div>

      <div class="message-row">
        <span class="avatar avatar--small" :class="`avatar--${selectedRoom.role}`">{{ selectedRoom.name.slice(0, 1) }}</span>
        <div class="message-stack">
          <div class="bubble bubble--theirs"><p v-for="line in selectedRoom.reply" :key="line">{{ line }}</p></div>
          <span class="timestamp">10:32</span>
        </div>
      </div>

      <div v-for="message in customMessages" :key="message.id" class="message-row message-row--mine">
        <div class="message-stack"><div class="bubble bubble--mine"><p>{{ message.body }}</p></div><span class="timestamp">たった今 <i><HrIcon name="check" :size="12" /></i></span></div>
      </div>
    </section>

    <div class="composer-area">
      <form class="composer" @submit.prevent="sendText">
        <input v-model="input" aria-label="メッセージ" placeholder="メッセージを入力..." />
        <button class="icon-button" type="button" aria-label="ファイルを添付"><HrIcon name="paperclip" /></button>
        <button class="send-button" type="submit" aria-label="送信"><HrIcon name="send" :size="21" /></button>
      </form>
    </div>

    <footer class="chat-tools">
      <button type="button"><HrIcon name="file" /><span>ファイル</span></button>
      <button type="button"><HrIcon name="template" /><span>テンプレート</span></button>
      <button v-if="selectedRoom.role === 'student'" class="schedule-tool" :class="{ active: scheduleSent }" type="button" @click="scheduleOpen = true">
        <HrIcon name="calendar" /><span>{{ scheduleSent ? "日程調整を再送" : "日程調整を作成" }}</span>
      </button>
      <button type="button"><HrIcon name="template" /><span>メモ</span></button>
    </footer>

    <Transition name="toast"><div v-if="toastVisible" class="toast"><span><HrIcon name="check" :size="15" /></span>{{ toastMessage }}</div></Transition>
    <HrScheduleDialog :open="scheduleOpen" :candidate-name="selectedRoom.name" @close="scheduleOpen = false" @submit="submitSchedule" />
  </div>
</template>

<style scoped>
.chat-page { display: grid; width: 100%; height: 100%; grid-template-rows: 76px minmax(0, 1fr) auto 72px; overflow: hidden; background: #fff; }
.chat-header { display: flex; align-items: center; gap: 12px; padding: 0 clamp(18px, 3vw, 42px); border-bottom: 1px solid #e6eaf1; background: rgb(255 255 255 / 94%); }
.icon-button { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border: 0; border-radius: 50%; background: transparent; color: #26344c; cursor: pointer; transition: background .18s; }.icon-button:hover { background: #f0f4fa; }
.avatar { display: grid; flex: 0 0 auto; width: 42px; height: 42px; place-items: center; border: 2px solid #fff; border-radius: 50%; box-shadow: 0 2px 7px rgb(40 50 70 / 15%); font-size: 12px; font-weight: 800; }.avatar--student { background: #dcf4e9; color: #157653; }.avatar--interviewer { background: #ffead3; color: #a85c11; }.avatar--hr { background: #eadffd; color: #6940ad; }.avatar--small { width: 30px; height: 30px; margin-top: 6px; font-size: 9px; }
.candidate { display: flex; flex-direction: column; gap: 4px; }.candidate strong { color: #20283a; font-size: 14px; }.candidate span { display: flex; align-items: center; color: #1769ff; font-size: 10px; font-weight: 650; }.candidate i { width: 3px; height: 3px; margin: 0 6px; border-radius: 50%; background: currentColor; }
.chat-header__actions { display: flex; gap: 3px; margin-left: auto; }
.chat-body { overflow-y: auto; scroll-behavior: smooth; padding: 17px clamp(18px, 4vw, 62px) 22px; background: radial-gradient(circle at 83% 4%, #f8fbff 0, transparent 26%), #fff; }
.date-divider { display: flex; align-items: center; justify-content: center; margin: 0 0 18px; color: #68758c; font-size: 9px; }.date-divider::before,.date-divider::after { width: min(90px, 12vw); height: 1px; margin: 0 13px; background: #eef1f5; content: ""; }
.message-row { display: flex; max-width: 920px; align-items: flex-start; gap: 10px; margin: 0 0 16px; }.message-row--mine { justify-content: flex-end; margin-left: auto; }
.message-row--schedule,.message-row--schedule .message-stack { width: 100%; }
.message-stack { display: flex; min-width: 0; flex-direction: column; }.message-row--mine .message-stack { align-items: flex-end; }
.bubble { border-radius: 16px; padding: 13px 16px; color: #26334b; font-size: 11px; line-height: 1.65; }.bubble p { margin: 0 0 2px; }.bubble--mine { max-width: 430px; border-bottom-right-radius: 5px; background: linear-gradient(145deg, #edf3ff, #e4edff); color: #174184; }.bubble--schedule { width: 100%; max-width: 800px; }.bubble--theirs { min-width: 190px; border-bottom-left-radius: 5px; background: #f3f5f8; }
.timestamp { display: flex; align-items: center; gap: 3px; margin-top: 5px; color: #77839a; font-size: 9px; }.timestamp i { display: flex; margin-left: 2px; color: #1769ff; }.timestamp i svg + svg { margin-left: -7px; }
.delivery-note { display: flex; align-items: center; gap: 6px; margin-top: 6px; border: 1px solid #dbe5f5; border-radius: 8px; padding: 6px 8px; background: #f8faff; color: #65738a; font-size: 8px; }.delivery-note > svg { color: #1769ff; }.delivery-avatars { display: flex; margin-left: auto; padding-left: 5px; }.delivery-avatars i { display: grid; width: 20px; height: 20px; margin-left: -5px; place-items: center; border: 2px solid #fff; border-radius: 50%; background: #ffead3; color: #9e5d18; font-size: 7px; font-style: normal; font-weight: 800; }
.composer-area { padding: 8px clamp(22px, 5vw, 80px) 10px; }.composer { display: flex; max-width: 880px; align-items: center; margin: 0 auto; border: 1px solid #dbe2ec; border-radius: 28px; padding: 3px 5px 3px 18px; background: #fff; box-shadow: 0 4px 14px rgb(30 46 78 / 5%); transition: border-color .2s, box-shadow .2s; }.composer:focus-within { border-color: #8cb3ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 8%), 0 4px 14px rgb(30 46 78 / 5%); }.composer input { min-width: 0; flex: 1; border: 0; outline: 0; color: #27344a; font: inherit; font-size: 11px; }.composer input::placeholder { color: #9aa4b5; }.send-button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 50%; background: #1769ff; color: #fff; cursor: pointer; box-shadow: 0 5px 12px rgb(23 105 255 / 30%); }.send-button:hover { background: #0758ed; }
.chat-tools { display: flex; align-items: stretch; justify-content: center; border-top: 1px solid #e6eaf1; background: #fff; }.chat-tools button { position: relative; display: flex; min-width: 100px; flex-direction: column; align-items: center; justify-content: center; gap: 7px; border: 0; background: transparent; color: #5d6980; cursor: pointer; }.chat-tools button:hover { background: #f7f9fd; color: #1769ff; }.chat-tools button span { font-size: 9px; font-weight: 650; }.chat-tools button.active { color: #1769ff; }.chat-tools button.active::after { position: absolute; right: 25%; bottom: 0; left: 25%; height: 2px; border-radius: 4px; background: #1769ff; content: ""; }
.toast { position: fixed; z-index: 60; top: 24px; left: 50%; display: flex; align-items: center; gap: 9px; transform: translateX(-50%); border: 1px solid #dce5f2; border-radius: 10px; padding: 11px 16px; background: #fff; box-shadow: 0 10px 30px rgb(24 37 65 / 16%); color: #293750; font-size: 12px; font-weight: 700; }.toast span { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: #e6f7ee; color: #18955a; }
.toast-enter-active,.toast-leave-active { transition: opacity .2s, transform .2s; }.toast-enter-from,.toast-leave-to { opacity: 0; transform: translate(-50%, -8px); }
@media (max-width: 700px) { .chat-header { padding: 0 12px 0 58px; }.chat-header__back { display: none; }.chat-header__actions .icon-button:first-child { display: none; }.chat-body { padding: 14px 12px 20px; }.composer-area { padding: 8px 12px 9px; }.chat-tools button { min-width: 0; flex: 1; }.bubble--mine { max-width: min(430px, 86vw); }.bubble--schedule { width: 100%; max-width: none; } }
@media (max-width: 430px) { .chat-header__actions .icon-button:nth-child(2) { display: none; }.candidate strong { font-size: 12px; }.chat-tools button span { font-size: 8px; }.bubble { padding: 13px 14px; } }
</style>
