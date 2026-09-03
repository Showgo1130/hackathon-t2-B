<script setup>
import { computed } from "vue"

const props = defineProps({
  status: { type: String, default: null },
})

const STATUS_META = {
  document_screening: { label: "書類選考中", color: "grey-darken-1" },
  first_interview: { label: "1次面接", color: "blue-darken-2" },
  second_interview: { label: "2次面接", color: "indigo-darken-2" },
  final_interview: { label: "最終面接", color: "deep-purple-darken-2" },
  offer: { label: "内定", color: "green-darken-2" },
  rejected: { label: "不合格", color: "red-darken-2" },
}

const meta = computed(() => STATUS_META[props.status] ?? { label: props.status ?? "未設定", color: "grey" })
</script>

<template>
  <v-chip
    :color="meta.color"
    variant="outlined"
    size="small"
    class="font-weight-bold bg-white"
  >
    {{ meta.label }}
  </v-chip>
</template>
