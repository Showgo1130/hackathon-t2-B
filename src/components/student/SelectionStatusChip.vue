<script setup>
import { computed } from "vue"

const props = defineProps({
  status: { type: String, default: null },
})

// 人事画面と同じ配色トーン（ブルー基調＋淡い背景）に揃える
const STATUS_META = {
  document_screening: { label: "書類選考中", bg: "#eef1f6", fg: "#54617a", border: "#dde3ec" },
  first_interview: { label: "1次面接", bg: "#edf3ff", fg: "#1769ff", border: "#c9dcff" },
  second_interview: { label: "2次面接", bg: "#e8edff", fg: "#3f4fd0", border: "#ccd5ff" },
  final_interview: { label: "最終面接", bg: "#f0eafd", fg: "#6b3fd0", border: "#ddd0fb" },
  offer: { label: "内定", bg: "#dcf4e9", fg: "#157653", border: "#bfe8d6" },
  offered: { label: "内定", bg: "#dcf4e9", fg: "#157653", border: "#bfe8d6" },
  rejected: { label: "不合格", bg: "#fdecec", fg: "#c03737", border: "#f6d2d2" },
}

const meta = computed(
  () => STATUS_META[props.status] ?? { label: props.status ?? "未設定", bg: "#f7f9fc", fg: "#69758b", border: "#e4e9f1" }
)
</script>

<template>
  <span
    class="status-chip"
    :style="{ background: meta.bg, color: meta.fg, borderColor: meta.border }"
  >
    {{ meta.label }}
  </span>
</template>

<style scoped>
.status-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 3px 11px;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .01em;
  white-space: nowrap;
}
</style>
