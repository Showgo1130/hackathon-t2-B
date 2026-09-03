import { Server } from "socket.io"
import { ROLES, hashPassword, verifyPassword, issueToken, verifyToken } from "../server/auth.js"
import { studentsRepo } from "../server/repositories/students.js"
import { interviewersRepo } from "../server/repositories/interviewers.js"
import { hrStaffRepo } from "../server/repositories/hrStaff.js"

const reposByRole = {
  student: studentsRepo,
  hr: hrStaffRepo,
  interviewer: interviewersRepo,
}

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) req.destroy()
    })
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on("error", reject)
  })

const sendJson = (res, status, body) => {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(body))
}

const handleLogin = async (req, res) => {
  let payload
  try {
    payload = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: "invalid_json" })
  }

  const { role, email, password } = payload
  if (!ROLES.includes(role) || !email || !password) {
    return sendJson(res, 400, { error: "missing_fields" })
  }

  const repo = reposByRole[role]
  const account = await repo.findByEmail(email)
  if (!account) return sendJson(res, 401, { error: "invalid_credentials" })

  const ok = await verifyPassword(password, account.password_hash)
  if (!ok) return sendJson(res, 401, { error: "invalid_credentials" })

  const token = issueToken({ id: account.id, role, name: account.name })
  sendJson(res, 200, { token, id: account.id, role, name: account.name })
}

const handleCreateUser = async (req, res) => {
  const authorization = req.headers.authorization ?? ""
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  const requester = token ? verifyToken(token) : null

  if (!requester) return sendJson(res, 401, { error: "unauthorized" })
  if (requester.role !== "hr") return sendJson(res, 403, { error: "forbidden" })

  let payload
  try {
    payload = await readJsonBody(req)
  } catch {
    return sendJson(res, 400, { error: "invalid_json" })
  }

  const role = payload.role
  const name = typeof payload.name === "string" ? payload.name.trim() : ""
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : ""
  const password = typeof payload.password === "string" ? payload.password : ""

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!ROLES.includes(role) || !name || !emailPattern.test(email) || password.length < 8) {
    return sendJson(res, 400, { error: "invalid_fields" })
  }

  const repo = reposByRole[role]
  const existing = await repo.findByEmail(email)
  if (existing) return sendJson(res, 409, { error: "email_already_exists" })

  const passwordHash = await hashPassword(password)
  const account = await repo.create({ name, email, passwordHash })

  sendJson(res, 201, {
    id: account.id,
    role,
    name: account.name,
    email: account.email,
    createdAt: account.created_at,
  })
}

const handleListUsers = async (req, res) => {
  const authorization = req.headers.authorization ?? ""
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
  const requester = token ? verifyToken(token) : null
  if (!requester) return sendJson(res, 401, { error: "unauthorized" })
  if (requester.role !== "hr") return sendJson(res, 403, { error: "forbidden" })

  const [students, interviewers, hrStaff] = await Promise.all([studentsRepo.list(), interviewersRepo.list(), hrStaffRepo.list()])
  const addRole = (items, role) => items.map((item) => ({ id: item.id, name: item.name, email: item.email, createdAt: item.created_at, role }))
  sendJson(res, 200, { users: [...addRole(students, "student"), ...addRole(interviewers, "interviewer"), ...addRole(hrStaff, "hr")] })
}

const attachApiRoutes = (server) => {
  server.middlewares.use((req, res, next) => {
    if (req.method === "POST" && req.url === "/api/login") {
      handleLogin(req, res).catch((err) => {
        console.error("[api/login] error", err)
        sendJson(res, 500, { error: "internal_error" })
      })
      return
    }
    if (req.method === "POST" && req.url === "/api/users") {
      handleCreateUser(req, res).catch((err) => {
        console.error("[api/users] error", err)
        sendJson(res, 500, { error: "internal_error" })
      })
      return
    }
    if (req.method === "GET" && req.url === "/api/users") {
      handleListUsers(req, res).catch((err) => {
        console.error("[api/users] error", err)
        sendJson(res, 500, { error: "internal_error" })
      })
      return
    }
    next()
  })
}

const connectionEvents = (io, socketEvents) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    const user = token ? verifyToken(token) : null
    if (!user) return next(new Error("unauthorized"))
    socket.data.user = user
    next()
  })
  io.on("connection", (socket) => socketEvents(io, socket))
}

const socketEvents = (io, socket) => {
  console.log(`socket.io - connection (${socket.data.user.role}:${socket.data.user.id})`)
  socket.on("disconnect", () => {
    console.log(`socket.io - socket.id \`${socket.id}\` disconnected`)
  })
}

export default (options = {}) => ({
  name: "socket.io",
  configureServer(server) {
    attachApiRoutes(server)
    const defaults = { connectionEvents, socketEvents }
    options = Object.assign(defaults, options)
    const io = new Server(server.httpServer)
    options.connectionEvents(io, options.socketEvents)
  },
})
