// 依存関係の順序でテーブルを並べる。
// 復元はこの順に挿入し、削除は逆順に行うことで外部キー制約に引っかからないようにする
export const TABLES = [
  "students",
  "interviewers",
  "hr_staff",
  "availability",
  "interview_requests",
  "candidate_slots",
  "conversations",
  "messages",
]
