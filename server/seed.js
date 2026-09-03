// 動作確認用のテストアカウントを作成する
// 実行: node server/seed.js
import { hashPassword } from "./auth.js"
import { studentsRepo } from "./repositories/students.js"
import { interviewersRepo } from "./repositories/interviewers.js"
import { hrStaffRepo } from "./repositories/hrStaff.js"

const STUDENTS = [
  { name: "田中 蓮", email: "student1@example.com", password: "password123", selection_status: "first_interview" },
  { name: "鈴木 さくら", email: "student2@example.com", password: "password123", selection_status: "second_interview" },
  { name: "高橋 大輝", email: "student3@example.com", password: "password123", selection_status: "final_interview" },
  { name: "山田 美咲", email: "student4@example.com", password: "password123", selection_status: "second_interview" },
  { name: "伊藤 翔", email: "student5@example.com", password: "password123", selection_status: "first_interview" },
]

const INTERVIEWERS = [
  { name: "面接官 一郎", email: "interviewer1@example.com", password: "password123" },
  { name: "面接官 二郎", email: "interviewer2@example.com", password: "password123" },
]

const HR_STAFF = [
  { name: "人事 花子", email: "hr1@example.com", password: "password123" },
]

const seedStudents = async () => {
  for (const { name, email, password, selection_status } of STUDENTS) {
    const existing = await studentsRepo.findByEmail(email)
    if (existing) {
      // 既存アカウントのselection_statusを更新する
      try {
        await studentsRepo.updateById(existing.id, { selection_status })
        console.log(`updated selection_status: ${email} -> ${selection_status}`)
      } catch (err) {
        console.warn(`failed to update ${email}: ${err.message}`)
      }
      continue
    }
    try {
      const passwordHash = await hashPassword(password)
      await studentsRepo.create({ name, email, passwordHash, selection_status })
      console.log(`created: ${email} / ${password} [${selection_status}]`)
    } catch (err) {
      console.warn(`failed to create ${email}: ${err.message}`)
    }
  }
}

const seedRepo = async (repo, accounts) => {
  for (const { name, email, password } of accounts) {
    const existing = await repo.findByEmail(email)
    if (existing) {
      console.log(`skip (exists): ${email}`)
      continue
    }
    const passwordHash = await hashPassword(password)
    await repo.create({ name, email, passwordHash })
    console.log(`created: ${email} / ${password}`)
  }
}

await seedStudents()
await seedRepo(interviewersRepo, INTERVIEWERS)
await seedRepo(hrStaffRepo, HR_STAFF)

console.log("seed done")
