<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue"
import socketManager from "../../socketManager.js"

const socket = socketManager.getInstance()

// 面接の共通情報（予定ごとに変わらないためDBは持たず、ここで固定値を持つ）
const MEETING = {
  durationMin: 60,
  format: "オンライン（Zoom）",
  zoomUrl: "https://zoom.us/j/9876543210?pwd=sample",
  zoomId: "987 6543 210",
  zoomPasscode: "123456",
  note: "開始5分前までにZoomへ入室してください。接続できない場合は人事担当までご連絡ください。",
}

// 確定済みの面接（日時・参加者・何次面接）をサーバーから受け取る
const schedules = ref([])
const loaded = ref(false)

const onScheduleData = (rows) => {
  schedules.value = rows.map((row) => ({
    ...row,
    startAt: new Date(`${row.confirmedDate}T${String(row.confirmedHour).padStart(2, "0")}:00:00`),
  }))
  loaded.value = true
}

// 日程が確定するとチャットに確定通知が届くので、それを合図に一覧を取り直す
const onNewMessage = (message) => {
  if (message.msg_type === "system_notice" && message.payload?.confirmedDate) {
    socket.emit("loadSchedules")
  }
}

const now = ref(new Date())
let clockTimer = null

const loadSchedules = () => socket.emit("loadSchedules")

onMounted(() => {
  socket.on("scheduleData", onScheduleData)
  socket.on("newMessage", onNewMessage)
  socket.on("connect", loadSchedules)
  loadSchedules()
  // 開催時刻を過ぎた予定を「過去の予定」へ移すため、現在時刻を定期更新する
  clockTimer = setInterval(() => (now.value = new Date()), 60 * 1000)
})
onUnmounted(() => {
  socket.off("scheduleData", onScheduleData)
  socket.off("newMessage", onNewMessage)
  socket.off("connect", loadSchedules)
  clearInterval(clockTimer)
})

const tab = ref("upcoming")
const selectedId = ref(null)
const selected = computed(() => schedules.value.find((s) => s.id === selectedId.value) ?? null)

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]
const formatDate = (d) =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}（${WEEKDAYS[d.getDay()]}）`
const formatTime = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
const formatRange = (item) => {
  const end = new Date(item.startAt.getTime() + MEETING.durationMin * 60 * 1000)
  return `${formatDate(item.startAt)} ${formatTime(item.startAt)} 〜 ${formatTime(end)}`
}
const roundLabel = (round) => (round >= 3 ? "最終面接" : `${round}次面接`)

const upcoming = computed(() =>
  schedules.value.filter((s) => s.startAt.getTime() >= now.value.getTime()).sort((a, b) => a.startAt - b.startAt)
)
const past = computed(() =>
  schedules.value.filter((s) => s.startAt.getTime() < now.value.getTime()).sort((a, b) => b.startAt - a.startAt)
)
const currentList = computed(() => (tab.value === "upcoming" ? upcoming.value : past.value))

const DAY_MS = 24 * 60 * 60 * 1000
const SOON_MS = 3 * DAY_MS
const isSoon = (item) => item.startAt.getTime() - now.value.getTime() < SOON_MS && item.startAt.getTime() >= now.value.getTime()
const isPast = (item) => item.startAt.getTime() < now.value.getTime()

// 面接官が一番見たい情報なので、一覧の前に直近の予定を出す
const nextSchedule = computed(() => upcoming.value[0] ?? null)
const thisWeekCount = computed(
  () => upcoming.value.filter((s) => s.startAt.getTime() - now.value.getTime() < 7 * DAY_MS).length
)

const openDetail = (item) => {
  selectedId.value = item.id
}
const closeDetail = () => {
  selectedId.value = null
}

const copied = ref(false)
const copyZoomUrl = async () => {
  try {
    await navigator.clipboard.writeText(MEETING.zoomUrl)
    copied.value = true
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section class="schedule-panel">
    <div class="stat-row">
      <div class="stat-card stat-card--next">
        <div class="stat-label">次の面接</div>
        <template v-if="nextSchedule">
          <div class="stat-main">{{ formatRange(nextSchedule) }}</div>
          <div class="stat-sub">{{ nextSchedule.studentName }}／{{ roundLabel(nextSchedule.round) }}</div>
        </template>
        <div v-else class="stat-sub">予定はありません</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今週の面接</div>
        <div class="stat-count">{{ thisWeekCount }}<span>件</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">今後の予定</div>
        <div class="stat-count">{{ upcoming.length }}<span>件</span></div>
      </div>
    </div>

    <v-tabs v-model="tab" color="primary" density="comfortable" class="mb-3">
      <v-tab value="upcoming">今後の予定（{{ upcoming.length }}）</v-tab>
      <v-tab value="past">過去の予定（{{ past.length }}）</v-tab>
    </v-tabs>

    <v-card
      v-for="item in currentList"
      :key="item.id"
      class="mb-3 schedule-card"
      variant="outlined"
      role="button"
      tabindex="0"
      :aria-label="`${item.studentName} ${roundLabel(item.round)} ${formatRange(item)} の詳細を開く`"
      @click="openDetail(item)"
      @keydown.enter.prevent="openDetail(item)"
      @keydown.space.prevent="openDetail(item)"
    >
      <div class="d-flex align-center pa-4 ga-4">
        <v-avatar color="primary" size="44">
          <span class="text-white text-subtitle-1">{{ item.studentName.slice(-2) }}</span>
        </v-avatar>

        <div class="flex-grow-1">
          <div class="d-flex align-center ga-2 mb-1 flex-wrap">
            <span class="text-subtitle-1 font-weight-medium">{{ item.studentName }}</span>
            <v-chip size="x-small" color="primary" variant="tonal">{{ roundLabel(item.round) }}</v-chip>
            <v-chip v-if="isSoon(item)" size="x-small" color="warning" variant="tonal">まもなく</v-chip>
          </div>
          <div class="text-body-2">{{ formatRange(item) }}</div>
          <div class="text-caption text-medium-emphasis">{{ MEETING.format }}</div>
        </div>

        <span class="text-h6 text-medium-emphasis">&rsaquo;</span>
      </div>
    </v-card>

    <v-card v-if="currentList.length === 0" variant="outlined" class="pa-6 text-center text-medium-emphasis">
      {{ !loaded ? "読み込み中..." : tab === "upcoming" ? "今後の予定はありません" : "過去の予定はありません" }}
    </v-card>

    <!-- 詳細は画面遷移ではなくダイアログで開き、一覧の文脈を保つ -->
    <v-dialog :model-value="!!selected" max-width="520" @update:model-value="closeDetail">
      <v-card v-if="selected" class="pa-5">
        <div class="d-flex align-center ga-2 mb-4 flex-wrap">
          <h2 class="text-h6 font-weight-medium">{{ selected.studentName }}</h2>
          <v-chip size="small" color="primary" variant="tonal">{{ roundLabel(selected.round) }}</v-chip>
        </div>

        <v-divider class="mb-4" />

        <div class="detail-row">
          <div class="detail-label">日時</div>
          <div>{{ formatRange(selected) }}（{{ MEETING.durationMin }}分）</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">参加者</div>
          <div>{{ selected.attendees.join("、") }}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">形式</div>
          <div>{{ MEETING.format }}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Zoom URL</div>
          <div class="d-flex align-center ga-2 flex-wrap">
            <a :href="MEETING.zoomUrl" target="_blank" rel="noopener">{{ MEETING.zoomUrl }}</a>
            <v-btn size="x-small" variant="tonal" @click="copyZoomUrl">
              {{ copied ? "コピーしました" : "コピー" }}
            </v-btn>
          </div>
        </div>
        <div class="detail-row">
          <div class="detail-label">ミーティングID</div>
          <div>{{ MEETING.zoomId }}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">パスコード</div>
          <div>{{ MEETING.zoomPasscode }}</div>
        </div>
        <div class="detail-row">
          <div class="detail-label">備考</div>
          <div>{{ MEETING.note }}</div>
        </div>

        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" @click="closeDetail">閉じる</v-btn>
          <v-btn
            v-if="!isPast(selected)"
            color="primary"
            :href="MEETING.zoomUrl"
            target="_blank"
            rel="noopener"
          >
            Zoomに参加する
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.stat-row {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
  margin-bottom: 18px;
}
.stat-card {
  border: 1px solid #e4e9f1;
  border-radius: 10px;
  background: #fff;
  padding: 14px 16px;
}
.stat-card--next { border-color: #d5e3ff; background: linear-gradient(90deg, #edf3ff, #f7faff); }
.stat-label { color: #69758b; font-size: 11px; font-weight: 700; }
.stat-main { margin-top: 6px; font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
.stat-sub { margin-top: 4px; color: #69758b; font-size: 12px; }
.stat-count { margin-top: 6px; font-size: 24px; font-weight: 700; }
.stat-count span { margin-left: 3px; color: #69758b; font-size: 12px; font-weight: 500; }

.schedule-card {
  cursor: pointer;
  transition: box-shadow .15s ease, border-color .15s ease;
}
.schedule-card:hover,
.schedule-card:focus-visible {
  border-color: #b9d2ff;
  box-shadow: 0 2px 10px rgb(23 105 255 / 12%);
}
.schedule-card:focus-visible {
  outline: 2px solid #1769ff;
  outline-offset: 2px;
}

.detail-row {
  display: flex;
  gap: 16px;
  padding: 8px 0;
  align-items: flex-start;
}
.detail-label {
  width: 110px;
  flex-shrink: 0;
  color: #69758b;
  font-size: 0.875rem;
}

@media (max-width: 900px) {
  .stat-row { grid-template-columns: 1fr 1fr; }
  .stat-card--next { grid-column: 1 / -1; }
}
</style>
