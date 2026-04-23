require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const { nanoid } = require("nanoid");
const { ensureDb, db, nowIso } = require("./src/db");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Create .env from .env.example");
  process.exit(1);
}

const REMINDERS_ENABLED = (process.env.TELEGRAM_REMINDERS || "1") === "1";
const REMINDER_MINUTES = (process.env.TELEGRAM_REMINDERS_MINUTES || "1440,120")
  .split(",")
  .map((x) => Number(String(x).trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => b - a);

const bot = new TelegramBot(TOKEN, { polling: true });

// Simple in-memory wizard state
const state = new Map(); // chatId -> { step, doctorId, date }

function mainMenu() {
  return {
    reply_markup: {
      keyboard: [["🩺 Qabulga yozilish"], ["📋 Mening yozuvlarim"]],
      resize_keyboard: true
    }
  };
}

function fmtDoctor(d) {
  return `${d.name} — ${d.specialty}`;
}

function buildSlots() {
  const slots = [];
  for (let h = 9; h <= 16; h++) {
    for (const m of [0, 30]) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}

function toLocalDateTime(dateStr, timeStr) {
  // Interprets as local time (Windows time zone)
  return new Date(`${dateStr}T${timeStr}:00`);
}

function normalizePhone(p) {
  const raw = String(p || "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  // keep leading +
  if (digits.startsWith("+")) return "+" + digits.slice(1).replace(/\D/g, "");
  return "+" + digits.replace(/\D/g, "");
}

async function ensureTelegramUser(chat, phoneNumber) {
  const chatId = String(chat.id);
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim() || "Telegram User";
  const email = `tg_${chatId}@telegram.local`;
  const phone = normalizePhone(phoneNumber);

  let userId = null;

  await db.update((s) => {
    const existingLink = (s.telegramLinks || []).find((l) => l.chatId === chatId);
    if (existingLink) {
      userId = existingLink.userId;
      if (phone && !s.users.find(u => u.id === userId).phone) {
        s.users.find(u => u.id === userId).phone = phone;
      }
      return;
    }

    let user = null;
    if (phone) {
      user = s.users.find((u) => normalizePhone(u.phone || "") === phone) || null;
    }
    if (!user) user = s.users.find((u) => u.email === email);
    if (!user) {
      user = {
        id: `usr_${nanoid(10)}`,
        name,
        email,
        phone,
        passwordHash: null,
        role: "user",
        createdAt: nowIso()
      };
      s.users.push(user);
    } else if (phone && !user.phone) {
      user.phone = phone;
    }

    s.telegramLinks = s.telegramLinks || [];
    s.telegramLinks.push({
      id: `tgl_${nanoid(10)}`,
      chatId,
      userId: user.id,
      phone,
      createdAt: nowIso()
    });
    userId = user.id;
  });

  return userId;
}

async function listDoctors() {
  const s = await db.getState();
  return s.doctors || [];
}

async function availability(doctorId, date) {
  const s = await db.getState();
  const taken = new Set(
    (s.appointments || [])
      .filter((a) => a.doctorId === doctorId && a.date === date && a.status !== "cancelled")
      .map((a) => a.time)
  );
  return buildSlots().filter((t) => !taken.has(t));
}

async function createAppointment({ userId, chatId, doctorId, date, time }) {
  let created = null;
  await db.update((s) => {
    const doctor = (s.doctors || []).find((d) => d.id === doctorId);
    if (!doctor) return;

    const clash = (s.appointments || []).some(
      (a) =>
        a.doctorId === doctorId &&
        a.date === date &&
        a.time === time &&
        a.status !== "cancelled"
    );
    if (clash) return;

    created = {
      id: `apt_${nanoid(10)}`,
      userId,
      doctorId,
      date,
      time,
      reason: "Telegram bot",
      status: "pending",
      source: "telegram",
      telegramChatId: String(chatId),
      reminders: { sent: [] },
      createdAt: nowIso()
    };
    s.appointments = s.appointments || [];
    s.appointments.push(created);
  });
  return created;
}

async function myAppointments(userId) {
  const s = await db.getState();
  const doctorsById = new Map((s.doctors || []).map((d) => [d.id, d]));
  return (s.appointments || [])
    .filter((a) => a.userId === userId)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .map((a) => ({ ...a, doctor: doctorsById.get(a.doctorId) || null }));
}

function statusUz(s) {
  if (s === "confirmed") return "✅ Tasdiqlangan";
  if (s === "cancelled") return "❌ Bekor qilingan";
  return "⏳ Kutilmoqda";
}

bot.onText(/\/start/, async (msg) => {
  await ensureDb();
  const chatId = msg.chat.id;
  const s = await db.getState();
  const link = (s.telegramLinks || []).find((l) => l.chatId === String(chatId));
  if (!link || !link.phone) {
    state.set(chatId, { step: "phone" });
    bot.sendMessage(chatId, "Telefon raqamingizni yuboring (Contact).", {
      reply_markup: {
        keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return;
  }
  await ensureTelegramUser(msg.chat, link.phone);
  state.delete(chatId);
  bot.sendMessage(chatId, "Assalomu alaykum! Medcare botiga xush kelibsiz.\n\nQuyidagilardan birini tanlang:", mainMenu());
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text || text.startsWith("/")) return;

  await ensureDb();
  const st0 = state.get(chatId);
  if (st0 && st0.step === "phone") return; // contact handler will process
  const s0 = await db.getState();
  const link0 = (s0.telegramLinks || []).find((l) => l.chatId === String(chatId));
  const userId = await ensureTelegramUser(msg.chat, link0 ? link0.phone : "");

  if (text === "🩺 Qabulga yozilish") {
    const doctors = await listDoctors();
    if (!doctors.length) {
      bot.sendMessage(chatId, "Hozircha shifokorlar yo‘q.", mainMenu());
      return;
    }
    state.set(chatId, { step: "doctor" });
    bot.sendMessage(
      chatId,
      "Shifokorni tanlang (raqamini yuboring):\n" +
        doctors.map((d, i) => `${i + 1}) ${fmtDoctor(d)}`).join("\n")
    );
    return;
  }

  if (text === "📋 Mening yozuvlarim") {
    const list = await myAppointments(userId);
    if (!list.length) {
      bot.sendMessage(chatId, "Hali yozuvlar yo‘q.", mainMenu());
      return;
    }
    const lines = list.map((a) => {
      const d = a.doctor ? fmtDoctor(a.doctor) : a.doctorId;
      return `• ${a.date} ${a.time} — ${d}\n  ${statusUz(a.status)}`;
    });
    bot.sendMessage(chatId, "Sizning yozuvlaringiz:\n\n" + lines.join("\n\n"), mainMenu());
    return;
  }

  const st = state.get(chatId);
  if (!st) {
    bot.sendMessage(chatId, "Menyudan foydalaning.", mainMenu());
    return;
  }

  if (st.step === "doctor") {
    const doctors = await listDoctors();
    const n = Number(text);
    if (!Number.isFinite(n) || n < 1 || n > doctors.length) {
      bot.sendMessage(chatId, "Iltimos, ro‘yxatdan raqam kiriting.");
      return;
    }
    const doctor = doctors[n - 1];
    state.set(chatId, { step: "date", doctorId: doctor.id });
    bot.sendMessage(
      chatId,
      `Tanlandi: ${fmtDoctor(doctor)}\n\nSana yuboring (YYYY-MM-DD), masalan: 2026-04-30`
    );
    return;
  }

  if (st.step === "date") {
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      bot.sendMessage(chatId, "Sana formati noto‘g‘ri. Masalan: 2026-04-30");
      return;
    }
    const date = text;
    const slots = await availability(st.doctorId, date);
    if (!slots.length) {
      bot.sendMessage(chatId, "Bu kunda bo‘sh vaqt yo‘q. Boshqa sana kiriting.");
      return;
    }
    state.set(chatId, { step: "time", doctorId: st.doctorId, date });
    bot.sendMessage(
      chatId,
      "Vaqtni tanlang (HH:MM):\n" + slots.join(", ")
    );
    return;
  }

  if (st.step === "time") {
    const tm = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!tm) {
      bot.sendMessage(chatId, "Vaqt formati noto‘g‘ri. Masalan: 09:30");
      return;
    }
    const time = text;
    const slots = await availability(st.doctorId, st.date);
    if (!slots.includes(time)) {
      bot.sendMessage(chatId, "Bu vaqt band. Boshqa vaqt tanlang.");
      return;
    }
    const apt = await createAppointment({ userId, chatId, doctorId: st.doctorId, date: st.date, time });
    if (!apt) {
      bot.sendMessage(chatId, "Yozilish amalga oshmadi. Qayta urinib ko‘ring.");
      return;
    }
    state.delete(chatId);
    bot.sendMessage(chatId, `✅ Yozildingiz!\nSana: ${apt.date}\nVaqt: ${apt.time}\nHolat: ${statusUz(apt.status)}`, mainMenu());
    return;
  }
});

bot.on("contact", async (msg) => {
  const chatId = msg.chat.id;
  await ensureDb();
  const phone = msg.contact && msg.contact.phone_number ? msg.contact.phone_number : "";
  await ensureTelegramUser(msg.chat, phone);
  state.delete(chatId);
  bot.sendMessage(chatId, "✅ Telefon qabul qilindi. Endi menyudan foydalaning.", mainMenu());
});

async function reminderTick() {
  if (!REMINDERS_ENABLED) return;
  await ensureDb();
  const s = await db.getState();
  const now = new Date();

  for (const a of s.appointments || []) {
    if (a.source !== "telegram") continue;
    if (!a.telegramChatId) continue;
    if (a.status === "cancelled") continue;

    const dt = toLocalDateTime(a.date, a.time);
    if (Number.isNaN(dt.getTime())) continue;

    const diffMin = Math.round((dt.getTime() - now.getTime()) / 60000);
    if (diffMin <= 0) continue;

    a.reminders = a.reminders || { sent: [] };
    a.reminders.sent = Array.isArray(a.reminders.sent) ? a.reminders.sent : [];

    for (const m of REMINDER_MINUTES) {
      const key = `m${m}`;
      if (diffMin === m && !a.reminders.sent.includes(key)) {
        try {
          await bot.sendMessage(
            Number(a.telegramChatId),
            `⏰ Eslatma: sizda ${a.date} ${a.time} ga qabul bor.\nHolat: ${statusUz(a.status)}`
          );
          await db.update((st) => {
            const ap = (st.appointments || []).find((x) => x.id === a.id);
            if (!ap) return;
            ap.reminders = ap.reminders || { sent: [] };
            ap.reminders.sent = Array.isArray(ap.reminders.sent) ? ap.reminders.sent : [];
            ap.reminders.sent.push(key);
          });
        } catch (e) {
          // ignore send errors
        }
      }
    }
  }
}

async function boot() {
  await ensureDb();
  console.log("Telegram bot started.");
  if (REMINDERS_ENABLED) {
    setInterval(() => reminderTick().catch(() => {}), 60 * 1000);
  }
}

boot().catch((e) => {
  console.error(e);
  process.exit(1);
});

