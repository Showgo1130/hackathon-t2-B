<script setup>
import { provide } from "vue"
import { session } from "./session.js"
import socketManager from "./socketManager.js"

provide("session", session)

// 各画面は setup の時点で接続済みのソケットを要求するため、
// onMounted（子より後に走る）ではなくここで接続する。
// これをしないと /hr や /interviewer を直接開いた・リロードしたときに画面が描画されない
if (session.value?.token) {
  socketManager.connect(session.value.token)
}
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<style scoped>
</style>
