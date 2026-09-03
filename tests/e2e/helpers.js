// 実際に動いている開発サーバー（既定 http://localhost:3000）に対して、
// ログインから Socket.io まで本番と同じ経路で操作するためのヘルパー。
import { io as connectClient } from "socket.io-client"

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const PASSWORD = "password123"

export const ensureServerUp = async () => {
  try {
    const res = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error(String(res.status))
  } catch (error) {
    throw new Error(
      `${BASE_URL} に接続できません。別のターミナルで npm start を実行してから再度お試しください（${error.message}）`
    )
  }
}

export const login = async (role, email, password = PASSWORD) => {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, email, password }),
  })
  if (!res.ok) throw new Error(`ログインに失敗: ${role}/${email} (${res.status})`)
  return res.json()
}

export const createUser = async (hrToken, { role, name, email, password = PASSWORD }) => {
  const res = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${hrToken}` },
    body: JSON.stringify({ role, name, email, password }),
  })
  if (!res.ok) throw new Error(`ユーザー作成に失敗: ${email} (${res.status})`)
  return res.json()
}

export const listUsers = async (hrToken) => {
  const res = await fetch(`${BASE_URL}/api/users`, { headers: { Authorization: `Bearer ${hrToken}` } })
  if (!res.ok) throw new Error(`ユーザー一覧の取得に失敗 (${res.status})`)
  return res.json()
}

// 1回のテスト実行で衝突しないメールアドレスを作る
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
let seq = 0
export const uniqueEmail = (prefix) => `${prefix}-${runId}-${++seq}@e2e.example.com`

const openSockets = []

// 接続して init を待つ。届いた newMessage は inbox に貯めておく
export const connectAs = async (token, { waitInit = true } = {}) => {
  const socket = connectClient(BASE_URL, { auth: { token }, forceNew: true })
  openSockets.push(socket)
  const inbox = []
  socket.on("newMessage", (message) => inbox.push(message))
  socket.inbox = inbox
  socket.on("appError", (error) => inbox.push({ appError: error }))
  if (waitInit) await once(socket, "init")
  return socket
}

export const closeAllSockets = () => {
  openSockets.splice(0).forEach((socket) => socket.close())
}

export const once = (socket, event, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`"${event}" が ${timeoutMs}ms 以内に届きませんでした`)), timeoutMs)
    socket.once(event, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })

// inbox に条件を満たすメッセージが現れるまで待つ（照合は非同期に進むため）
export const waitForMessage = async (socket, predicate, { timeoutMs = 20000, label = "メッセージ" } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = socket.inbox.find((message) => !message.appError && predicate(message))
    if (found) return found
    if (Date.now() > deadline) {
      const seen = socket.inbox.map((m) => m.appError ? `appError:${m.appError.message}` : `${m.msg_type}/${m.payload?.kind ?? "-"}`)
      throw new Error(`${label} が届きませんでした。受信した内容: ${JSON.stringify(seen)}`)
    }
    await sleep(200)
  }
}

// 条件が満たされないままであることを確かめる（届かないはずのものが届かないことの確認）
export const staysAbsent = async (socket, predicate, ms = 1500) => {
  await sleep(ms)
  return !socket.inbox.some((message) => !message.appError && predicate(message))
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const request = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} の応答がありません`)), 20000)
    socket.emit(event, payload, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
  })

export const isApprovalRequest = (message) =>
  message.msg_type === "system_notice" && message.payload?.kind === "match_approval"
export const isConfirmed = (message) =>
  message.msg_type === "system_notice" && Boolean(message.payload?.confirmedDate)
export const isAvailabilityCheck = (message) => message.msg_type === "availability_check"
export const isCalendarRequest = (message) => message.msg_type === "calendar_request"
