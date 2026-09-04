<script setup>
import { computed, onMounted, ref } from "vue"
import { session } from "../../session.js"
import HrCreateUserDialog from "./HrCreateUserDialog.vue"
import HrIcon from "./ui/HrIcon.vue"

const dialogOpen = ref(false)
const activeRole = ref("all")
const searchQuery = ref("")
const toast = ref("")
const isCreating = ref(false)
const createError = ref("")
const loading = ref(true)
const loadError = ref("")

const users = ref([])
const roleLabels = { student: "学生", interviewer: "面接官", hr: "人事" }
const formatDate = (value) => value ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "—"
const loadUsers = async () => {
  loading.value = true; loadError.value = ""
  try {
    const response = await fetch("/api/users", { headers: { Authorization: `Bearer ${session.value?.token ?? ""}` } })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    users.value = result.users.map((user) => ({ ...user, roleLabel: roleLabels[user.role], createdAt: formatDate(user.createdAt) }))
  } catch { loadError.value = "ユーザー情報を取得できませんでした。" }
  finally { loading.value = false }
}
onMounted(loadUsers)

const tabs = computed(() => [
  { value: "all", label: "すべて", count: users.value.length },
  { value: "student", label: "学生", count: users.value.filter((user) => user.role === "student").length },
  { value: "interviewer", label: "面接官", count: users.value.filter((user) => user.role === "interviewer").length },
  { value: "hr", label: "人事", count: users.value.filter((user) => user.role === "hr").length },
])

const filteredUsers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return users.value.filter((user) => {
    const roleMatches = activeRole.value === "all" || user.role === activeRole.value
    const queryMatches = !query || [user.name, user.email].some((value) => value.toLowerCase().includes(query))
    return roleMatches && queryMatches
  })
})

const summary = computed(() => ({
  all: users.value.length,
  student: users.value.filter((user) => user.role === "student").length,
  interviewer: users.value.filter((user) => user.role === "interviewer").length,
  hr: users.value.filter((user) => user.role === "hr").length,
}))

const openCreateDialog = () => { createError.value = ""; dialogOpen.value = true }
const createUser = async (user) => {
  isCreating.value = true; createError.value = ""
  try {
    const response = await fetch("/api/users", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.value?.token ?? ""}` },
      body: JSON.stringify({ role: user.role, name: user.name, email: user.email, password: user.password }),
    })
    const result = await response.json()
    if (!response.ok) {
      createError.value = result.error === "email_already_exists" ? "このメールアドレスはすでに登録されています。" : "ユーザーの作成に失敗しました。"
      return
    }
    users.value.unshift({ ...result, roleLabel: roleLabels[result.role], createdAt: formatDate(result.createdAt) })
    dialogOpen.value = false; toast.value = `${result.name}さんのアカウントを作成しました`
    window.setTimeout(() => { toast.value = "" }, 2800)
  } catch { createError.value = "サーバーに接続できませんでした。" }
  finally { isCreating.value = false }
}

const roleIcon = (role) => role === "student" ? "student" : role === "interviewer" ? "briefcase" : "shield"
</script>

<template>
  <div class="users-page">
    <header class="page-header">
      <div><span class="eyebrow">ACCOUNT MANAGEMENT</span><h1>ユーザー管理</h1><p>採用プロセスに参加するユーザーと権限を管理します。</p></div>
      <button class="add-button" type="button" @click="openCreateDialog"><HrIcon name="user-plus" :size="18" />ユーザーを作成</button>
    </header>

    <aside class="permission-note"><span><HrIcon name="shield" :size="19" /></span><div><strong>人事権限でのみ操作できます</strong><p>学生・面接官・他の人事アカウントを作成できるのは人事ユーザーだけです。</p></div></aside>

    <section class="summary-grid" aria-label="ユーザー数">
      <article><span class="summary-icon summary-icon--all"><HrIcon name="users" /></span><div><small>全ユーザー</small><strong>{{ summary.all }}</strong></div></article>
      <article><span class="summary-icon summary-icon--student"><HrIcon name="student" /></span><div><small>学生</small><strong>{{ summary.student }}</strong></div></article>
      <article><span class="summary-icon summary-icon--interviewer"><HrIcon name="briefcase" /></span><div><small>面接官</small><strong>{{ summary.interviewer }}</strong></div></article>
      <article><span class="summary-icon summary-icon--hr"><HrIcon name="shield" /></span><div><small>人事</small><strong>{{ summary.hr }}</strong></div></article>
    </section>

    <section class="user-panel">
      <div class="panel-tools">
        <div class="tabs" role="tablist">
          <button v-for="tab in tabs" :key="tab.value" type="button" role="tab" :aria-selected="activeRole === tab.value" :class="{ active: activeRole === tab.value }" @click="activeRole = tab.value">{{ tab.label }}<span>{{ tab.count }}</span></button>
        </div>
        <label class="search"><HrIcon name="search" :size="17" /><input v-model="searchQuery" type="search" placeholder="名前・メールで検索" /></label>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>ユーザー</th><th>種別</th><th>作成日</th><th></th></tr></thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id">
              <td><div class="user-cell"><span :class="`avatar avatar--${user.role}`">{{ user.name.slice(0, 1) }}</span><div><strong>{{ user.name }}</strong><small>{{ user.email }}</small></div></div></td>
              <td><span :class="`role-badge role-badge--${user.role}`"><HrIcon :name="roleIcon(user.role)" :size="13" />{{ user.roleLabel }}</span></td>
              <td>{{ user.createdAt }}</td>
              <td><button class="more-button" type="button" aria-label="操作メニュー"><HrIcon name="more" :size="18" /></button></td>
            </tr>
          </tbody>
        </table>
        <div v-if="loading || loadError || filteredUsers.length === 0" class="empty"><span><HrIcon :name="loading ? 'users' : 'search'" /></span><strong>{{ loading ? "DBから読み込んでいます" : loadError || "該当するユーザーがいません" }}</strong><p v-if="!loading && !loadError">検索条件を変更してください。</p></div>
      </div>
      <footer class="panel-footer">{{ filteredUsers.length }}件を表示</footer>
    </section>
    <Transition name="toast"><div v-if="toast" class="toast"><span><HrIcon name="check" :size="14" /></span>{{ toast }}</div></Transition>
    <HrCreateUserDialog :open="dialogOpen" :submitting="isCreating" :server-error="createError" @close="dialogOpen = false" @create="createUser" />
  </div>
</template>

<style scoped>
.users-page { height: 100%; overflow-y: auto; padding: 34px clamp(24px, 4.5vw, 68px) 50px; background: #f7f9fc; color: #263248; }.page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }.eyebrow { display: block; margin-bottom: 7px; color: #1769ff; font-size: 12px; font-weight: 800; letter-spacing: .16em; }.page-header h1 { margin: 0; color: #172033; font-size: 25px; letter-spacing: -.03em; }.page-header p { margin: 7px 0 0; color: #748096; font-size: 13px; }.add-button { display: flex; height: 42px; align-items: center; gap: 8px; border: 0; border-radius: 9px; padding: 0 17px; background: #1769ff; box-shadow: 0 7px 16px rgb(23 105 255 / 23%); color: #fff; font-size: 13px; font-weight: 750; cursor: pointer; }.add-button:hover { background: #0758ed; }
.permission-note { display: flex; align-items: center; gap: 11px; margin-top: 24px; border: 1px solid #cdddfb; border-radius: 10px; padding: 12px 15px; background: #f1f6ff; }.permission-note > span { display: grid; width: 34px; height: 34px; flex: 0 0 auto; place-items: center; border-radius: 9px; background: #fff; color: #1769ff; }.permission-note div { display: flex; min-width: 0; align-items: baseline; gap: 12px; }.permission-note strong { color: #24467d; font-size: 13px; }.permission-note p { margin: 0; color: #657692; font-size: 12px; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }.summary-grid article { display: flex; align-items: center; gap: 12px; border: 1px solid #e2e8f0; border-radius: 11px; padding: 15px; background: #fff; }.summary-icon { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 10px; }.summary-icon--all { background: #edf3ff; color: #1769ff; }.summary-icon--student { background: #ecf9f4; color: #14855d; }.summary-icon--interviewer { background: #fff4e8; color: #c16b16; }.summary-icon--hr { background: #f4edff; color: #7445c5; }.summary-grid article div { display: flex; flex-direction: column; }.summary-grid small { color: #7a869a; font-size: 12px; }.summary-grid strong { margin-top: 3px; color: #202b3e; font-size: 20px; }
.user-panel { overflow: hidden; border: 1px solid #e0e6ef; border-radius: 12px; background: #fff; box-shadow: 0 4px 14px rgb(32 48 78 / 4%); }.panel-tools { display: flex; min-height: 66px; align-items: center; justify-content: space-between; gap: 18px; padding: 0 18px; border-bottom: 1px solid #e8edf3; }.tabs { display: flex; height: 66px; align-items: stretch; gap: 4px; }.tabs button { position: relative; display: flex; align-items: center; gap: 6px; border: 0; padding: 0 12px; background: transparent; color: #667289; font-size: 13px; font-weight: 700; cursor: pointer; }.tabs button::after { position: absolute; right: 10px; bottom: 0; left: 10px; height: 2px; border-radius: 4px; background: transparent; content: ""; }.tabs button.active { color: #1769ff; }.tabs button.active::after { background: #1769ff; }.tabs button span { min-width: 18px; border-radius: 8px; padding: 2px 5px; background: #f0f3f7; color: #758095; font-size: 12px; }.tabs button.active span { background: #e8f0ff; color: #1769ff; }
.search { display: flex; width: min(220px, 32%); height: 36px; align-items: center; gap: 8px; border: 1px solid #dce3ed; border-radius: 8px; padding: 0 10px; color: #8994a7; }.search:focus-within { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 8%); }.search input { min-width: 0; flex: 1; border: 0; outline: 0; color: #344054; font: inherit; font-size: 12px; }
.table-wrap { overflow-x: auto; }table { width: 100%; border-collapse: collapse; }th { height: 40px; background: #fafbfd; color: #8993a5; font-size: 12px; font-weight: 700; text-align: left; white-space: nowrap; }th,td { padding: 0 16px; }td { height: 66px; border-top: 1px solid #edf0f4; color: #5e6a7f; font-size: 12px; white-space: nowrap; }.user-cell { display: flex; align-items: center; gap: 10px; }.user-cell > div { display: flex; flex-direction: column; }.user-cell strong { color: #2b374b; font-size: 13px; }.user-cell small { margin-top: 4px; color: #8590a2; font-size: 12px; }.avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 50%; font-size: 13px; font-weight: 800; }.avatar--student { background: #dcf4e9; color: #157653; }.avatar--interviewer { background: #ffead3; color: #a85c11; }.avatar--hr { background: #eadffd; color: #6940ad; }
.role-badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 7px; padding: 5px 8px; font-size: 12px; font-weight: 750; }.role-badge--student { background: #edf9f4; color: #157653; }.role-badge--interviewer { background: #fff5e9; color: #a85c11; }.role-badge--hr { background: #f4effd; color: #6940ad; }.status { display: inline-flex; align-items: center; gap: 6px; }.status i { width: 6px; height: 6px; border-radius: 50%; }.status--active i { background: #20aa70; box-shadow: 0 0 0 3px #e5f7ef; }.status--invited { color: #aa6b1c; }.status--invited i { background: #efa83f; box-shadow: 0 0 0 3px #fff3df; }.more-button { display: grid; width: 30px; height: 30px; place-items: center; border: 0; border-radius: 7px; background: transparent; color: #788499; cursor: pointer; }.more-button:hover { background: #f1f4f8; }
.empty { display: flex; min-height: 230px; flex-direction: column; align-items: center; justify-content: center; }.empty > span { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 11px; background: #f1f4f8; color: #7e8a9e; }.empty strong { margin-top: 12px; font-size: 13px; }.empty p { margin: 4px 0 0; color: #8994a7; font-size: 12px; }.panel-footer { padding: 12px 17px; border-top: 1px solid #e8edf3; color: #8791a3; font-size: 12px; }
.toast { position: fixed; z-index: 70; top: 24px; left: 50%; display: flex; align-items: center; gap: 9px; transform: translateX(-50%); border: 1px solid #dce5f2; border-radius: 10px; padding: 11px 16px; background: #fff; box-shadow: 0 10px 30px rgb(24 37 65 / 16%); color: #293750; font-size: 13px; font-weight: 700; }.toast span { display: grid; width: 21px; height: 21px; place-items: center; border-radius: 50%; background: #e6f7ee; color: #18955a; }.toast-enter-active,.toast-leave-active { transition: opacity .2s, transform .2s; }.toast-enter-from,.toast-leave-to { opacity: 0; transform: translate(-50%, -7px); }
@media (max-width: 950px) { .summary-grid { grid-template-columns: 1fr 1fr; }.permission-note div { display: block; }.permission-note p { margin-top: 3px; }.panel-tools { align-items: stretch; flex-direction: column; padding: 0 14px 13px; }.tabs { height: 55px; overflow-x: auto; }.search { width: 100%; }.table-wrap { overflow-x: auto; }table { min-width: 760px; } }
@media (max-width: 560px) { .users-page { padding: 84px 15px 35px; }.page-header { align-items: stretch; flex-direction: column; }.add-button { justify-content: center; }.permission-note { align-items: flex-start; }.summary-grid { grid-template-columns: 1fr 1fr; }.summary-grid article { padding: 11px; }.summary-icon { width: 33px; height: 33px; }.summary-grid strong { font-size: 17px; } }
</style>
