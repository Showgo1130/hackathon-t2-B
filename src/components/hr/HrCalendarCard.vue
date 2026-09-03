<script setup>
import { computed, ref } from "vue"
import HrIcon from "./ui/HrIcon.vue"

const props = defineProps({
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  selectedDay: { type: Number, required: true },
  deadlineLabel: { type: String, default: "" },
})

const emit = defineEmits(["update:month", "select", "submit"])
const weekDays = ["日", "月", "火", "水", "木", "金", "土"]
const hours = Array.from({ length: 10 }, (_, index) => index + 9)
const selectedSlots = ref([])
const submitted = ref(false)

const days = computed(() => {
  const offset = new Date(props.year, props.month - 1, 1).getDay()
  const count = new Date(props.year, props.month, 0).getDate()
  return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
})

const activeDateLabel = computed(() => {
  const date = new Date(props.year, props.month - 1, props.selectedDay)
  return `${props.month}月${props.selectedDay}日（${weekDays[date.getDay()]}）`
})

const sortedSlots = computed(() => [...selectedSlots.value].sort((a, b) =>
  a.year - b.year || a.month - b.month || a.day - b.day || a.hour - b.hour
))

const slotKey = ({ year, month, day, hour }) => `${year}-${month}-${day}-${hour}`
const isHourSelected = (hour) => selectedSlots.value.some((slot) => slotKey(slot) === slotKey({ year: props.year, month: props.month, day: props.selectedDay, hour }))
const slotsOnDay = (day) => selectedSlots.value.filter((slot) => slot.year === props.year && slot.month === props.month && slot.day === day).length

const selectDay = (day) => {
  if (!day) return
  emit("select", day)
}

const toggleHour = (hour) => {
  const target = { year: props.year, month: props.month, day: props.selectedDay, hour }
  const key = slotKey(target)
  const index = selectedSlots.value.findIndex((slot) => slotKey(slot) === key)
  if (index >= 0) selectedSlots.value.splice(index, 1)
  else selectedSlots.value.push(target)
  submitted.value = false
}

const removeSlot = (slot) => {
  selectedSlots.value = selectedSlots.value.filter((item) => slotKey(item) !== slotKey(slot))
  submitted.value = false
}

const clearSlots = () => {
  selectedSlots.value = []
  submitted.value = false
}

const formatSlot = (slot) => {
  const date = new Date(slot.year, slot.month - 1, slot.day)
  return `${slot.month}/${slot.day}（${weekDays[date.getDay()]}） ${String(slot.hour).padStart(2, "0")}:00–${String(slot.hour + 1).padStart(2, "0")}:00`
}

const submitSlots = () => {
  if (!selectedSlots.value.length) return
  submitted.value = true
  emit("submit", sortedSlots.value)
}
</script>

<template>
  <section class="schedule-card">
    <div class="schedule-card__intro">
      <strong>二次面接の日程調整</strong>
      <p>参加できる日時をすべて選択してください</p>
      <span>回答期限：{{ deadlineLabel }}</span>
    </div>

    <div class="calendar-section">
      <div class="step-label"><span>1</span><strong>日付を選択</strong></div>
      <div class="calendar-head">
        <button type="button" aria-label="前の月" @click="emit('update:month', -1)"><HrIcon name="back" :size="18" /></button>
        <strong>{{ year }}年{{ month }}月</strong>
        <button class="calendar-head__next" type="button" aria-label="次の月" @click="emit('update:month', 1)"><HrIcon name="back" :size="18" /></button>
      </div>

      <div class="calendar-grid calendar-grid--week"><span v-for="day in weekDays" :key="day">{{ day }}</span></div>
      <div class="calendar-grid">
        <button
          v-for="(day, index) in days"
          :key="`${day}-${index}`"
          type="button"
          :disabled="!day"
          :class="{ selected: day === selectedDay, 'has-slots': slotsOnDay(day) }"
          :aria-label="day ? `${month}月${day}日${slotsOnDay(day) ? `、${slotsOnDay(day)}件選択中` : ''}` : undefined"
          @click="selectDay(day)"
        >
          {{ day }}<i v-if="day && slotsOnDay(day)">{{ slotsOnDay(day) }}</i>
        </button>
      </div>
    </div>

    <div class="time-section">
      <div class="step-label"><span>2</span><div><strong>時間を選択</strong><small>{{ activeDateLabel }}</small></div></div>
      <div class="time-grid">
        <button v-for="hour in hours" :key="hour" type="button" :class="{ selected: isHourSelected(hour) }" :aria-pressed="isHourSelected(hour)" @click="toggleHour(hour)">
          <span v-if="isHourSelected(hour)" class="time-check"><HrIcon name="check" :size="11" /></span>
          <span>{{ String(hour).padStart(2, "0") }}:00</span><small>– {{ String(hour + 1).padStart(2, "0") }}:00</small>
        </button>
      </div>
      <p class="time-note">各枠は1時間です。複数の候補を選択できます。</p>
    </div>

    <div class="selection-section" :class="{ 'selection-section--empty': !selectedSlots.length }">
      <div class="selection-head">
        <strong>選択した候補日時 <span>{{ selectedSlots.length }}</span></strong>
        <button v-if="selectedSlots.length" type="button" @click="clearSlots">すべて解除</button>
      </div>
      <div v-if="selectedSlots.length" class="selected-list">
        <span v-for="slot in sortedSlots" :key="slotKey(slot)">
          <HrIcon name="calendar" :size="13" />{{ formatSlot(slot) }}
          <button type="button" :aria-label="`${formatSlot(slot)}を解除`" @click="removeSlot(slot)"><HrIcon name="close" :size="12" /></button>
        </span>
      </div>
      <p v-else>カレンダーから日付と時間を選んでください</p>
    </div>

    <div class="submit-area">
      <p v-if="submitted" class="sent-message"><span><HrIcon name="check" :size="12" /></span>候補日時を送信しました</p>
      <button class="submit-button" type="button" :disabled="!selectedSlots.length || submitted" @click="submitSlots">
        <HrIcon :name="submitted ? 'check' : 'send'" :size="16" />{{ submitted ? "送信済み" : `${selectedSlots.length}件の候補を送信` }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.schedule-card { display: grid; grid-template-columns: minmax(250px, .92fr) minmax(270px, 1.08fr); margin-top: 9px; overflow: hidden; border: 1px solid #dce5f5; border-radius: 14px; background: #fff; color: #18213a; }
.schedule-card__intro { grid-column: 1 / -1; padding: 12px 16px 10px; border-bottom: 1px solid #edf1f7; }.schedule-card__intro strong { display: block; font-size: 12px; }.schedule-card__intro p { display: inline; margin: 0 12px 0 0; color: #667085; font-size: 9px; }.schedule-card__intro > span { color: #778198; font-size: 8px; }
.calendar-section,.time-section,.selection-section { padding: 11px 13px; border-bottom: 1px solid #edf1f7; }.calendar-section { border-right: 1px solid #edf1f7; }.step-label { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }.step-label > span { display: grid; width: 17px; height: 17px; flex: 0 0 auto; place-items: center; border-radius: 50%; background: #e8f0ff; color: #1769ff; font-size: 8px; font-weight: 800; }.step-label > strong,.step-label div strong { display: block; color: #344054; font-size: 9px; }.step-label div { display: flex; align-items: baseline; gap: 7px; }.step-label div small { color: #1769ff; font-size: 8px; font-weight: 700; }
.calendar-head { display: grid; grid-template-columns: 30px 1fr 30px; align-items: center; padding: 5px 0 8px; text-align: center; }.calendar-head strong { font-size: 12px; }.calendar-head button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #344054; cursor: pointer; }.calendar-head button:hover { background: #f2f5fa; }.calendar-head__next { transform: rotate(180deg); }
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }.calendar-grid--week { padding-bottom: 4px; color: #7b8498; font-size: 9px; text-align: center; }.calendar-grid > button { position: relative; aspect-ratio: 1; min-width: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #344054; font: inherit; font-size: 9px; cursor: pointer; }.calendar-grid > button:not(:disabled):hover { background: #edf3ff; color: #145ee8; }.calendar-grid > button.selected { border-color: #1769ff; background: #1769ff; box-shadow: 0 3px 8px rgb(23 105 255 / 25%); color: #fff; }.calendar-grid > button:disabled { cursor: default; }.calendar-grid > button.has-slots:not(.selected) { border-color: #a9c4f9; background: #f0f5ff; color: #1769ff; font-weight: 800; }.calendar-grid > button i { position: absolute; top: -3px; right: -2px; display: grid; min-width: 13px; height: 13px; place-items: center; border: 2px solid #fff; border-radius: 7px; background: #1769ff; color: #fff; font-size: 7px; font-style: normal; }
.time-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5px; }.time-grid button { position: relative; display: flex; min-height: 33px; align-items: baseline; justify-content: center; gap: 4px; border: 1px solid #dce3ed; border-radius: 7px; background: #fff; color: #354158; font: inherit; cursor: pointer; }.time-grid button:hover { border-color: #9fbcf4; background: #f7f9ff; }.time-grid button.selected { border-color: #1769ff; background: #edf3ff; box-shadow: inset 0 0 0 1px #1769ff; color: #145ee8; font-weight: 800; }.time-grid button > span:not(.time-check) { font-size: 9px; }.time-grid button small { font-size: 7px; }.time-check { position: absolute; top: -5px; right: -4px; display: grid; width: 15px; height: 15px; place-items: center; border: 2px solid #fff; border-radius: 50%; background: #1769ff; color: #fff; }.time-note { margin: 6px 0 0; color: #8993a4; font-size: 7px; }
.selection-section { min-height: 78px; border-bottom: 0; background: #fbfcfe; }.selection-section--empty { padding-top: 12px; padding-bottom: 12px; }.selection-head { display: flex; align-items: center; justify-content: space-between; }.selection-head strong { color: #344054; font-size: 9px; }.selection-head strong span { display: inline-grid; min-width: 17px; height: 17px; margin-left: 4px; place-items: center; border-radius: 9px; background: #1769ff; color: #fff; font-size: 8px; }.selection-head > button { border: 0; background: transparent; color: #6f7b90; font-size: 8px; cursor: pointer; }.selection-head > button:hover { color: #d04444; }.selected-list { display: flex; max-height: 54px; flex-wrap: wrap; gap: 4px; overflow-y: auto; margin-top: 7px; }.selected-list > span { display: flex; height: 25px; align-items: center; gap: 5px; border: 1px solid #d7e2f6; border-radius: 7px; padding: 0 5px 0 7px; background: #fff; color: #31517f; font-size: 7px; font-weight: 700; }.selected-list > span > svg { color: #1769ff; }.selected-list button { display: grid; width: 17px; height: 17px; place-items: center; border: 0; border-radius: 5px; background: transparent; color: #7f899b; cursor: pointer; }.selected-list button:hover { background: #fff0f0; color: #d04444; }.selection-section > p { margin: 5px 0 0; color: #929cad; font-size: 8px; }
.submit-area { display: flex; flex-direction: column; justify-content: center; border-left: 1px solid #edf1f7; padding: 12px 14px; }.submit-button { display: flex; width: 100%; height: 37px; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 8px; background: #1769ff; box-shadow: 0 5px 12px rgb(23 105 255 / 23%); color: #fff; font: inherit; font-size: 9px; font-weight: 800; cursor: pointer; }.submit-button:hover:not(:disabled) { background: #0758ed; }.submit-button:disabled { background: #c8d5e9; box-shadow: none; cursor: not-allowed; }.sent-message { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0 0 6px; color: #16895d; font-size: 8px; font-weight: 750; }.sent-message span { display: grid; width: 17px; height: 17px; place-items: center; border-radius: 50%; background: #e4f7ee; }
@media (max-width: 700px) { .schedule-card { display: block; }.schedule-card__intro p { display: block; margin: 6px 0 3px; }.calendar-section { border-right: 0; }.selection-section { border-bottom: 1px solid #edf1f7; }.submit-area { border-left: 0; }.selected-list { max-height: none; flex-direction: column; flex-wrap: nowrap; overflow: visible; }.selected-list > span { width: 100%; } }
</style>
