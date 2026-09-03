// 面接官の通知を1か所で保持する。
// サイドバーの未対応バッジと通知パネルの両方から読むため、
// socket の購読はこのモジュールで一度だけ行う。
import { computed, reactive, ref } from "vue"
import socketManager from "../../socketManager.js"

const messages = reactive([])
const loaded = ref(false)
// 購読中のソケット。ログアウト→ログインなどで張り直されると別インスタンスになるため、
// フラグではなくインスタンスそのものを覚えておいて、変わっていたら購読し直す
let boundSocket = null

// 同じ日時が別の依頼で来ることがあるため、依頼IDまで含めてキーにする
const keyOf = (msg) => `${msg.request_id}_${msg.payload.slotDate}_${msg.payload.slotHour}`
const keysOf = (predicate) => computed(() => new Set(messages.filter(predicate).map(keyOf)))

export const isApprovalRequest = (msg) =>
  msg.msg_type === "system_notice" && msg.payload?.kind === "match_approval"
const isAvailabilityCheck = (msg) => msg.msg_type === "availability_check"

const answeredKeys = keysOf((m) => m.msg_type === "availability_answer")
const approvedKeys = keysOf((m) => m.msg_type === "result" && m.payload?.kind === "match_approval_answer")
const cancelledKeys = keysOf((m) => m.msg_type === "system_notice" && m.payload?.kind === "match_approval_cancelled")

// 日程が確定した依頼。残っている空き確認にはもう答えさせない
const settledRequestIds = computed(
  () =>
    new Set(
      messages
        .filter((m) => m.msg_type === "system_notice" && m.payload?.confirmedDate)
        .map((m) => m.request_id)
    )
)

export const isCheckOpen = (msg) =>
  !answeredKeys.value.has(keyOf(msg)) && !settledRequestIds.value.has(msg.request_id)
export const isApprovalOpen = (msg) =>
  !approvedKeys.value.has(keyOf(msg)) && !cancelledKeys.value.has(keyOf(msg))

export const needsAction = (msg) =>
  (isAvailabilityCheck(msg) && isCheckOpen(msg)) || (isApprovalRequest(msg) && isApprovalOpen(msg))

// 未対応の通知。古いものが下に流れて埋もれないよう、パネルの先頭に固定して出す
export const pendingItems = computed(() => messages.filter(needsAction))
export const pendingCount = computed(() => pendingItems.value.length)
// 履歴は新しい順（未対応は上の枠に出るのでここでは重複して出さない）
export const historyItems = computed(() => [...messages].filter((m) => !needsAction(m)).reverse())

const onInit = ({ messages: history }) => {
  messages.splice(0, messages.length, ...history)
  loaded.value = true
}
const onNewMessage = (message) => messages.push(message)

const bind = () => {
  const socket = socketManager.getInstance()
  if (boundSocket === socket) return

  // 前の接続の購読を外し、そのとき読み込んだ履歴も捨てる（別ユーザーの通知が残らないように）
  boundSocket?.off("init", onInit)
  boundSocket?.off("newMessage", onNewMessage)
  messages.splice(0, messages.length)
  loaded.value = false

  socket.on("init", onInit)
  socket.on("newMessage", onNewMessage)
  boundSocket = socket

  // 接続後に購読を始めた場合は init を取りこぼしているので、明示的に取り直す
  if (socket.connected) socket.emit("loadInit")
}

export const useNotifications = () => {
  bind()
  const socket = socketManager.getInstance()

  const answerAvailability = (msg, isAvailable) => {
    socket.emit("answerAvailability", {
      slotDate: msg.payload.slotDate,
      slotHour: msg.payload.slotHour,
      isAvailable,
      requestId: msg.request_id,
    })
  }

  const respondToMatch = (msg, approved) => {
    socket.emit("respondToMatch", {
      requestId: msg.request_id,
      slotDate: msg.payload.slotDate,
      slotHour: msg.payload.slotHour,
      approved,
    })
  }

  return { messages, loaded, pendingItems, pendingCount, historyItems, answerAvailability, respondToMatch }
}
