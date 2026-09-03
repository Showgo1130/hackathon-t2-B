<script setup>
import { provide } from "vue"
import { useRouter } from "vue-router"
import { clearSession, session } from "./session.js"
import socketManager from "./socketManager.js"

provide("session", session)

const router = useRouter()

// 各画面は setup の時点で接続済みのソケットを要求するため、
// onMounted（子より後に走る）ではなくここで接続する。
// これをしないと /hr や /interviewer を直接開いた・リロードしたときに画面が描画されない
if (session.value?.token) {
  let socket
  // ログイン直後に張った接続がある場合は、それを切らずに使い回す
  try { socket = socketManager.getInstance() }
  catch { socket = socketManager.connect(session.value.token) }

  // 接続を拒否されると各画面が「読み込み中...」のまま止まってしまう。
  // トークンの期限切れが主な原因なので、セッションを捨ててログインに戻す
  socket.on("connect_error", () => {
    if (socket.active) return // 一時的な切断。socket.io が自動で再接続する
    clearSession()
    socketManager.disconnect()
    router.push({ name: "login" })
  })
}
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<style scoped>
</style>
