<script setup>
import InterviewerNotifications from "./InterviewerNotifications.vue"
import InterviewerSchedule from "./InterviewerSchedule.vue"
</script>

<template>
  <div class="iv-page">
    <header class="page-header">
      <span class="eyebrow">DASHBOARD</span>
      <h1>ダッシュボード</h1>
    </header>

    <div class="dashboard-body">
      <div class="main-column">
        <InterviewerSchedule />
      </div>
      <aside class="side-column">
        <InterviewerNotifications />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.iv-page {
  height: 100%;
  overflow-y: auto;
  padding: 26px 30px 40px;
  background: #f7f9fc;
}
.page-header { margin-bottom: 22px; }
.eyebrow { color: #7a8699; font-size: 10px; font-weight: 750; letter-spacing: .12em; }
h1 { margin: 4px 0 6px; font-size: 22px; letter-spacing: -.02em; }
.page-header p { margin: 0; color: #69758b; font-size: 12px; }

.dashboard-body {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr) 340px;
  align-items: start;
}
.main-column { min-width: 0; }
.side-column {
  position: sticky;
  top: 0;
  height: calc(100vh - 190px);
  min-height: 380px;
}

@media (max-width: 1100px) {
  .dashboard-body { grid-template-columns: minmax(0, 1fr); }
  .side-column { position: static; height: auto; max-height: 520px; }
}
@media (max-width: 820px) {
  .iv-page { padding: 22px 18px 34px; }
}
</style>
