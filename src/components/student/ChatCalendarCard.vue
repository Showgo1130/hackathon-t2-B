<script setup>
import { computed, reactive, ref, watch } from "vue"

const props = defineProps({
  rangeStart: { type: String, required: true }, // "YYYY-MM-DD"
  rangeEnd: { type: String, required: true },
  hours: { type: Array, default: () => [9, 10, 11, 12, 13, 14, 15, 16, 17] },
  readonly: { type: Boolean, default: false }, // HR views this component as readonly if needed
  submittedSlots: { type: Array, default: () => [] } // 提出済み { slotDate, slotHour } の一覧（readonly時の表示用）
})

const emit = defineEmits(["submit"])

const parseDate = (dateStr) => new Date(`${dateStr}T00:00:00`)
const toIso = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const rangeDates = computed(() => {
  const result = []
  const cursor = parseDate(props.rangeStart)
  const end = parseDate(props.rangeEnd)
  while (cursor <= end) {
    result.push(toIso(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
})
const dateSet = computed(() => new Set(rangeDates.value))

const calendarMonths = computed(() => {
  if (rangeDates.value.length === 0) return []
  const startMonth = parseDate(props.rangeStart)
  startMonth.setDate(1)
  const endMonth = parseDate(props.rangeEnd)
  
  const months = []
  const cursor = new Date(startMonth)
  while (cursor.getFullYear() < endMonth.getFullYear() || (cursor.getFullYear() === endMonth.getFullYear() && cursor.getMonth() <= endMonth.getMonth())) {
    months.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  
  return months.map(month => {
    const y = month.getFullYear()
    const m = month.getMonth()
    const firstDay = new Date(y, m, 1)
    const lastDay = new Date(y, m + 1, 0)
    
    const leadingDays = firstDay.getDay()
    const days = []
    
    for (let i = 0; i < leadingDays; i++) {
      days.push(null)
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(toIso(new Date(y, m, i)))
    }
    
    return {
      title: `${y}年 ${m + 1}月`,
      days
    }
  })
})

const keyOf = (date, hour) => `${date}_${hour}`

const selection = reactive(new Set())

// デフォルトでは何も選択しない。提出済みスロットがある場合はそれだけを反映する
const initSelection = () => {
  selection.clear()
  props.submittedSlots.forEach(({ slotDate, slotHour }) => {
    selection.add(keyOf(slotDate, slotHour))
  })
}
// Call immediately
initSelection()

const selectedDate = ref(props.submittedSlots[0]?.slotDate ?? null)
const isSelected = (date, hour) => selection.has(keyOf(date, hour))
const isSelectedOnCurrent = (hour) => isSelected(selectedDate.value, hour)

// Check if ALL hours are selected for the current date
const isAllHoursSelectedForCurrent = computed(() => {
  return props.hours.every(h => selection.has(keyOf(selectedDate.value, h)))
})

const toggleHour = (hour) => {
  if (props.readonly) return
  const key = keyOf(selectedDate.value, hour)
  if (selection.has(key)) selection.delete(key)
  else selection.add(key)
}

const toggleAllHoursForCurrent = (val) => {
  if (props.readonly) return
  props.hours.forEach(h => {
    const key = keyOf(selectedDate.value, h)
    if (val) selection.add(key)
    else selection.delete(key)
  })
}

const summary = computed(() =>
  [...selection]
    .map((key) => {
      const [date, hourStr] = key.split("_")
      return { key, date, hour: Number(hourStr) }
    })
    .sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1))
)

const canSubmit = computed(() => selection.size > 0)

const confirmAndSubmit = () => {
  if (!canSubmit.value || props.readonly) return
  const slots = summary.value.map(({ date, hour }) => ({ slotDate: date, slotHour: hour }))
  emit("submit", slots)
}

const getDayNumber = (dateStr) => {
  if (!dateStr) return ""
  return parseDate(dateStr).getDate()
}

const isDateInRange = (dateStr) => {
  if (!dateStr) return false
  return dateSet.value.has(dateStr)
}

const hasSelection = (dateStr) => {
  if (!dateStr) return false
  return props.hours.some(h => selection.has(keyOf(dateStr, h)))
}
</script>

<template>
  <div class="calendar-card">
    <div class="text-subtitle-1 mb-1 font-weight-bold">
      面接可能な時間帯を選択
    </div>
    <div class="text-caption text-medium-emphasis mb-4">
      対象期間: {{ rangeStart }} 〜 {{ rangeEnd }}
    </div>

    <!-- Calendar View -->
    <div v-for="month in calendarMonths" :key="month.title" class="month-view mb-4">
      <div class="month-title text-center mb-2 font-weight-bold">{{ month.title }}</div>
      <div class="calendar-grid">
        <div class="day-header text-red">日</div>
        <div class="day-header">月</div>
        <div class="day-header">火</div>
        <div class="day-header">水</div>
        <div class="day-header">木</div>
        <div class="day-header">金</div>
        <div class="day-header text-blue">土</div>

        <template v-for="(date, i) in month.days" :key="i">
          <div v-if="!date" class="calendar-cell empty"></div>
          <button
            v-else
            type="button"
            class="calendar-cell date-cell"
            :class="{
              'in-range': isDateInRange(date),
              'selected-date': date === selectedDate,
              'has-selection': hasSelection(date),
              'out-of-range': !isDateInRange(date)
            }"
            :disabled="!isDateInRange(date)"
            @click="selectedDate = date"
          >
            {{ getDayNumber(date) }}
          </button>
        </template>
      </div>
    </div>

    <v-divider class="my-4" />

    <!-- Time slots for selected day -->
    <div v-if="selectedDate" class="time-selection-area">
      <div class="d-flex align-center justify-space-between mb-3">
        <div class="text-subtitle-2 font-weight-bold">
          {{ selectedDate }} の時間帯
        </div>
        <v-checkbox
          v-if="!readonly"
          :model-value="isAllHoursSelectedForCurrent"
          @update:model-value="toggleAllHoursForCurrent"
          label="全ての時間帯可能"
          color="primary"
          density="compact"
          hide-details
          class="flex-grow-0"
        ></v-checkbox>
      </div>

      <div class="hour-grid">
        <v-btn
          v-for="hour in hours"
          :key="hour"
          type="button"
          :variant="isSelectedOnCurrent(hour) ? 'flat' : 'outlined'"
          :color="isSelectedOnCurrent(hour) ? 'primary' : 'grey-darken-1'"
          class="hour-btn"
          size="small"
          :disabled="readonly"
          @click="toggleHour(hour)"
        >
          {{ hour }}:00
        </v-btn>
      </div>
    </div>
    <div v-else-if="!readonly" class="text-caption text-medium-emphasis pick-date-hint">
      日にちを選ぶと、時間帯を選べます
    </div>

    <v-divider class="my-4" v-if="!readonly" />

    <div v-if="!readonly" class="d-flex align-center justify-space-between">
      <div class="text-caption">
        選択中の候補: <strong>{{ selection.size }}</strong> 件
      </div>
      <v-btn
        color="primary"
        :disabled="!canSubmit"
        @click="confirmAndSubmit"
      >
        確定して送信
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.calendar-card {
  width: 100%;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  max-width: 360px;
  margin: 0 auto;
}
.day-header {
  text-align: center;
  font-size: 12px;
  font-weight: bold;
  padding: 4px 0;
}
.calendar-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  border-radius: 4px;
  border: 1px solid transparent;
}
.date-cell {
  cursor: pointer;
  background: #f7f9fc;
  border-color: #e4e9f1;
}
.date-cell.out-of-range {
  color: #d1d5db;
  cursor: not-allowed;
  background: transparent;
  border-color: transparent;
}
.date-cell.in-range:hover:not(.selected-date) {
  background: #f3f4f6;
  border-color: #d1d5db;
}
.date-cell.has-selection {
  background: #dbeafe;
  border-color: #bfdbfe;
  color: #1e40af;
  font-weight: bold;
}
.date-cell.selected-date {
  background: #1769ff;
  border-color: #1769ff;
  color: white;
  font-weight: bold;
}
.hour-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.hour-btn {
  min-width: 72px;
}
.pick-date-hint {
  text-align: center;
  padding: 8px 0;
}
</style>
