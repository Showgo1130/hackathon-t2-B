<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue"
import { onBeforeRouteLeave } from "vue-router"
import socketManager from "../../socketManager.js"
import CalendarPicker from "../shared/CalendarPicker.vue"

const socket = socketManager.getInstance()

const toIso = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const windowStart = ref(new Date())
const rangeStart = computed(() => toIso(windowStart.value))
const rangeEnd = computed(() => {
  const d = new Date(windowStart.value)
  d.setDate(d.getDate() + 13)
  return toIso(d)
})

const availabilityMap = reactive(new Map())
const keyOf = (date, hour) => `${date}_${hour}`

const applyRows = (rows) => {
  rows.forEach((row) => availabilityMap.set(keyOf(row.slot_date, row.slot_hour), row.is_available))
}
const clearCells = (cells) => {
  cells.forEach(({ slotDate, slotHour }) => availabilityMap.delete(keyOf(slotDate, slotHour)))
}

const loadAvailability = () => {
  socket.emit("loadAvailability", { rangeStart: rangeStart.value, rangeEnd: rangeEnd.value })
}
// 再接続したときも取り直す
const reload = () => {
  loadAvailability()
  socket.emit("loadSchedules")
}

// 確定した面接。空き予定の上に「面接あり」として重ねて表示する（編集はさせない）
const bookedMap = reactive(new Map())
const onScheduleData = (rows) => {
  bookedMap.clear()
  rows.forEach((row) => {
    bookedMap.set(keyOf(row.confirmedDate, row.confirmedHour), row)
  })
}
const isBooked = (date, hour) => bookedMap.has(keyOf(date, hour))

// 過ぎた枠に空き予定を登録しても意味がないので編集させない
const isPastSlot = (date, hour) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`) < new Date()
const isLocked = (date, hour) => isBooked(date, hour) || isPastSlot(date, hour)
const bookedCount = computed(() => bookedMap.size)

const onAvailabilityData = (rows) => applyRows(rows)
const onAvailabilityUpdated = (rows) => {
  applyRows(rows)
  countResponse()
}
const onAvailabilityCleared = (cells) => {
  clearCells(cells)
  countResponse()
}
const onAppError = ({ message }) => failSave(message ?? "保存に失敗しました")

onMounted(() => {
  socket.on("availabilityData", onAvailabilityData)
  socket.on("availabilityUpdated", onAvailabilityUpdated)
  socket.on("availabilityCleared", onAvailabilityCleared)
  socket.on("scheduleData", onScheduleData)
  socket.on("appError", onAppError)
  socket.on("connect", reload)
  reload()
})
onUnmounted(() => {
  socket.off("availabilityData", onAvailabilityData)
  socket.off("availabilityUpdated", onAvailabilityUpdated)
  socket.off("availabilityCleared", onAvailabilityCleared)
  socket.off("scheduleData", onScheduleData)
  socket.off("appError", onAppError)
  socket.off("connect", reload)
  window.clearTimeout(saveTimer)
})

const isCurrentWindow = computed(() => rangeStart.value === toIso(new Date()))
const goToToday = () => {
  windowStart.value = new Date()
  loadAvailability()
}

const shiftWindow = (days) => {
  const d = new Date(windowStart.value)
  d.setDate(d.getDate() + days)
  windowStart.value = d
  loadAvailability()
}

// ---- 下書き ----
// 誤操作をそのまま保存しないよう、編集は draftMap に溜めて「保存する」で一括反映する。
// 値は true(○) / false(×) / null(取消) で、保存済みと同じ値になった時点で下書きから外す。
const draftMap = reactive(new Map())

const savedValue = (key) => (availabilityMap.has(key) ? availabilityMap.get(key) : null)
const currentValue = (key) => (draftMap.has(key) ? draftMap.get(key) : savedValue(key))

const setDraft = (key, value) => {
  if (value === savedValue(key)) draftMap.delete(key)
  else draftMap.set(key, value)
}

const pendingCells = computed(() => [...draftMap.entries()].map(([key, value]) => {
  const [slotDate, hourStr] = key.split("_")
  return { key, slotDate, slotHour: Number(hourStr), value }
}))
const pendingCount = computed(() => pendingCells.value.length)
const pendingBreakdown = computed(() => ({
  available: pendingCells.value.filter((c) => c.value === true).length,
  unavailable: pendingCells.value.filter((c) => c.value === false).length,
  cleared: pendingCells.value.filter((c) => c.value === null).length,
}))

const cellState = (date, hour) => {
  if (isBooked(date, hour)) return "booked"
  if (isPastSlot(date, hour)) return `${currentValue(keyOf(date, hour)) === true ? "available" : currentValue(keyOf(date, hour)) === false ? "unavailable" : "unset"} past`
  const key = keyOf(date, hour)
  const v = currentValue(key)
  const base = v === true ? "available" : v === false ? "unavailable" : "unset"
  return draftMap.has(key) ? `${base} unsaved` : base
}
const cellLabel = (date, hour) => {
  if (isBooked(date, hour)) return "面"
  const v = currentValue(keyOf(date, hour))
  if (v === true) return "○"
  if (v === false) return "×"
  return "-"
}

const roundLabel = (round) => (round >= 3 ? "最終面接" : `${round}次面接`)
const cellTitle = (date, hour) => {
  const booked = bookedMap.get(keyOf(date, hour))
  if (booked) return `${booked.studentName}／${roundLabel(booked.round)}（面接が確定しています）`
  if (isPastSlot(date, hour)) return "過ぎた日時のため変更できません"
  return ""
}

// 塗るモード。ドラッグでも単クリックでも、選択したセルをこの状態にする
const paintMode = ref("available")
// ボタンの見た目（記号・色）はカレンダーのセルと揃えて、どれを塗るのか一目で分かるようにする
const paintModes = [
  { value: "available", mark: "○", label: "空き", hint: "面接できる時間帯" },
  { value: "unavailable", mark: "×", label: "不可", hint: "面接できない時間帯" },
  { value: "clear", mark: "−", label: "取消", hint: "登録を取り消して未登録に戻す" },
]
const activeMode = computed(() => paintModes.find((m) => m.value === paintMode.value) ?? paintModes[0])
const paintValue = computed(() => {
  if (paintMode.value === "available") return true
  if (paintMode.value === "unavailable") return false
  return null
})

const onCellsSelect = ({ cells: selected }) => {
  // 確定した面接の枠は変更させない（CalendarPicker 側でも除外しているが二重に守る）
  const cells = selected.filter(({ date, hour }) => !isLocked(date, hour))
  if (cells.length === 0) return

  // 単セルを同じ状態に塗り直したときは取り消しとみなす（誤クリックを戻せるようにする）
  const firstKey = keyOf(cells[0].date, cells[0].hour)
  const isUndo = cells.length === 1 && paintValue.value !== null && currentValue(firstKey) === paintValue.value
  const value = isUndo ? null : paintValue.value

  cells.forEach(({ date, hour }) => setDraft(keyOf(date, hour), value))
}

const discardDraft = () => draftMap.clear()

// ---- 保存 ----
const confirmOpen = ref(false)
const isSaving = ref(false)

const openConfirm = () => {
  if (pendingCount.value === 0) return
  confirmOpen.value = true
}

const savedNotice = ref(false)
const saveError = ref("")

// サーバーの応答を数えて、全部返ってきたら保存完了とする
let awaitingResponses = 0
let saveTimer = null

const finishSave = () => {
  awaitingResponses = 0
  window.clearTimeout(saveTimer)
  isSaving.value = false
  draftMap.clear()
  savedNotice.value = true
  window.setTimeout(() => (savedNotice.value = false), 2600)
}

const failSave = (message) => {
  awaitingResponses = 0
  window.clearTimeout(saveTimer)
  isSaving.value = false
  saveError.value = message
}

// 保存の応答が来たら1つ消し込む。下書きは全部返ってくるまで残す
const countResponse = () => {
  if (awaitingResponses === 0) return
  awaitingResponses -= 1
  if (awaitingResponses === 0) finishSave()
}

const save = () => {
  const groups = [
    { value: true, cells: pendingCells.value.filter((c) => c.value === true) },
    { value: false, cells: pendingCells.value.filter((c) => c.value === false) },
    { value: null, cells: pendingCells.value.filter((c) => c.value === null) },
  ].filter((g) => g.cells.length > 0)

  saveError.value = ""
  isSaving.value = true
  confirmOpen.value = false
  awaitingResponses = groups.length

  for (const group of groups) {
    socket.emit("setAvailability", {
      cells: group.cells.map(({ slotDate, slotHour }) => ({ slotDate, slotHour })),
      isAvailable: group.value,
    })
  }

  saveTimer = window.setTimeout(
    () => failSave("保存の応答がありませんでした。通信状況を確認して、もう一度お試しください"),
    10000
  )
}

// 未保存のまま離れてしまうのを防ぐ
const warnBeforeUnload = (event) => {
  if (pendingCount.value === 0) return
  event.preventDefault()
  event.returnValue = ""
}
onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload))
onUnmounted(() => window.removeEventListener("beforeunload", warnBeforeUnload))
onBeforeRouteLeave(() => {
  if (pendingCount.value === 0) return true
  return window.confirm(`保存していない変更が ${pendingCount.value} 件あります。破棄して移動しますか？`)
})
</script>

<template>
  <div class="iv-page">
    <header class="page-header">
      <span class="eyebrow">AVAILABILITY</span>
      <h1>空き予定登録</h1>
      <p>面接可能な時間帯を登録します。ここで登録した空きが日程の自動照合に使われます。</p>
    </header>

    <div class="edit-bar">
      <div class="paint-picker">
        <span class="paint-picker__label">入力する内容</span>
        <div class="paint-modes" role="radiogroup" aria-label="入力する内容">
          <button
            v-for="mode in paintModes"
            :key="mode.value"
            type="button"
            role="radio"
            :aria-checked="paintMode === mode.value"
            :title="mode.hint"
            :class="['paint-mode', `paint-mode--${mode.value}`, { 'is-active': paintMode === mode.value }]"
            @click="paintMode = mode.value"
          >
            <span class="paint-mode__mark">{{ mode.mark }}</span>
            <span class="paint-mode__text">{{ mode.label }}</span>
          </button>
        </div>
      </div>

      <div class="edit-bar__spacer"></div>

      <span v-if="isSaving" class="saving-badge">保存中...</span>
      <span v-else-if="pendingCount > 0" class="pending-badge">未保存 {{ pendingCount }}件</span>
      <span v-else-if="savedNotice" class="saved-badge">保存しました</span>

      <v-btn size="small" variant="text" :disabled="pendingCount === 0 || isSaving" @click="discardDraft">破棄する</v-btn>
      <v-btn size="small" color="primary" :disabled="pendingCount === 0" :loading="isSaving" @click="openConfirm">
        保存する
      </v-btn>
    </div>

    <v-alert v-if="saveError" type="error" density="compact" class="mb-3" closable @click:close="saveError = ''">
      {{ saveError }}（変更は未保存のまま残しています）
    </v-alert>

    <p v-if="bookedCount > 0" class="booked-note">
      確定した面接が {{ bookedCount }} 件あります。その枠は「面」と表示され、変更できません。
      カーソルを合わせると候補者名が出ます。
    </p>

    <p class="hint">
      いま選んでいるのは
      <strong :class="`hint__mode hint__mode--${activeMode.value}`">{{ activeMode.mark }} {{ activeMode.label }}</strong>
      です。この状態でセルをクリックすると「{{ activeMode.hint }}」として入力されます。<br />
      セルをドラッグすると範囲をまとめて選べます。日付・時刻の見出しをクリックすると、その列・行をまとめて選べます。
      <strong>変更は「保存する」を押すまで反映されません</strong>（点線の枠が未保存の変更です）。
    </p>

    <div class="d-flex align-center ga-2 mb-3">
      <v-btn size="small" variant="outlined" @click="shiftWindow(-14)">&lt; 前の2週間</v-btn>
      <span class="text-body-2">{{ rangeStart }} 〜 {{ rangeEnd }}</span>
      <v-btn size="small" variant="outlined" @click="shiftWindow(14)">次の2週間 &gt;</v-btn>
      <v-btn size="small" variant="text" :disabled="isCurrentWindow" @click="goToToday">今日に戻る</v-btn>
    </div>

    <CalendarPicker
      :range-start="rangeStart"
      :range-end="rangeEnd"
      :cell-state="cellState"
      :cell-label="cellLabel"
      :cell-locked="isLocked"
      :cell-title="cellTitle"
      @cells-select="onCellsSelect"
    />

    <div class="legend">
      <span><i class="swatch swatch--available"></i>空き</span>
      <span><i class="swatch swatch--unavailable"></i>不可</span>
      <span><i class="swatch swatch--cleared"></i>未登録</span>
      <span><i class="swatch swatch--booked"></i>面接あり（変更できません）</span>
      <span><i class="swatch swatch--unsaved"></i>未保存の変更</span>
      <span><i class="swatch swatch--past"></i>過ぎた日時（変更できません）</span>
    </div>

    <v-dialog v-model="confirmOpen" max-width="420">
      <v-card class="pa-5">
        <div class="text-h6 mb-4">空き予定を保存しますか？</div>
        <ul class="confirm-list">
          <li v-if="pendingBreakdown.available > 0">
            <span class="swatch swatch--available"></span>空き（○）に変更　<strong>{{ pendingBreakdown.available }}件</strong>
          </li>
          <li v-if="pendingBreakdown.unavailable > 0">
            <span class="swatch swatch--unavailable"></span>不可（×）に変更　<strong>{{ pendingBreakdown.unavailable }}件</strong>
          </li>
          <li v-if="pendingBreakdown.cleared > 0">
            <span class="swatch swatch--cleared"></span>登録を取り消し　<strong>{{ pendingBreakdown.cleared }}件</strong>
          </li>
        </ul>
        <p class="text-caption text-medium-emphasis mt-3 mb-0">
          保存した空き予定は、日程の自動照合にすぐ使われます。
        </p>
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="confirmOpen = false">キャンセル</v-btn>
          <v-btn color="primary" :loading="isSaving" @click="save">保存する</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.edit-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.edit-bar__spacer { flex: 1; }

/* 塗るモードの選択は、この画面で最初に触る操作なのではっきり見せる */
.paint-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid #dbe2ee;
  border-radius: 14px;
  background: #fff;
  padding: 9px 14px;
  box-shadow: 0 1px 3px rgba(26, 34, 53, .08);
}
.paint-picker__label {
  color: #42506a;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .04em;
  white-space: nowrap;
}
.paint-modes { display: flex; gap: 8px; }
.paint-mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 104px;
  min-height: 42px;
  border: 2px solid var(--pm-line);
  border-radius: 10px;
  background: #fff;
  padding: 0 16px;
  color: var(--pm-line);
  font-size: 14px;
  font-weight: 750;
  line-height: 1;
  cursor: pointer;
  transition: background .15s, color .15s, box-shadow .15s, transform .1s;
}
.paint-mode__mark { font-size: 17px; font-weight: 800; }
.paint-mode:hover { background: var(--pm-tint); }
.paint-mode:active { transform: translateY(1px); }
.paint-mode:focus-visible { outline: 3px solid rgba(23, 105, 255, .45); outline-offset: 2px; }
.paint-mode.is-active {
  background: var(--pm-line);
  box-shadow: 0 0 0 3px var(--pm-ring), 0 2px 8px rgba(26, 34, 53, .2);
  color: #fff;
}
.paint-mode.is-active:hover { background: var(--pm-line); }
.paint-mode--available { --pm-line: #13894d; --pm-tint: #e8f8ee; --pm-ring: rgba(19, 137, 77, .25); }
.paint-mode--unavailable { --pm-line: #c9352a; --pm-tint: #fdecea; --pm-ring: rgba(201, 53, 42, .25); }
.paint-mode--clear { --pm-line: #4f5c74; --pm-tint: #eef1f6; --pm-ring: rgba(79, 92, 116, .25); }

.hint strong.hint__mode {
  border-radius: 6px;
  padding: 2px 8px;
  color: #fff;
  font-size: 12px;
}
.hint strong.hint__mode--available { background: #13894d; }
.hint strong.hint__mode--unavailable { background: #c9352a; }
.hint strong.hint__mode--clear { background: #4f5c74; }
.pending-badge {
  border-radius: 999px;
  background: #fdf1e0;
  padding: 4px 12px;
  color: #c2740a;
  font-size: 12px;
  font-weight: 700;
}
.saving-badge {
  border-radius: 999px;
  background: #eef1f6;
  padding: 4px 12px;
  color: #42506a;
  font-size: 12px;
  font-weight: 700;
}
.saved-badge {
  border-radius: 999px;
  background: #e6f6ec;
  padding: 4px 12px;
  color: #1a8a4c;
  font-size: 12px;
  font-weight: 700;
}
.hint {
  margin: 0 0 14px;
  color: #69758b;
  font-size: 12px;
  line-height: 1.7;
}
.hint strong { color: #1a2235; }

.confirm-list { margin: 0; padding: 0; list-style: none; }
.confirm-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  font-size: 14px;
}
.swatch { display: inline-block; width: 14px; height: 14px; border: 1px solid #ccc; border-radius: 3px; }
.swatch--available { border-color: #2ecc71; background: #2ecc71; }
.swatch--unavailable { border-color: #e74c3c; background: #e74c3c; }
.swatch--cleared { background: #fff; }
.swatch--booked { border-color: #1769ff; background: #1769ff; }
.swatch--unsaved { border: 2px dashed #1a2235; background: #fff; }
.swatch--past { background: #eef1f6; }

.booked-note {
  margin: 0 0 12px;
  border-left: 3px solid #1769ff;
  border-radius: 0 8px 8px 0;
  background: #f5f8ff;
  padding: 10px 12px;
  color: #1a2235;
  font-size: 12px;
  line-height: 1.7;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 14px;
  color: #69758b;
  font-size: 12px;
}
.legend span { display: flex; align-items: center; gap: 6px; }

.iv-page {
  height: 100%;
  overflow-y: auto;
  padding: 26px 30px 40px;
  background: #f7f9fc;
}
.iv-page .page-header { margin-bottom: 22px; }
.iv-page .eyebrow { color: #7a8699; font-size: 10px; font-weight: 750; letter-spacing: .12em; }
.iv-page h1 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -.02em; }
.iv-page .page-header p { margin: 0; color: #69758b; font-size: 12px; }

@media (max-width: 820px) {
  .iv-page { padding: 22px 18px 34px; }
}
</style>
