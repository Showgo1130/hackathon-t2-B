// チャットの本文から「可能／不可」を読み取る処理の単体テスト
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseYesNo } from "../../socket_event/interviewer.js"

describe("肯定として扱う返信", () => {
  for (const text of ["はい", "はい、大丈夫です", "参加可能です", "OK です", "ok", "○", "その時間は空いています"]) {
    it(`「${text}」→ 可能`, () => assert.equal(parseYesNo(text), true))
  }
})

describe("否定として扱う返信", () => {
  for (const text of ["いいえ", "その日は無理です", "NG", "ng", "×", "予定が埋まっています"]) {
    it(`「${text}」→ 不可`, () => assert.equal(parseYesNo(text), false))
  }
})

describe("判断できない返信", () => {
  for (const text of ["承知しました", "確認して折り返します", "", "ありがとうございます"]) {
    it(`「${text || "（空文字）"}」→ 判定しない`, () => assert.equal(parseYesNo(text), null))
  }
})

describe("否定表現を肯定と取り違えないこと", () => {
  it("「空いていません」は不可として扱う", () => {
    assert.equal(parseYesNo("その時間は空いていません"), false)
  })

  it("「不可能です」は不可として扱う", () => {
    assert.equal(parseYesNo("不可能です"), false)
  })

  it("「大丈夫ではありません」は不可として扱う", () => {
    assert.equal(parseYesNo("大丈夫ではありません"), false)
  })
})
