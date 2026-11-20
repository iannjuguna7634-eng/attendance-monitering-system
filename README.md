# Student Attendance Monitoring System (v2)

Modern full-stack attendance system that keeps the **exact same look** as the original while adding:

- **Class start times** + grace period → automatic **Late** detection
- Real accounts (no public demo credentials)
- Change password in Settings
- Classes management page
- Timestamped attendance records
- Export JSON

## Stack
- Node.js + Express
- better-sqlite3
- express-session + bcryptjs
- Same CSS / UI as the original

## Default login (first run only)
- **Username:** `admin`
- **Password:** `ChangeMe123!`

**Change the password immediately** in Settings → Change Password.

## Local run
```bash
cd attendance-system
npm install
npm start
```
Open http://localhost:3000

## Deploy on Render
1. Push this folder to a GitHub repo
2. Create a new **Web Service** on Render
3. Connect the repo
4. Build: `npm install`
5. Start: `node server.js`
6. (Optional) set `SESSION_SECRET` env var

The SQLite database lives in `/data/attendance.db` and persists on the free disk.

## Features
- Secure login (session cookie)
- Student CRUD + search
- Classes with start time, duration, grace minutes
- Mark attendance by date + class
- Auto-Late based on class start time when enabled
- Dashboard stats
- Performance reports
- JSON export
- Responsive UI matching the original design
