// 動作確認用のテストアカウントを作成する
// 実行: node server/seed.js
import { hashPassword } from "./auth.js"
import { studentsRepo } from "./repositories/students.js"
import { interviewersRepo } from "./repositories/interviewers.js"
import { hrStaffRepo } from "./repositories/hrStaff.js"

const ACCOUNTS = {
  students: [{ name: "学生 太郎", email: "student1@example.com", password: "password123" }],
  interviewers: [
    { name: "面接官 一郎", email: "interviewer1@example.com", password: "password123" },
    { name: "面接官 二郎", email: "interviewer2@example.com", password: "password123" },
  ],
  hr_staff: [{ name: "人事 花子", email: "hr1@example.com", password: "password123" }],
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

await seedRepo(studentsRepo, ACCOUNTS.students)
await seedRepo(interviewersRepo, ACCOUNTS.interviewers)
await seedRepo(hrStaffRepo, ACCOUNTS.hr_staff)

console.log("seed done")
