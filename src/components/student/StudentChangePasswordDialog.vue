<script setup>
import { computed, inject, ref, watch } from "vue"
import HrIcon from "../hr/ui/HrIcon.vue"

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue", "changed"])

const session = inject("session")
const currentPassword = ref("")
const newPassword = ref("")
const confirmPassword = ref("")
const currentPasswordVisible = ref(false)
const newPasswordVisible = ref(false)
const confirmPasswordVisible = ref(false)
const errorMessage = ref("")
const isSubmitting = ref(false)

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
})
const canSubmit = computed(() =>
  currentPassword.value.length > 0 &&
  newPassword.value.length >= 8 &&
  confirmPassword.value === newPassword.value &&
  !isSubmitting.value
)

const reset = () => {
  currentPassword.value = ""
  newPassword.value = ""
  confirmPassword.value = ""
  currentPasswordVisible.value = false
  newPasswordVisible.value = false
  confirmPasswordVisible.value = false
  errorMessage.value = ""
  isSubmitting.value = false
}

watch(() => props.modelValue, (value) => {
  if (!value) reset()
})

const close = () => {
  if (!isSubmitting.value) isOpen.value = false
}

const submit = async () => {
  errorMessage.value = ""
  if (newPassword.value.length < 8) {
    errorMessage.value = "新しいパスワードは8文字以上で入力してください"
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = "新しいパスワードが確認入力と一致しません"
    return
  }
  if (currentPassword.value === newPassword.value) {
    errorMessage.value = "現在とは異なるパスワードを設定してください"
    return
  }

  isSubmitting.value = true
  try {
    const token = session?.value?.token ?? session?.token ?? ""
    const response = await fetch("/api/student/password", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (data.error === "invalid_current_password") {
        errorMessage.value = "現在のパスワードが正しくありません"
      } else if (data.error === "password_unchanged") {
        errorMessage.value = "現在とは異なるパスワードを設定してください"
      } else {
        errorMessage.value = "パスワードを変更できませんでした。しばらくしてから再度お試しください"
      }
      return
    }

    emit("changed")
    isOpen.value = false
  } catch {
    errorMessage.value = "パスワードを変更できませんでした。通信環境をご確認ください"
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <v-dialog v-model="isOpen" max-width="480" persistent>
    <v-card class="password-dialog">
      <v-card-title class="password-dialog__title">パスワード変更</v-card-title>
      <v-card-subtitle class="password-dialog__subtitle">
        人事担当者から発行された初期パスワードを変更できます。
      </v-card-subtitle>

      <v-card-text class="password-dialog__body">
        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="currentPassword"
            label="現在のパスワード"
            :type="currentPasswordVisible ? 'text' : 'password'"
            autocomplete="current-password"
            variant="outlined"
            density="comfortable"
          >
            <template #append-inner>
              <button
                type="button"
                class="visibility-button"
                :aria-label="currentPasswordVisible ? '現在のパスワードを隠す' : '現在のパスワードを表示'"
                @click="currentPasswordVisible = !currentPasswordVisible"
              >
                <HrIcon name="eye" :size="18" />
              </button>
            </template>
          </v-text-field>
          <v-text-field
            v-model="newPassword"
            label="新しいパスワード"
            :type="newPasswordVisible ? 'text' : 'password'"
            autocomplete="new-password"
            variant="outlined"
            density="comfortable"
            hint="8文字以上で入力してください"
            persistent-hint
          >
            <template #append-inner>
              <button
                type="button"
                class="visibility-button"
                :aria-label="newPasswordVisible ? '新しいパスワードを隠す' : '新しいパスワードを表示'"
                @click="newPasswordVisible = !newPasswordVisible"
              >
                <HrIcon name="eye" :size="18" />
              </button>
            </template>
          </v-text-field>
          <v-text-field
            v-model="confirmPassword"
            label="新しいパスワード（確認）"
            :type="confirmPasswordVisible ? 'text' : 'password'"
            autocomplete="new-password"
            variant="outlined"
            density="comfortable"
            :error-messages="confirmPassword && confirmPassword !== newPassword ? '新しいパスワードが一致しません' : ''"
          >
            <template #append-inner>
              <button
                type="button"
                class="visibility-button"
                :aria-label="confirmPasswordVisible ? '確認用パスワードを隠す' : '確認用パスワードを表示'"
                @click="confirmPasswordVisible = !confirmPasswordVisible"
              >
                <HrIcon name="eye" :size="18" />
              </button>
            </template>
          </v-text-field>
          <v-alert v-if="errorMessage" type="error" density="compact" class="mt-1">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions class="password-dialog__actions">
        <v-btn variant="text" :disabled="isSubmitting" @click="close">キャンセル</v-btn>
        <v-btn color="primary" variant="flat" :loading="isSubmitting" :disabled="!canSubmit" @click="submit">
          変更する
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.password-dialog { border-radius: 14px; }
.password-dialog__title { padding: 24px 24px 6px; color: #1a2235; font-size: 19px; font-weight: 750; }
.password-dialog__subtitle { padding: 0 24px; color: #69758b; line-height: 1.6; white-space: normal; }
.password-dialog__body { padding: 22px 24px 8px; }
.password-dialog__actions { gap: 8px; justify-content: flex-end; padding: 12px 24px 22px; }
.visibility-button { display: grid; border: 0; padding: 4px; background: transparent; color: #69758b; cursor: pointer; place-items: center; }
</style>
