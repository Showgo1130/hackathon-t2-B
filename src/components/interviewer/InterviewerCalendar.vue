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

const loadAvailability = () => {
  socket.emit("loadAvailability", { rangeStart: rangeStart.value, rangeEnd: rangeEnd.value })
}

const onAvailabilityData = (rows) => applyRows(rows)
const onAvailabilityUpdated = (row) => applyRows([row])

onMounted(() => {
  socket.on("availabilityData", onAvailabilityData)
  socket.on("availabilityUpdated", onAvailabilityUpdated)
  loadAvailability()
})
onUnmounted(() => {
  socket.off("availabilityData", onAvailabilityData)
  socket.off("availabilityUpdated", onAvailabilityUpdated)
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
const toggleCell = ({ date, hour }) => {
  const current = availabilityMap.get(keyOf(date, hour))
  const next = current !== true
  availabilityMap.set(keyOf(date, hour), next)
  socket.emit("setAvailability", { slotDate: date, slotHour: hour, isAvailable: next })
}
</script>

<template>
  <div>
    <p class="mb-2">クリックで 空き(○) / 不可(×) を切り替えられます</p>
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
      @cell-click="toggleCell"
    />
  </div>
</template>

<style scoped>
</style>
