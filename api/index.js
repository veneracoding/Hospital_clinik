const fs = require("fs");
const express = require("express");

let app = null;
let dbReady = false;

function ensureAppLoaded() {
  if (app) return app;

  const { ensureDb, db } = require("../src/db");
  const { apiRouter } = require("../src/routes/api");

  const nextApp = express();
  nextApp.use(express.json({ limit: "1mb" }));
  nextApp.use(express.urlencoded({ extended: true }));
  nextApp.use((req, res, next) => {
    // Prevent 304 caching issues for authenticated API calls
    res.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  });

  // Serve uploaded files from /tmp/uploads on Vercel
  nextApp.use("/uploads", express.static("/tmp/uploads"));

  // Mount API routes
  nextApp.use("/api", apiRouter(db));

  // Stash init hooks on app instance
  nextApp.__ensureDb = ensureDb;

  app = nextApp;
  return app;
}

module.exports = async (req, res) => {
  try {
    const loadedApp = ensureAppLoaded();
    if (!dbReady) {
      fs.mkdirSync("/tmp/uploads", { recursive: true });
      await loadedApp.__ensureDb();
      dbReady = true;
    }
    return loadedApp(req, res);
  } catch (err) {
    console.error("API_FATAL", err);
    if (res.headersSent) return;
    res.status(500).json({
      ok: false,
      error: { message: err && err.message ? String(err.message) : "Server error" }
    });
  }
};
