(() => {
  "use strict";

  const API = "/api";
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  async function api(path, options = {}) {
    const res = await fetch(API + path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function dateText(x) {
    return new Date(x + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric"
    });
  }

  function statusBadge(s) {
    return `<span class="status ${String(s).toLowerCase()}">${esc(s)}</span>`;
  }

  async function requireLogin() {
    const page = location.pathname.split("/").pop() || "index.html";
    const protectedPages = ["dashboard.html", "students.html", "classes.html", "attendance.html", "reports.html", "settings.html"];
    if (!protectedPages.includes(page)) return true;

    try {
      const me = await api("/auth/me");
      if ($("sideUserName")) $("sideUserName").textContent = me.fullName || me.username;
      if ($("sideUserRole")) $("sideUserRole").textContent = me.role || "Admin";
      return true;
    } catch {
      location.href = "login.html";
      return false;
    }
  }

  function common() {
    document.querySelectorAll(".nav a[data-page]").forEach(a => {
      const page = location.pathname.split("/").pop().replace(".html", "");
      a.classList.toggle("active", a.dataset.page === page);
    });

    if ($("liveDate")) {
      $("liveDate").textContent = new Date().toLocaleDateString(undefined, {
        weekday: "short", month: "short", day: "numeric"
      });
    }

    $("logoutBtn")?.addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST" }); } catch {}
      location.href = "login.html";
    });

    document.querySelectorAll("[data-close]").forEach(b =>
      b.addEventListener("click", () => document.querySelectorAll(".modal").forEach(m => m.classList.add("hidden")))
    );
  }

  // ========== LOGIN ==========
  function loginPage() {
    if (!$("loginForm")) return;

    api("/auth/me").then(() => location.href = "dashboard.html").catch(() => {});

    $("loginForm").addEventListener("submit", async e => {
      e.preventDefault();
      const msg = $("loginMessage");
      msg.textContent = "";
      msg.className = "message";

      try {
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            username: $("username").value.trim(),
            password: $("password").value
          })
        });
        msg.textContent = "Login successful...";
        msg.className = "message success";
        setTimeout(() => location.href = "dashboard.html", 300);
      } catch (err) {
        msg.textContent = err.message || "Invalid credentials";
      }
    });
  }

  // ========== DASHBOARD ==========
  async function dashboardPage() {
    if (!$("totalStudents")) return;

    try {
      const data = await api("/attendance/today");
      $("totalStudents").textContent = data.total;
      $("presentToday").textContent = data.present + (data.late ? ` (+${data.late} late)` : "");
      $("absentToday").textContent = data.absent;
      $("attendanceRate").textContent = data.rate + "%";
      if ($("todayLabel")) $("todayLabel").textContent = dateText(data.date);

      $("dashboardAttendance").innerHTML = data.list.map(x => `
        <tr>
          <td><b>${esc(x.name)}</b></td>
          <td>${esc(x.reg_no)}</td>
          <td>${esc(x.course)}</td>
          <td>${statusBadge(x.status)}</td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="empty">No students yet.</td></tr>`;
    } catch (err) {
      console.error(err);
    }
  }

  // ========== STUDENTS ==========
  let deleteId = null;

  async function studentsPage() {
    if (!$("studentsTable")) return;

    const render = async () => {
      const q = $("studentSearch").value.trim();
      try {
        const students = await api("/students" + (q ? `?q=${encodeURIComponent(q)}` : ""));
        $("studentCount").textContent = students.length;
        $("studentsTable").innerHTML = students.length
          ? students.map(x => `
              <tr>
                <td><b>${esc(x.name)}</b></td>
                <td>${esc(x.reg_no)}</td>
                <td>${esc(x.course)}</td>
                <td class="actions">
                  <button class="table-btn" data-edit="${x.id}">Edit</button>
                  <button class="table-btn delete-btn" data-del="${x.id}">Delete</button>
                </td>
              </tr>
            `).join("")
          : `<tr><td colspan="4" class="empty">No students found.</td></tr>`;
      } catch (err) {
        $("studentsTable").innerHTML = `<tr><td colspan="4" class="empty">${esc(err.message)}</td></tr>`;
      }
    };

    $("openStudentModal").addEventListener("click", () => {
      $("studentModalTitle").textContent = "Add Student";
      $("editStudentId").value = "";
      $("studentForm").reset();
      $("studentMessage").textContent = "";
      $("studentModal").classList.remove("hidden");
    });

    $("studentSearch").addEventListener("input", () => render());

    $("studentsTable").addEventListener("click", async e => {
      if (e.target.dataset.edit) {
        try {
          const s = await api(`/students/${e.target.dataset.edit}`);
          $("studentModalTitle").textContent = "Edit Student";
          $("editStudentId").value = s.id;
          $("studentName").value = s.name;
          $("studentReg").value = s.reg_no;
          $("studentCourse").value = s.course;
          $("studentMessage").textContent = "";
          $("studentModal").classList.remove("hidden");
        } catch (err) {
          alert(err.message);
        }
      }
      if (e.target.dataset.del) {
        deleteId = e.target.dataset.del;
        $("deleteModal").classList.remove("hidden");
      }
    });

    $("confirmDelete")?.addEventListener("click", async () => {
      try {
        await api(`/students/${deleteId}`, { method: "DELETE" });
        $("deleteModal").classList.add("hidden");
        render();
      } catch (err) {
        alert(err.message);
      }
    });

    $("studentForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = {
        name: $("studentName").value.trim(),
        reg_no: $("studentReg").value.trim(),
        course: $("studentCourse").value.trim()
      };
      const id = $("editStudentId").value;
      try {
        if (id) {
          await api(`/students/${id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/students", { method: "POST", body: JSON.stringify(body) });
        }
        $("studentModal").classList.add("hidden");
        render();
      } catch (err) {
        $("studentMessage").textContent = err.message;
      }
    });

    render();
  }

  // ========== CLASSES ==========
  async function classesPage() {
    if (!$("classesTable")) return;

    const render = async () => {
      try {
        const classes = await api("/classes");
        $("classesTable").innerHTML = classes.length
          ? classes.map(c => `
              <tr>
                <td><b>${esc(c.name)}</b></td>
                <td>${esc(c.course || "—")}</td>
                <td>${esc(c.start_time)}</td>
                <td>${c.duration_minutes} min</td>
                <td>${c.grace_minutes} min</td>
                <td class="actions">
                  <button class="table-btn" data-edit="${c.id}">Edit</button>
                  <button class="table-btn delete-btn" data-del="${c.id}">Delete</button>
                </td>
              </tr>
            `).join("")
          : `<tr><td colspan="6" class="empty">No classes yet. Add one to enable start-time based Late marking.</td></tr>`;
      } catch (err) {
        $("classesTable").innerHTML = `<tr><td colspan="6" class="empty">${esc(err.message)}</td></tr>`;
      }
    };

    $("openClassModal").addEventListener("click", () => {
      $("classModalTitle").textContent = "Add Class";
      $("editClassId").value = "";
      $("classForm").reset();
      $("classStart").value = "09:00";
      $("classDuration").value = 90;
      $("classGrace").value = 15;
      $("classMessage").textContent = "";
      $("classModal").classList.remove("hidden");
    });

    $("classesTable").addEventListener("click", async e => {
      if (e.target.dataset.edit) {
        try {
          const classes = await api("/classes");
          const c = classes.find(x => String(x.id) === e.target.dataset.edit);
          if (!c) return;
          $("classModalTitle").textContent = "Edit Class";
          $("editClassId").value = c.id;
          $("className").value = c.name;
          $("classCourse").value = c.course || "";
          $("classStart").value = c.start_time;
          $("classDuration").value = c.duration_minutes;
          $("classGrace").value = c.grace_minutes;
          $("classMessage").textContent = "";
          $("classModal").classList.remove("hidden");
        } catch (err) {
          alert(err.message);
        }
      }
      if (e.target.dataset.del) {
        if (!confirm("Deactivate this class?")) return;
        try {
          await api(`/classes/${e.target.dataset.del}`, { method: "DELETE" });
          render();
        } catch (err) {
          alert(err.message);
        }
      }
    });

    $("classForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = {
        name: $("className").value.trim(),
        course: $("classCourse").value.trim(),
        start_time: $("classStart").value,
        duration_minutes: +$("classDuration").value || 90,
        grace_minutes: +$("classGrace").value || 15
      };
      const id = $("editClassId").value;
      try {
        if (id) {
          await api(`/classes/${id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/classes", { method: "POST", body: JSON.stringify(body) });
        }
        $("classModal").classList.add("hidden");
        render();
      } catch (err) {
        $("classMessage").textContent = err.message;
      }
    });

    render();
  }

  // ========== ATTENDANCE ==========
  async function attendancePage() {
    if (!$("attendanceTable")) return;

    $("attendanceDate").value = today();

    // load classes into select
    try {
      const classes = await api("/classes");
      const sel = $("attendanceClass");
      sel.innerHTML = `<option value="">— Select class —</option>` +
        classes.map(c => `<option value="${c.id}" data-start="${c.start_time}" data-grace="${c.grace_minutes}" data-name="${esc(c.name)}">${esc(c.name)} (${c.start_time})</option>`).join("");
      if (classes.length) sel.value = classes[0].id;
    } catch {}

    const updateClassInfo = () => {
      const sel = $("attendanceClass");
      const opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value) {
        $("classInfo").textContent = "Select a class to enable automatic Late detection based on start time.";
        return;
      }
      const start = opt.dataset.start;
      const grace = opt.dataset.grace;
      $("classInfo").textContent = `Class starts at ${start}. Students marked after ${start} + ${grace} min grace will be suggested as Late when Auto-Late is enabled.`;
    };

    const render = async () => {
      const date = $("attendanceDate").value;
      const classId = $("attendanceClass").value;
      const q = ($("attendanceSearch").value || "").trim().toLowerCase();
      updateClassInfo();

      try {
        const data = await api(`/attendance?date=${date}${classId ? `&class_id=${classId}` : ""}`);
        const statusMap = {};
        data.records.forEach(r => statusMap[r.student_id] = r.status);

        let students = data.students;
        if (q) {
          students = students.filter(x =>
            `${x.name} ${x.reg_no} ${x.course}`.toLowerCase().includes(q)
          );
        }

        $("attendanceTable").innerHTML = students.length
          ? students.map((x, i) => {
              const st = statusMap[x.id] || "Absent";
              return `
                <tr>
                  <td>${i + 1}</td>
                  <td><b>${esc(x.name)}</b></td>
                  <td>${esc(x.reg_no)}</td>
                  <td>${esc(x.course)}</td>
                  <td>
                    <select class="status-select" data-id="${x.id}">
                      <option ${st === "Present" ? "selected" : ""}>Present</option>
                      <option ${st === "Absent" ? "selected" : ""}>Absent</option>
                      <option ${st === "Late" ? "selected" : ""}>Late</option>
                    </select>
                  </td>
                </tr>`;
            }).join("")
          : `<tr><td colspan="5" class="empty">No students found.</td></tr>`;

        updateSummary();
      } catch (err) {
        $("attendanceTable").innerHTML = `<tr><td colspan="5" class="empty">${esc(err.message)}</td></tr>`;
      }
    };

    const updateSummary = () => {
      let p = 0, a = 0, l = 0;
      document.querySelectorAll(".status-select").forEach(sel => {
        if (sel.value === "Present") p++;
        else if (sel.value === "Absent") a++;
        else if (sel.value === "Late") l++;
      });
      $("attendancePresent").textContent = p + " Present";
      $("attendanceAbsent").textContent = a + " Absent";
      $("attendanceLate").textContent = l + " Late";
    };

    $("attendanceDate").addEventListener("change", render);
    $("attendanceClass").addEventListener("change", render);
    $("attendanceSearch").addEventListener("input", render);
    $("attendanceTable").addEventListener("change", updateSummary);

    $("saveAttendance").addEventListener("click", async () => {
      const date = $("attendanceDate").value;
      const class_id = $("attendanceClass").value ? +$("attendanceClass").value : null;
      const auto_late = $("autoLate").checked;
      const records = [];
      document.querySelectorAll(".status-select").forEach(sel => {
        records.push({ student_id: +sel.dataset.id, status: sel.value });
      });

      try {
        const res = await api("/attendance", {
          method: "POST",
          body: JSON.stringify({ date, class_id, records, auto_late })
        });
        $("attendanceMessage").textContent = res.message || "Saved!";
        $("attendanceMessage").className = "message success";
        setTimeout(() => { $("attendanceMessage").textContent = ""; }, 3000);
        render(); // refresh in case auto-late changed values
      } catch (err) {
        $("attendanceMessage").textContent = err.message;
        $("attendanceMessage").className = "message";
      }
    });

    render();
  }

  // ========== REPORTS ==========
  async function reportsPage() {
    if (!$("reportsTable")) return;

    const render = async () => {
      const q = ($("reportSearch")?.value || "").trim();
      try {
        const data = await api("/reports" + (q ? `?q=${encodeURIComponent(q)}` : ""));
        $("reportsTable").innerHTML = data.performance.length
          ? data.performance.map(x => `
              <tr>
                <td><b>${esc(x.name)}</b></td>
                <td>${esc(x.reg_no)}</td>
                <td>${esc(x.course)}</td>
                <td>${x.present}</td>
                <td>${x.late}</td>
                <td>${x.absent}</td>
                <td><b>${x.rate}%</b></td>
              </tr>
            `).join("")
          : `<tr><td colspan="7" class="empty">No data yet.</td></tr>`;
      } catch (err) {
        $("reportsTable").innerHTML = `<tr><td colspan="7" class="empty">${esc(err.message)}</td></tr>`;
      }
    };

    $("reportSearch")?.addEventListener("input", render);
    render();
  }

  // ========== SETTINGS ==========
  async function settingsPage() {
    if (!$("exportData")) return;

    try {
      const me = await api("/auth/me");
      if ($("settingsAccountInfo")) {
        $("settingsAccountInfo").textContent = `Logged in as ${me.fullName || me.username} (${me.role})`;
      }
    } catch {}

    $("openPasswordModal")?.addEventListener("click", () => {
      $("passwordForm").reset();
      $("passwordMessage").textContent = "";
      $("passwordModal").classList.remove("hidden");
    });

    $("passwordForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const current = $("currentPassword").value;
      const neu = $("newPassword").value;
      const confirm = $("confirmPassword").value;
      if (neu !== confirm) {
        $("passwordMessage").textContent = "New passwords do not match";
        return;
      }
      try {
        await api("/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ currentPassword: current, newPassword: neu })
        });
        $("passwordMessage").textContent = "Password updated successfully";
        $("passwordMessage").className = "message success";
        setTimeout(() => $("passwordModal").classList.add("hidden"), 1200);
      } catch (err) {
        $("passwordMessage").textContent = err.message;
        $("passwordMessage").className = "message";
      }
    });

    $("exportData").addEventListener("click", async () => {
      try {
        const data = await api("/export");
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `attendance-export-${today()}.json`;
        a.click();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // ---------- Boot ----------
  (async () => {
    const ok = await requireLogin();
    if (!ok) return;
    common();
    loginPage();
    dashboardPage();
    studentsPage();
    classesPage();
    attendancePage();
    reportsPage();
    settingsPage();
  })();
})();
