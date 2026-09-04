<script setup>
defineProps({
  align: { type: String, default: "left" }, // 'left' | 'right' | 'center'
  variant: { type: String, default: "default" }, // 'default' | 'system'
  senderLabel: { type: String, default: "" },
  isConfirmedNotice: { type: Boolean, default: false },
  wide: { type: Boolean, default: false }, // カレンダーなど横幅を使いたい中身向け
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
        'chat-bubble--center': align === 'center' && variant !== 'system' && !isConfirmedNotice,
        'chat-bubble--system': variant === 'system' && !isConfirmedNotice,
        'chat-bubble--system-confirmed': isConfirmedNotice,
        'chat-bubble--wide': wide,
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
  margin-bottom: 18px;
}
.chat-row--right {
  align-items: flex-end;
}
.chat-row--center {
  align-items: center;
}
.chat-row__label {
  margin: 0 4px 5px;
  color: #768297;
  font-size: 11px;
  font-weight: 650;
}
.chat-bubble {
  max-width: min(86%, 880px);
  border: 1px solid #e5e9ef;
  border-radius: 5px 13px 13px 13px;
  padding: 12px 16px;
  background: #fff;
  box-shadow: 0 2px 8px rgb(35 49 75 / 3%);
  color: #273348;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-bubble--wide {
  width: 100%;
  max-width: min(96%, 700px);
  white-space: normal;
}
.chat-bubble--other {
  background: #fff;
}
.chat-bubble--own {
  border-color: #d6e3fb;
  border-radius: 13px 5px 13px 13px;
  background: #edf3ff;
  color: #163f82;
}
.chat-bubble--center {
  border-radius: 13px;
}
.chat-bubble--system {
  border-radius: 13px;
  border-style: dashed;
  background: #f7f9fc;
  color: #5c6a83;
  font-size: 13px;
  text-align: center;
}
.chat-bubble--system-confirmed {
  width: 100%;
  max-width: min(94%, 640px);
  border: 2px solid #1769ff;
  border-radius: 14px;
  padding: 0;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 10px 26px rgb(23 105 255 / 18%);
  white-space: normal;
}
</style>
