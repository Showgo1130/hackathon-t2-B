<script setup>
defineProps({
  align: { type: String, default: "left" }, // 'left' | 'right' | 'center'
  variant: { type: String, default: "default" }, // 'default' | 'system'
  senderLabel: { type: String, default: "" },
  isConfirmedNotice: { type: Boolean, default: false },
})
</script>

<template>
  <div
    class="chat-row"
    :class="{
      'chat-row--right': align === 'right',
      'chat-row--center': align === 'center',
    }"
  >
    <div v-if="senderLabel && align !== 'center'" class="chat-row__label">{{ senderLabel }}</div>
    <div
      class="chat-bubble"
      :class="{
        'chat-bubble--own': align === 'right',
        'chat-bubble--other': align === 'left',
        'chat-bubble--system': variant === 'system' && !isConfirmedNotice,
        'chat-bubble--system-confirmed': isConfirmedNotice,
      }"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.chat-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-bottom: 16px;
}
.chat-row--right {
  align-items: flex-end;
}
.chat-row--center {
  align-items: center;
}
.chat-row__label {
  font-size: 12px;
  color: #6b7280;
  margin: 0 4px 4px;
}
.chat-bubble {
  max-width: min(85%, 600px);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
  border: 1px solid #e5e7eb;
}
.chat-bubble--other {
  background: #f9fafb;
  color: #111827;
}
.chat-bubble--own {
  background: #ffffff;
  color: #111827;
  border: 1px solid #d1d5db;
}
.chat-bubble--system {
  background: #f3f4f6;
  color: #4b5563;
  font-size: 13px;
  text-align: center;
  border-style: dashed;
}
.chat-bubble--system-confirmed {
  background: #ecfdf5;
  color: #065f46;
  font-size: 15px;
  font-weight: bold;
  text-align: center;
  border: 2px solid #10b981;
  padding: 16px 24px;
}
</style>
