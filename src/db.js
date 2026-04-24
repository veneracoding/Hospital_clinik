const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const IS_VERCEL = Boolean(process.env.VERCEL);
// On Vercel, the project filesystem is read-only; /tmp is writable (but ephemeral).
const DB_DIR = IS_VERCEL ? "/tmp" : path.join(__dirname, "..", "data");
const DB_PATH = path.join(DB_DIR, "store.json");
const KV_KEY = "hospital_clinik:store:v1";

function rid(size = 10) {
  // URL-safe-ish id; good enough for this project
  return crypto.randomBytes(Math.ceil(size * 0.75)).toString("base64url").slice(0, size);
}

function nowIso() {
  return new Date().toISOString();
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.name === "SyntaxError")) return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath, value) {
  const tmpPath = `${filePath}.${rid(8)}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function defaultSeed() {
  return {
    meta: { createdAt: nowIso(), version: 1 },
    doctors: [
      {
        id: "doc_1",
        name: "John Deo",
        specialty: "Therapist",
        photo: "./img/doc-1.jpg",
        bio: "Therapist with a focus on prevention, diagnostics, and long-term patient care plans.",
        socials: { facebook: "", twitter: "", instagram: "", linkedin: "" }
      },
      {
        id: "doc_2",
        name: "John Deo",
        specialty: "Cardiologist",
        photo: "./img/doc-2.jpg",
        bio: "Cardiology specialist experienced in heart health screening and lifestyle-based treatment programs.",
        socials: { facebook: "", twitter: "", instagram: "", linkedin: "" }
      },
      {
        id: "doc_3",
        name: "John Deo",
        specialty: "Dentist",
        photo: "./img/doc-3.jpg",
        bio: "Dental care professional focused on painless procedures, hygiene education, and modern restorative methods.",
        socials: { facebook: "", twitter: "", instagram: "", linkedin: "" }
      },
      {
        id: "doc_4",
        name: "John Deo",
        specialty: "Neurologist",
        photo: "./img/doc-4.jpg",
        bio: "Neurology specialist working with headaches, stress-related conditions, and nervous system diagnostics.",
        socials: { facebook: "", twitter: "", instagram: "", linkedin: "" }
      },
      {
        id: "doc_5",
        name: "John Deo",
        specialty: "Pediatrician",
        photo: "./img/doc-5.jpg",
        bio: "Pediatrician with patient-friendly communication and evidence-based care for children of all ages.",
        socials: { facebook: "", twitter: "", instagram: "", linkedin: "" }
      },
      {
        id: "doc_6",
        name: "John Deo",
        specialty: "Surgeon",
        photo: "./img/doc-6.avif",
        bio: "Surgeon experienced in consultation, pre-op planning, and safe post-op recovery guidance.",
        socials: { facebook: "", twitter: "", instagram: "", linkedin: "" }
      }
    ],
    users: [],
    sessions: [],
    appointments: [],
    contactMessages: []
  };
}

function canUseVercelKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getKvClient() {
  // Lazy require so local dev doesn't need KV configured
  const mod = require("@vercel/kv");
  return mod.kv;
}

function canUseRedisUrl() {
  return Boolean(process.env.REDIS_URL);
}

let redisClientPromise = null;
async function getRedisClient() {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const { createClient } = require("redis");
      const client = createClient({ url: process.env.REDIS_URL });
      client.on("error", () => {});
      await client.connect();
      return client;
    })();
  }
  return await redisClientPromise;
}

function createDb() {
  let state = null;
  let saving = Promise.resolve();

  async function load() {
    if (state) return state;
    if (canUseRedisUrl()) {
      const redis = await getRedisClient();
      const raw = await redis.get(KV_KEY);
      if (raw) {
        try {
          state = JSON.parse(raw);
          return state;
        } catch (_) {}
      }
      state = defaultSeed();
      await redis.set(KV_KEY, JSON.stringify(state));
      return state;
    }
    if (canUseVercelKv()) {
      const kv = await getKvClient();
      const loaded = await kv.get(KV_KEY);
      state = loaded ?? defaultSeed();
      return state;
    }

    const loaded = await readJsonSafe(DB_PATH);
    state = loaded ?? defaultSeed();
    return state;
  }

  async function save() {
    const snapshot = state;
    saving = saving.then(async () => {
      if (canUseRedisUrl()) {
        const redis = await getRedisClient();
        await redis.set(KV_KEY, JSON.stringify(snapshot));
        return;
      }
      if (canUseVercelKv()) {
        const kv = await getKvClient();
        await kv.set(KV_KEY, snapshot);
        return;
      }

      await ensureDir(DB_DIR);
      await writeJsonAtomic(DB_PATH, snapshot);
    });
    await saving;
  }

  async function getState() {
    return await load();
  }

  async function update(mutator) {
    const s = await load();
    mutator(s);
    await save();
    return s;
  }

  return { getState, update };
}

const db = createDb();

async function ensureDb() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@medcare.local").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin12345";

  await db.update((s) => {
    // migrations / defaults
    if (!s.meta) s.meta = { createdAt: nowIso(), version: 1 };
    if (!Array.isArray(s.doctors)) s.doctors = [];
    if (!Array.isArray(s.users)) s.users = [];
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (!Array.isArray(s.appointments)) s.appointments = [];
    if (!Array.isArray(s.contactMessages)) s.contactMessages = [];
    // booking only via website

    for (const u of s.users) {
      if (!u.role) u.role = "user";
      if (!u.phone) u.phone = "";
    }

    for (const d of s.doctors) {
      if (!d.bio) d.bio = "";
      if (!d.socials) d.socials = { facebook: "", twitter: "", instagram: "", linkedin: "" };
      if (!d.education) d.education = "";
      if (!d.experience) d.experience = "";
      if (!d.achievements) d.achievements = "";
      if (!d.languages) d.languages = "";
      if (!d.workStart) d.workStart = "09:00";
      if (!d.workEnd) d.workEnd = "17:00";
    }

    for (const a of s.appointments) {
      if (!a.status) a.status = "pending";
      if (!a.source) a.source = "web";
      if (!a.reminders) a.reminders = { sent: [] };
    }

    const hasAdmin = s.users.some((u) => u.role === "admin");
    if (!hasAdmin) {
      // Create a default admin if none exists
      s.users.push({
        id: `usr_${rid(10)}`,
        name: "Admin",
        email: adminEmail,
        passwordHash: bcrypt.hashSync(adminPassword, 10),
        role: "admin",
        createdAt: nowIso()
      });
    }
  });
}

module.exports = { db, ensureDb, nowIso };

