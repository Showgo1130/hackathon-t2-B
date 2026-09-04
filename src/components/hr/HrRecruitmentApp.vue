<script setup>
import { computed, inject, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { clearSession, session as authSession } from "../../session.js"
import socketManager from "../../socketManager.js"
import HrCreateUserDialog from "./HrCreateUserDialog.vue"
import HrIcon from "./ui/HrIcon.vue"

const route = useRoute()
const router = useRouter()
const session = inject("session")
const mobileMenuOpen = ref(false)

const navItems = [
  { label: "ダッシュボード", icon: "dashboard", route: "hr-dashboard" },
  { label: "チャット", icon: "chat", route: "hr-chat" },
  { label: "日程調整を作成", icon: "calendar", route: "hr-schedule-create" },
]

const displayName = computed(() => session?.value?.name || "人事")
const activeRoute = (name) => name === "hr-chat"
  ? route.name === "hr-chat" || route.name === "hr-chat-room"
  : route.name === name

// ---- ユーザー作成 ----
// どの画面からでも呼べるよう、ダッシュボードではなくメニューに置く
const createDialogOpen = ref(false)
const isCreating = ref(false)
const createError = ref("")
const toast = ref("")

const openCreateDialog = () => {
  mobileMenuOpen.value = false
  createError.value = ""
  createDialogOpen.value = true
}

const createUser = async (user) => {
  isCreating.value = true
  createError.value = ""
  try {
    const response = await fetch("/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authSession.value?.token ?? ""}`,
      },
      body: JSON.stringify({
        role: user.role,
        name: user.name,
        email: user.email,
        password: user.password,
      }),
    })

    const result = await response.json()
    if (!response.ok) {
      createError.value = result.error === "email_already_exists"
        ? "このメールアドレスは、選択したユーザー種別ですでに登録されています。"
        : result.error === "forbidden"
          ? "ユーザーを作成する権限がありません。"
          : "ユーザーの作成に失敗しました。入力内容を確認してください。"
      return
    }

    createDialogOpen.value = false
    toast.value = `${result.name}さんの${user.roleLabel}アカウントを作成しました`
    window.setTimeout(() => { toast.value = "" }, 2800)
    // 学生や面接官を作った場合は、開いている画面の一覧に反映する
    try { socketManager.getInstance().emit("loadDashboard") } catch { /* 未接続なら次の読み込みで反映される */ }
  } catch {
    createError.value = "サーバーに接続できませんでした。しばらくしてから再度お試しください。"
  } finally {
    isCreating.value = false
  }
}

const logout = () => {
  clearSession()
  socketManager.disconnect()
  router.push({ name: "login" })
}
</script>

<template>
  <div class="hr-app">
    <aside class="sidebar" :class="{ 'sidebar--open': mobileMenuOpen }">
      <div class="brand">
        <span class="brand__mark"><HrIcon name="calendar" :size="25" :stroke-width="2" /></span>
        <div><strong>ミツカル採用</strong><small>採用管理</small></div>
      </div>

      <nav class="main-nav" aria-label="人事メニュー">
        <RouterLink
          v-for="item in navItems"
          :key="item.route"
          :to="{ name: item.route }"
          :class="{ active: activeRoute(item.route) }"
          @click="mobileMenuOpen = false"
        >
          <HrIcon :name="item.icon" :size="19" />
          <span>{{ item.label }}</span>
        </RouterLink>

        <button class="nav-action" type="button" @click="openCreateDialog">
          <HrIcon name="user-plus" :size="19" />
          <span>ユーザーを作成</span>
        </button>
      </nav>

      <div class="account-area">
        <!-- 押しても何も起きないので、ボタンではなく表示だけの枠にする -->
        <div class="account">
          <span class="avatar avatar--hr">{{ displayName.slice(0, 1) }}</span>
          <span class="account__copy"><strong>{{ displayName }}</strong><small>人事アカウント</small></span>
        </div>
        <button class="logout" type="button" @click="logout">
          <HrIcon name="logout" :size="18" /><span>ログアウト</span>
        </button>
      </div>
    </aside>

    <button class="mobile-menu" type="button" aria-label="メニューを開く" @click="mobileMenuOpen = !mobileMenuOpen">
      <span></span><span></span><span></span>
    </button>

    <main class="workspace">
      <RouterView />
    </main>

    <HrCreateUserDialog
      :open="createDialogOpen"
      :submitting="isCreating"
      :server-error="createError"
      @close="createDialogOpen = false"
      @create="createUser"
    />

    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </div>
</template>

<style scoped>
.hr-app {
  position: fixed;
  z-index: 1;
  inset: 0;
  display: grid;
  grid-template-columns: 226px minmax(0, 1fr);
  overflow: hidden;
  background: #f7f9fc;
  color: #1a2235;
  font-family: Inter, "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
}
.hr-app, .hr-app * { box-sizing: border-box; }

.sidebar { display: flex; min-width: 0; flex-direction: column; border-right: 1px solid #e4e9f1; background: #fff; }
.brand { display: flex; height: 88px; align-items: center; gap: 13px; padding: 0 26px; }
.brand__mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 10px; background: #1769ff; color: #fff; box-shadow: 0 6px 14px rgb(23 105 255 / 25%); }
.brand div { display: flex; flex-direction: column; }
.brand strong { font-size: 19px; letter-spacing: -.02em; }.brand small { margin-top: 2px; color: #69758b; font-size: 12px; font-weight: 700; }
.main-nav { display: flex; flex-direction: column; gap: 8px; padding: 16px 14px; }
.main-nav a { display: flex; min-height: 45px; align-items: center; gap: 14px; border-radius: 9px; padding: 0 15px; color: #42506a; font-size: 15px; font-weight: 650; text-decoration: none; transition: background .18s, color .18s, transform .18s; }
.main-nav a:hover { background: #f5f7fb; transform: translateX(2px); }.main-nav a.active { background: linear-gradient(90deg, #edf3ff, #f3f7ff); color: #1769ff; }
/* メニューの3項目の下に置く。移動ではなくその場で開くので、リンクと同じ形にはしない */
.nav-action {
  display: flex; width: 100%; min-height: 45px; align-items: center; gap: 14px;
  border: 0; border-radius: 9px; margin-top: 10px; padding: 0 15px;
  background: #1769ff; box-shadow: 0 7px 16px rgb(23 105 255 / 23%);
  color: #fff; font: inherit; font-size: 15px; font-weight: 750;
  cursor: pointer; transition: background .18s, box-shadow .18s;
}
.nav-action:hover { background: #0758ed; box-shadow: 0 9px 20px rgb(23 105 255 / 30%); }
.nav-action:focus-visible { outline: 3px solid rgb(23 105 255 / 35%); outline-offset: 2px; }

.toast {
  position: fixed; z-index: 40; bottom: 24px; left: 50%;
  border-radius: 10px; padding: 11px 18px;
  background: #1a2235; color: #fff; font-size: 13px; font-weight: 650;
  box-shadow: 0 10px 28px rgb(20 30 55 / 28%); transform: translateX(-50%);
}

.account-area { display: flex; flex-direction: column; gap: 10px; margin-top: auto; padding: 14px; }
.account,.logout { display: flex; width: 100%; align-items: center; border: 1px solid #dee4ed; border-radius: 9px; background: #fff; color: #2c3850; }
.logout { cursor: pointer; }
/* 操作できる場所と見分けがつくよう、枠内の情報表示として静かに置く */
.account { gap: 10px; border-color: #eaeef5; padding: 10px; background: #f7f9fc; cursor: default; text-align: left; }.account__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.account__copy strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }.account__copy small { margin-top: 3px; color: #69758b; font-size: 12px; }
.avatar { display: grid; flex: 0 0 auto; width: 34px; height: 34px; place-items: center; border-radius: 50%; font-size: 13px; font-weight: 750; }.avatar--hr { background: linear-gradient(145deg, #f7d2c4, #754637); color: #fff; }
.logout { min-height: 43px; gap: 12px; padding: 0 13px; font-size: 14px; font-weight: 650; }.logout:hover { border-color: #f0b9b9; background: #fff7f7; color: #c03737; }
.workspace { min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
.mobile-menu { display: none; }

@media (max-width: 820px) {
  .hr-app { grid-template-columns: 72px minmax(0, 1fr); }
  .brand { justify-content: center; padding: 0; }.brand > div,.main-nav a span,.nav-action span,.account__copy,.logout span { display: none; }
  .main-nav { padding: 14px 10px; }.main-nav a,.nav-action { justify-content: center; padding: 0; }.account-area { padding: 10px; }.account { justify-content: center; padding: 8px; }.logout { justify-content: center; padding: 0; }
}
@media (max-width: 560px) {
  .hr-app { display: block; }
  .sidebar { position: fixed; z-index: 30; inset: 0 auto 0 0; width: 226px; transform: translateX(-100%); box-shadow: 14px 0 35px rgb(21 34 60 / 18%); transition: transform .22s ease; }.sidebar--open { transform: translateX(0); }
  .brand { justify-content: flex-start; padding: 0 26px; }.brand > div,.main-nav a span,.nav-action span,.account__copy,.logout span { display: flex; }.main-nav a,.nav-action { justify-content: flex-start; padding: 0 15px; }.account { justify-content: flex-start; padding: 10px; }.logout { justify-content: flex-start; padding: 0 13px; }
  .mobile-menu { position: fixed; z-index: 25; top: 19px; left: 15px; display: flex; width: 38px; height: 38px; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px solid #e0e6ef; border-radius: 9px; background: #fff; box-shadow: 0 4px 12px rgb(20 38 75 / 8%); }.mobile-menu span { width: 16px; height: 1.5px; border-radius: 2px; background: #28364e; }
}
</style>
