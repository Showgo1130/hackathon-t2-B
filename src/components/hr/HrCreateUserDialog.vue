<script setup>
import { computed, reactive, ref, watch } from "vue"
import HrIcon from "./ui/HrIcon.vue"

const props = defineProps({
  open: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  serverError: { type: String, default: "" },
})
const emit = defineEmits(["close", "create"])

const roles = [
  { value: "student", label: "学生", description: "候補日時の選択・チャット", icon: "student" },
  { value: "interviewer", label: "面接官", description: "空き予定の登録・回答", icon: "briefcase" },
  { value: "hr", label: "人事", description: "採用管理・ユーザー作成", icon: "shield" },
]

const form = reactive({ role: "student", name: "", email: "", password: "" })
const submitted = ref(false)
const passwordVisible = ref(false)

const roleLabel = computed(() => roles.find((role) => role.value === form.role)?.label || "")
const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
const canSubmit = computed(() => form.name.trim() && emailValid.value && form.password.length >= 8)

const generatePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"
  const values = new Uint32Array(12)
  window.crypto.getRandomValues(values)
  form.password = Array.from(values, (value) => chars[value % chars.length]).join("")
}

const reset = () => {
  Object.assign(form, { role: "student", name: "", email: "", password: "" })
  submitted.value = false
  passwordVisible.value = false
  generatePassword()
}

watch(() => props.open, (open) => { if (open) reset() })

const submit = () => {
  submitted.value = true
  if (!canSubmit.value) return
  emit("create", {
    role: form.role,
    roleLabel: roleLabel.value,
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    password: form.password,
  })
}
</script>

<template>
  <Transition name="dialog">
    <div v-if="open" class="dialog-layer" @mousedown.self="emit('close')">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
        <header class="dialog__header">
          <div class="dialog__title-icon"><HrIcon name="user-plus" :size="21" /></div>
          <div><h2 id="create-user-title">ユーザーを新規作成</h2><p>ログインに必要な情報と権限を設定します</p></div>
          <button type="button" aria-label="閉じる" @click="emit('close')"><HrIcon name="close" /></button>
        </header>

        <form class="dialog__body" @submit.prevent="submit">
          <fieldset>
            <legend>ユーザー種別 <span>必須</span></legend>
            <div class="role-grid">
              <label v-for="role in roles" :key="role.value" :class="{ selected: form.role === role.value }">
                <input v-model="form.role" type="radio" name="role" :value="role.value" />
                <span class="role-icon"><HrIcon :name="role.icon" :size="20" /></span>
                <span><strong>{{ role.label }}</strong><small>{{ role.description }}</small></span>
                <i><HrIcon name="check" :size="13" /></i>
              </label>
            </div>
          </fieldset>

          <label class="field">
            <span>氏名 <i>必須</i></span>
            <input v-model="form.name" type="text" autocomplete="off" placeholder="氏名を入力" />
            <small v-if="submitted && !form.name.trim()" class="error">氏名を入力してください</small>
          </label>

          <label class="field">
            <span>メールアドレス <i>必須</i></span>
            <div class="input-with-icon"><HrIcon name="mail" :size="18" /><input v-model="form.email" type="email" autocomplete="off" placeholder="user@example.com" /></div>
            <small v-if="submitted && !emailValid" class="error">正しいメールアドレスを入力してください</small>
            <small v-else>このメールアドレスがログインIDになります</small>
          </label>

          <label class="field">
            <span>初期パスワード <i>必須</i></span>
            <div class="password-input">
              <HrIcon name="key" :size="18" />
              <input v-model="form.password" :type="passwordVisible ? 'text' : 'password'" autocomplete="new-password" />
              <button type="button" :aria-label="passwordVisible ? 'パスワードを隠す' : 'パスワードを表示'" @click="passwordVisible = !passwordVisible"><HrIcon name="eye" :size="18" /></button>
              <button class="regenerate" type="button" @click="generatePassword"><HrIcon name="refresh" :size="15" />再生成</button>
            </div>
            <small :class="{ error: submitted && form.password.length < 8 }">8文字以上で設定してください</small>
          </label>

          <p v-if="serverError" class="server-error">{{ serverError }}</p>
        </form>

        <footer class="dialog__footer">
          <button class="cancel-button" type="button" @click="emit('close')">キャンセル</button>
          <button class="create-button" type="button" :disabled="submitting || (submitted && !canSubmit)" @click="submit"><HrIcon name="user-plus" :size="17" />{{ submitting ? "作成中..." : `${roleLabel}アカウントを作成` }}</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-layer { position: fixed; z-index: 60; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(16 28 51 / 48%); backdrop-filter: blur(3px); }
.dialog { display: flex; width: min(680px, 100%); max-height: calc(100vh - 48px); flex-direction: column; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 17px; background: #fff; box-shadow: 0 26px 80px rgb(23 35 60 / 25%); }
.dialog__header { display: grid; grid-template-columns: 44px 1fr 38px; align-items: center; gap: 12px; padding: 20px 24px; border-bottom: 1px solid #e8edf4; }.dialog__title-icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 11px; background: #edf3ff; color: #1769ff; }.dialog__header h2 { margin: 0; color: #172033; font-size: 17px; }.dialog__header p { margin: 4px 0 0; color: #78849a; font-size: 10px; }.dialog__header > button { display: grid; width: 36px; height: 36px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: #47556d; cursor: pointer; }.dialog__header > button:hover { background: #f2f5f9; }
.dialog__body { overflow-y: auto; padding: 24px; }.dialog__body fieldset { margin: 0 0 22px; border: 0; padding: 0; }.dialog__body legend,.field > span { margin-bottom: 9px; color: #344054; font-size: 11px; font-style: normal; font-weight: 750; }.dialog__body legend span,.field > span i { color: #1769ff; font-size: 9px; font-style: normal; }
.role-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }.role-grid label { position: relative; display: flex; min-width: 0; align-items: center; gap: 9px; border: 1px solid #dce3ed; border-radius: 10px; padding: 12px; cursor: pointer; transition: border .18s, background .18s; }.role-grid label:hover { border-color: #a8c2f5; }.role-grid label.selected { border-color: #1769ff; background: #f4f7ff; box-shadow: 0 0 0 2px rgb(23 105 255 / 7%); }.role-grid input { position: absolute; opacity: 0; }.role-icon { display: grid; flex: 0 0 auto; width: 34px; height: 34px; place-items: center; border-radius: 8px; background: #f0f3f8; color: #53617a; }.selected .role-icon { background: #e3edff; color: #1769ff; }.role-grid label > span:nth-child(3) { display: flex; min-width: 0; flex-direction: column; }.role-grid strong { color: #263247; font-size: 11px; }.role-grid small { overflow: hidden; margin-top: 3px; color: #7e899c; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.role-grid i { display: none; width: 18px; height: 18px; margin-left: auto; place-items: center; border-radius: 50%; background: #1769ff; color: #fff; }.role-grid .selected i { display: grid; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.field { display: flex; flex-direction: column; margin-bottom: 18px; }.field input { width: 100%; min-width: 0; height: 43px; border: 1px solid #d6deea; border-radius: 8px; padding: 0 12px; outline: 0; color: #273348; font: inherit; font-size: 11px; }.field input:focus,.input-with-icon:focus-within,.password-input:focus-within { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 9%); }.field > small { margin-top: 6px; color: #8791a3; font-size: 8px; }.field > small.error { color: #d04444; }
.input-with-icon,.password-input { display: flex; align-items: center; border: 1px solid #d6deea; border-radius: 8px; padding-left: 12px; color: #8994a7; }.input-with-icon input,.password-input input { border: 0; box-shadow: none; }.input-with-icon input:focus,.password-input input:focus { box-shadow: none; }.password-input > button { display: grid; height: 34px; place-items: center; border: 0; background: transparent; color: #6c788d; cursor: pointer; }.password-input .regenerate { display: flex; gap: 5px; margin-right: 5px; border-left: 1px solid #e0e5ed; padding: 0 8px; color: #1769ff; font-size: 9px; font-weight: 700; white-space: nowrap; }
.invite-option { display: flex; align-items: flex-start; gap: 9px; border: 1px solid #dce6f7; border-radius: 9px; padding: 13px; background: #f7faff; cursor: pointer; }.invite-option input { position: absolute; opacity: 0; }.checkbox { display: grid; width: 18px; height: 18px; flex: 0 0 auto; place-items: center; border: 1px solid #b8c5d9; border-radius: 5px; background: #fff; color: transparent; }.invite-option input:checked + .checkbox { border-color: #1769ff; background: #1769ff; color: #fff; }.invite-option > span:last-child { display: flex; flex-direction: column; }.invite-option strong { color: #30405a; font-size: 10px; }.invite-option small { margin-top: 3px; color: #7b879a; font-size: 8px; }
.server-error { margin: 12px 0 0; border: 1px solid #f1c9c9; border-radius: 8px; padding: 10px 12px; background: #fff5f5; color: #c43d3d; font-size: 9px; }
.dialog__footer { display: flex; justify-content: flex-end; gap: 10px; padding: 17px 24px; border-top: 1px solid #e8edf4; background: #fbfcfe; }.dialog__footer button { height: 42px; border-radius: 8px; padding: 0 19px; font-size: 11px; font-weight: 750; cursor: pointer; }.cancel-button { border: 1px solid #d6deea; background: #fff; color: #344054; }.create-button { display: flex; align-items: center; gap: 7px; border: 0; background: #1769ff; color: #fff; box-shadow: 0 6px 15px rgb(23 105 255 / 23%); }.create-button:disabled { background: #9ebdf8; cursor: not-allowed; box-shadow: none; }
.dialog-enter-active,.dialog-leave-active { transition: opacity .2s; }.dialog-enter-active .dialog,.dialog-leave-active .dialog { transition: transform .2s; }.dialog-enter-from,.dialog-leave-to { opacity: 0; }.dialog-enter-from .dialog,.dialog-leave-to .dialog { transform: translateY(10px) scale(.985); }
@media (max-width: 650px) { .dialog-layer { padding: 8px; }.dialog { max-height: calc(100vh - 16px); }.role-grid { grid-template-columns: 1fr; }.form-row { grid-template-columns: 1fr; gap: 0; }.dialog__body { padding: 18px; }.dialog__footer { padding: 14px 18px; }.dialog__footer button { flex: 1; padding: 0 9px; }.role-grid small { white-space: normal; } }
</style>
