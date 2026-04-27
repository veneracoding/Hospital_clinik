
async function run() {
    const start = Date.now();
    console.log("Fetching login...");
    const loginRes = await fetch("https://hospital-clinik-nine.vercel.app/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong@wrong.com", password: "wrong" })
    });
    console.log("Status:", loginRes.status, "in", Date.now() - start, "ms");
}
run();
