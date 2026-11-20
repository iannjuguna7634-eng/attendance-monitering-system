const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data dir
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "attendance.db"));
db.pragma("journal_mode = WAL");

// ---------- Schema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    reg_no TEXT UNIQUE NOT NULL,
    course TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    course TEXT,
    start_time TEXT NOT NULL,          -- HH:MM 24h
    duration_minutes INTEGER DEFAULT 90,
    grace_minutes INTEGER DEFAULT 15,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    class_id INTEGER,
    date TEXT NOT NULL,                -- YYYY-MM-DD
    status TEXT NOT NULL,              -- Present | Late | Absent
    marked_at TEXT,                    -- ISO timestamp when marked
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL,
    UNIQUE(student_id, date, class_id)
  );

  CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);
  CREATE INDEX IF NOT EXISTS idx_att_student ON attendance(student_id);
`);

// Seed initial admin if none exists (no public demo credentials shown in UI)
const userCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync("ChangeMe123!", 10);
  db.prepare(
    "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)"
  ).run("admin", hash, "Administrator", "admin");
  console.log("Created initial admin user: admin / ChangeMe123!  (please change password in Settings)");
}

// Seed sample students & a default class if empty
const studentCount = db.prepare("SELECT COUNT(*) as c FROM students").get().c;
if (studentCount === 0) {
  const insert = db.prepare(
    "INSERT INTO students (name, reg_no, course) VALUES (?, ?, ?)"
  );
  const samples = [
    ["John Kamau", "DIT-001", "Diploma in IT"],
    ["Mary Wanjiku", "DIT-002", "Diploma in IT"],
    ["Brian Otieno", "DIT-003", "Diploma in IT"],
    ["Lucy Achieng", "DIT-004", "Diploma in IT"],
    ["Kevin Mwangi", "DIT-005", "Diploma in IT"],
    ["Faith Njeri", "DIT-006", "Diploma in IT"]
  ];
  samples.forEach(s => insert.run(...s));
}

const classCount = db.prepare("SELECT COUNT(*) as c FROM classes").get().c;
if (classCount === 0) {
  db.prepare(
    `INSERT INTO classes (name, course, start_time, duration_minutes, grace_minutes)
     VALUES (?, ?, ?, ?, ?)`
  ).run("Morning Lecture", "Diploma in IT", "09:00", 90, 15);
  db.prepare(
    `INSERT INTO classes (name, course, start_time, duration_minutes, grace_minutes)
     VALUES (?, ?, ?, ?, ?)`
  ).run("Afternoon Lab", "Diploma in IT", "14:00", 120, 10);
}

// ---------- Middleware ----------
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "attendance-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

// ---------- Auth ----------
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.fullName = user.full_name;
  req.session.role = user.role;
  res.json({
    success: true,
    user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role }
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const user = db.prepare("SELECT id, username, full_name as fullName, role FROM users WHERE id = ?").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json(user);
});

app.post("/api/auth/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Current password and new password (min 6 chars) required" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
  res.json({ success: true, message: "Password updated successfully" });
});

// ---------- Students ----------
app.get("/api/students", requireAuth, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  let rows;
  if (q) {
    rows = db.prepare(
      `SELECT * FROM students WHERE lower(name) LIKE ? OR lower(reg_no) LIKE ? OR lower(course) LIKE ?
       ORDER BY name`
    ).all(`%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare("SELECT * FROM students ORDER BY name").all();
  }
  res.json(rows);
});

app.get("/api/students/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM students WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Student not found" });
  res.json(row);
});

app.post("/api/students", requireAuth, (req, res) => {
  const { name, reg_no, course } = req.body || {};
  if (!name || !reg_no || !course) {
    return res.status(400).json({ error: "name, reg_no and course are required" });
  }
  try {
    const info = db.prepare(
      "INSERT INTO students (name, reg_no, course) VALUES (?, ?, ?)"
    ).run(name.trim(), reg_no.trim(), course.trim());
    const student = db.prepare("SELECT * FROM students WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json(student);
  } catch (e) {
    if (e.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "Registration number already exists" });
    }
    throw e;
  }
});

app.put("/api/students/:id", requireAuth, (req, res) => {
  const { name, reg_no, course } = req.body || {};
  if (!name || !reg_no || !course) {
    return res.status(400).json({ error: "name, reg_no and course are required" });
  }
  try {
    const info = db.prepare(
      "UPDATE students SET name = ?, reg_no = ?, course = ? WHERE id = ?"
    ).run(name.trim(), reg_no.trim(), course.trim(), req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: "Student not found" });
    const student = db.prepare("SELECT * FROM students WHERE id = ?").get(req.params.id);
    res.json(student);
  } catch (e) {
    if (e.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "Registration number already exists" });
    }
    throw e;
  }
});

app.delete("/api/students/:id", requireAuth, (req, res) => {
  const info = db.prepare("DELETE FROM students WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Student not found" });
  res.json({ success: true });
});

// ---------- Classes ----------
app.get("/api/classes", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM classes WHERE active = 1 ORDER BY start_time, name").all();
  res.json(rows);
});

app.post("/api/classes", requireAuth, (req, res) => {
  const { name, course, start_time, duration_minutes, grace_minutes } = req.body || {};
  if (!name || !start_time) {
    return res.status(400).json({ error: "name and start_time are required" });
  }
  // basic HH:MM validation
  if (!/^\d{2}:\d{2}$/.test(start_time)) {
    return res.status(400).json({ error: "start_time must be HH:MM" });
  }
  const info = db.prepare(
    `INSERT INTO classes (name, course, start_time, duration_minutes, grace_minutes)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    name.trim(),
    (course || "").trim(),
    start_time,
    duration_minutes || 90,
    grace_minutes ?? 15
  );
  const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(cls);
});

app.put("/api/classes/:id", requireAuth, (req, res) => {
  const { name, course, start_time, duration_minutes, grace_minutes, active } = req.body || {};
  if (!name || !start_time) {
    return res.status(400).json({ error: "name and start_time are required" });
  }
  const info = db.prepare(
    `UPDATE classes SET name=?, course=?, start_time=?, duration_minutes=?, grace_minutes=?, active=?
     WHERE id=?`
  ).run(
    name.trim(),
    (course || "").trim(),
    start_time,
    duration_minutes || 90,
    grace_minutes ?? 15,
    active === 0 ? 0 : 1,
    req.params.id
  );
  if (info.changes === 0) return res.status(404).json({ error: "Class not found" });
  res.json(db.prepare("SELECT * FROM classes WHERE id = ?").get(req.params.id));
});

app.delete("/api/classes/:id", requireAuth, (req, res) => {
  // soft delete
  const info = db.prepare("UPDATE classes SET active = 0 WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Class not found" });
  res.json({ success: true });
});

// Helper: decide status based on class start time
function decideStatus(classId, requestedStatus) {
  if (!classId || requestedStatus === "Absent") return requestedStatus || "Absent";
  const cls = db.prepare("SELECT * FROM classes WHERE id = ?").get(classId);
  if (!cls) return requestedStatus || "Present";

  const now = new Date();
  const [h, m] = cls.start_time.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  const graceEnd = new Date(start.getTime() + (cls.grace_minutes || 15) * 60 * 1000);

  if (now <= graceEnd) return "Present";
  // still within class duration? mark Late, else keep requested
  const end = new Date(start.getTime() + (cls.duration_minutes || 90) * 60 * 1000);
  if (now <= end) return "Late";
  return requestedStatus || "Late";
}

// ---------- Attendance ----------
app.get("/api/attendance/today", requireAuth, (req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  const students = db.prepare("SELECT * FROM students ORDER BY name").all();
  const records = db.prepare(
    "SELECT student_id, status FROM attendance WHERE date = ?"
  ).all(date);

  const map = {};
  records.forEach(r => (map[r.student_id] = r.status));

  let present = 0, late = 0, absent = 0;
  const list = students.map(s => {
    const status = map[s.id] || "Absent";
    if (status === "Present") present++;
    else if (status === "Late") late++;
    else absent++;
    return { ...s, status };
  });

  const total = students.length;
  const rate = total ? Math.round(((present + late) / total) * 100) : 0;

  res.json({ date, total, present, late, absent, rate, list });
});

app.get("/api/attendance", requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const classId = req.query.class_id ? +req.query.class_id : null;

  const students = db.prepare("SELECT * FROM students ORDER BY name").all();
  let records;
  if (classId) {
    records = db.prepare(
      "SELECT student_id, status, marked_at FROM attendance WHERE date = ? AND class_id = ?"
    ).all(date, classId);
  } else {
    // fallback: any record for that date (prefer latest)
    records = db.prepare(
      "SELECT student_id, status, marked_at FROM attendance WHERE date = ?"
    ).all(date);
  }

  res.json({ date, class_id: classId, records, students });
});

app.post("/api/attendance", requireAuth, (req, res) => {
  const { date, class_id, records, auto_late } = req.body || {};
  if (!date || !Array.isArray(records)) {
    return res.status(400).json({ error: "date and records array required" });
  }

  const nowIso = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO attendance (student_id, class_id, date, status, marked_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id, date, class_id) DO UPDATE SET
      status = excluded.status,
      marked_at = excluded.marked_at
  `);

  const tx = db.transaction((rows) => {
    for (const r of rows) {
      let status = r.status || "Absent";
      // optional auto-late based on class start time
      if (auto_late && class_id && status !== "Absent") {
        status = decideStatus(class_id, status);
      }
      upsert.run(r.student_id, class_id || null, date, status, nowIso);
    }
  });

  tx(records);
  res.json({ success: true, message: "Attendance saved successfully" });
});

// ---------- Reports ----------
app.get("/api/reports", requireAuth, (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  const students = db.prepare("SELECT * FROM students ORDER BY name").all();
  const allAtt = db.prepare(
    "SELECT student_id, status FROM attendance"
  ).all();

  const stats = {};
  students.forEach(s => {
    stats[s.id] = { present: 0, absent: 0, late: 0 };
  });
  allAtt.forEach(r => {
    if (!stats[r.student_id]) return;
    const key = r.status.toLowerCase();
    if (key === "present") stats[r.student_id].present++;
    else if (key === "late") stats[r.student_id].late++;
    else stats[r.student_id].absent++;
  });

  let performance = students.map(s => {
    const st = stats[s.id];
    const total = st.present + st.absent + st.late;
    const rate = total ? Math.round(((st.present + st.late) / total) * 100) : 0;
    return {
      id: s.id,
      name: s.name,
      reg_no: s.reg_no,
      course: s.course,
      present: st.present,
      absent: st.absent,
      late: st.late,
      rate
    };
  });

  if (q) {
    performance = performance.filter(p =>
      `${p.name} ${p.reg_no} ${p.course}`.toLowerCase().includes(q)
    );
  }

  res.json({ performance });
});

// Export
app.get("/api/export", requireAuth, (req, res) => {
  const students = db.prepare("SELECT * FROM students").all();
  const classes = db.prepare("SELECT * FROM classes").all();
  const attendance = db.prepare("SELECT * FROM attendance").all();
  res.json({ students, classes, attendance, exportedAt: new Date().toISOString() });
});

// SPA-ish fallback for html pages
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const file = path.join(__dirname, "public", req.path === "/" ? "index.html" : req.path);
  if (fs.existsSync(file) && file.endsWith(".html")) {
    return res.sendFile(file);
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Student Attendance System running on http://localhost:${PORT}`);
});
