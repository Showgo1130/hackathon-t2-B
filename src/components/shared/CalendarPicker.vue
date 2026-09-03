<script setup>
import { computed, onUnmounted, ref } from "vue"

const props = defineProps({
  rangeStart: { type: String, required: true }, // "YYYY-MM-DD"
  rangeEnd: { type: String, required: true },
  hours: { type: Array, default: () => [9, 10, 11, 12, 13, 14, 15, 16, 17] },
  cellState: { type: Function, required: true }, // (date, hour) => string (css state name)
  cellLabel: { type: Function, default: (date, hour) => `${hour}:00` },
})

// cells は [{ date, hour }] の配列。単セルのクリックも要素1件の選択として通知する
const emit = defineEmits(["cellsSelect"])

const dates = computed(() => {
  const result = []
  const cursor = new Date(`${props.rangeStart}T00:00:00`)
  const end = new Date(`${props.rangeEnd}T00:00:00`)
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, "0")
    const d = String(cursor.getDate()).padStart(2, "0")
    result.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
})

const shortDate = (date) => {
  const d = new Date(`${date}T00:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`
}

// ---- ドラッグによる矩形選択 ----
const dragAnchor = ref(null) // { dateIdx, hourIdx }
const dragCursor = ref(null)

const dragRect = computed(() => {
  if (!dragAnchor.value || !dragCursor.value) return null
  return {
    dateMin: Math.min(dragAnchor.value.dateIdx, dragCursor.value.dateIdx),
    dateMax: Math.max(dragAnchor.value.dateIdx, dragCursor.value.dateIdx),
    hourMin: Math.min(dragAnchor.value.hourIdx, dragCursor.value.hourIdx),
    hourMax: Math.max(dragAnchor.value.hourIdx, dragCursor.value.hourIdx),
  }
})

const inDragRect = (dateIdx, hourIdx) => {
  const r = dragRect.value
  if (!r) return false
  return dateIdx >= r.dateMin && dateIdx <= r.dateMax && hourIdx >= r.hourMin && hourIdx <= r.hourMax
}

const rectCells = () => {
  const r = dragRect.value
  if (!r) return []
  const cells = []
  for (let d = r.dateMin; d <= r.dateMax; d += 1) {
    for (let h = r.hourMin; h <= r.hourMax; h += 1) {
      cells.push({ date: dates.value[d], hour: props.hours[h] })
    }
  }
  return cells
}

const endDrag = () => {
  const cells = rectCells()
  dragAnchor.value = null
  dragCursor.value = null
  window.removeEventListener("mouseup", endDrag)
  if (cells.length > 0) emit("cellsSelect", { cells })
}

// キーボード操作（Enter / Space）では単セルの選択として通知する
const selectCell = (dateIdx, hourIdx) => {
  emit("cellsSelect", { cells: [{ date: dates.value[dateIdx], hour: props.hours[hourIdx] }] })
}

const startDrag = (dateIdx, hourIdx, event) => {
  event.preventDefault() // ドラッグ中のテキスト選択を抑止する
  dragAnchor.value = { dateIdx, hourIdx }
  dragCursor.value = { dateIdx, hourIdx }
  window.addEventListener("mouseup", endDrag)
}

const extendDrag = (dateIdx, hourIdx) => {
  if (!dragAnchor.value) return
  dragCursor.value = { dateIdx, hourIdx }
}

onUnmounted(() => window.removeEventListener("mouseup", endDrag))

// ---- ヘッダークリックによる行／列の一括選択 ----
const selectDate = (date) => emit("cellsSelect", { cells: props.hours.map((hour) => ({ date, hour })) })
const selectHour = (hour) => emit("cellsSelect", { cells: dates.value.map((date) => ({ date, hour })) })
const selectAll = () =>
  emit("cellsSelect", { cells: dates.value.flatMap((date) => props.hours.map((hour) => ({ date, hour }))) })
</script>

<template>
  <div class="calendar-picker">
    <table>
      <thead>
        <tr>
          <th><button type="button" class="header-btn" title="全体を選択" @click="selectAll">全</button></th>
          <th v-for="date in dates" :key="date">
            <button type="button" class="header-btn" title="この日をまとめて選択" @click="selectDate(date)">
              {{ shortDate(date) }}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(hour, hourIdx) in hours" :key="hour">
          <th>
            <button type="button" class="header-btn" title="この時間をまとめて選択" @click="selectHour(hour)">
              {{ hour }}:00
            </button>
          </th>
          <td v-for="(date, dateIdx) in dates" :key="date">
            <button
              type="button"
              class="cell"
              :class="[cellState(date, hour), { dragging: inDragRect(dateIdx, hourIdx) }]"
              @mousedown="startDrag(dateIdx, hourIdx, $event)"
              @mouseenter="extendDrag(dateIdx, hourIdx)"
              @keydown.enter.prevent="selectCell(dateIdx, hourIdx)"
              @keydown.space.prevent="selectCell(dateIdx, hourIdx)"
            >
              {{ cellLabel(date, hour) }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.calendar-picker {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  user-select: none;
}
th, td {
  padding: 2px;
  text-align: center;
  font-size: 12px;
  white-space: nowrap;
}
.header-btn {
  padding: 2px 4px;
  border-radius: 4px;
  font: inherit;
  color: inherit;
  background: none;
  cursor: pointer;
}
.header-btn:hover {
  background: #eceff1;
}
.cell {
  width: 56px;
  height: 32px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.cell.selected {
  background: #3498db;
  color: #fff;
  border-color: #3498db;
}
.cell.available {
  background: #2ecc71;
  color: #fff;
  border-color: #2ecc71;
}
.cell.unavailable {
  background: #e74c3c;
  color: #fff;
  border-color: #e74c3c;
}
.cell.unset {
  background: #fff;
}
.cell.dragging {
  outline: 2px solid #34495e;
  outline-offset: -2px;
}
</style>
