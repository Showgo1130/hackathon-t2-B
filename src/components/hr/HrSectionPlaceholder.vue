<script setup>
import { computed } from "vue"
import { useRoute } from "vue-router"
import HrIcon from "./ui/HrIcon.vue"

const route = useRoute()
const content = computed(() => ({
  "hr-sent": { title: "送信済み", description: "候補者へ送信した日程調整を確認できます。", icon: "calendar" },
  "hr-candidates": { title: "候補者一覧", description: "選考中の候補者と現在のステータスを管理します。", icon: "users" },
  "hr-interviewers": { title: "面接官一覧", description: "面接官の担当情報と予定を確認できます。", icon: "briefcase" },
  "hr-settings": { title: "設定", description: "採用チームと通知に関する設定を管理します。", icon: "settings" },
}[route.name] || { title: "採用管理", description: "", icon: "calendar" }))
</script>

<template>
  <div class="section-page">
    <header><div><h1>{{ content.title }}</h1><p>{{ content.description }}</p></div></header>
    <section class="empty-state"><span><HrIcon :name="content.icon" :size="28" /></span><h2>{{ content.title }}</h2><p>このページは画面構成に合わせたルートとして用意されています。</p><RouterLink :to="{ name: 'hr-chat' }">チャットへ戻る</RouterLink></section>
  </div>
</template>

<style scoped>
.section-page { min-height: 100%; padding: 38px clamp(24px, 5vw, 70px); background: #f8fafd; }.section-page header { padding-bottom: 26px; border-bottom: 1px solid #e4e9f1; }.section-page h1 { margin: 0; color: #1d2939; font-size: 24px; }.section-page header p { margin: 8px 0 0; color: #667085; font-size: 13px; }.empty-state { display: flex; max-width: 520px; min-height: 330px; flex-direction: column; align-items: center; justify-content: center; margin: 56px auto; border: 1px dashed #d5deec; border-radius: 18px; background: #fff; text-align: center; }.empty-state > span { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 15px; background: #edf3ff; color: #1769ff; }.empty-state h2 { margin: 18px 0 5px; font-size: 17px; }.empty-state p { margin: 0; color: #7b8699; font-size: 12px; }.empty-state a { margin-top: 22px; border-radius: 8px; padding: 10px 17px; background: #1769ff; color: #fff; font-size: 12px; font-weight: 700; text-decoration: none; }
</style>
