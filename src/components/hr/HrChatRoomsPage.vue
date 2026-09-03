<script setup>
import { computed, ref } from "vue"
import HrIcon from "./ui/HrIcon.vue"
import { hrChatRooms } from "./hrChatMockData.js"

const search = ref("")
const activeRole = ref("all")

const roleOptions = [
  { value: "all", label: "すべて", icon: "chat" },
  { value: "student", label: "学生", icon: "student" },
  { value: "interviewer", label: "面接官", icon: "briefcase" },
  { value: "hr", label: "他人事", icon: "shield" },
]

const roleMeta = {
  student: { label: "学生", description: "選考中の候補者", icon: "student" },
  interviewer: { label: "面接官", description: "面接を担当するメンバー", icon: "briefcase" },
  hr: { label: "他人事", description: "採用チームのメンバー", icon: "shield" },
}

const filteredRooms = computed(() => {
  const query = search.value.trim().toLowerCase()
  return hrChatRooms.filter((room) => {
    const matchesRole = activeRole.value === "all" || room.role === activeRole.value
    const matchesQuery = !query || [room.name, room.detail, room.lastMessage].some((value) => value.toLowerCase().includes(query))
    return matchesRole && matchesQuery
  })
})

const roomGroups = computed(() => ["student", "interviewer", "hr"]
  .map((role) => ({ role, ...roleMeta[role], rooms: filteredRooms.value.filter((room) => room.role === role) }))
  .filter((group) => group.rooms.length))

const roleCount = (role) => role === "all" ? hrChatRooms.length : hrChatRooms.filter((room) => room.role === role).length
</script>

<template>
  <div class="rooms-page">
    <header class="page-header">
      <div><span>MESSAGES</span><h1>トークルーム</h1><p>メッセージを送る相手を選択してください。</p></div>
      <label class="search-box"><HrIcon name="search" :size="18" /><input v-model="search" type="search" placeholder="名前・所属・メッセージを検索" /></label>
    </header>

    <nav class="role-tabs" aria-label="ユーザー種別">
      <button v-for="role in roleOptions" :key="role.value" type="button" :class="[`role-tab--${role.value}`, { active: activeRole === role.value }]" @click="activeRole = role.value">
        <span><HrIcon :name="role.icon" :size="17" /></span>{{ role.label }}<i>{{ roleCount(role.value) }}</i>
      </button>
    </nav>

    <main v-if="roomGroups.length" class="room-groups">
      <section v-for="group in roomGroups" :key="group.role" class="room-group">
        <header>
          <span :class="`group-icon group-icon--${group.role}`"><HrIcon :name="group.icon" :size="18" /></span>
          <div><h2>{{ group.label }}</h2><p>{{ group.description }}</p></div>
          <strong>{{ group.rooms.length }}人</strong>
        </header>

        <div class="room-grid">
          <RouterLink v-for="room in group.rooms" :key="room.id" :to="{ name: 'hr-chat-room', params: { role: room.role, id: room.id } }" class="room-card">
            <span :class="`avatar avatar--${room.role}`">{{ room.name.slice(0, 1) }}</span>
            <div class="room-card__content">
              <div class="room-card__name"><strong>{{ room.name }} さん</strong><time>{{ room.time }}</time></div>
              <span :class="`role-badge role-badge--${room.role}`">{{ room.roleLabel }}</span>
              <p class="detail">{{ room.detail }}</p>
              <p class="last-message">{{ room.lastMessage }}</p>
            </div>
            <span v-if="room.unread" class="unread">{{ room.unread }}</span>
            <span class="open-arrow"><HrIcon name="back" :size="17" /></span>
          </RouterLink>
        </div>
      </section>
    </main>

    <div v-else class="empty-state"><span><HrIcon name="search" :size="23" /></span><strong>トークルームが見つかりません</strong><p>検索条件またはユーザー種別を変更してください。</p></div>
  </div>
</template>

<style scoped>
.rooms-page { height: 100%; overflow-y: auto; padding: 33px clamp(24px, 4.5vw, 68px) 50px; background: #f7f9fc; color: #263248; }.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }.page-header > div > span { display: block; margin-bottom: 7px; color: #1769ff; font-size: 8px; font-weight: 800; letter-spacing: .16em; }.page-header h1 { margin: 0; color: #172033; font-size: 25px; letter-spacing: -.03em; }.page-header p { margin: 7px 0 0; color: #748096; font-size: 11px; }.search-box { display: flex; width: min(310px, 38%); height: 42px; align-items: center; gap: 9px; border: 1px solid #dce3ed; border-radius: 10px; padding: 0 13px; background: #fff; color: #8994a7; box-shadow: 0 3px 10px rgb(29 45 73 / 4%); }.search-box:focus-within { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 8%); }.search-box input { min-width: 0; flex: 1; border: 0; outline: 0; color: #344054; font: inherit; font-size: 10px; }
.role-tabs { display: flex; gap: 9px; margin: 25px 0 21px; }.role-tabs button { display: flex; min-width: 105px; height: 42px; align-items: center; gap: 8px; border: 1px solid #dfe5ee; border-radius: 10px; padding: 0 11px; background: #fff; color: #637086; font: inherit; font-size: 10px; font-weight: 750; cursor: pointer; transition: border .18s, box-shadow .18s, transform .18s; }.role-tabs button:hover { transform: translateY(-1px); border-color: #b7c9e9; }.role-tabs button > span { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 7px; background: #f1f4f8; }.role-tabs button i { display: grid; min-width: 18px; height: 18px; margin-left: auto; place-items: center; border-radius: 9px; background: #eef1f5; color: #7b8799; font-size: 8px; font-style: normal; }.role-tabs button.active { border-color: #1769ff; background: #f7f9ff; box-shadow: 0 0 0 2px rgb(23 105 255 / 7%); color: #1769ff; }.role-tabs button.active > span,.role-tabs button.active i { background: #e6efff; color: #1769ff; }.role-tabs .role-tab--student.active { border-color: #28a879; color: #16845f; }.role-tabs .role-tab--student.active > span,.role-tabs .role-tab--student.active i { background: #e6f7f0; color: #16845f; }.role-tabs .role-tab--interviewer.active { border-color: #df9a47; color: #a96417; }.role-tabs .role-tab--interviewer.active > span,.role-tabs .role-tab--interviewer.active i { background: #fff0dc; color: #a96417; }.role-tabs .role-tab--hr.active { border-color: #8d68cf; color: #7047b8; }.role-tabs .role-tab--hr.active > span,.role-tabs .role-tab--hr.active i { background: #efe8fb; color: #7047b8; }
.room-groups { display: flex; flex-direction: column; gap: 23px; }.room-group > header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }.group-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 9px; }.group-icon--student { background: #e7f7f1; color: #16845f; }.group-icon--interviewer { background: #fff0dc; color: #a96417; }.group-icon--hr { background: #efe8fb; color: #7047b8; }.room-group header div { display: flex; flex-direction: column; }.room-group h2 { margin: 0; color: #2b374b; font-size: 12px; }.room-group header p { margin: 2px 0 0; color: #8792a5; font-size: 8px; }.room-group header > strong { margin-left: auto; color: #8a95a7; font-size: 8px; }
.room-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }.room-card { position: relative; display: flex; min-width: 0; min-height: 128px; gap: 10px; border: 1px solid #e0e6ef; border-radius: 12px; padding: 15px 13px; background: #fff; box-shadow: 0 3px 10px rgb(30 47 77 / 3%); color: inherit; text-decoration: none; transition: border .18s, box-shadow .18s, transform .18s; }.room-card:hover { transform: translateY(-2px); border-color: #b9cdf0; box-shadow: 0 8px 20px rgb(30 47 77 / 9%); }.avatar { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 50%; font-size: 11px; font-weight: 800; }.avatar--student { background: #dcf4e9; color: #157653; }.avatar--interviewer { background: #ffead3; color: #a85c11; }.avatar--hr { background: #eadffd; color: #6940ad; }.room-card__content { min-width: 0; flex: 1; }.room-card__name { display: flex; min-width: 0; align-items: center; gap: 6px; }.room-card__name strong { overflow: hidden; color: #29364b; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.room-card__name time { margin-left: auto; color: #98a1b0; font-size: 7px; }.role-badge { display: inline-flex; margin-top: 5px; border-radius: 8px; padding: 2px 6px; font-size: 7px; font-weight: 750; }.role-badge--student { background: #eaf8f2; color: #157653; }.role-badge--interviewer { background: #fff3e5; color: #a85c11; }.role-badge--hr { background: #f2ecfc; color: #6940ad; }.detail { overflow: hidden; margin: 6px 0 0; color: #758196; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.last-message { overflow: hidden; margin: 9px 0 0; color: #4e5b70; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.unread { position: absolute; top: 10px; left: 42px; display: grid; min-width: 17px; height: 17px; place-items: center; border: 2px solid #fff; border-radius: 9px; background: #1769ff; color: #fff; font-size: 7px; font-weight: 800; }.open-arrow { position: absolute; right: 8px; bottom: 8px; display: grid; width: 24px; height: 24px; place-items: center; border-radius: 7px; color: #a2abba; transform: rotate(180deg); }.room-card:hover .open-arrow { background: #edf3ff; color: #1769ff; }
.empty-state { display: flex; min-height: 330px; flex-direction: column; align-items: center; justify-content: center; border: 1px dashed #d5deeb; border-radius: 14px; background: #fff; }.empty-state > span { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 13px; background: #f0f3f7; color: #7d899b; }.empty-state strong { margin-top: 13px; color: #3c485d; font-size: 11px; }.empty-state p { margin: 5px 0 0; color: #8a95a7; font-size: 9px; }
@media (max-width: 1080px) { .room-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .rooms-page { padding: 84px 15px 35px; }.page-header { align-items: stretch; flex-direction: column; gap: 16px; }.search-box { width: 100%; }.role-tabs { overflow-x: auto; padding-bottom: 3px; }.role-tabs button { min-width: 100px; }.room-grid { grid-template-columns: 1fr; } }
</style>
