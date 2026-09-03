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

const onAvailabilityData = (rows) => applyRows(rows)
const onAvailabilityUpdated = (rows) => applyRows(rows)
const onAvailabilityCleared = (cells) => clearCells(cells)

onMounted(() => {
  socket.on("availabilityData", onAvailabilityData)
  socket.on("availabilityUpdated", onAvailabilityUpdated)
  socket.on("availabilityCleared", onAvailabilityCleared)
  loadAvailability()
})
onUnmounted(() => {
  socket.off("availabilityData", onAvailabilityData)
  socket.off("availabilityUpdated", onAvailabilityUpdated)
  socket.off("availabilityCleared", onAvailabilityCleared)
})

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
  const key = keyOf(date, hour)
  const v = currentValue(key)
  const base = v === true ? "available" : v === false ? "unavailable" : "unset"
  return draftMap.has(key) ? `${base} unsaved` : base
}
const cellLabel = (date, hour) => {
  const v = currentValue(keyOf(date, hour))
  if (v === true) return "○"
  if (v === false) return "×"
  return "-"
}

// 塗るモード。ドラッグでも単クリックでも、選択したセルをこの状態にする
const paintMode = ref("available")
const paintValue = computed(() => {
  if (paintMode.value === "available") return true
  if (paintMode.value === "unavailable") return false
  return null
})

const onCellsSelect = ({ cells }) => {
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

const save = () => {
  const groups = [
    { value: true, cells: pendingCells.value.filter((c) => c.value === true) },
    { value: false, cells: pendingCells.value.filter((c) => c.value === false) },
    { value: null, cells: pendingCells.value.filter((c) => c.value === null) },
  ]

  isSaving.value = true
  for (const group of groups) {
    if (group.cells.length === 0) continue
    socket.emit("setAvailability", {
      cells: group.cells.map(({ slotDate, slotHour }) => ({ slotDate, slotHour })),
      isAvailable: group.value,
    })
  }

  // 送信済みの下書きは、サーバーからの反映を待たずに手元でも確定させる
  pendingCells.value.forEach(({ key, slotDate, slotHour, value }) => {
    if (value === null) availabilityMap.delete(key)
    else availabilityMap.set(keyOf(slotDate, slotHour), value)
  })
  draftMap.clear()

  confirmOpen.value = false
  isSaving.value = false
  savedNotice.value = true
  window.setTimeout(() => (savedNotice.value = false), 2600)
}

const savedNotice = ref(false)

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
      <v-btn-toggle v-model="paintMode" density="compact" color="primary" mandatory variant="outlined">
        <v-btn value="available" size="small">○ 空き</v-btn>
        <v-btn value="unavailable" size="small">× 不可</v-btn>
        <v-btn value="clear" size="small">− 取消</v-btn>
      </v-btn-toggle>

      <div class="edit-bar__spacer"></div>

      <span v-if="pendingCount > 0" class="pending-badge">未保存 {{ pendingCount }}件</span>
      <span v-else-if="savedNotice" class="saved-badge">保存しました</span>

      <v-btn size="small" variant="text" :disabled="pendingCount === 0" @click="discardDraft">破棄する</v-btn>
      <v-btn size="small" color="primary" :disabled="pendingCount === 0" @click="openConfirm">保存する</v-btn>
    </div>

    <p class="hint">
      セルをドラッグすると範囲をまとめて選べます。日付・時刻の見出しをクリックすると、その列・行をまとめて選べます。
      <strong>変更は「保存する」を押すまで反映されません</strong>（点線の枠が未保存の変更です）。
    </p>

    <div class="d-flex align-center ga-2 mb-3">
      <v-btn size="small" variant="outlined" @click="shiftWindow(-14)">&lt; 前の2週間</v-btn>
      <span class="text-body-2">{{ rangeStart }} 〜 {{ rangeEnd }}</span>
      <v-btn size="small" variant="outlined" @click="shiftWindow(14)">次の2週間 &gt;</v-btn>
    </div>

    <CalendarPicker
      :range-start="rangeStart"
      :range-end="rangeEnd"
      :cell-state="cellState"
      :cell-label="cellLabel"
      @cells-select="onCellsSelect"
    />

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
.pending-badge {
  border-radius: 999px;
  background: #fdf1e0;
  padding: 4px 12px;
  color: #c2740a;
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
