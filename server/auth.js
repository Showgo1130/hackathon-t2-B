import "dotenv/config"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me"
const TOKEN_TTL = "12h"

export const ROLES = ["student", "hr", "interviewer"]

export const hashPassword = (plain) => bcrypt.hash(plain, 10)

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

export const issueToken = ({ id, role, name }) =>
  jwt.sign({ id, role, name }, JWT_SECRET, { expiresIn: TOKEN_TTL })

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}
