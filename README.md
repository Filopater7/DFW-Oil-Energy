# DFW Oil Energy – Driver Tracking Portal

A branded web application for **DFW Oil Energy (Wholesale Distributor)** that collects driver trip registration data, saves it to MongoDB Atlas, appends to Google Sheets, sends email notifications, and issues a unique **QR pass** per driver that automatically expires after the chosen trip duration.

---

## Features

- **Branded UI** — DFW Oil Energy logo, black / gold / orange color scheme
- **8 required form fields** — Company Name, Driver Name, Truck Number, Start Time, Number of Days, Phone Number, Camera License Scan, Digital Signature
- **MongoDB Atlas** — every submission stored persistently
- **Google Sheets** — each submission appended as a new row
- **Email notifications** — HTML email with QR code + license photo on every submission
- **Unique QR pass** — UUID token per driver, expires exactly when their trip ends
- **Confirmation page** — live countdown timer, print-to-PDF button
- **Verify page** — ACTIVE (green) / EXPIRED (red) / NOT FOUND (orange) status when QR is scanned
- **Full validation** — client-side (instant) and server-side (secure)
- **Rate limiting** — 20 submissions per 15 minutes per IP

---

## Project Structure

```
DFW-Oil-Energy/
├── api/                          # Vercel serverless functions
│   ├── submit.js                 #   POST /api/submit
│   ├── health.js                 #   GET  /api/health
│   └── verify/
│       └── [token].js            #   GET  /api/verify/:token
├── lib/                          # Shared helpers
│   ├── db.js                     #   Cached MongoDB connection
│   ├── Submission.js             #   Mongoose model
│   ├── validate.js               #   Server-side validation
│   └── email.js                  #   Nodemailer helper
├── public/                       # Static frontend (served by Vercel)
│   ├── assets/logo.jpg           #   DFW Oil Energy logo
│   ├── index.html                #   Driver form
│   ├── confirm.html              #   Post-submit QR confirmation
│   ├── verify.html               #   QR scan result page
│   ├── style.css                 #   Brand styles
│   └── app.js                    #   Frontend logic
├── server.js                     # Local Express server (dev only)
├── vercel.json                   # Vercel routing + function config
├── package.json
├── .env.example                  # Config template — copy to .env
└── .gitignore
```

---

## Deploy to Vercel (Recommended)

### Step 1 — Set up MongoDB Atlas (free)

1. Go to [https://cloud.mongodb.com](https://cloud.mongodb.com) and create a free account
2. Create a **Free M0 cluster** (any region)
3. Create a **database user** (username + password — save these)
4. Go to **Network Access → Add IP Address → Allow access from anywhere** (`0.0.0.0/0`) — required for Vercel's dynamic IPs
5. Go to **Clusters → Connect → Drivers** → copy the connection string
6. Replace `<username>`, `<password>` in the string — this is your `MONGODB_URI`

### Step 2 — Connect GitHub repo to Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Import the `Filopater7/DFW-Oil-Energy` repository
3. Framework Preset: **Other** (or Express — Vercel auto-detects)
4. Root Directory: `/` (default)
5. Before clicking Deploy, click **Environment Variables** and add all the variables from the table below

### Step 3 — Add Environment Variables in Vercel

Go to: **Vercel Dashboard → Project → Settings → Environment Variables**

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ **Yes** | MongoDB Atlas connection string |
| `GOOGLE_SHEETS_ID` | ⚡ Optional | Spreadsheet ID from the Sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ⚡ Optional | Service account email from JSON key |
| `GOOGLE_PRIVATE_KEY` | ⚡ Optional | Private key from JSON key file (keep `\n` as literal `\n`) |
| `EMAIL_HOST` | ⚡ Optional | SMTP host e.g. `smtp.gmail.com` |
| `EMAIL_PORT` | ⚡ Optional | SMTP port e.g. `587` |
| `EMAIL_SECURE` | ⚡ Optional | `false` for port 587, `true` for port 465 |
| `EMAIL_USER` | ⚡ Optional | Your email address |
| `EMAIL_PASS` | ⚡ Optional | App password (Gmail) or API key (SendGrid) |
| `EMAIL_FROM` | ⚡ Optional | Display name, e.g. `"DFW Oil Energy <no-reply@dfwoilenergy.com>"` |
| `EMAIL_TO` | ⚡ Optional | Notification recipient(s), comma-separated |

> `MONGODB_URI` is the only **required** variable. Google Sheets and Email will be silently skipped if not configured.

### Step 4 — Deploy

Click **Deploy**. Vercel builds and deploys in ~30 seconds. Your app will be live at:
```
https://dfw-oil-energy.vercel.app
```

---

## Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → **Enable the Google Sheets API**
3. **IAM & Admin → Service Accounts** → Create service account → download JSON key
4. Open your Google Sheet → **Share** with the service account email (Editor access)
5. Add these headers to **row 1** of Sheet1:

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| Submitted At | Company | Driver | Truck | Start Time | Days | Phone | License | Signature | Token | Expires At |

---

## Email Setup

**Gmail (recommended):**
1. Enable 2-Factor Authentication
2. Go to [App Passwords](https://myaccount.google.com/apppasswords) → Generate for "Mail"
3. Use the 16-character app password as `EMAIL_PASS`

```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=you@gmail.com
EMAIL_PASS=abcd efgh ijkl mnop
```

**SendGrid:**
```
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=SG.your_sendgrid_api_key
```

---

## Run Locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
copy .env.example .env
# Edit .env with your credentials

# 3. Start server
npm start          # production
npm run dev        # auto-restart on changes

# Open: http://localhost:3000
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/submit` | Submit driver form, returns `{token, expiresAt, qrDataURL, driver}` |
| `GET` | `/api/verify/:token` | Check QR pass status — `active`, `expired`, or `not_found` |
| `GET` | `/api/health` | Server health check |

---

## Security Notes

- `.env` is git-ignored — never commit real credentials
- `MONGODB_URI` and all secrets live only in Vercel's encrypted environment
- Images (license photo + signature) stored as base64 in MongoDB — no file system needed
- Rate limiting: 20 submissions per 15 minutes per IP
- Server-side validation runs independently of client-side checks
