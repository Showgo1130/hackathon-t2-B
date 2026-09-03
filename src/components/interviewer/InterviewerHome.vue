<script setup>
import { inject, ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../../socketManager.js"
import { clearSession } from "../../session.js"
import InterviewerCalendar from "./InterviewerCalendar.vue"
import InterviewerChat from "./InterviewerChat.vue"
import InterviewerSchedule from "./InterviewerSchedule.vue"

const session = inject("session")
const router = useRouter()
const tab = ref("chat")

const logout = () => {
  clearSession()
  socketManager.disconnect()
  router.push({ name: "login" })
}
</script>

<template>
  <div class="mx-auto my-5 px-4" style="max-width: 900px">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h5 font-weight-medium">{{ session?.name }} さん（面接官）</h1>
      <v-btn variant="text" @click="logout">ログアウト</v-btn>
    </div>

    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="chat">通知・チャット</v-tab>
      <v-tab value="calendar">空き予定登録</v-tab>
      <v-tab value="schedule">予定一覧</v-tab>
    </v-tabs>

    <InterviewerChat v-if="tab === 'chat'" />
    <InterviewerCalendar v-else-if="tab === 'calendar'" />
    <InterviewerSchedule v-else />
  </div>
</template>

<style scoped>
</style>
