<script setup>
import { computed } from "vue"

const props = defineProps({
  rangeStart: { type: String, required: true }, // "YYYY-MM-DD"
  rangeEnd: { type: String, required: true },
  hours: { type: Array, default: () => [9, 10, 11, 12, 13, 14, 15, 16, 17] },
  cellState: { type: Function, required: true }, // (date, hour) => string (css state name)
  cellLabel: { type: Function, default: (date, hour) => `${hour}:00` },
})

const emit = defineEmits(["cellClick"])

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
</script>

<template>
  <div class="calendar-picker">
    <table>
      <thead>
        <tr>
          <th></th>
          <th v-for="date in dates" :key="date">{{ shortDate(date) }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="hour in hours" :key="hour">
          <th>{{ hour }}:00</th>
          <td v-for="date in dates" :key="date">
            <button
              type="button"
              class="cell"
              :class="cellState(date, hour)"
              @click="emit('cellClick', { date, hour })"
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
}
th, td {
  padding: 2px;
  text-align: center;
  font-size: 12px;
  white-space: nowrap;
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
</style>
