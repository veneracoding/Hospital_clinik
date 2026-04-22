const path = require("path");
const express = require("express");
const fs = require("fs/promises");

const { ensureDb, db } = require("./src/db");
const { apiRouter } = require("./src/routes/api");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function main() {
  await ensureDb();

  const app = express();

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Ensure uploads dir exists
  await fs.mkdir(path.join(__dirname, "uploads"), { recursive: true });

  // Static assets + pages (keep same design)
  app.use(express.static(path.join(__dirname)));

  app.use("/api", apiRouter(db));

  // Fallback to index for unknown routes (optional)
  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

