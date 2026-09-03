<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from "vue"
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

const cellState = (date, hour) => {
  const v = availabilityMap.get(keyOf(date, hour))
  if (v === true) return "available"
  if (v === false) return "unavailable"
  return "unset"
}
const cellLabel = (date, hour) => {
  const v = availabilityMap.get(keyOf(date, hour))
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
  const isUndo =
    cells.length === 1 && paintValue.value !== null && availabilityMap.get(keyOf(cells[0].date, cells[0].hour)) === paintValue.value
  const value = isUndo ? null : paintValue.value

  const payloadCells = cells.map(({ date, hour }) => ({ slotDate: date, slotHour: hour }))
  if (value === null) clearCells(payloadCells)
  else cells.forEach(({ date, hour }) => availabilityMap.set(keyOf(date, hour), value))

  socket.emit("setAvailability", { cells: payloadCells, isAvailable: value })
}
</script>

<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <v-btn-toggle v-model="paintMode" density="compact" color="primary" mandatory variant="outlined">
        <v-btn value="available" size="small">○ 空き</v-btn>
        <v-btn value="unavailable" size="small">× 不可</v-btn>
        <v-btn value="clear" size="small">− 取消</v-btn>
      </v-btn-toggle>
      <span class="text-caption">
        セルをドラッグすると範囲をまとめて登録できます。日付・時刻の見出しをクリックすると、その列・行を一括登録します。
      </span>
    </div>
    <div class="d-flex align-center ga-2 mb-2">
      <v-btn size="small" @click="shiftWindow(-14)">&lt; 前の2週間</v-btn>
      <span>{{ rangeStart }} 〜 {{ rangeEnd }}</span>
      <v-btn size="small" @click="shiftWindow(14)">次の2週間 &gt;</v-btn>
    </div>
    <CalendarPicker
      :range-start="rangeStart"
      :range-end="rangeEnd"
      :cell-state="cellState"
      :cell-label="cellLabel"
      @cells-select="onCellsSelect"
    />
  </div>
</template>

<style scoped>
</style>
