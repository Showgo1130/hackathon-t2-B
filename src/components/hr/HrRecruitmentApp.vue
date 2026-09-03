<script setup>
import { computed, inject, ref } from "vue"
import { useRoute, useRouter } from "vue-router"
import { clearSession } from "../../session.js"
import socketManager from "../../socketManager.js"
import HrIcon from "./ui/HrIcon.vue"

const route = useRoute()
const router = useRouter()
const session = inject("session")
const mobileMenuOpen = ref(false)

const navItems = [
  { label: "ダッシュボード", icon: "dashboard", route: "hr-dashboard" },
  { label: "チャット", icon: "chat", route: "hr-chat" },
  { label: "日程調整を作成", icon: "calendar", route: "hr-schedule-create" },
  { label: "ユーザー管理", icon: "user-plus", route: "hr-users" },
]

const displayName = computed(() => session?.value?.name || "人事")
const activeRoute = (name) => name === "hr-chat"
  ? route.name === "hr-chat" || route.name === "hr-chat-room"
  : route.name === name

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
        <div><strong>Hiresch</strong><small>採用管理</small></div>
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
      </nav>

      <div class="account-area">
        <button class="account" type="button">
          <span class="avatar avatar--hr">{{ displayName.slice(0, 1) }}</span>
          <span class="account__copy"><strong>{{ displayName }}</strong><small>人事アカウント</small></span>
          <HrIcon name="chevron-down" :size="16" />
        </button>
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
.brand strong { font-size: 19px; letter-spacing: -.02em; }.brand small { margin-top: 2px; color: #69758b; font-size: 9px; font-weight: 700; }
.main-nav { display: flex; flex-direction: column; gap: 8px; padding: 16px 14px; }
.main-nav a { display: flex; min-height: 45px; align-items: center; gap: 14px; border-radius: 9px; padding: 0 15px; color: #42506a; font-size: 13px; font-weight: 650; text-decoration: none; transition: background .18s, color .18s, transform .18s; }
.main-nav a:hover { background: #f5f7fb; transform: translateX(2px); }.main-nav a.active { background: linear-gradient(90deg, #edf3ff, #f3f7ff); color: #1769ff; }
.account-area { display: flex; flex-direction: column; gap: 10px; margin-top: auto; padding: 14px; }
.account,.logout { display: flex; width: 100%; align-items: center; border: 1px solid #dee4ed; border-radius: 9px; background: #fff; color: #2c3850; cursor: pointer; }
.account { gap: 10px; padding: 10px; text-align: left; }.account__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.account__copy strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.account__copy small { margin-top: 3px; color: #69758b; font-size: 8px; }
.avatar { display: grid; flex: 0 0 auto; width: 34px; height: 34px; place-items: center; border-radius: 50%; font-size: 11px; font-weight: 750; }.avatar--hr { background: linear-gradient(145deg, #f7d2c4, #754637); color: #fff; }
.logout { min-height: 43px; gap: 12px; padding: 0 13px; font-size: 12px; font-weight: 650; }.logout:hover { border-color: #f0b9b9; background: #fff7f7; color: #c03737; }
.workspace { min-width: 0; min-height: 0; overflow: hidden; background: #fff; }
.mobile-menu { display: none; }

@media (max-width: 820px) {
  .hr-app { grid-template-columns: 72px minmax(0, 1fr); }
  .brand { justify-content: center; padding: 0; }.brand > div,.main-nav a span,.account__copy,.account > svg,.logout span { display: none; }
  .main-nav { padding: 14px 10px; }.main-nav a { justify-content: center; padding: 0; }.account-area { padding: 10px; }.account { justify-content: center; padding: 8px; }.logout { justify-content: center; padding: 0; }
}
@media (max-width: 560px) {
  .hr-app { display: block; }
  .sidebar { position: fixed; z-index: 30; inset: 0 auto 0 0; width: 226px; transform: translateX(-100%); box-shadow: 14px 0 35px rgb(21 34 60 / 18%); transition: transform .22s ease; }.sidebar--open { transform: translateX(0); }
  .brand { justify-content: flex-start; padding: 0 26px; }.brand > div,.main-nav a span,.account__copy,.account > svg,.logout span { display: flex; }.main-nav a { justify-content: flex-start; padding: 0 15px; }.account { justify-content: flex-start; padding: 10px; }.logout { justify-content: flex-start; padding: 0 13px; }
  .mobile-menu { position: fixed; z-index: 25; top: 19px; left: 15px; display: flex; width: 38px; height: 38px; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px solid #e0e6ef; border-radius: 9px; background: #fff; box-shadow: 0 4px 12px rgb(20 38 75 / 8%); }.mobile-menu span { width: 16px; height: 1.5px; border-radius: 2px; background: #28364e; }
}
</style>
