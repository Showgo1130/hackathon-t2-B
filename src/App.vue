<script setup>
import { onMounted, provide } from "vue"
import { session } from "./session.js"
import socketManager from "./socketManager.js"

provide("session", session)

onMounted(() => {
  if (session.value?.token) {
    try { socketManager.getInstance() }
    catch { socketManager.connect(session.value.token) }
  }
})
</script>

<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<style scoped>
</style>
