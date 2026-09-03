// 認証まわり（server/auth.js）の単体テスト
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import jwt from "jsonwebtoken"
import { ROLES, hashPassword, issueToken, verifyPassword, verifyToken } from "../../server/auth.js"

describe("パスワードのハッシュ化", () => {
  it("同じパスワードでも毎回違うハッシュになり、検証は通る", async () => {
    const first = await hashPassword("password123")
    const second = await hashPassword("password123")

    assert.notEqual(first, second, "ソルトが効いている")
    assert.equal(await verifyPassword("password123", first), true)
    assert.equal(await verifyPassword("password123", second), true)
  })

  it("違うパスワードは通らない", async () => {
    const hash = await hashPassword("password123")
    assert.equal(await verifyPassword("password124", hash), false)
    assert.equal(await verifyPassword("", hash), false)
  })
})

describe("トークンの発行と検証", () => {
  it("発行したトークンから id / role / name を取り出せる", () => {
    const token = issueToken({ id: "abc", role: "interviewer", name: "面接官A" })
    const payload = verifyToken(token)

    assert.equal(payload.id, "abc")
    assert.equal(payload.role, "interviewer")
    assert.equal(payload.name, "面接官A")
  })

  it("改ざんされたトークンは null になる", () => {
    const token = issueToken({ id: "abc", role: "hr", name: "人事" })
    assert.equal(verifyToken(`${token}x`), null)
    assert.equal(verifyToken("でたらめ"), null)
    assert.equal(verifyToken(""), null)
  })

  it("別の鍵で署名されたトークンは受け付けない", () => {
    const forged = jwt.sign({ id: "abc", role: "hr", name: "なりすまし" }, "another-secret-value")
    assert.equal(verifyToken(forged), null)
  })

  it("期限切れのトークンは受け付けない", () => {
    const expired = jwt.sign(
      { id: "abc", role: "hr", name: "人事" },
      process.env.JWT_SECRET ?? "dev-secret-change-me",
      { expiresIn: "-1s" }
    )
    assert.equal(verifyToken(expired), null)
  })

  it("扱うロールは3種類だけ", () => {
    assert.deepEqual(ROLES, ["student", "hr", "interviewer"])
  })
})
