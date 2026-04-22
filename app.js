let menu=document.querySelector('#menu-btn');
let navbar=document.querySelector('.navbar');

if(menu && navbar){
  menu.onclick=()=>{
      menu.classList.toggle('fa-times');
      navbar.classList.toggle('active');
  }
}

window.onscroll=()=>{
    if(menu) menu.classList.remove('fa-times');
    if(navbar) navbar.classList.remove('active');
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.ok) {
    const msg = (json && json.error) ? json.error : ("Request failed (" + res.status + ")");
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return json.data;
}

async function initBooking() {
  const form = document.getElementById("bookingForm");
  if (!form) return;

  const authHint = document.getElementById("bookingAuthHint");
  const doctorSel = document.getElementById("doctorId");
  const dateInp = document.getElementById("bookDate");
  const timeSel = document.getElementById("bookTime");
  const reasonInp = document.getElementById("bookReason");
  const result = document.getElementById("bookingResult");

  function showResult(text, kind) {
    result.style.display = "block";
    result.style.background = kind === "error" ? "#fff1f2" : "#f7fffd";
    result.style.border = kind === "error"
      ? "1px solid rgba(244,63,94,.25)"
      : "1px solid rgba(22,160,133,.2)";
    result.style.color = kind === "error" ? "#b91c1c" : "var(--black)";
    result.textContent = text;
  }

  // Default date = tomorrow (better UX than empty)
  try {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    dateInp.value = d.toISOString().slice(0, 10);
  } catch (e) {}

  // Auth check (booking requires login)
  try {
    await fetchJson("/api/me");
    if (authHint) authHint.style.display = "none";
  } catch (e) {
    if (authHint) authHint.style.display = "block";
  }

  // Load doctors list
  const doctors = await fetchJson("/api/doctors");
  doctorSel.innerHTML = '<option value="">Choose doctor</option>';
  for (const d of doctors) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name + " • " + d.specialty;
    doctorSel.appendChild(opt);
  }

  async function loadSlots() {
    const doctorId = doctorSel.value;
    const date = dateInp.value;
    timeSel.innerHTML = '<option value="">Choose time</option>';
    if (!doctorId || !date) return;

    try {
      const data = await fetchJson("/api/availability?doctorId=" + encodeURIComponent(doctorId) + "&date=" + encodeURIComponent(date));
      for (const t of data.available) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        timeSel.appendChild(opt);
      }
      if (!data.available.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No slots available";
        timeSel.appendChild(opt);
      }
    } catch (err) {
      showResult(err && err.message ? err.message : "Failed to load time slots", "error");
    }
  }

  doctorSel.addEventListener("change", loadSlots);
  dateInp.addEventListener("change", loadSlots);
  await loadSlots();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    result.style.display = "none";
    const doctorId = doctorSel.value;
    const date = dateInp.value;
    const time = timeSel.value;

    if (!doctorId || !date || !time) {
      showResult("Please choose doctor, date and time.", "error");
      return;
    }

    try {
      await fetchJson("/api/me");
    } catch (err) {
      window.location.href = "login.html";
      return;
    }

    try {
      const data = await fetchJson("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId,
          date,
          time,
          reason: reasonInp ? reasonInp.value : ""
        })
      });
      showResult("✅ Booked! Status: pending (waiting). Go to 'My appointments' to track.", "ok");
      await loadSlots();
      if (data && data.appointment && data.appointment.time) timeSel.value = "";
      if (reasonInp) reasonInp.value = "";
    } catch (err) {
      showResult("⚠️ " + (err && err.message ? err.message : "Booking failed"), "error");
      await loadSlots();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // Smooth section scroll with fixed header offset (prevents "flying away" jumps)
  const header = document.querySelector(".header");
  const headerOffset = () => (header ? header.getBoundingClientRect().height : 0) + 12;

  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!a) return;

    const href = a.getAttribute("href");
    if (!href) return;

    // Prevent jump-to-top for dummy links
    if (href === "#") {
      e.preventDefault();
      return;
    }

    // Smooth scroll for in-page anchors
    if (href.startsWith("#")) {
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      const top = el.getBoundingClientRect().top + window.pageYOffset - headerOffset();
      window.scrollTo({ top, behavior: "smooth" });
    }
  });

  initBooking().catch(() => {});
});

