const fs = require("fs");
const express = require("express");

const { ensureDb, db } = require("../src/db");
const { apiRouter } = require("../src/routes/api");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files from /tmp/uploads on Vercel
app.use("/uploads", express.static("/tmp/uploads"));

// Mount API routes
app.use("/api", apiRouter(db));

// Ensure DB is initialized (runs once per cold start)
let dbReady = false;

module.exports = async (req, res) => {
    if (!dbReady) {
        // Ensure /tmp/uploads exists for file uploads
        fs.mkdirSync("/tmp/uploads", { recursive: true });
        await ensureDb();
        dbReady = true;
    }
    return app(req, res);
};
