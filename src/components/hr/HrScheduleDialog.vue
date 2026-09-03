<script setup>
import { computed, ref, watch } from "vue"
import HrIcon from "./ui/HrIcon.vue"

const props = defineProps({
  open: { type: Boolean, default: false },
  candidateName: { type: String, default: "田中 太郎" },
})
const emit = defineEmits(["close", "submit"])

const message = ref("田中さん\n二次面接の日程調整のご案内です。\nご都合の良い日時をカレンダーから選択してください。")
const deadline = ref("2026-09-07T23:59")
const shareWithInterviewers = ref(true)
const interviewerCandidates = [
  { id: 1, name: "鈴木 一郎", department: "開発部" },
  { id: 2, name: "高橋 美咲", department: "事業企画部" },
]
const candidateInitial = computed(() => props.candidateName.slice(0, 1))

watch(() => props.open, (open) => {
  if (open) {
    message.value = `${props.candidateName}さん\n二次面接の日程調整のご案内です。\nご都合の良い日時をカレンダーから選択してください。`
  }
})

const submit = () => {
  if (!message.value.trim()) return
  emit("submit", {
    message: message.value,
    deadline: deadline.value,
    interviewerRecipients: shareWithInterviewers.value ? interviewerCandidates : [],
  })
}
</script>

<template>
  <Transition name="dialog">
    <div v-if="open" class="dialog-layer" role="presentation" @mousedown.self="emit('close')">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title">
        <header class="dialog__header">
          <h2 id="schedule-dialog-title">日程調整を作成</h2>
          <button type="button" aria-label="閉じる" @click="emit('close')"><HrIcon name="close" :size="22" /></button>
        </header>

        <div class="dialog__body">
          <div class="field-group">
            <label>送信先</label>
            <div class="recipient">
              <span class="avatar avatar--candidate">{{ candidateInitial }}</span>
              <div><strong>{{ candidateName }} さん</strong><span>二次面接 調整中</span></div>
              <button type="button">変更</button>
            </div>
          </div>

          <div class="auto-share">
            <label>
              <input v-model="shareWithInterviewers" type="checkbox" />
              <span class="auto-share__check"><HrIcon name="check" :size="12" /></span>
              <span><strong>面接官候補にも同じ内容を自動送信</strong><small>この日程調整に参加する面接官へ同時に案内します</small></span>
              <i>自動</i>
            </label>
            <div v-if="shareWithInterviewers" class="interviewer-recipients">
              <span v-for="interviewer in interviewerCandidates" :key="interviewer.id">
                <b>{{ interviewer.name.slice(0, 1) }}</b>
                <span><strong>{{ interviewer.name }} さん</strong><small>{{ interviewer.department }}・面接官</small></span>
                <HrIcon name="check" :size="13" />
              </span>
            </div>
          </div>

          <div class="field-group">
            <label for="schedule-message">メッセージ（候補者への案内）</label>
            <textarea id="schedule-message" v-model="message" maxlength="500" rows="6" />
            <small>{{ message.length }} / 500</small>
          </div>

          <div class="field-group field-group--deadline">
            <label for="schedule-deadline">提出期限（任意）</label>
            <div class="date-input">
              <input id="schedule-deadline" v-model="deadline" type="datetime-local" />
              <HrIcon name="calendar" :size="19" />
            </div>
          </div>

          <aside class="notice">
            <HrIcon name="info" :size="19" />
            <p>候補者にはカレンダーが表示され、<br />ご都合の良い日時を選択していただきます。<br /><span>※ 人事側で希望日時を設定する必要はありません</span></p>
          </aside>
        </div>

        <footer class="dialog__footer">
          <button class="secondary-button" type="button" @click="emit('close')">キャンセル</button>
          <button class="primary-button" type="button" @click="submit">送信する</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.dialog-layer { position: fixed; z-index: 50; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(14 25 48 / 42%); backdrop-filter: blur(3px); }
.dialog { display: flex; width: min(540px, 100%); max-height: calc(100vh - 48px); flex-direction: column; overflow: hidden; border: 1px solid #e4e8f0; border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgb(31 44 71 / 22%); }
.dialog__header { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; min-height: 72px; padding: 0 20px; border-bottom: 1px solid #e9edf3; }
.dialog__header h2 { grid-column: 2; margin: 0; color: #121827; font-size: 17px; text-align: center; }
.dialog__header button { grid-column: 3; display: grid; width: 38px; height: 38px; place-items: center; border: 0; border-radius: 9px; background: transparent; color: #1d2939; cursor: pointer; }
.dialog__header button:hover { background: #f4f6fa; }
.dialog__body { overflow-y: auto; padding: 26px 28px; }
.field-group { position: relative; margin-bottom: 23px; }
.field-group > label { display: block; margin-bottom: 10px; color: #1d2939; font-size: 12px; font-weight: 700; }
.recipient { display: flex; align-items: center; gap: 11px; padding-bottom: 19px; border-bottom: 1px solid #e9edf3; }
.avatar { display: grid; flex: 0 0 auto; width: 38px; height: 38px; place-items: center; border-radius: 50%; font-size: 12px; font-weight: 750; }
.avatar--candidate { background: linear-gradient(145deg, #fde3cb, #9c6a52); color: #fff; }
.recipient div { display: flex; flex: 1; flex-direction: column; gap: 3px; }
.recipient strong { font-size: 13px; }.recipient span { color: #1769ff; font-size: 10px; }
.recipient button { padding: 8px 14px; border: 1px solid #d9e2f2; border-radius: 8px; background: #fff; color: #1769ff; font-size: 11px; font-weight: 700; cursor: pointer; }
.auto-share { margin: -6px 0 23px; overflow: hidden; border: 1px solid #d7e4fb; border-radius: 10px; background: #f7faff; }.auto-share > label { display: flex; align-items: center; gap: 9px; padding: 12px 13px; cursor: pointer; }.auto-share > label > input { position: absolute; opacity: 0; }.auto-share__check { display: grid; width: 18px; height: 18px; flex: 0 0 auto; place-items: center; border: 1px solid #b8c6da; border-radius: 5px; background: #fff; color: transparent; }.auto-share input:checked + .auto-share__check { border-color: #1769ff; background: #1769ff; color: #fff; }.auto-share label > span:nth-child(3) { display: flex; min-width: 0; flex: 1; flex-direction: column; }.auto-share label strong { color: #29436e; font-size: 10px; }.auto-share label small { margin-top: 3px; color: #77849a; font-size: 8px; }.auto-share label > i { border-radius: 10px; padding: 3px 7px; background: #e4edff; color: #1769ff; font-size: 8px; font-style: normal; font-weight: 800; }.interviewer-recipients { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; padding: 0 12px 12px 39px; }.interviewer-recipients > span { display: flex; min-width: 0; align-items: center; gap: 7px; border: 1px solid #e1e8f3; border-radius: 8px; padding: 7px; background: #fff; }.interviewer-recipients b { display: grid; width: 26px; height: 26px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #fff0dc; color: #a96417; font-size: 8px; }.interviewer-recipients > span > span { display: flex; min-width: 0; flex: 1; flex-direction: column; }.interviewer-recipients > span > svg { flex: 0 0 auto; color: #1a9a65; }.interviewer-recipients strong { overflow: hidden; color: #354158; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.interviewer-recipients small { overflow: hidden; color: #8792a5; font-size: 7px; text-overflow: ellipsis; white-space: nowrap; }
textarea { width: 100%; resize: vertical; border: 1px solid #d6deea; border-radius: 9px; padding: 13px 14px; outline: none; color: #303a4d; font: inherit; font-size: 12px; line-height: 2; transition: border-color .2s, box-shadow .2s; }
textarea:focus, .date-input:focus-within { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 10%); }
.field-group small { display: block; margin-top: 5px; color: #7c879c; font-size: 10px; text-align: right; }
.date-input { display: flex; max-width: 330px; align-items: center; border: 1px solid #d6deea; border-radius: 9px; padding-right: 12px; color: #69758b; }
.date-input input { min-width: 0; flex: 1; border: 0; padding: 11px 13px; outline: 0; color: #526078; font: inherit; font-size: 12px; }
.notice { display: flex; gap: 10px; border: 1px solid #cbdcff; border-radius: 9px; padding: 14px; background: #f5f8ff; color: #1769ff; }
.notice p { margin: 0; color: #21427d; font-size: 11px; line-height: 1.9; }.notice span { color: #6c7891; }
.dialog__footer { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; padding: 20px 28px; border-top: 1px solid #e9edf3; }
.dialog__footer button { height: 44px; border-radius: 8px; font-size: 13px; font-weight: 750; cursor: pointer; }
.secondary-button { border: 1px solid #d6deea; background: #fff; color: #1d2939; }.primary-button { border: 0; background: linear-gradient(135deg, #246fff, #0758ed); color: #fff; box-shadow: 0 7px 17px rgb(23 105 255 / 24%); }
.dialog-enter-active,.dialog-leave-active { transition: opacity .2s ease; }.dialog-enter-active .dialog,.dialog-leave-active .dialog { transition: transform .2s ease; }.dialog-enter-from,.dialog-leave-to { opacity: 0; }.dialog-enter-from .dialog,.dialog-leave-to .dialog { transform: translateY(10px) scale(.98); }
@media (max-width: 600px) { .dialog-layer { padding: 10px; }.dialog { max-height: calc(100vh - 20px); }.dialog__body { padding: 20px; }.dialog__footer { padding: 16px 20px; }.interviewer-recipients { grid-template-columns: 1fr; padding-left: 12px; } }
</style>
