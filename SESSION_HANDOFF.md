# 引き継ぎメモ（面接日程調整チャットアプリ）

このファイルは、別セッションで作業を継続するための引き継ぎ用サマリー。
詳細な実装計画は `/home/otkhp/.claude/plans/wiggly-orbiting-hare.md` に保存済み（承認済みプラン）。

## 背景・ゴール

新卒採用担当（人事）が、面接の日程調整のために学生・面接官と何度もチャットのラリーを繰り返しており、
候補者（学生）とのやり取りに時間を割けていない。この課題を解決するため、日程調整を自動化する専用Webアプリを作る。

登場人物: 学生 / 人事 / 面接官（人事と面接官は複数人想定）。

### フロー
0. 面接官が各々、面接可能な予定を事前にカレンダーDBに登録する
1. 人事が学生を指定し、日程調整依頼（対象期間）を送る
2. 学生がチャット上のカレンダーから、対象期間内で自分が可能な時間帯を選んで送信する
3. サーバーが学生の候補時間と面接官の空き予定を自動照合する
   - 面接官が既に「不可」と登録済み → その候補は除外
   - 面接官が既に「可」と登録済み → そのまま候補として成立
   - 未登録 → 面接官に「この時間空いていますか」を自動でチャット/通知で確認し、回答を待つ
   - 誰かが「不可」と答えたら除外、全員合う時間が見つからなければ人事に再送を促し①に戻る
4. 全員が空いている時間が見つかれば、学生・人事のチャットに確定通知を自動送信する
5. 最終選考の結果報告は、人事が学生とのチャットから通常メッセージとして送るだけ

## 確定した設計判断（ユーザー回答済み・再確認不要）

- **認証**: ロール別の簡易ID/PW認証。Supabaseにbcryptハッシュで保存。Supabase Authは使わない
- **面接官の空き確認**: 通知内のワンクリックボタン、かつチャット欄への直接返信（「はい/いいえ」等）の両方で回答可能にする
- **「自動メール送信」は全部アプリ内チャット/通知（Socket.io）に置き換え**。実メールは一切送らない
- **最終選考結果報告**: 人事がチャット上でプレーンテキストを送るだけ。追加の自動化は不要
- **面接官の割当**: 人事が依頼作成時に1名以上の面接官を選択。複数指定した場合は全員が空いている時間のみ確定とする

## 技術構成

- ベース: 既存の `hackathon-chatapp`（Vite + Vue3 + Vuetify + Socket.io の単一グローバルチャット雛形）
- DB: Supabase（Postgres）。学生/面接官/人事は別テーブル
- サーバー: Viteの`configureServer`内でSocket.ioサーバーを立てる既存構成を継続（別Expressアプリは立てない）。ログインのみ`/api/login`をconnectミドルウェアで追加
- チャット: 元の「グローバルbroadcast」方式は廃止。会話（conversation）ごとのSocket.io roomに変更。学生ごと1本・面接官ごと1本の常設スレッド
- 認証: `/api/login`でID/PW検証→JWT発行。クライアントは`io({auth:{token}})`でSocket接続、サーバー側`io.use()`で検証し`socket.data.user`にセット

## 作成/変更したファイル一覧

### DB
- `sql/schema.sql` — 8テーブルの定義（students, interviewers, hr_staff, availability, interview_requests, candidate_slots, conversations, messages）

### サーバー側（新規）
- `server/supabaseClient.js` — service role keyでのSupabaseクライアント（.env未設定でも起動は落ちないようダミーURLにフォールバック）
- `server/auth.js` — bcryptハッシュ検証・JWT発行/検証
- `server/repositories/accountRepoFactory.js` — students/interviewers/hr_staff共通のCRUDファクトリ
- `server/repositories/students.js` / `interviewers.js` / `hrStaff.js` — 上記ファクトリの薄いラッパー
- `server/repositories/availability.js` — 面接官の空き予定カレンダーCRUD
- `server/repositories/interviewRequests.js` — 日程調整依頼CRUD
- `server/repositories/candidateSlots.js` — 候補スロットCRUD
- `server/repositories/conversations.js` — 会話（学生用/面接官用）のfindOrCreate
- `server/repositories/messages.js` — チャットメッセージCRUD
- `server/matching.js` — ③の照合エンジン本体（submitStudentSlots / evaluateRequest / answerAvailability / finalize / notifyNoMatch）
- `server/seed.js` — 動作確認用テストアカウント投入スクリプト（`npm run seed`）

### サーバー配線
- `plugins/socket.io.plugin.js` — `/api/login`ミドルウェア追加、Socket.io接続時のJWT検証(`io.use`)追加
- `socket_event/index.js` — ロール（student/hr/interviewer）ごとにハンドラを振り分け
- `socket_event/student.js` — 学生用: チャット送受信、`submitCalendar`（②の候補提出）
- `socket_event/hr.js` — 人事用: ダッシュボードデータ配信、`createRequest`/`resendRequest`（①）、任意会話へのチャット送信（結果報告含む）
- `socket_event/interviewer.js` — 面接官用: チャット送受信、`answerAvailability`（ボタン/チャット直接回答）、`loadAvailability`/`setAvailability`（⓪カレンダー登録）

### フロントエンド
- `src/session.js` — ログイン中ユーザー情報（sessionStorage連携のreactive ref）
- `src/socketManager.js` — `connect(token)`でauth付きSocket接続する形に変更
- `src/App.vue` — `<v-app>`でラップ、session提供、マウント時にSocket再接続
- `src/router/index.js` — `/`(login) `/student` `/hr` `/interviewer` にルート再編、role別ガード
- `src/components/Login.vue` — ロールタブ+ID/PWログイン
- `src/components/shared/CalendarPicker.vue` — 日付×時間の共通グリッドUI（学生の候補選択・面接官の空き登録で共用）
- `src/components/student/StudentChat.vue` — 学生用チャット+カレンダー候補提出
- `src/components/hr/HrDashboard.vue` — 学生/面接官一覧、状態バッジ、日程送信/再送ダイアログ、チャット（結果報告も同じ送信欄）
- `src/components/interviewer/InterviewerHome.vue` / `InterviewerCalendar.vue` / `InterviewerChat.vue` — 面接官用の空き登録画面とチャット（Yes/Noボタン+直接返信両対応）

### 削除
- `src/components/Chat.vue`（元テンプレートの単一グローバルチャット、置き換えにより不要）

### ドキュメント
- `.env.sample` — `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `JWT_SECRET`
- `README.md` — セットアップ手順にSupabaseスキーマ適用・.env設定・seed実行を追加、追加要件セクションに実装内容を記載

## 動作確認済みのこと

- `npm install` で依存追加済み（`@supabase/supabase-js` `bcryptjs` `jsonwebtoken` `dotenv` `cookie`）
- `npm start` でdevサーバーが正常起動することを確認（ポート3000）
- `POST /api/login` にリクエストが到達し、ハンドラが動くことを確認（実Supabase未接続のため`fetch failed`で失敗するのは想定通り）
- ローカルに`.env`ファイルを`.env.sample`からコピー済み（値は未設定）

## ユーザー側で行ったこと

1. **Supabaseプロジェクトの作成**（進行中、ユーザーが作業中）
   - ユーザーが管理画面の `Settings` 配下に `API` タブが見当たらないと報告して詰まっていた
   - SupabaseのダッシュボードUIが刷新されている可能性があり、`Settings → API Keys`（キー） / `Settings → Data API`（Project URL）のようにタブが分かれている場合がある
   - 次のセッションでは、まずユーザーに実際の画面（Settings配下に表示されているタブ一覧）を教えてもらい、正確な場所を特定する必要がある
   - Web検索ツールがこのモデルでは使えなかった（`tool type 'web_search_20250305' is not supported for this model`というエラー）ため、別モデル/別セッションでは使える可能性がある
2. `sql/schema.sql` をSupabaseのSQL Editorで実行
3. `.env` に `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `JWT_SECRET` を設定（service_role keyは秘密情報なので取り扱い注意、チャットに貼らない）
4. `npm run seed` でテストアカウント投入（student1@example.com / interviewer1・2@example.com / hr1@example.com、パスワードは全て `password123`）
5. `npm start` して3ロールでログインし、一連のフロー（⓪面接官の空き登録→①人事が依頼送信→②学生が候補提出→③自動照合・面接官への確認→④確定通知→結果報告）をE2Eで確認
