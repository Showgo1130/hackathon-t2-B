import { ref } from "vue"

// messages テーブルに既読カラムが無いため、既読時刻はこの端末に持つ。
// 人事が複数端末で使う場合は共有されないので、本来はDB側に持たせたい。
const STORAGE_KEY = "hr-chat-read-at"

const load = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// ダッシュボードが未読件数を出し直せるよう、ref にして共有する
export const readAtMap = ref(load())

export const lastReadAt = (partyId) => {
  const value = readAtMap.value[partyId]
  return value ? new Date(value).getTime() : 0
}

export const markRead = (partyId, at = new Date()) => {
  if (!partyId) return
  readAtMap.value = { ...readAtMap.value, [partyId]: new Date(at).toISOString() }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(readAtMap.value))
  } catch {
    // 保存できなくても未読が消えないだけなので、操作は止めない
  }
}
