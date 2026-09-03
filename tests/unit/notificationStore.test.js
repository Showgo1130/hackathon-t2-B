// 面接官の通知ストア（未対応／履歴の振り分け）の単体テスト。
// socketManager だけ差し替えて、Vue のリアクティブな部分は本物を動かす。
import assert from "node:assert/strict"
import { beforeEach, describe, it, mock } from "node:test"

// 疑似ソケット。emit は「サーバーへ送った内容」、trigger は「サーバーから届いた」を表す
const makeSocket = ({ connected = false } = {}) => {
  const handlers = new Map()
  return {
    connected,
    sent: [],
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
    },
    off(event, handler) {
      handlers.set(event, (handlers.get(event) ?? []).filter((h) => h !== handler))
    },
    emit(event, payload) {
      this.sent.push({ event, payload })
    },
    trigger(event, payload) {
      ;[...(handlers.get(event) ?? [])].forEach((handler) => handler(payload))
    },
    handlerCount(event) {
      return (handlers.get(event) ?? []).length
    },
  }
}

let currentSocket
mock.module(new URL("../../src/socketManager.js", import.meta.url).href, {
  defaultExport: { getInstance: () => currentSocket },
})

const { useNotifications, isApprovalRequest, needsAction } = await import(
  "../../src/components/interviewer/notificationStore.js"
)

let clock = 0
const message = (overrides) => ({
  id: `msg-${++clock}`,
  request_id: "req-1",
  sender_kind: "system",
  body: "本文",
  created_at: new Date(Date.UTC(2026, 8, 1, 0, clock)).toISOString(),
  payload: {},
  ...overrides,
})

const check = (slotHour, overrides = {}) =>
  message({ msg_type: "availability_check", payload: { slotDate: "2026-09-10", slotHour }, ...overrides })
const answer = (slotHour, isAvailable, overrides = {}) =>
  message({
    msg_type: "availability_answer",
    sender_kind: "interviewer",
    payload: { slotDate: "2026-09-10", slotHour, isAvailable },
    ...overrides,
  })
const approvalRequest = (slotHour, overrides = {}) =>
  message({
    msg_type: "system_notice",
    payload: { kind: "match_approval", slotDate: "2026-09-10", slotHour },
    ...overrides,
  })
const approvalAnswer = (slotHour, approved, overrides = {}) =>
  message({
    msg_type: "result",
    sender_kind: "interviewer",
    payload: { kind: "match_approval_answer", slotDate: "2026-09-10", slotHour, approved },
    ...overrides,
  })
const approvalCancelled = (slotHour, overrides = {}) =>
  message({
    msg_type: "system_notice",
    payload: { kind: "match_approval_cancelled", slotDate: "2026-09-10", slotHour },
    ...overrides,
  })
const confirmedNotice = (overrides = {}) =>
  message({
    msg_type: "system_notice",
    payload: { confirmedDate: "2026-09-10", confirmedHour: 14, studentName: "学生 太郎", round: 1 },
    ...overrides,
  })

// 毎回新しいソケットにすることで、ストアの購読も張り直される
beforeEach(() => {
  currentSocket = makeSocket()
})

const start = (history = []) => {
  const store = useNotifications()
  currentSocket.trigger("init", { conversationId: "conv-1", messages: history })
  return store
}

describe("履歴の読み込み", () => {
  it("init が届くまでは読み込み中のまま", () => {
    const store = useNotifications()
    assert.equal(store.loaded.value, false)

    currentSocket.trigger("init", { conversationId: "conv-1", messages: [] })
    assert.equal(store.loaded.value, true)
  })

  it("newMessage は履歴に積み増される", () => {
    const store = start([check(14)])
    assert.equal(store.pendingCount.value, 1)

    currentSocket.trigger("newMessage", check(15))
    assert.equal(store.pendingCount.value, 2)
  })
})

describe("未対応と履歴の振り分け", () => {
  it("未回答の空き確認は未対応に入る", () => {
    const store = start([check(14)])
    assert.equal(store.pendingCount.value, 1)
    assert.equal(store.historyItems.value.length, 0)
  })

  it("回答済みの空き確認は履歴に移る", () => {
    const store = start([check(14), answer(14, true)])
    assert.equal(store.pendingCount.value, 0)
    assert.equal(store.historyItems.value.length, 2)
  })

  it("同じ日時でも依頼が違えば別の未対応として扱う", () => {
    const store = start([
      check(14),
      answer(14, true),
      check(14, { request_id: "req-2" }),
    ])
    assert.equal(store.pendingCount.value, 1)
    assert.equal(store.pendingItems.value[0].request_id, "req-2")
  })

  it("日程が確定したら、残っている空き確認はもう答えさせない", () => {
    const store = start([check(14), check(15), confirmedNotice()])
    assert.equal(store.pendingCount.value, 0)
  })

  it("承認依頼は未対応、回答すると外れる", () => {
    const store = start([approvalRequest(14)])
    assert.equal(store.pendingCount.value, 1)
    assert.equal(isApprovalRequest(store.pendingItems.value[0]), true)

    currentSocket.trigger("newMessage", approvalAnswer(14, false))
    assert.equal(store.pendingCount.value, 0)
  })

  it("承認が不要になった通知が来たら未対応から外れる", () => {
    const store = start([approvalRequest(14)])
    currentSocket.trigger("newMessage", approvalCancelled(14))
    assert.equal(store.pendingCount.value, 0)
  })

  it("ただのテキストは未対応にならない", () => {
    const store = start([message({ msg_type: "text", sender_kind: "hr", payload: null })])
    assert.equal(store.pendingCount.value, 0)
    assert.equal(store.historyItems.value.length, 1)
    assert.equal(needsAction(store.historyItems.value[0]), false)
  })

  it("履歴は新しいものが先頭に来る", () => {
    const first = message({ msg_type: "text", body: "古い", payload: null })
    const second = message({ msg_type: "text", body: "新しい", payload: null })
    const store = start([first, second])
    assert.deepEqual(store.historyItems.value.map((m) => m.body), ["新しい", "古い"])
  })
})

describe("接続を張り直したとき", () => {
  it("新しいソケットに購読し直し、前の接続の履歴は捨てる", () => {
    const store = start([check(14), check(15)])
    assert.equal(store.pendingCount.value, 2)
    const previous = currentSocket

    // ログアウト → 別のユーザーでログイン、で socket が差し替わった状況
    currentSocket = makeSocket()
    useNotifications()

    assert.equal(store.loaded.value, false, "新しい接続の履歴が来るまでは読み込み中")
    assert.equal(store.pendingCount.value, 0, "前のユーザーの通知が残らない")
    assert.equal(previous.handlerCount("init"), 0, "古いソケットの購読は外れている")

    currentSocket.trigger("init", { conversationId: "conv-2", messages: [check(9)] })
    assert.equal(store.pendingCount.value, 1)
    assert.equal(store.pendingItems.value[0].payload.slotHour, 9)
  })

  it("古いソケットに届いたメッセージはもう反映しない", () => {
    const store = start([check(14)])
    const previous = currentSocket

    currentSocket = makeSocket()
    useNotifications()
    currentSocket.trigger("init", { conversationId: "conv-2", messages: [] })

    previous.trigger("newMessage", check(20))
    assert.equal(store.pendingCount.value, 0)
  })

  it("接続済みのソケットに後から購読したら、履歴を取り直す", () => {
    currentSocket = makeSocket({ connected: true })
    useNotifications()

    assert.deepEqual(currentSocket.sent.map((s) => s.event), ["loadInit"])
  })

  it("未接続のソケットには loadInit を送らない（接続時に init が届くため）", () => {
    useNotifications()
    assert.deepEqual(currentSocket.sent, [])
  })
})

describe("回答の送信", () => {
  it("空き確認への回答を依頼IDつきで送る", () => {
    const store = start([])
    const target = check(14)

    store.answerAvailability(target, true)

    assert.deepEqual(currentSocket.sent.at(-1), {
      event: "answerAvailability",
      payload: { slotDate: "2026-09-10", slotHour: 14, isAvailable: true, requestId: "req-1" },
    })
  })

  it("承認依頼への回答を送る", () => {
    const store = start([])
    store.respondToMatch(approvalRequest(14), false)

    assert.deepEqual(currentSocket.sent.at(-1), {
      event: "respondToMatch",
      payload: { requestId: "req-1", slotDate: "2026-09-10", slotHour: 14, approved: false },
    })
  })
})
