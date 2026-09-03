<script setup>
import { computed, reactive, ref } from "vue"
import { useRouter } from "vue-router"
import HrIcon from "./ui/HrIcon.vue"

const router = useRouter()
const activeStep = ref(1)
const showConfirmation = ref(false)
const showCandidatePicker = ref(false)
const completed = ref(false)

const candidateOptions = [
  { id: "student-tanaka", name: "田中 太郎", school: "青山大学", stage: "二次面接" },
  { id: "student-sato", name: "佐藤 花子", school: "明和大学", stage: "一次面接" },
  { id: "student-yamamoto", name: "山本 健", school: "東都大学", stage: "最終面接" },
  { id: "student-kato", name: "加藤 葵", school: "西京大学", stage: "二次面接" },
]

const form = reactive({
  candidateIds: ["student-tanaka"],
  stage: "二次面接",
  interviewType: "オンライン面接",
  assignment: "preset",
  interviewerCount: 2,
  participation: "all",
  duration: "60分",
  deadlineDate: "2026-09-10",
  deadlineTime: "23:59",
  message: "以下の日程からご都合の良い時間をすべて選択してください。\n調整後、確定した日程をご連絡します。",
  reminder: true,
  reminderDate: "2026-09-08",
  reminderTime: "09:00",
})

const steps = [
  { number: 1, label: "基本情報" },
  { number: 2, label: "面接官の設定" },
  { number: 3, label: "条件設定" },
  { number: 4, label: "内容確認" },
]

const participationLabel = computed(() => form.participation === "all" ? "全員の参加が必要" : "いずれか1名で参加可能")
const assignmentLabel = computed(() => form.assignment === "preset" ? "プリセットから選択" : form.assignment === "auto" ? "面接官を自動で設定" : "面接官を個別に指定")
const selectedCandidates = computed(() => candidateOptions.filter((candidate) => form.candidateIds.includes(candidate.id)))
const allCandidatesSelected = computed(() => form.candidateIds.length === candidateOptions.length)

const toggleAllCandidates = () => {
  form.candidateIds = allCandidatesSelected.value ? [] : candidateOptions.map((candidate) => candidate.id)
}

const removeCandidate = (id) => {
  form.candidateIds = form.candidateIds.filter((candidateId) => candidateId !== id)
}

const next = () => {
  if (!form.candidateIds.length) {
    activeStep.value = 1
    showCandidatePicker.value = true
    return
  }
  if (activeStep.value < 4) activeStep.value += 1
  else showConfirmation.value = true
}

const createSchedule = () => {
  showConfirmation.value = false
  completed.value = true
  window.setTimeout(() => { completed.value = false }, 2800)
}
</script>

<template>
  <div class="create-page">
    <header class="page-header">
      <button type="button" aria-label="戻る" @click="router.back()"><HrIcon name="back" :size="19" /></button>
      <div><span>SCHEDULE CREATION</span><h1>面接調整を作成</h1></div>
    </header>

    <nav class="stepper" aria-label="作成ステップ">
      <button v-for="step in steps" :key="step.number" type="button" :class="{ active: activeStep === step.number, completed: activeStep > step.number }" @click="activeStep = step.number">
        <span><HrIcon v-if="activeStep > step.number" name="check" :size="12" />{{ activeStep > step.number ? "" : step.number }}</span>
        <strong>{{ step.label }}</strong>
      </button>
    </nav>

    <form class="settings-grid" @submit.prevent="next">
      <section v-show="activeStep === 1" :class="{ active: activeStep === 1 }" @focusin="activeStep = 1">
        <header><span>1</span><div><h2>基本情報</h2><p>候補者と選考内容を選択</p></div></header>
        <div class="section-body">
          <div class="field candidate-field">
            <span>候補者 <i>必須</i></span>
            <button class="candidate-trigger" type="button" @click="showCandidatePicker = true">
              <span><HrIcon name="users" :size="15" />{{ selectedCandidates.length ? `${selectedCandidates.length}名を選択中` : "候補者を選択" }}</span>
              <HrIcon name="chevron-down" :size="15" />
            </button>
            <div v-if="selectedCandidates.length" class="candidate-chips">
              <span v-for="candidate in selectedCandidates" :key="candidate.id">{{ candidate.name }}<button type="button" :aria-label="`${candidate.name}を解除`" @click="removeCandidate(candidate.id)"><HrIcon name="close" :size="10" /></button></span>
            </div>
            <small v-else class="required-message">候補者を1名以上選択してください</small>
          </div>
          <label class="field"><span>選考ステップ <i>必須</i></span><div class="select-wrap"><select v-model="form.stage"><option>一次面接</option><option>二次面接</option><option>最終面接</option></select><HrIcon name="chevron-down" :size="15" /></div></label>
          <label class="field"><span>面接の種類</span><div class="select-wrap"><select v-model="form.interviewType"><option>オンライン面接</option><option>対面面接</option><option>電話面接</option></select><HrIcon name="chevron-down" :size="15" /></div></label>
        </div>
      </section>

      <section v-show="activeStep === 2" :class="{ active: activeStep === 2 }" @focusin="activeStep = 2">
        <header><span>2</span><div><h2>面接官の設定</h2><p>担当者の決め方を設定</p></div></header>
        <div class="section-body">
          <fieldset class="radio-list"><legend>設定方法</legend>
            <label><input v-model="form.assignment" type="radio" value="preset" /><span></span><div><strong>プリセットから選択</strong><small>選考ステップに設定された面接官を自動で設定</small></div></label>
            <label><input v-model="form.assignment" type="radio" value="auto" /><span></span><div><strong>面接官を自動で設定（推薦）</strong><small>空き予定をもとに最適な面接官を選定</small></div></label>
            <label><input v-model="form.assignment" type="radio" value="manual" /><span></span><div><strong>面接官を個別に指定</strong><small>特定の面接官を自由に指定</small></div></label>
          </fieldset>
          <label class="field compact-field"><span>必要人数</span><div class="number-input"><input v-model.number="form.interviewerCount" type="number" min="1" max="10" /><b>名</b></div><small>自動で設定されます（必要に応じて変更可能）</small></label>
        </div>
      </section>

      <section v-show="activeStep === 3" :class="{ active: activeStep === 3 }" @focusin="activeStep = 3">
        <header><span>3</span><div><h2>参加条件</h2><p>面接の成立条件を設定</p></div></header>
        <div class="section-body">
          <fieldset class="radio-list"><legend>参加形式 <i>必須</i></legend>
            <label><input v-model="form.participation" type="radio" value="all" /><span></span><div><strong>全員の参加が必要</strong><small>登録された面接官全員が同じ時間に参加する必要があります</small></div></label>
            <label><input v-model="form.participation" type="radio" value="any" /><span></span><div><strong>いずれか1名で参加可能</strong><small>登録された面接官の中から、都合のつく1名が対応します</small></div></label>
          </fieldset>
          <label class="field"><span>面接時間（目安）<i>必須</i></span><div class="select-wrap"><select v-model="form.duration"><option>30分</option><option>45分</option><option>60分</option><option>90分</option></select><HrIcon name="chevron-down" :size="15" /></div></label>
        </div>
      </section>

      <section v-show="activeStep === 4" :class="{ active: activeStep === 4 }" @focusin="activeStep = 4">
        <header><span>4</span><div><h2>詳細設定</h2><p>期限と候補者への案内</p></div></header>
        <div class="section-body">
          <div class="field"><span>提出期限 <i>必須</i></span><div class="date-row"><input v-model="form.deadlineDate" type="date" /><input v-model="form.deadlineTime" type="time" /></div></div>
          <label class="field message-field"><span>メッセージ（候補者への連絡内容）</span><textarea v-model="form.message" maxlength="500" rows="4"></textarea><small>{{ form.message.length }}/500</small></label>
          <label class="toggle-row"><span><strong>候補者へリマインドを送信する</strong><small>回答期限前に自動で通知します</small></span><input v-model="form.reminder" type="checkbox" /><i></i></label>
          <div v-if="form.reminder" class="date-row reminder-row"><input v-model="form.reminderDate" type="date" /><input v-model="form.reminderTime" type="time" /></div>
        </div>
      </section>
    </form>

    <footer class="action-bar">
      <button class="cancel-button" type="button" @click="router.push({ name: 'hr-chat' })">キャンセル</button>
      <button v-if="activeStep > 1" class="back-button" type="button" @click="activeStep -= 1">戻る</button>
      <button class="next-button" type="button" @click="next">{{ activeStep === 4 ? "内容を確認" : "次へ" }}<HrIcon name="back" :size="16" /></button>
    </footer>

    <Transition name="modal">
      <div v-if="showConfirmation" class="modal-layer" @mousedown.self="showConfirmation = false">
        <section class="confirmation" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
          <header><span><HrIcon name="calendar" :size="22" /></span><div><h2 id="confirmation-title">作成内容を確認</h2><p>以下の内容で面接日程の調整を作成します。</p></div><button type="button" @click="showConfirmation = false"><HrIcon name="close" /></button></header>
          <dl>
            <div class="candidate-summary"><dt>候補者（{{ selectedCandidates.length }}名）</dt><dd>{{ selectedCandidates.map((candidate) => candidate.name).join("、") }}</dd></div><div><dt>選考</dt><dd>{{ form.stage }}・{{ form.interviewType }}</dd></div>
            <div><dt>面接官</dt><dd>{{ assignmentLabel }}・{{ form.interviewerCount }}名</dd></div><div><dt>参加条件</dt><dd>{{ participationLabel }}</dd></div>
            <div><dt>面接時間</dt><dd>{{ form.duration }}</dd></div><div><dt>提出期限</dt><dd>{{ form.deadlineDate }} {{ form.deadlineTime }}</dd></div>
          </dl>
          <footer><button type="button" @click="showConfirmation = false">修正する</button><button type="button" @click="createSchedule">この内容で作成</button></footer>
        </section>
      </div>
    </Transition>

    <Transition name="modal">
      <div v-if="showCandidatePicker" class="modal-layer" @mousedown.self="showCandidatePicker = false">
        <section class="candidate-picker" role="dialog" aria-modal="true" aria-labelledby="candidate-picker-title">
          <header><span><HrIcon name="users" :size="21" /></span><div><h2 id="candidate-picker-title">候補者を選択</h2><p>同じ日程調整を送る候補者を複数選択できます。</p></div><button type="button" @click="showCandidatePicker = false"><HrIcon name="close" /></button></header>
          <div class="picker-tools"><strong>{{ form.candidateIds.length }}名を選択中</strong><button type="button" @click="toggleAllCandidates">{{ allCandidatesSelected ? "すべて解除" : "すべて選択" }}</button></div>
          <div class="candidate-list">
            <label v-for="candidate in candidateOptions" :key="candidate.id" :class="{ selected: form.candidateIds.includes(candidate.id) }">
              <input v-model="form.candidateIds" type="checkbox" :value="candidate.id" />
              <span class="candidate-avatar">{{ candidate.name.slice(0, 1) }}</span>
              <span><strong>{{ candidate.name }} さん</strong><small>{{ candidate.school }}・{{ candidate.stage }}</small></span>
              <i><HrIcon name="check" :size="12" /></i>
            </label>
          </div>
          <footer><button type="button" @click="showCandidatePicker = false">キャンセル</button><button type="button" :disabled="!form.candidateIds.length" @click="showCandidatePicker = false">{{ form.candidateIds.length }}名を選択</button></footer>
        </section>
      </div>
    </Transition>
    <Transition name="toast"><div v-if="completed" class="toast"><span><HrIcon name="check" :size="14" /></span>{{ selectedCandidates.length }}名分の面接日程調整を作成しました（プレビュー）</div></Transition>
  </div>
</template>

<style scoped>
.create-page { display: grid; height: 100%; grid-template-rows: 70px 58px minmax(0, 1fr) 70px; overflow: hidden; background: #f8fafc; color: #273348; }.page-header { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #e3e8f0; padding: 0 20px; background: #fff; }.page-header > button { display: grid; width: 34px; height: 34px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #3e4b61; cursor: pointer; }.page-header > button:hover { background: #f1f4f8; }.page-header div { display: flex; align-items: baseline; gap: 9px; }.page-header div span { color: #1769ff; font-size: 7px; font-weight: 800; letter-spacing: .13em; }.page-header h1 { margin: 0; font-size: 15px; }
.stepper { display: flex; align-items: center; justify-content: center; padding: 0 7%; background: #fff; }.stepper button { position: relative; display: flex; min-width: 0; flex: 1; align-items: center; gap: 8px; border: 0; background: transparent; color: #919baa; cursor: pointer; }.stepper button:not(:last-child)::after { height: 1px; flex: 1; margin: 0 11px; background: #dfe5ed; content: ""; }.stepper button.active:not(:last-child)::after,.stepper button.completed:not(:last-child)::after { background: #9cbbfa; }.stepper button > span { display: grid; width: 21px; height: 21px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #aeb6c2; color: #fff; font-size: 8px; font-weight: 800; }.stepper button.active { color: #1769ff; }.stepper button.active > span,.stepper button.completed > span { background: #1769ff; box-shadow: 0 3px 8px rgb(23 105 255 / 22%); }.stepper strong { font-size: 9px; white-space: nowrap; }
.settings-grid { display: grid; min-height: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; overflow-y: auto; padding: 13px 17px; }.settings-grid > section { min-width: 0; overflow: hidden; border: 1px solid #e0e6ee; border-radius: 11px; background: #fff; box-shadow: 0 2px 8px rgb(35 49 74 / 3%); transition: border .2s, box-shadow .2s; }.settings-grid > section.active { border-color: #9abafa; box-shadow: 0 0 0 2px rgb(23 105 255 / 6%), 0 6px 18px rgb(34 51 83 / 6%); }.settings-grid section > header { display: flex; min-height: 57px; align-items: center; gap: 9px; border-bottom: 1px solid #ebeff4; padding: 0 13px; }.settings-grid section > header > span { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 7px; background: #f0f3f8; color: #738097; font-size: 8px; font-weight: 800; }.settings-grid section.active > header > span { background: #e7efff; color: #1769ff; }.settings-grid h2 { margin: 0; color: #303c50; font-size: 10px; }.settings-grid header p { margin: 3px 0 0; color: #929cac; font-size: 7px; }.section-body { padding: 14px; }
.field { display: flex; flex-direction: column; margin-bottom: 15px; }.field > span,.radio-list legend { margin-bottom: 7px; color: #465269; font-size: 8px; font-weight: 750; }.field > span i,.radio-list legend i { color: #1769ff; font-size: 7px; font-style: normal; }.select-wrap { position: relative; }.select-wrap svg { position: absolute; top: 50%; right: 9px; transform: translateY(-50%); pointer-events: none; color: #8490a3; }.field select,.field input,.date-row input { width: 100%; height: 36px; appearance: none; border: 1px solid #dce2eb; border-radius: 7px; padding: 0 10px; outline: 0; background: #fff; color: #3f4c61; font: inherit; font-size: 8px; }.field select { padding-right: 28px; }.field select:focus,.field input:focus,.date-row input:focus,.message-field textarea:focus { border-color: #1769ff; box-shadow: 0 0 0 3px rgb(23 105 255 / 7%); }.field > small { margin-top: 5px; color: #929baa; font-size: 7px; }
.candidate-trigger { display: flex; width: 100%; min-height: 36px; align-items: center; justify-content: space-between; border: 1px solid #dce2eb; border-radius: 7px; padding: 0 9px; background: #fff; color: #3f4c61; cursor: pointer; }.candidate-trigger:hover { border-color: #9dbbf4; }.candidate-trigger > span { display: flex; align-items: center; gap: 6px; font-size: 8px; }.candidate-trigger > span svg { color: #1769ff; }.candidate-trigger > svg { color: #8490a3; }.candidate-chips { display: flex; max-height: 57px; flex-wrap: wrap; gap: 4px; overflow-y: auto; margin-top: 7px; }.candidate-chips > span { display: inline-flex; height: 25px; align-items: center; gap: 4px; border-radius: 7px; padding: 0 4px 0 7px; background: #edf3ff; color: #315486; font-size: 7px; font-weight: 700; }.candidate-chips button { display: grid; width: 16px; height: 16px; place-items: center; border: 0; border-radius: 4px; background: transparent; color: #6f7d93; cursor: pointer; }.candidate-chips button:hover { background: #dce8ff; color: #1769ff; }.candidate-field .required-message { color: #d14a4a; }
.radio-list { margin: 0 0 17px; border: 0; padding: 0; }.radio-list label { display: flex; align-items: flex-start; gap: 7px; margin: 0 0 11px; cursor: pointer; }.radio-list input { position: absolute; opacity: 0; }.radio-list label > span { width: 14px; height: 14px; flex: 0 0 auto; border: 1.5px solid #bbc5d2; border-radius: 50%; }.radio-list input:checked + span { border: 4px solid #1769ff; }.radio-list label div { display: flex; min-width: 0; flex-direction: column; }.radio-list strong { color: #485469; font-size: 8px; }.radio-list small { margin-top: 3px; color: #929baa; font-size: 6.5px; line-height: 1.45; }.number-input { position: relative; }.number-input b { position: absolute; top: 50%; right: 10px; transform: translateY(-50%); color: #69758a; font-size: 8px; }.number-input input { padding-right: 28px; }.date-row { display: grid; grid-template-columns: 1.3fr .8fr; gap: 7px; }.message-field { position: relative; }.message-field textarea { width: 100%; resize: none; border: 1px solid #dce2eb; border-radius: 7px; padding: 9px; outline: 0; color: #465269; font: inherit; font-size: 7px; line-height: 1.65; }.message-field > small { text-align: right; }.toggle-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; cursor: pointer; }.toggle-row > span { display: flex; min-width: 0; flex: 1; flex-direction: column; }.toggle-row strong { color: #465269; font-size: 8px; }.toggle-row small { margin-top: 3px; color: #929baa; font-size: 6.5px; }.toggle-row input { position: absolute; opacity: 0; }.toggle-row > i { position: relative; width: 30px; height: 17px; flex: 0 0 auto; border-radius: 9px; background: #c7cfda; }.toggle-row > i::after { position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 20%); content: ""; transition: transform .2s; }.toggle-row input:checked + i { background: #1769ff; }.toggle-row input:checked + i::after { transform: translateX(13px); }.reminder-row { margin-top: 10px; }
.action-bar { display: flex; align-items: center; justify-content: center; gap: 10px; border-top: 1px solid #e1e6ee; padding: 0 20px; background: #fff; }.action-bar button { height: 39px; border-radius: 8px; font-size: 9px; font-weight: 750; cursor: pointer; }.cancel-button,.back-button { width: 155px; border: 1px solid #d9e0e9; background: #fff; color: #485469; }.back-button { width: 90px; }.next-button { display: flex; width: 200px; align-items: center; justify-content: center; gap: 8px; border: 0; background: #1769ff; box-shadow: 0 5px 13px rgb(23 105 255 / 22%); color: #fff; }.next-button svg { transform: rotate(180deg); }
.modal-layer { position: fixed; z-index: 70; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(18 30 53 / 48%); backdrop-filter: blur(3px); }.confirmation { width: min(520px, 100%); overflow: hidden; border-radius: 14px; background: #fff; box-shadow: 0 24px 70px rgb(20 32 55 / 24%); }.confirmation > header { display: grid; grid-template-columns: 40px 1fr 34px; align-items: center; gap: 10px; border-bottom: 1px solid #e8ecf2; padding: 17px 20px; }.confirmation header > span { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 9px; background: #eaf1ff; color: #1769ff; }.confirmation h2 { margin: 0; font-size: 14px; }.confirmation header p { margin: 4px 0 0; color: #8590a2; font-size: 8px; }.confirmation header button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #677389; cursor: pointer; }.confirmation dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin: 0; padding: 14px 20px; }.confirmation dl div { border-bottom: 1px solid #edf0f4; padding: 10px 4px; }.confirmation dt { color: #8993a5; font-size: 7px; }.confirmation dd { margin: 4px 0 0; color: #354158; font-size: 9px; font-weight: 700; }.confirmation > footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #e8ecf2; padding: 14px 20px; }.confirmation footer button { height: 37px; border-radius: 7px; padding: 0 16px; font-size: 9px; font-weight: 750; cursor: pointer; }.confirmation footer button:first-child { border: 1px solid #d9e0e9; background: #fff; color: #566277; }.confirmation footer button:last-child { border: 0; background: #1769ff; color: #fff; }.toast { position: fixed; z-index: 80; top: 20px; left: 50%; display: flex; align-items: center; gap: 8px; transform: translateX(-50%); border: 1px solid #dce5f2; border-radius: 9px; padding: 10px 14px; background: #fff; box-shadow: 0 10px 30px rgb(24 37 65 / 16%); font-size: 9px; font-weight: 700; }.toast span { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; background: #e6f7ee; color: #18955a; }.modal-enter-active,.modal-leave-active,.toast-enter-active,.toast-leave-active { transition: opacity .2s; }.modal-enter-from,.modal-leave-to,.toast-enter-from,.toast-leave-to { opacity: 0; }
.candidate-picker { width: min(530px, 100%); overflow: hidden; border-radius: 14px; background: #fff; box-shadow: 0 24px 70px rgb(20 32 55 / 24%); }.candidate-picker > header { display: grid; grid-template-columns: 40px 1fr 34px; align-items: center; gap: 10px; border-bottom: 1px solid #e8ecf2; padding: 17px 20px; }.candidate-picker header > span { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 9px; background: #eaf1ff; color: #1769ff; }.candidate-picker h2 { margin: 0; color: #273348; font-size: 14px; }.candidate-picker header p { margin: 4px 0 0; color: #8590a2; font-size: 8px; }.candidate-picker header > button { display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #677389; cursor: pointer; }.picker-tools { display: flex; align-items: center; justify-content: space-between; padding: 11px 20px; background: #f8fafd; }.picker-tools strong { color: #435069; font-size: 9px; }.picker-tools button { border: 0; background: transparent; color: #1769ff; font-size: 8px; font-weight: 750; cursor: pointer; }.candidate-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 14px 20px; }.candidate-list label { position: relative; display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid #dfe5ed; border-radius: 9px; padding: 10px; cursor: pointer; }.candidate-list label.selected { border-color: #1769ff; background: #f4f7ff; box-shadow: 0 0 0 2px rgb(23 105 255 / 6%); }.candidate-list input { position: absolute; opacity: 0; }.candidate-avatar { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #dcf4e9; color: #157653; font-size: 9px; font-weight: 800; }.candidate-list label > span:nth-child(3) { display: flex; min-width: 0; flex: 1; flex-direction: column; }.candidate-list strong { overflow: hidden; color: #344054; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.candidate-list small { margin-top: 3px; color: #8792a5; font-size: 7px; }.candidate-list i { display: grid; width: 17px; height: 17px; place-items: center; border: 1px solid #c8d1de; border-radius: 5px; color: transparent; }.candidate-list .selected i { border-color: #1769ff; background: #1769ff; color: #fff; }.candidate-picker > footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid #e8ecf2; padding: 14px 20px; }.candidate-picker footer button { height: 37px; border-radius: 7px; padding: 0 17px; font-size: 9px; font-weight: 750; cursor: pointer; }.candidate-picker footer button:first-child { border: 1px solid #d9e0e9; background: #fff; color: #566277; }.candidate-picker footer button:last-child { border: 0; background: #1769ff; color: #fff; }.candidate-picker footer button:disabled { background: #b8c9e8; cursor: not-allowed; }
@media (max-width: 1050px) { .create-page { overflow-y: auto; grid-template-rows: 70px auto auto 70px; }.stepper { min-height: 58px; }.settings-grid { grid-template-columns: 1fr 1fr; overflow: visible; }.settings-grid > section { min-height: 350px; } }
@media (max-width: 650px) { .create-page { display: block; padding-bottom: 80px; }.page-header { height: 70px; padding-left: 60px; }.page-header div span { display: none; }.stepper { justify-content: flex-start; overflow-x: auto; padding: 12px 15px; }.stepper button { flex: 0 0 auto; }.stepper button:not(:last-child)::after { width: 24px; flex: 0 0 auto; }.settings-grid { display: flex; flex-direction: column; padding: 12px; }.settings-grid > section { min-height: 0; }.action-bar { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; height: 70px; }.cancel-button { display: none; }.back-button { width: 85px; }.next-button { flex: 1; max-width: 220px; }.confirmation dl,.candidate-list { grid-template-columns: 1fr; } }

/* 入力中のステップだけを大きく見せる、集中型ウィザードレイアウト */
.create-page { grid-template-rows: 78px 72px minmax(0, 1fr) 78px; overflow: hidden; }
.page-header { padding: 0 clamp(24px, 4vw, 54px); }.page-header h1 { font-size: 20px; }.page-header div span { font-size: 9px; }
.stepper { padding: 0 max(7%, calc((100% - 900px) / 2)); }.stepper button > span { width: 28px; height: 28px; font-size: 10px; }.stepper strong { font-size: 11px; }.stepper button:not(:last-child)::after { margin: 0 18px; }
.settings-grid { display: block; min-height: 0; overflow-y: auto; padding: 28px clamp(22px, 5vw, 64px); }.settings-grid > section { width: min(880px, 100%); min-height: 0; margin: 0 auto; overflow: visible; border-radius: 16px; box-shadow: 0 9px 28px rgb(35 49 74 / 7%); }.settings-grid > section.active { border-color: #dbe4f2; box-shadow: 0 9px 28px rgb(35 49 74 / 8%); }.settings-grid section > header { min-height: 82px; gap: 14px; padding: 0 28px; background: linear-gradient(90deg, #fbfcff, #fff); }.settings-grid section > header > span { width: 38px; height: 38px; border-radius: 10px; font-size: 12px; }.settings-grid h2 { font-size: 16px; }.settings-grid header p { margin-top: 5px; font-size: 10px; }.section-body { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; padding: 28px; }.section-body > :only-child,.section-body > .radio-list:first-child { grid-column: 1 / -1; }
.field { margin-bottom: 22px; }.field > span,.radio-list legend { margin-bottom: 10px; font-size: 11px; }.field > span i,.radio-list legend i { font-size: 9px; }.field select,.field input,.date-row input { height: 46px; border-radius: 9px; padding: 0 14px; font-size: 11px; }.field select { padding-right: 36px; }.select-wrap svg { right: 13px; }.field > small { margin-top: 7px; font-size: 9px; }
.candidate-field { grid-column: 1 / -1; }.candidate-trigger { min-height: 48px; border-radius: 9px; padding: 0 14px; }.candidate-trigger > span { gap: 9px; font-size: 11px; }.candidate-chips { max-height: 72px; gap: 7px; margin-top: 10px; }.candidate-chips > span { height: 31px; gap: 6px; border-radius: 8px; padding: 0 6px 0 10px; font-size: 9px; }.candidate-chips button { width: 19px; height: 19px; }
.radio-list { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 24px; }.radio-list legend { grid-column: 1 / -1; }.radio-list label { min-height: 88px; margin: 0; border: 1px solid #dce3ed; border-radius: 11px; padding: 15px; background: #fff; transition: border .18s, background .18s; }.radio-list label:has(input:checked) { border-color: #1769ff; background: #f5f8ff; box-shadow: 0 0 0 2px rgb(23 105 255 / 7%); }.radio-list label > span { width: 18px; height: 18px; }.radio-list input:checked + span { border-width: 5px; }.radio-list strong { font-size: 11px; }.radio-list small { margin-top: 6px; font-size: 9px; line-height: 1.55; }.compact-field { grid-column: 1; }.number-input b { right: 14px; font-size: 10px; }
.message-field { grid-column: 1 / -1; }.message-field textarea { min-height: 100px; border-radius: 9px; padding: 13px; font-size: 11px; }.date-row { gap: 10px; }.toggle-row { grid-column: 1 / -1; border: 1px solid #e0e7f1; border-radius: 10px; padding: 14px; background: #fafcff; }.toggle-row strong { font-size: 11px; }.toggle-row small { margin-top: 4px; font-size: 9px; }.toggle-row > i { width: 38px; height: 22px; border-radius: 12px; }.toggle-row > i::after { width: 18px; height: 18px; }.toggle-row input:checked + i::after { transform: translateX(16px); }.reminder-row { grid-column: 1 / -1; width: min(410px, 100%); margin-top: 12px; }
.action-bar { gap: 12px; }.action-bar button { height: 46px; border-radius: 9px; font-size: 11px; }.cancel-button { width: 150px; }.back-button { width: 110px; }.next-button { width: 230px; }
.candidate-picker { width: min(650px, 100%); }.candidate-picker > header { padding: 22px 26px; }.candidate-picker h2 { font-size: 17px; }.candidate-picker header p { font-size: 10px; }.picker-tools { padding: 14px 26px; }.picker-tools strong { font-size: 11px; }.picker-tools button { font-size: 10px; }.candidate-list { gap: 10px; padding: 19px 26px; }.candidate-list label { min-height: 70px; border-radius: 11px; padding: 13px; }.candidate-avatar { width: 38px; height: 38px; font-size: 11px; }.candidate-list strong { font-size: 11px; }.candidate-list small { margin-top: 5px; font-size: 9px; }.candidate-list i { width: 20px; height: 20px; }.candidate-picker > footer { padding: 17px 26px; }.candidate-picker footer button { height: 42px; padding: 0 20px; font-size: 10px; }

@media (max-width: 760px) {
  .create-page { display: block; overflow-y: auto; padding-bottom: 82px; }.page-header { height: 72px; padding-left: 60px; }.page-header div span { display: none; }.stepper { min-height: 64px; justify-content: flex-start; overflow-x: auto; padding: 12px 16px; }.stepper button { flex: 0 0 auto; }.stepper button:not(:last-child)::after { width: 28px; flex: 0 0 auto; margin: 0 10px; }.settings-grid { padding: 16px 12px; overflow: visible; }.settings-grid section > header { min-height: 72px; padding: 0 18px; }.section-body { display: block; padding: 20px 18px; }.radio-list { display: flex; flex-direction: column; }.radio-list label { min-height: 76px; }.action-bar { position: fixed; z-index: 20; right: 0; bottom: 0; left: 0; height: 72px; }.cancel-button { display: none; }.back-button { width: 88px; }.next-button { flex: 1; max-width: 230px; }.confirmation dl,.candidate-list { grid-template-columns: 1fr; }
}
</style>
