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
    const msg = (json && json.error) ? json.error : ("So‘rov bajarilmadi (" + res.status + ")");
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return json.data;
}

const themes = ["light", "dark", "coffee", "blue", "purple", "pink", "orange"];
const themeIcons = {
  light: "fa-sun",
  dark: "fa-moon",
  coffee: "fa-mug-hot",
  blue: "fa-water",
  purple: "fa-wand-magic-sparkles",
  pink: "fa-heart",
  orange: "fa-flame"
};

function initThemeToggle() {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggle");
  const thumb = btn ? btn.querySelector(".theme-toggle__thumb") : null;

  const getPreferred = () => {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      return "light";
    }
  };

  const getSaved = () => {
    try { return localStorage.getItem("theme"); } catch (e) { return null; }
  };

  const setTheme = (theme) => {
    root.removeAttribute("data-theme");
    if (theme !== "light") root.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
    if (btn) {
      const icon = themeIcons[theme] || "fa-sun";
      btn.setAttribute("aria-label", theme + " mavzu");
      if (thumb) thumb.innerHTML = '<i class="fa-regular ' + icon + '"></i>';
    }
  };

  const getCurrent = () => {
    if (root.hasAttribute("data-theme")) {
      return root.getAttribute("data-theme");
    }
    return "light";
  };

  const getNext = () => {
    const current = getCurrent();
    const idx = themes.indexOf(current);
    if (idx === -1) return "dark";
    return themes[(idx + 1) % themes.length];
  };

  const initial = getSaved() || "light";
  setTheme(initial);

  if (btn) {
    btn.addEventListener("click", () => {
      const nextTheme = getNext();
      setTheme(nextTheme);
    });
  }
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
  doctorSel.innerHTML = '<option value="">Shifokorni tanlang</option>';
  for (const d of doctors) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name + " • " + d.specialty;
    doctorSel.appendChild(opt);
  }

  async function loadSlots() {
    const doctorId = doctorSel.value;
    const date = dateInp.value;
    timeSel.innerHTML = '<option value="">Vaqtni tanlang</option>';
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
        opt.textContent = "Bo‘sh vaqt yo‘q";
        timeSel.appendChild(opt);
      }
    } catch (err) {
      showResult(err && err.message ? err.message : "Vaqtlar yuklanmadi", "error");
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
      showResult("Iltimos, shifokor, sana va vaqtni tanlang.", "error");
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
      showResult("✅ Yozildingiz! Holat: kutilmoqda. Kuzatish uchun “Yozuvlarim” sahifasiga o‘ting.", "ok");
      await loadSlots();
      if (data && data.appointment && data.appointment.time) timeSel.value = "";
      if (reasonInp) reasonInp.value = "";
    } catch (err) {
      showResult("⚠️ " + (err && err.message ? err.message : "Yozilish amalga oshmadi"), "error");
      await loadSlots();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initBooking().catch(() => {});
  loadDoctorsSection().catch(() => {});
});

async function loadDoctorsSection() {
  const container = document.getElementById("doctors-container");
  if (!container) return;

  try {
    const doctors = await fetchJson("/api/doctors");
    if (!doctors || !doctors.length) {
      container.innerHTML = '<div class="muted">Hozircha shifokorlar yo‘q</div>';
      return;
    }

    container.innerHTML = doctors.map(d => {
      const name = (d.name || '').toLowerCase();
      const specialty = d.specialty || 'malakali shifokor';
      const img = d.photo || './img/doc-1.jpg';
      return `
        <div class="box">
          <img src="${img}" alt="${name}">
          <h3>${d.name || ''}</h3>
          <span>${specialty}</span>
          <a href="doctor.html?id=${d.id}" class="btn">batafsil <span class="fas fa-chevron-right"></span></a>
          <div class="share">
            ${d.socials?.facebook ? `<a href="${d.socials.facebook}" class="fab fa-facebook"></a>` : ''}
            ${d.socials?.twitter ? `<a href="${d.socials.twitter}" class="fab fa-twitter"></a>` : ''}
            ${d.socials?.instagram ? `<a href="${d.socials.instagram}" class="fab fa-instagram"></a>` : ''}
            ${d.socials?.linkedin ? `<a href="${d.socials.linkedin}" class="fab fa-linkedin"></a>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch(e) {
    console.error("loadDoctorsSection error:", e);
  }
}

