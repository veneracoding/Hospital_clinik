const fs = require("fs");

async function ping() {
    console.log("Fetching health...");
    const healthRes = await fetch("https://hospital-clinik-nine.vercel.app/api/health");
    console.log("Health status:", healthRes.status);
    const health = await healthRes.text();
    console.log("Health:", health);
}
ping().catch(console.error);
