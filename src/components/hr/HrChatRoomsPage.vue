<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { session } from "../../session.js"
import socketManager from "../../socketManager.js"
import HrIcon from "./ui/HrIcon.vue"

const search = ref("")
const students = ref([])
const requests = ref([])
const conversations = ref([])
const unrepliedMessages = ref([])
const loading = ref(true)
// ダッシュボードの「一覧で返信する」から来たときは、未返信だけを出した状態で開く
const route = useRoute()
const onlyUnreplied = ref(route.query.filter === "unreplied")
const getSocket = () => { try { return socketManager.getInstance() } catch { return socketManager.connect(session.value.token) } }
const socket = getSocket()

const selectionLabels = { first_interview: "一次面接", second_interview: "二次面接", final_interview: "最終面接", offered: "内定", rejected: "不採用" }
const requestLabels = { awaiting_student: "学生回答待ち", matching: "面接官確認中", confirmed: "日程確定", cancelled: "キャンセル" }
const latestRequest = (studentId) => requests.value.filter((item) => item.student_id === studentId).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0]
// 人事がまだ返していないメッセージ。会話IDで届くので学生IDに引き直す
const unrepliedByStudent = computed(() => {
  const studentIdOf = new Map(conversations.value.filter((c) => c.student_id).map((c) => [c.id, c.student_id]))
  const map = new Map()
  for (const message of unrepliedMessages.value) {
    const studentId = studentIdOf.get(message.conversation_id)
    if (studentId) map.set(studentId, message)
  }
  return map
})
const hrChatRooms = computed(() => [
  ...students.value.map((student) => {
    const request = latestRequest(student.id)
    const unreplied = unrepliedByStudent.value.get(student.id) ?? null
    return { id: student.id, role: "student", name: student.name, detail: student.email, status: selectionLabels[student.selection_status] ?? student.selection_status,
      // 未返信のときは状態ラベルより本人の言葉を出す。何に返すのかが一覧で分かる
      lastMessage: unreplied ? unreplied.body : (request ? requestLabels[request.status] ?? request.status : "日程調整は未送信です"),
      time: unreplied ? new Date(unreplied.created_at).toLocaleDateString("ja-JP") : (request ? new Date(request.updated_at).toLocaleDateString("ja-JP") : ""),
      unreplied }
  }),
])
const unrepliedCount = computed(() => hrChatRooms.value.filter((room) => room.unreplied).length)

const filteredRooms = computed(() => {
  const query = search.value.trim().toLowerCase()
  return hrChatRooms.value.filter((room) => {
    const matchesQuery = !query || [room.name, room.detail, room.lastMessage].some((value) => (value ?? "").toLowerCase().includes(query))
    return matchesQuery && (!onlyUnreplied.value || room.unreplied)
  })
  // 返事を待たせている人を先頭に。同じなら古いメッセージから片付ける
  .sort((a, b) => {
    if (Boolean(a.unreplied) !== Boolean(b.unreplied)) return a.unreplied ? -1 : 1
    if (a.unreplied && b.unreplied) return new Date(a.unreplied.created_at) - new Date(b.unreplied.created_at)
    return 0
  })
})

// 相手は候補者だけなので種別で分ける必要がない。1本のリストにして送りだけ持つ
const pageSize = 12
const page = ref(1)
const totalPages = computed(() => Math.max(1, Math.ceil(filteredRooms.value.length / pageSize)))
const paginatedRooms = computed(() => filteredRooms.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch([search, onlyUnreplied], () => { page.value = 1 })
watch(totalPages, (pages) => { if (page.value > pages) page.value = pages })
const onDashboard = (data) => {
  students.value = data.students ?? []; requests.value = data.requests ?? []
  conversations.value = data.conversations ?? []; unrepliedMessages.value = data.unrepliedMessages ?? []
  loading.value = false
}
const onNewMessage = () => socket.emit("loadDashboard")
onMounted(() => {
  socket.on("dashboardData", onDashboard); socket.on("newMessage", onNewMessage); socket.emit("loadDashboard")
})
onUnmounted(() => { socket.off("dashboardData", onDashboard); socket.off("newMessage", onNewMessage) })
</script>

<template>
  <div class="rooms-page">
    <header class="page-header">
      <div>
        <span>MESSAGES</span>
        <h1>チャット</h1>
        <p>{{ unrepliedCount ? `${unrepliedCount}人が返信を待っています。` : "返信待ちのメッセージはありません。" }}</p>
      </div>
      <div class="tools">
        <label class="search-box">
          <HrIcon name="search" :size="18" />
          <input v-model="search" type="search" placeholder="名前・メール・メッセージを検索" />
        </label>
        <button
          type="button"
          class="unreplied-toggle"
          :class="{ active: onlyUnreplied }"
          :aria-pressed="onlyUnreplied"
          @click="onlyUnreplied = !onlyUnreplied"
        >未返信のみ<i>{{ unrepliedCount }}</i></button>
      </div>
    </header>

    <main v-if="paginatedRooms.length" class="room-list">
      <div class="room-list__head">
        <span>候補者</span>
        <span>選考ステップ</span>
        <span>最後のメッセージ</span>
        <span></span>
        <span class="ta-r">更新</span>
        <span></span>
      </div>

      <RouterLink
        v-for="room in paginatedRooms"
        :key="room.id"
        :to="{ name: 'hr-chat-room', params: { role: room.role, id: room.id } }"
        class="room-row"
        :class="{ 'room-row--unreplied': room.unreplied }"
      >
        <span class="avatar">{{ room.name.slice(0, 1) }}</span>
        <span class="room-row__who">
          <strong>{{ room.name }} さん</strong>
          <small>{{ room.detail }}</small>
        </span>
        <span class="stage">{{ room.status }}</span>
        <span class="room-row__message">{{ room.lastMessage }}</span>
        <span class="room-row__flag"><i v-if="room.unreplied" class="unreplied-tag">未返信</i></span>
        <time>{{ room.time }}</time>
        <span class="open-arrow"><HrIcon name="back" :size="16" /></span>
      </RouterLink>

      <nav v-if="filteredRooms.length > pageSize" class="pagination" aria-label="ページ送り">
        <span>{{ filteredRooms.length }}人中 {{ (page - 1) * pageSize + 1 }}〜{{ Math.min(page * pageSize, filteredRooms.length) }}人</span>
        <button type="button" :disabled="page === 1" @click="page--">‹ 前へ</button>
        <strong>{{ page }} / {{ totalPages }}</strong>
        <button type="button" :disabled="page === totalPages" @click="page++">次へ ›</button>
      </nav>
    </main>

    <div v-else class="empty-state">
      <span><HrIcon :name="loading ? 'chat' : 'search'" :size="23" /></span>
      <strong>{{ loading ? "DBから読み込んでいます" : onlyUnreplied ? "返信待ちのメッセージはありません" : "候補者が見つかりません" }}</strong>
      <p>{{ loading ? "少しお待ちください。" : onlyUnreplied ? "「未返信のみ」を外すと全員が表示されます。" : "検索条件を変更してください。" }}</p>
    </div>
  </div>
</template>

<style scoped>
.rooms-page { height: 100%; overflow-y: auto; padding: 33px clamp(24px, 4.5vw, 68px) 50px; background: #f7f9fc; color: #263248; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; margin-bottom: 20px; }
.page-header > div > span { display: block; margin-bottom: 7px; color: #1769ff; font-size: 8px; font-weight: 800; letter-spacing: .16em; }
.page-header h1 { margin: 0; color: #172033; font-size: 25px; letter-spacing: -.03em; }
.page-header p { margin: 7px 0 0; color: #748096; font-size: 11px; }
.tools { display: flex; flex-shrink: 0; align-items: center; gap: 9px; }
.search-box { display: flex; width: min(300px, 40vw); height: 40px; align-items: center; gap: 9px; border: 1px solid #dce3ed; border-radius: 10px; padding: 0 13px; background: #fff; color: #8994a7; box-shadow: 0 3px 10px rgb(29 45 73 / 4%); }
.search-box:focus-within { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 8%); }
.search-box input { min-width: 0; flex: 1; border: 0; outline: 0; color: #344054; font: inherit; font-size: 12px; }
.unreplied-toggle { display: flex; height: 40px; flex-shrink: 0; align-items: center; gap: 8px; border: 1px solid #dfe5ee; border-radius: 10px; padding: 0 14px; background: #fff; color: #637086; font: inherit; font-size: 12px; font-weight: 750; cursor: pointer; }
.unreplied-toggle i { display: grid; min-width: 20px; height: 20px; place-items: center; border-radius: 10px; background: #eef1f5; color: #7b8799; font-size: 11px; font-style: normal; }
.unreplied-toggle:hover { border-color: #b7c9e9; }
.unreplied-toggle.active { border-color: #1769ff; background: #f7f9ff; color: #1769ff; }
.unreplied-toggle.active i { background: #1769ff; color: #fff; }

/* 相手は候補者だけなので、カードを敷き詰めず1行1人のリストにする。
   列を固定して、名前・選考ステップ・本文・更新日が縦に揃うようにする */
.room-list { overflow: hidden; border: 1px solid #e3e9f2; border-radius: 13px; background: #fff; box-shadow: 0 2px 10px rgb(30 47 77 / 4%); }
.room-list__head, .room-row {
  display: grid;
  grid-template-columns: 36px minmax(150px, 1.1fr) 84px minmax(0, 2fr) 62px 62px 18px;
  align-items: center;
  gap: 14px;
  padding: 0 18px;
}
.room-list__head { height: 38px; border-bottom: 1px solid #e9eef5; background: #f8fafd; color: #8490a3; font-size: 10px; font-weight: 750; }
.room-list__head > span:first-child { grid-column: 1 / 3; }
.ta-r { text-align: right; }

.room-row { min-height: 62px; border-bottom: 1px solid #eef2f7; color: inherit; text-decoration: none; transition: background .15s; }
.room-row:last-of-type { border-bottom: 0; }
.room-row:hover { background: #f6f9ff; }
.room-row--unreplied { background: #f8fbff; }
.room-row--unreplied:hover { background: #eff5ff; }

.avatar { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 50%; background: #dcf4e9; color: #157653; font-size: 13px; font-weight: 800; }
.room-row__who { display: flex; min-width: 0; flex-direction: column; }
.room-row__who strong { overflow: hidden; color: #29364b; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.room-row__who small { overflow: hidden; color: #8590a3; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.stage { justify-self: start; border-radius: 7px; background: #eaf8f2; padding: 3px 9px; color: #157653; font-size: 10px; font-weight: 700; white-space: nowrap; }
.room-row__message { overflow: hidden; color: #6a768b; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.room-row--unreplied .room-row__message { color: #1a2235; font-weight: 700; }
.room-row__flag { justify-self: end; }
.unreplied-tag { border-radius: 6px; background: #1769ff; padding: 3px 8px; color: #fff; font-size: 10px; font-style: normal; font-weight: 800; white-space: nowrap; }
.room-row time { color: #98a1b0; font-size: 10px; text-align: right; }
.open-arrow { display: grid; place-items: center; color: #b9c2cf; transform: rotate(180deg); }
.room-row:hover .open-arrow { color: #1769ff; }

.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 10px; border-top: 1px solid #eef2f7; padding: 12px 18px; }
.pagination > span { margin-right: auto; color: #8490a3; font-size: 11px; }
.pagination button { height: 32px; border: 1px solid #dce3ed; border-radius: 8px; padding: 0 12px; background: #fff; color: #43516a; font: inherit; font-size: 11px; cursor: pointer; }
.pagination button:hover:not(:disabled) { border-color: #1769ff; color: #1769ff; }
.pagination button:disabled { opacity: .42; cursor: default; }
.pagination strong { min-width: 48px; color: #667289; font-size: 11px; text-align: center; }

.empty-state { display: flex; min-height: 320px; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #d5deeb; border-radius: 14px; background: #fff; }
.empty-state > span { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 13px; background: #f0f3f7; color: #7d899b; }
.empty-state strong { margin-top: 13px; color: #3c485d; font-size: 13px; }
.empty-state p { margin: 5px 0 0; color: #8a95a7; font-size: 11px; }

@media (max-width: 1080px) {
  .room-list__head, .room-row { grid-template-columns: 36px minmax(130px, 1fr) 84px 62px 62px 18px; }
  .room-list__head > span:nth-child(3), .room-row__message { display: none; }
}
@media (max-width: 720px) {
  .rooms-page { padding: 84px 15px 35px; }
  .page-header { align-items: stretch; flex-direction: column; gap: 14px; }
  .tools { flex-wrap: wrap; }
  .search-box { width: 100%; }
  .room-list__head { display: none; }
  .room-row { grid-template-columns: 36px minmax(0, 1fr) auto; gap: 10px; padding: 12px 14px; }
  .stage, .room-row time, .open-arrow { display: none; }
}
</style>
