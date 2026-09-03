-- 面接日程調整チャットアプリ スキーマ定義
-- Supabase の SQL Editor で実行する

create extension if not exists pgcrypto;

-- 学生・面接官・人事は別テーブル
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz default now()
);

-- 選考状況（人事が管理）。既存プロジェクトに反映する場合はこのalterをSQL Editorで実行する
alter table students
  add column if not exists selection_status text not null default 'first_interview'
    check (selection_status in ('first_interview','second_interview','final_interview','offered','rejected'));

create table if not exists interviewers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz default now()
);

create table if not exists hr_staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz default now()
);

-- ⓪ 面接官の空き予定カレンダー（日付×時間帯に登録）
create table if not exists availability (
  id uuid primary key default gen_random_uuid(),
  interviewer_id uuid not null references interviewers(id) on delete cascade,
  slot_date date not null,
  slot_hour int not null check (slot_hour between 0 and 23),
  is_available boolean not null,
  updated_at timestamptz default now(),
  unique (interviewer_id, slot_date, slot_hour)
);

-- ①③④ 日程調整依頼と進行状態
create table if not exists interview_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  hr_id uuid not null references hr_staff(id) on delete cascade,
  interviewer_ids uuid[] not null,
  range_start date not null,
  range_end date not null,
  status text not null default 'awaiting_student'
    check (status in ('awaiting_student','matching','confirmed','cancelled')),
  confirmed_date date,
  confirmed_hour int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ②③ 学生が提示した候補スロットごとの照合状態
create table if not exists candidate_slots (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references interview_requests(id) on delete cascade,
  slot_date date not null,
  slot_hour int not null,
  status text not null default 'pending_check'
    check (status in ('pending_check','available_confirmed','rejected')),
  created_at timestamptz default now(),
  unique (request_id, slot_date, slot_hour)
);

-- 個別チャット（学生ごと1本、面接官ごと1本の常設スレッド）
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('student','interviewer')),
  student_id uuid references students(id) on delete cascade,
  interviewer_id uuid references interviewers(id) on delete cascade,
  hr_id uuid references hr_staff(id),
  created_at timestamptz default now(),
  constraint conversations_one_party check (
    (kind = 'student' and student_id is not null and interviewer_id is null) or
    (kind = 'interviewer' and interviewer_id is not null and student_id is null)
  )
);
create unique index if not exists conversations_student_unique on conversations(student_id) where kind = 'student';
create unique index if not exists conversations_interviewer_unique on conversations(interviewer_id) where kind = 'interviewer';

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_kind text not null check (sender_kind in ('student','hr','interviewer','system')),
  sender_id uuid,
  body text,
  msg_type text not null default 'text'
    check (msg_type in ('text','memo','calendar_request','calendar_submission',
                         'availability_check','availability_answer','system_notice','result')),
  payload jsonb,
  request_id uuid references interview_requests(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists messages_conversation_idx on messages(conversation_id, created_at);
