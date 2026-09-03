<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import { useRoute } from "vue-router"
import { session } from "../../session.js"
import socketManager from "../../socketManager.js"
import HrIcon from "./ui/HrIcon.vue"

const socket = (() => { try { return socketManager.getInstance() } catch { return socketManager.connect(session.value.token) } })()
// ダッシュボードの「日程調整を送る」から来たときは、その候補者を選んだ状態で開く
const route = useRoute()
const presetStudentIds = String(route.query.students ?? "").split(",").filter(Boolean)
const presetApplied = ref(false)
const students = ref([]), interviewers = ref([]), loading = ref(true), sending = ref(false)
const search = ref(""), selectionFilter = ref("all"), error = ref(""), success = ref("")
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`
const today = new Date(), rangeEnd = new Date(today), deadline = new Date(today)
rangeEnd.setDate(rangeEnd.getDate()+13); deadline.setDate(deadline.getDate()+2)
const form = reactive({ studentIds:[], interviewerMode:"all", interviewerIds:[], requiredCount:1, duration:60, rangeStart:iso(today), rangeEnd:iso(rangeEnd), deadlineDate:iso(deadline), deadlineTime:"23:59", message:"" })
const stages = { first_interview:"一次面接", second_interview:"二次面接", final_interview:"最終面接", offered:"内定", rejected:"不採用" }
const filteredStudents = computed(() => students.value.filter((student) => {
  const query = search.value.trim().toLowerCase()
  return (selectionFilter.value === "all" || student.selection_status === selectionFilter.value)
    && (!query || student.name.toLowerCase().includes(query) || student.email.toLowerCase().includes(query))
}))
const targetInterviewerIds = computed(() => form.interviewerMode === "all" ? interviewers.value.map(({id}) => id) : form.interviewerIds)
const selectedStudents = computed(() => students.value.filter(({id}) => form.studentIds.includes(id)))
const allVisible = computed(() => filteredStudents.value.length && filteredStudents.value.every(({id}) => form.studentIds.includes(id)))
const valid = computed(() => form.studentIds.length && targetInterviewerIds.value.length && form.requiredCount >= 1
  && form.requiredCount <= targetInterviewerIds.value.length && form.duration >= 1 && form.duration <= 60
  && form.rangeStart && form.rangeEnd && form.rangeStart <= form.rangeEnd && form.deadlineDate && form.deadlineTime && !sending.value)
watch(targetInterviewerIds, (ids) => { if (form.requiredCount > ids.length) form.requiredCount = Math.max(1, ids.length) })
const onDashboard = (data) => {
  students.value=data.students??[]; interviewers.value=data.interviewers??[]; loading.value=false
  if (presetStudentIds.length && !presetApplied.value) {
    presetApplied.value = true
    form.studentIds = presetStudentIds.filter((id) => students.value.some((student) => student.id === id))
  }
}
onMounted(() => { socket.on("dashboardData",onDashboard); socket.emit("loadDashboard") })
onUnmounted(() => socket.off("dashboardData",onDashboard))
const toggleVisible = () => {
  const ids=filteredStudents.value.map(({id})=>id)
  form.studentIds=allVisible.value ? form.studentIds.filter(id=>!ids.includes(id)) : [...new Set([...form.studentIds,...ids])]
}
const submit = () => {
  if (!valid.value) return
  sending.value=true; error.value=""; success.value=""
  socket.emit("createBulkRequests", { studentIds:form.studentIds, interviewerIds:targetInterviewerIds.value,
    requiredInterviewerCount:Number(form.requiredCount), durationMinutes:Number(form.duration), rangeStart:form.rangeStart, rangeEnd:form.rangeEnd,
    responseDeadline:new Date(`${form.deadlineDate}T${form.deadlineTime}:00`).toISOString(), message:form.message }, (result) => {
      sending.value=false
      if (!result?.ok) { error.value="送信できませんでした。入力内容と接続を確認してください。"; return }
      success.value=`${result.count}名へ日程調整を送信しました。`; form.studentIds=[]
    })
}
</script>

<template>
  <div class="page">
    <header class="page-head"><div><span>SCHEDULE</span><h1>日程調整を作成</h1><p>候補者と条件を選択し、まとめて送信します。</p></div><strong>{{ selectedStudents.length }}<small>名を選択中</small></strong></header>
    <form class="layout" @submit.prevent="submit">
      <section class="card candidates">
        <header><div><b>1</b><span><strong>候補者</strong><small>複数選択・選考段階で絞り込み</small></span></div><button type="button" @click="toggleVisible">{{ allVisible ? "表示中を解除" : "表示中を全選択" }}</button></header>
        <div class="filters"><label><HrIcon name="search" :size="16"/><input v-model="search" placeholder="名前・メールで検索"></label><select v-model="selectionFilter"><option value="all">すべての選考段階</option><option v-for="(label,key) in stages" :key="key" :value="key">{{ label }}</option></select></div>
        <div class="list"><p v-if="loading" class="empty">DBから読み込んでいます…</p><label v-for="student in filteredStudents" :key="student.id" :class="{selected:form.studentIds.includes(student.id)}"><input v-model="form.studentIds" type="checkbox" :value="student.id"><i>{{ student.name.slice(0,1) }}</i><span><strong>{{ student.name }}</strong><small>{{ student.email }}</small></span><em>{{ stages[student.selection_status] || student.selection_status }}</em><b><HrIcon name="check" :size="12"/></b></label><p v-if="!loading&&!filteredStudents.length" class="empty">対象の候補者はいません。</p></div>
      </section>
      <div class="settings">
        <section class="card"><header><div><b>2</b><span><strong>面接官の設定</strong><small>基本は登録済み面接官全員</small></span></div></header><div class="body">
          <div class="switch"><label><input v-model="form.interviewerMode" type="radio" value="all"><span>面接官全員</span></label><label><input v-model="form.interviewerMode" type="radio" value="manual"><span>個別に選択</span></label></div>
          <p v-if="form.interviewerMode==='all'" class="note">DB登録済みの面接官 {{ interviewers.length }}名へ送ります。</p><div v-else class="people"><label v-for="person in interviewers" :key="person.id"><input v-model="form.interviewerIds" type="checkbox" :value="person.id">{{ person.name }}</label></div>
          <label class="field"><span>必要人数 <i>必須</i></span><div><input v-model.number="form.requiredCount" type="number" min="1" :max="Math.max(1,targetInterviewerIds.length)"><em>名 / {{ targetInterviewerIds.length }}名</em></div></label>
        </div></section>
        <section class="card"><header><div><b>3</b><span><strong>日程と案内</strong><small>選考ステップ・面接種類の設定は不要です</small></span></div></header><div class="body grid">
          <label class="field wide"><span>候補日時の期間 <i>必須</i></span><div class="dates"><input v-model="form.rangeStart" type="date"><em>〜</em><input v-model="form.rangeEnd" type="date"></div></label>
          <label class="field"><span>面接時間（上限60分）<i>必須</i></span><div><input v-model.number="form.duration" type="number" min="1" max="60" step="1"><em>分</em></div></label>
          <label class="field"><span>提出期限 <i>必須</i></span><div class="dates deadline"><input v-model="form.deadlineDate" type="date"><input v-model="form.deadlineTime" type="time"></div></label>
          <aside><HrIcon name="calendar" :size="17"/><span><strong>リマインドは1回</strong><small>提出期限の24時間前に自動送信</small></span></aside>
          <label class="field wide"><span>候補者へのメッセージ</span><textarea v-model="form.message" maxlength="500" rows="3" placeholder="未入力の場合は標準案内を送信します。"></textarea><small>{{ form.message.length }}/500</small></label>
        </div></section>
      </div>
      <footer><p :class="{error}">{{ error || success || `${selectedStudents.length}名の候補者・${targetInterviewerIds.length}名の面接官が対象です` }}</p><button :disabled="!valid"><HrIcon name="send" :size="17"/>{{ sending ? "送信中…" : `${selectedStudents.length}名へ一斉送信` }}</button></footer>
    </form>
  </div>
</template>

<style scoped>
.page,.page *{box-sizing:border-box}.page{height:100%;overflow:auto;padding:28px clamp(20px,3vw,45px);background:#f7f9fc;color:#273348}.page-head{display:flex;align-items:end;justify-content:space-between;margin-bottom:20px}.page-head>div>span{color:#1769ff;font-size:8px;font-weight:800;letter-spacing:.15em}.page-head h1{margin:5px 0 0;font-size:24px}.page-head p{margin:6px 0 0;color:#78849a;font-size:10px}.page-head>strong{color:#1769ff;font-size:25px}.page-head>strong small{margin-left:6px;color:#758197;font-size:9px}.layout{display:grid;grid-template-columns:minmax(420px,1.08fr) minmax(410px,.92fr);gap:14px}.card{overflow:hidden;border:1px solid #e0e6ef;border-radius:13px;background:#fff}.card>header{display:flex;min-height:62px;align-items:center;justify-content:space-between;border-bottom:1px solid #e8edf3;padding:0 16px}.card>header>div{display:flex;align-items:center;gap:10px}.card>header b{display:grid;width:27px;height:27px;place-items:center;border-radius:8px;background:#eaf1ff;color:#1769ff;font-size:10px}.card header span{display:flex;flex-direction:column}.card header strong{font-size:11px}.card header small{margin-top:3px;color:#8b95a6;font-size:7px}.card header button{border:0;background:none;color:#1769ff;font-size:8px;font-weight:700;cursor:pointer}.candidates{grid-row:span 2}.filters{display:grid;grid-template-columns:1fr 165px;gap:8px;padding:12px;border-bottom:1px solid #edf0f4}.filters label{display:flex;height:36px;align-items:center;gap:7px;border:1px solid #dce3ed;border-radius:8px;padding:0 10px}.filters input{min-width:0;flex:1;border:0;outline:0;font-size:8px}.filters select{border:1px solid #dce3ed;border-radius:8px;background:#fff;padding:0 8px;font-size:8px}.list{height:493px;overflow:auto;padding:7px 10px}.list>label{display:flex;min-height:57px;align-items:center;gap:9px;border:1px solid transparent;border-radius:9px;padding:7px 9px;cursor:pointer}.list>label.selected{border-color:#acc6fb;background:#f2f6ff}.list input,.switch input{position:absolute;opacity:0}.list>label>i{display:grid;width:33px;height:33px;place-items:center;border-radius:50%;background:#e7f7f1;color:#16845f;font-size:10px;font-style:normal;font-weight:800}.list label>span{display:flex;min-width:0;flex:1;flex-direction:column}.list label span strong{font-size:9px}.list label span small{margin-top:3px;color:#8994a6;font-size:7px}.list label>em{border-radius:8px;padding:4px 7px;background:#edf3ff;color:#1769ff;font-size:7px;font-style:normal}.list label>b{display:grid;width:18px;height:18px;place-items:center;border:1px solid #cbd3df;border-radius:5px;color:transparent}.list label.selected>b{border-color:#1769ff;background:#1769ff;color:#fff}.empty{padding:55px;text-align:center;color:#8994a6;font-size:9px}.settings{display:flex;flex-direction:column;gap:14px}.body{padding:14px}.switch{display:grid;grid-template-columns:1fr 1fr;gap:6px}.switch span{display:flex;height:35px;align-items:center;justify-content:center;border:1px solid #dce3ed;border-radius:8px;font-size:8px;cursor:pointer}.switch input:checked+span{border-color:#1769ff;background:#edf3ff;color:#1769ff}.note{color:#768398;font-size:8px}.people{display:flex;max-height:65px;flex-wrap:wrap;gap:6px;overflow:auto;margin-top:10px}.people label{border-radius:7px;padding:5px 7px;background:#f4f6f9;font-size:8px}.field{display:flex;flex-direction:column;margin-top:12px}.field>span{margin-bottom:6px;font-size:8px;font-weight:700}.field>span i{color:#1769ff;font-size:7px}.field>div{position:relative}.field input,.field textarea{width:100%;border:1px solid #dce3ed;border-radius:7px;padding:0 9px;outline:0;font:inherit;font-size:8px}.field input{height:35px}.field textarea{padding:8px;resize:vertical}.field>div>em{position:absolute;right:9px;top:50%;transform:translateY(-50%);color:#7c8799;font-size:8px;font-style:normal}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:0 10px}.wide{grid-column:1/-1}.dates{display:grid!important;grid-template-columns:1fr 15px 1fr;align-items:center;gap:4px}.dates>em{position:static!important;transform:none!important;text-align:center}.deadline{grid-template-columns:1.3fr .7fr}.grid aside{display:flex;align-items:center;gap:8px;margin-top:12px;border:1px solid #cdddfb;border-radius:8px;padding:8px;background:#f2f6ff;color:#1769ff}.grid aside span{display:flex;flex-direction:column}.grid aside strong{font-size:8px}.grid aside small{font-size:7px;color:#687b99}.field>small{text-align:right;color:#929cad;font-size:7px}.layout>footer{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:18px;border:1px solid #e0e6ef;border-radius:12px;padding:12px 15px;background:#fff}.layout>footer p{margin:0;color:#758196;font-size:8px}.layout>footer p.error{color:#c74242}.layout>footer button{display:flex;min-width:210px;height:40px;align-items:center;justify-content:center;gap:7px;border:0;border-radius:8px;background:#1769ff;color:#fff;font-size:9px;font-weight:800}.layout>footer button:disabled{background:#c7d2e5}@media(max-width:1000px){.layout{grid-template-columns:1fr}.list{height:330px}.layout>footer{grid-column:1}}@media(max-width:600px){.page{padding:80px 13px 25px}.filters,.grid{grid-template-columns:1fr}.wide{grid-column:1}.layout>footer{align-items:stretch;flex-direction:column}.layout>footer button{width:100%}}
</style>
