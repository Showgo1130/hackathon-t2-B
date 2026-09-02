<script setup>
import { ref } from "vue"
import { useRouter } from "vue-router"
import socketManager from "../socketManager.js"
import { setSession } from "../session.js"

const ROLE_TABS = [
  { value: "student", label: "学生" },
  { value: "hr", label: "人事" },
  { value: "interviewer", label: "面接官" },
]

const router = useRouter()

const role = ref("student")
const email = ref("")
const password = ref("")
const errorMessage = ref("")
const isSubmitting = ref(false)

const onSubmit = async () => {
  errorMessage.value = ""
  if (!email.value || !password.value) {
    errorMessage.value = "メールアドレスとパスワードを入力してください"
    return
  }

  isSubmitting.value = true
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: role.value, email: email.value, password: password.value }),
    })
    if (!res.ok) {
      errorMessage.value = "メールアドレスまたはパスワードが正しくありません"
      return
    }
    const data = await res.json()
    setSession(data)
    socketManager.connect(data.token)
    router.push({ name: role.value })
  } catch {
    errorMessage.value = "ログインに失敗しました。しばらくしてから再度お試しください"
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="login-container mx-auto my-10 px-4" style="max-width: 420px">
    <h1 class="text-h4 font-weight-medium mb-6">面接日程調整アプリ</h1>
    <v-card class="pa-6">
      <v-tabs v-model="role" color="primary" grow>
        <v-tab v-for="tab in ROLE_TABS" :key="tab.value" :value="tab.value">{{ tab.label }}</v-tab>
      </v-tabs>
      <v-form class="mt-6" @submit.prevent="onSubmit">
        <v-text-field v-model="email" label="メールアドレス" type="email" autocomplete="username" />
        <v-text-field v-model="password" label="パスワード" type="password" autocomplete="current-password" />
        <v-alert v-if="errorMessage" type="error" density="compact" class="mb-4">{{ errorMessage }}</v-alert>
        <v-btn type="submit" color="primary" block :loading="isSubmitting">ログイン</v-btn>
      </v-form>
    </v-card>
  </div>
</template>

<style scoped>
</style>
