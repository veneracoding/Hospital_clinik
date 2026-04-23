# Hospital_clinik (Medcare)

Static clinic website + lightweight backend for:
- doctors list
- booking with **date/time** and status **pending (waiting)**
- login/register
- "My appointments"
- contact form submission

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start server:

```bash
npm run dev
```

Open:
- `http://localhost:3000/index.html`
- `http://localhost:3000/login.html`
- `http://localhost:3000/register.html`
- `http://localhost:3000/appointments.html`
- `http://localhost:3000/contact.html`
- `http://localhost:3000/admin.html`

## Telegram bot

1. Copy `.env.example` → `.env`
2. Set `TELEGRAM_BOT_TOKEN` in `.env`
3. Run:

```bash
npm run bot
```

Bot features:
- booking via doctor → date → time
- my appointments
- reminders (configurable via `TELEGRAM_REMINDERS_MINUTES`)

## Admin access

On first run, the backend creates a default admin (if no admin exists):
- email: `admin@medcare.local`
- password: `admin12345`

You can override these before first run:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## Data storage

Data is stored in `data/store.json` (created automatically on first run).

