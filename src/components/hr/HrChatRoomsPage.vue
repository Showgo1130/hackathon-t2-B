<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { session } from "../../session.js"
import socketManager from "../../socketManager.js"
import HrIcon from "./ui/HrIcon.vue"

const search = ref("")
const activeRole = ref("all")
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

const roleOptions = [
  { value: "all", label: "すべて", icon: "chat" },
  { value: "student", label: "学生", icon: "student" },
]

const roleMeta = {
  student: { label: "学生", description: "選考中の候補者", icon: "student" },
}

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
    return { id: student.id, role: "student", name: student.name, detail: student.email, roleLabel: "学生", status: selectionLabels[student.selection_status] ?? student.selection_status,
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
    const matchesRole = activeRole.value === "all" || room.role === activeRole.value
    const matchesQuery = !query || [room.name, room.detail, room.lastMessage].some((value) => (value ?? "").toLowerCase().includes(query))
    return matchesRole && matchesQuery && (!onlyUnreplied.value || room.unreplied)
  })
  // 返事を待たせている人を先頭に。同じなら古いメッセージから片付ける
  .sort((a, b) => {
    if (Boolean(a.unreplied) !== Boolean(b.unreplied)) return a.unreplied ? -1 : 1
    if (a.unreplied && b.unreplied) return new Date(a.unreplied.created_at) - new Date(b.unreplied.created_at)
    return 0
  })
})

const pageSize = 10
const rolePages = reactive({ student: 1 })
const roomsForRole = (role) => filteredRooms.value.filter((room) => room.role === role)
const roleTotalPages = (role) => Math.max(1, Math.ceil(roomsForRole(role).length / pageSize))
const paginatedRoomsForRole = (role) => roomsForRole(role).slice((rolePages[role] - 1) * pageSize, rolePages[role] * pageSize)
watch([search, activeRole, onlyUnreplied], () => { rolePages.student = 1 })

const roomGroups = computed(() => ["student"]
  .map((role) => ({ role, ...roleMeta[role], rooms: paginatedRoomsForRole(role), total: roomsForRole(role).length }))
  .filter((group) => group.total))

const roleCount = (role) => role === "all" ? hrChatRooms.value.length : hrChatRooms.value.filter((room) => room.role === role).length
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
      <div><span>MESSAGES</span><h1>トークルーム</h1><p>{{ unrepliedCount ? `${unrepliedCount}人が返信を待っています。` : "返信待ちのメッセージはありません。" }}</p></div>
      <label class="search-box"><HrIcon name="search" :size="18" /><input v-model="search" type="search" placeholder="名前・所属・メッセージを検索" /></label>
    </header>

    <nav class="role-tabs" aria-label="ユーザー種別">
      <button v-for="role in roleOptions" :key="role.value" type="button" :class="[`role-tab--${role.value}`, { active: activeRole === role.value }]" @click="activeRole = role.value">
        <span><HrIcon :name="role.icon" :size="17" /></span>{{ role.label }}<i>{{ roleCount(role.value) }}</i>
      </button>
      <button
        type="button"
        class="unreplied-toggle"
        :class="{ active: onlyUnreplied }"
        :aria-pressed="onlyUnreplied"
        @click="onlyUnreplied = !onlyUnreplied"
      >未返信のみ<i>{{ unrepliedCount }}</i></button>
    </nav>

    <main v-if="roomGroups.length" class="room-groups">
      <section v-for="group in roomGroups" :key="group.role" class="room-group">
        <header>
          <span :class="`group-icon group-icon--${group.role}`"><HrIcon :name="group.icon" :size="18" /></span>
          <div><h2>{{ group.label }}</h2><p>{{ group.description }}</p></div>
          <strong>{{ group.rooms.length }}人</strong>
        </header>

        <div class="room-grid">
          <RouterLink v-for="room in group.rooms" :key="room.id" :to="{ name: 'hr-chat-room', params: { role: room.role, id: room.id } }" class="room-card" :class="{ 'room-card--unreplied': room.unreplied }">
            <span :class="`avatar avatar--${room.role}`">{{ room.name.slice(0, 1) }}</span>
            <div class="room-card__content">
              <div class="room-card__name"><strong>{{ room.name }} さん</strong><time>{{ room.time }}</time></div>
              <span :class="`role-badge role-badge--${room.role}`">{{ room.roleLabel }}</span>
              <p class="detail">{{ room.detail }}</p>
              <p class="last-message">{{ room.lastMessage }}</p>
            </div>
            <span v-if="room.unreplied" class="unreplied-tag">未返信</span>
            <span class="open-arrow"><HrIcon name="back" :size="17" /></span>
          </RouterLink>
        </div>
        <nav v-if="group.total > pageSize" class="pagination pagination--group" :aria-label="`${group.label}のページ送り`">
          <span>{{ group.total }}人中 {{ (rolePages[group.role] - 1) * pageSize + 1 }}〜{{ Math.min(rolePages[group.role] * pageSize, group.total) }}人</span>
          <button type="button" :disabled="rolePages[group.role] === 1" @click="rolePages[group.role]--">‹ 前へ</button>
          <strong>{{ rolePages[group.role] }} / {{ roleTotalPages(group.role) }}</strong>
          <button type="button" :disabled="rolePages[group.role] === roleTotalPages(group.role)" @click="rolePages[group.role]++">次へ ›</button>
        </nav>
      </section>
    </main>

    <div v-else class="empty-state"><span><HrIcon :name="loading ? 'chat' : 'search'" :size="23" /></span><strong>{{ loading ? "DBから読み込んでいます" : onlyUnreplied ? "返信待ちのメッセージはありません" : "トークルームが見つかりません" }}</strong><p>{{ loading ? "少しお待ちください。" : onlyUnreplied ? "「未返信のみ」を外すと全員が表示されます。" : "検索条件またはユーザー種別を変更してください。" }}</p></div>
  </div>
</template>

<style scoped>
.rooms-page { height: 100%; overflow-y: auto; padding: 33px clamp(24px, 4.5vw, 68px) 50px; background: #f7f9fc; color: #263248; }.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }.page-header > div > span { display: block; margin-bottom: 7px; color: #1769ff; font-size: 8px; font-weight: 800; letter-spacing: .16em; }.page-header h1 { margin: 0; color: #172033; font-size: 25px; letter-spacing: -.03em; }.page-header p { margin: 7px 0 0; color: #748096; font-size: 11px; }.search-box { display: flex; width: min(310px, 38%); height: 42px; align-items: center; gap: 9px; border: 1px solid #dce3ed; border-radius: 10px; padding: 0 13px; background: #fff; color: #8994a7; box-shadow: 0 3px 10px rgb(29 45 73 / 4%); }.search-box:focus-within { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 8%); }.search-box input { min-width: 0; flex: 1; border: 0; outline: 0; color: #344054; font: inherit; font-size: 10px; }
.unreplied-toggle { display: flex; height: 42px; align-items: center; gap: 8px; border: 1px solid #dfe5ee; border-radius: 10px; margin-left: auto; padding: 0 14px; background: #fff; color: #637086; font: inherit; font-size: 10px; font-weight: 750; cursor: pointer; }
.unreplied-toggle i { display: grid; min-width: 18px; height: 18px; place-items: center; border-radius: 9px; background: #eef1f5; color: #7b8799; font-size: 8px; font-style: normal; }
.unreplied-toggle:hover { border-color: #b7c9e9; }
.unreplied-toggle.active { border-color: #1769ff; background: #f7f9ff; color: #1769ff; }
.unreplied-toggle.active i { background: #1769ff; color: #fff; }
.role-tabs { display: flex; gap: 9px; margin: 25px 0 21px; }.role-tabs button { display: flex; min-width: 105px; height: 42px; align-items: center; gap: 8px; border: 1px solid #dfe5ee; border-radius: 10px; padding: 0 11px; background: #fff; color: #637086; font: inherit; font-size: 10px; font-weight: 750; cursor: pointer; transition: border .18s, box-shadow .18s, transform .18s; }.role-tabs button:hover { transform: translateY(-1px); border-color: #b7c9e9; }.role-tabs button > span { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 7px; background: #f1f4f8; }.role-tabs button i { display: grid; min-width: 18px; height: 18px; margin-left: auto; place-items: center; border-radius: 9px; background: #eef1f5; color: #7b8799; font-size: 8px; font-style: normal; }.role-tabs button.active { border-color: #1769ff; background: #f7f9ff; box-shadow: 0 0 0 2px rgb(23 105 255 / 7%); color: #1769ff; }.role-tabs button.active > span,.role-tabs button.active i { background: #e6efff; color: #1769ff; }.role-tabs .role-tab--student.active { border-color: #28a879; color: #16845f; }.role-tabs .role-tab--student.active > span,.role-tabs .role-tab--student.active i { background: #e6f7f0; color: #16845f; }.role-tabs .role-tab--interviewer.active { border-color: #df9a47; color: #a96417; }.role-tabs .role-tab--interviewer.active > span,.role-tabs .role-tab--interviewer.active i { background: #fff0dc; color: #a96417; }.role-tabs .role-tab--hr.active { border-color: #8d68cf; color: #7047b8; }.role-tabs .role-tab--hr.active > span,.role-tabs .role-tab--hr.active i { background: #efe8fb; color: #7047b8; }
.room-groups { display: flex; flex-direction: column; gap: 15px; }.room-group > header { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }.group-icon { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 8px; }.group-icon--student { background: #e7f7f1; color: #16845f; }.group-icon--interviewer { background: #fff0dc; color: #a96417; }.group-icon--hr { background: #efe8fb; color: #7047b8; }.room-group header div { display: flex; flex-direction: column; }.room-group h2 { margin: 0; color: #2b374b; font-size: 11px; }.room-group header p { margin: 1px 0 0; color: #8792a5; font-size: 7px; }.room-group header > strong { margin-left: auto; color: #8a95a7; font-size: 8px; }
.room-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }.room-card { position: relative; display: flex; min-width: 0; min-height: 96px; gap: 8px; border: 1px solid #e0e6ef; border-radius: 10px; padding: 10px; background: #fff; box-shadow: 0 2px 7px rgb(30 47 77 / 3%); color: inherit; text-decoration: none; transition: border .18s, box-shadow .18s, transform .18s; }.room-card:hover { transform: translateY(-1px); border-color: #b9cdf0; box-shadow: 0 6px 15px rgb(30 47 77 / 8%); }.avatar { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 50%; font-size: 9px; font-weight: 800; }.avatar--student { background: #dcf4e9; color: #157653; }.avatar--interviewer { background: #ffead3; color: #a85c11; }.avatar--hr { background: #eadffd; color: #6940ad; }.room-card__content { min-width: 0; flex: 1; }.room-card__name { display: flex; min-width: 0; align-items: center; gap: 5px; }.room-card__name strong { overflow: hidden; color: #29364b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.room-card__name time { margin-left: auto; color: #98a1b0; font-size: 7px; }.role-badge { display: inline-flex; margin-top: 3px; border-radius: 8px; padding: 2px 6px; font-size: 7px; font-weight: 750; }.role-badge--student { background: #eaf8f2; color: #157653; }.role-badge--interviewer { background: #fff3e5; color: #a85c11; }.role-badge--hr { background: #f2ecfc; color: #6940ad; }.detail { overflow: hidden; margin: 4px 0 0; color: #758196; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }.last-message { overflow: hidden; margin: 5px 0 0; color: #4e5b70; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }.unreplied-tag { position: absolute; top: 6px; right: 6px; border-radius: 6px; background: #1769ff; padding: 2px 6px; color: #fff; font-size: 7px; font-weight: 800; letter-spacing: .04em; }
.room-card--unreplied { border-color: #b3ccf7; background: #f8fbff; }
.room-card--unreplied .last-message { color: #1a2235; font-weight: 700; }.open-arrow { position: absolute; right: 6px; bottom: 6px; display: grid; width: 21px; height: 21px; place-items: center; border-radius: 6px; color: #a2abba; transform: rotate(180deg); }.room-card:hover .open-arrow { background: #edf3ff; color: #1769ff; }
.empty-state { display: flex; min-height: 330px; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #d5deeb; border-radius: 14px; background: #fff; }.empty-state > span { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 13px; background: #f0f3f7; color: #7d899b; }.empty-state strong { margin-top: 13px; color: #3c485d; font-size: 11px; }.empty-state p { margin: 5px 0 0; color: #8a95a7; font-size: 9px; }
.pagination { display: flex; align-items: center; justify-content: flex-end; gap: 9px; margin-top: 20px; }.pagination>span { margin-right: auto; color: #8490a3; font-size: 9px; }.pagination button { height: 33px; border: 1px solid #dce3ed; border-radius: 8px; padding: 0 12px; background: #fff; color: #43516a; font: inherit; font-size: 9px; cursor: pointer; }.pagination button:hover:not(:disabled) { border-color: #1769ff; color: #1769ff; }.pagination button:disabled { opacity: .42; cursor: default; }.pagination strong { min-width: 48px; color: #667289; font-size: 9px; text-align: center; }
.pagination--group { margin-top: 10px; }
@media (max-width: 1200px) { .room-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 980px) { .room-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) { .rooms-page { padding: 84px 15px 35px; }.page-header { align-items: stretch; flex-direction: column; gap: 16px; }.search-box { width: 100%; }.role-tabs { overflow-x: auto; padding-bottom: 3px; }.role-tabs button { min-width: 100px; }.room-grid { grid-template-columns: 1fr; } }
</style>
