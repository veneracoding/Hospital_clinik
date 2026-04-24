const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { nowIso } = require("../db");
const multer = require("multer");
const path = require("path");

function rid(size = 10) {
  return crypto.randomBytes(Math.ceil(size * 0.75)).toString("base64url").slice(0, size);
}

function ok(res, data) {
  res.json({ ok: true, data });
}

function fail(res, status, message) {
  res.status(status).json({ ok: false, error: message });
}

function isEmail(v) {
  return typeof v === "string" && /^[^ ]+@[^ ]+\.[a-z]{2,}$/i.test(v.trim());
}

function normalizeDate(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return v;
}

function normalizeTime(v) {
  if (typeof v !== "string") return null;
  const m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return v;
}

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map((p) => p.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx);
    const v = p.slice(idx + 1);
    if (k === name) return decodeURIComponent(v);
  }
  return null;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  const next = parts.join("; ");
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", next);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, next]);
  } else {
    res.setHeader("Set-Cookie", [String(prev), next]);
  }
}

function clearCookie(res, name) {
  const next = `${name}=; Path=/; Max-Age=0`;
  const prev = res.getHeader("Set-Cookie");
  if (!prev) {
    res.setHeader("Set-Cookie", next);
  } else if (Array.isArray(prev)) {
    res.setHeader("Set-Cookie", [...prev, next]);
  } else {
    res.setHeader("Set-Cookie", [String(prev), next]);
  }
}

function buildTimeSlots() {
  // 09:00 - 17:00, step 30 min (last start 16:30)
  const slots = [];
  for (let h = 9; h <= 16; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }
  }
  return slots;
}

function requireAuth(db) {
  return async (req, res, next) => {
    const sid = getCookie(req, "sid");
    if (!sid) return fail(res, 401, "Not authenticated");
    const s = await db.getState();
    const session = s.sessions.find((x) => x.id === sid);
    if (!session) return fail(res, 401, "Not authenticated");
    const user = s.users.find((u) => u.id === session.userId);
    if (!user) return fail(res, 401, "Not authenticated");
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role || "user" };
    next();
  };
}

function requireAdmin(db) {
  return async (req, res, next) => {
    const sid = getCookie(req, "sid_admin") || getCookie(req, "sid");
    if (!sid) return fail(res, 401, "Not authenticated");
    const s = await db.getState();
    const session = s.sessions.find((x) => x.id === sid);
    if (!session) return fail(res, 401, "Not authenticated");
    const user = s.users.find((u) => u.id === session.userId);
    if (!user) return fail(res, 401, "Not authenticated");
    if ((user.role || "user") !== "admin") return fail(res, 403, "Admin access required");
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role || "admin" };
    next();
  };
}

function apiRouter(db) {
  const router = require("express").Router();

  router.get("/health", (req, res) => ok(res, { status: "ok" }));

  router.get("/doctors", async (req, res) => {
    const s = await db.getState();
    ok(res, s.doctors);
  });

  router.get("/availability", async (req, res) => {
    const doctorId = typeof req.query.doctorId === "string" ? req.query.doctorId : null;
    const date = normalizeDate(req.query.date);
    if (!doctorId) return fail(res, 400, "doctorId is required");
    if (!date) return fail(res, 400, "date is required (YYYY-MM-DD)");

    const s = await db.getState();
    const doctor = s.doctors.find((d) => d.id === doctorId);
    if (!doctor) return fail(res, 404, "Doctor not found");

    const taken = new Set(
      s.appointments
        .filter((a) => a.doctorId === doctorId && a.date === date && a.status !== "cancelled")
        .map((a) => a.time)
    );

    const all = buildTimeSlots();
    const available = all.filter((t) => !taken.has(t));
    ok(res, { doctorId, date, available });
  });

  router.post("/contact", async (req, res) => {
    const { name, email, phone, message } = req.body || {};
    if (typeof name !== "string" || !name.trim()) return fail(res, 400, "Name is required");
    if (!isEmail(email)) return fail(res, 400, "Email is invalid");
    if (typeof phone !== "string" || phone.trim().length < 5) return fail(res, 400, "Phone is required");
    if (typeof message !== "string" || message.trim().length < 2) return fail(res, 400, "Message is required");

    await db.update((s) => {
      s.contactMessages.push({
        id: `msg_${rid(10)}`,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        message: message.trim(),
        createdAt: nowIso()
      });
    });
    ok(res, { sent: true });
  });

  router.post("/auth/register", async (req, res) => {
    const { name, email, password, phone } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 2) return fail(res, 400, "Name is required");
    if (!isEmail(email)) return fail(res, 400, "Email is invalid");
    if (typeof password !== "string" || password.length < 6) return fail(res, 400, "Password must be 6+ chars");

    const emailNorm = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);

    let createdUser = null;
    await db.update((s) => {
      if (s.users.some((u) => u.email === emailNorm)) return;
      createdUser = {
        id: `usr_${rid(10)}`,
        name: name.trim(),
        email: emailNorm,
        phone: typeof phone === "string" ? phone.trim() : "",
        passwordHash,
        createdAt: nowIso()
      };
      s.users.push(createdUser);
    });

    if (!createdUser) return fail(res, 409, "Email already registered");
    ok(res, { user: { id: createdUser.id, name: createdUser.name, email: createdUser.email, phone: createdUser.phone || "" } });
  });

  router.post("/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!isEmail(email)) return fail(res, 400, "Email is invalid");
    if (typeof password !== "string" || !password) return fail(res, 400, "Password is required");

    const s = await db.getState();
    const emailNorm = email.trim().toLowerCase();
    const user = s.users.find((u) => u.email === emailNorm);
    if (!user) return fail(res, 401, "Invalid email or password");
    const okPwd = await bcrypt.compare(password, user.passwordHash);
    if (!okPwd) return fail(res, 401, "Invalid email or password");

    const sid = `sid_${rid(18)}`;
    await db.update((st) => {
      st.sessions.push({ id: sid, userId: user.id, createdAt: nowIso() });
    });

    const cookieName = (user.role || "user") === "admin" ? "sid_admin" : "sid";
    setCookie(res, cookieName, sid, {
      httpOnly: true,
      secure: Boolean(process.env.VERCEL),
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
    ok(res, { user: { id: user.id, name: user.name, email: user.email, phone: user.phone || "", role: user.role || "user" } });
  });

  router.post("/auth/logout", async (req, res) => {
    const adminOnly = String(req.query && req.query.admin) === "1";
    const sid = getCookie(req, "sid");
    const sidAdmin = getCookie(req, "sid_admin");

    const toRemove = new Set(
      adminOnly ? [sidAdmin].filter(Boolean) : [sid, sidAdmin].filter(Boolean)
    );
    if (toRemove.size) {
      await db.update((s) => {
        s.sessions = s.sessions.filter((x) => !toRemove.has(x.id));
      });
    }

    if (!adminOnly) clearCookie(res, "sid");
    clearCookie(res, "sid_admin");
    ok(res, { loggedOut: true });
  });

  router.get("/auth/me", requireAuth(db), async (req, res) => {
    ok(res, { user: req.user });
  });

  router.get("/me", requireAuth(db), async (req, res) => {
    ok(res, { user: req.user });
  });

  // ---------- Admin ----------
  const uploadBaseDir = process.env.VERCEL ? "/tmp/uploads" : path.join(process.cwd(), "uploads");
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadBaseDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").slice(0, 10) || ".png";
        cb(null, `doc_${Date.now()}_${rid(8)}${ext}`);
      }
    }),
    limits: { fileSize: 5 * 1024 * 1024 }
  });

  router.post("/admin/upload", requireAdmin(db), upload.single("photo"), async (req, res) => {
    if (!req.file) return fail(res, 400, "photo is required");
    ok(res, { url: `/uploads/${req.file.filename}` });
  });

  router.get("/admin/me", requireAdmin(db), async (req, res) => {
    ok(res, { user: req.user });
  });

  router.get("/admin/doctors", requireAdmin(db), async (req, res) => {
    const s = await db.getState();
    ok(res, s.doctors);
  });

  router.post("/admin/doctors", requireAdmin(db), async (req, res) => {
    const { name, specialty, photo, bio, socials, education, experience, achievements, languages, workStart, workEnd } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 2) return fail(res, 400, "name is required");
    if (typeof specialty !== "string" || specialty.trim().length < 2) return fail(res, 400, "specialty is required");

    const created = {
      id: `doc_${rid(8)}`,
      name: name.trim(),
      specialty: specialty.trim(),
      photo: typeof photo === "string" ? photo.trim() : "",
      bio: typeof bio === "string" ? bio.trim() : "",
      education: typeof education === "string" ? education.trim() : "",
      experience: typeof experience === "string" ? experience.trim() : "",
      achievements: typeof achievements === "string" ? achievements.trim() : "",
      languages: typeof languages === "string" ? languages.trim() : "",
      workStart: typeof workStart === "string" && workStart.trim() ? workStart.trim() : "09:00",
      workEnd: typeof workEnd === "string" && workEnd.trim() ? workEnd.trim() : "17:00",
      socials: {
        facebook: socials && typeof socials.facebook === "string" ? socials.facebook.trim() : "",
        twitter: socials && typeof socials.twitter === "string" ? socials.twitter.trim() : "",
        instagram: socials && typeof socials.instagram === "string" ? socials.instagram.trim() : "",
        linkedin: socials && typeof socials.linkedin === "string" ? socials.linkedin.trim() : ""
      }
    };

    await db.update((s) => {
      s.doctors.push(created);
    });
    ok(res, { doctor: created });
  });

  router.patch("/admin/doctors/:id", requireAdmin(db), async (req, res) => {
    const id = req.params.id;
    const patch = req.body || {};

    let updated = null;
    await db.update((s) => {
      const d = s.doctors.find((x) => x.id === id);
      if (!d) return;
      if (typeof patch.name === "string" && patch.name.trim().length >= 2) d.name = patch.name.trim();
      if (typeof patch.specialty === "string" && patch.specialty.trim().length >= 2) d.specialty = patch.specialty.trim();
      if (typeof patch.photo === "string") d.photo = patch.photo.trim();
      if (typeof patch.bio === "string") d.bio = patch.bio.trim();
      if (typeof patch.education === "string") d.education = patch.education.trim();
      if (typeof patch.experience === "string") d.experience = patch.experience.trim();
      if (typeof patch.achievements === "string") d.achievements = patch.achievements.trim();
      if (typeof patch.languages === "string") d.languages = patch.languages.trim();
      if (typeof patch.workStart === "string" && patch.workStart.trim()) d.workStart = patch.workStart.trim();
      if (typeof patch.workEnd === "string" && patch.workEnd.trim()) d.workEnd = patch.workEnd.trim();
      if (patch.socials && typeof patch.socials === "object") {
        d.socials = d.socials || { facebook: "", twitter: "", instagram: "", linkedin: "" };
        for (const k of ["facebook", "twitter", "instagram", "linkedin"]) {
          if (typeof patch.socials[k] === "string") d.socials[k] = patch.socials[k].trim();
        }
      }
      updated = { ...d };
    });
    if (!updated) return fail(res, 404, "Doctor not found");
    ok(res, { doctor: updated });
  });

  router.delete("/admin/doctors/:id", requireAdmin(db), async (req, res) => {
    const id = req.params.id;
    let removed = false;
    await db.update((s) => {
      const before = s.doctors.length;
      s.doctors = s.doctors.filter((d) => d.id !== id);
      removed = s.doctors.length !== before;
      // also cancel appointments for this doctor (keeps history without clashes)
      for (const a of s.appointments) {
        if (a.doctorId === id) a.status = "cancelled";
      }
    });
    if (!removed) return fail(res, 404, "Doctor not found");
    ok(res, { deleted: true });
  });

  router.get("/admin/appointments", requireAdmin(db), async (req, res) => {
    const s = await db.getState();
    const doctorsById = new Map(s.doctors.map((d) => [d.id, d]));
    const usersById = new Map(s.users.map((u) => [u.id, u]));
    const list = [...s.appointments]
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
      .map((a) => ({
        ...a,
        doctor: doctorsById.get(a.doctorId) ? { ...doctorsById.get(a.doctorId) } : null,
        user: usersById.get(a.userId)
          ? {
              id: a.userId,
              name: usersById.get(a.userId).name,
              email: usersById.get(a.userId).email,
              phone: usersById.get(a.userId).phone || "",
              role: usersById.get(a.userId).role || "user"
            }
          : null
      }));
    ok(res, list);
  });

  router.get("/admin/users", requireAdmin(db), async (req, res) => {
    const s = await db.getState();
    const doctorsById = new Map(s.doctors.map((d) => [d.id, d]));
    const apptsByUser = new Map();
    for (const a of s.appointments) {
      if (!apptsByUser.has(a.userId)) apptsByUser.set(a.userId, []);
      apptsByUser.get(a.userId).push({
        ...a,
        doctor: doctorsById.get(a.doctorId) ? { ...doctorsById.get(a.doctorId) } : null
      });
    }

    const users = [...s.users]
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || "",
        role: u.role || "user",
        createdAt: u.createdAt,
        appointments: (apptsByUser.get(u.id) || []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      }))
      .sort((a, b) => (a.email || "").localeCompare(b.email || ""));

    ok(res, users);
  });

  router.patch("/admin/appointments/:id", requireAdmin(db), async (req, res) => {
    const id = req.params.id;
    const { status } = req.body || {};
    const allowed = new Set(["pending", "confirmed", "cancelled"]);
    if (typeof status !== "string" || !allowed.has(status)) return fail(res, 400, "Invalid status");

    let updated = null;
    await db.update((s) => {
      const a = s.appointments.find((x) => x.id === id);
      if (!a) return;
      a.status = status;
      updated = { ...a };
    });
    if (!updated) return fail(res, 404, "Appointment not found");
    ok(res, { appointment: updated });
  });

  router.post("/appointments/book", requireAuth(db), async (req, res) => {
    const { doctorId, date, time, reason } = req.body || {};
    const dateNorm = normalizeDate(date);
    const timeNorm = normalizeTime(time);
    if (typeof doctorId !== "string" || !doctorId) return fail(res, 400, "doctorId is required");
    if (!dateNorm) return fail(res, 400, "date is required (YYYY-MM-DD)");
    if (!timeNorm) return fail(res, 400, "time is required (HH:MM)");

    const reasonNorm = typeof reason === "string" ? reason.trim().slice(0, 300) : "";

    let created = null;
    await db.update((s) => {
      const doctor = s.doctors.find((d) => d.id === doctorId);
      if (!doctor) return;

      const clash = s.appointments.some(
        (a) =>
          a.doctorId === doctorId &&
          a.date === dateNorm &&
          a.time === timeNorm &&
          a.status !== "cancelled"
      );
      if (clash) return;

      created = {
        id: `apt_${rid(10)}`,
        userId: req.user.id,
        doctorId,
        date: dateNorm,
        time: timeNorm,
        reason: reasonNorm,
        status: "pending",
        createdAt: nowIso()
      };
      s.appointments.push(created);
    });

    if (!created) return fail(res, 409, "This time is already taken (or doctor not found)");
    ok(res, { appointment: created });
  });

  router.post("/appointments", requireAuth(db), async (req, res) => {
    const { doctorId, date, time, reason } = req.body || {};
    const dateNorm = normalizeDate(date);
    const timeNorm = normalizeTime(time);
    if (typeof doctorId !== "string" || !doctorId) return fail(res, 400, "doctorId is required");
    if (!dateNorm) return fail(res, 400, "date is required (YYYY-MM-DD)");
    if (!timeNorm) return fail(res, 400, "time is required (HH:MM)");

    const reasonNorm = typeof reason === "string" ? reason.trim().slice(0, 300) : "";

    let created = null;
    await db.update((s) => {
      const doctor = s.doctors.find((d) => d.id === doctorId);
      if (!doctor) return;

      const clash = s.appointments.some(
        (a) =>
          a.doctorId === doctorId &&
          a.date === dateNorm &&
          a.time === timeNorm &&
          a.status !== "cancelled"
      );
      if (clash) return;

      created = {
        id: `apt_${rid(10)}`,
        userId: req.user.id,
        doctorId,
        date: dateNorm,
        time: timeNorm,
        reason: reasonNorm,
        status: "pending",
        createdAt: nowIso()
      };
      s.appointments.push(created);
    });

    if (!created) return fail(res, 409, "This time is already taken (or doctor not found)");
    ok(res, { appointment: created });
  });

  router.get("/appointments/mine", requireAuth(db), async (req, res) => {
    const s = await db.getState();
    const doctorsById = new Map(s.doctors.map((d) => [d.id, d]));
    const mine = s.appointments
      .filter((a) => a.userId === req.user.id)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map((a) => ({
        ...a,
        doctor: doctorsById.get(a.doctorId) ? { ...doctorsById.get(a.doctorId) } : null
      }));
    ok(res, mine);
  });

  return router;
}

module.exports = { apiRouter };

