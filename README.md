# DFW Oil Energy – Driver Tracking Portal

A branded web application for DFW Oil Energy (Wholesale Distributor) that collects driver trip registration data, saves it to Google Sheets, and sends email notifications on each submission.

---

## Features

- **Branded UI** – DFW Oil Energy logo, black/gold/orange color scheme
- **8 required form fields** – Company Name, Driver Name, Truck Number, Start Time, Number of Days, Phone Number, Scan License (file upload), Digital Signature
- **Google Sheets integration** – Each submission is appended as a new row
- **Email notifications** – HTML email with all form data + attached license file sent on every submission
- **Full validation** – Client-side (instant feedback) and server-side (secure)
- **File upload** – JPEG, PNG, PDF up to 10 MB
- **Digital signature pad** – Mouse and touch support
- **Rate limiting** – 20 submissions per 15 minutes per IP

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
# Copy the example env file
copy .env.example .env
```

Open `.env` and fill in your credentials (see section below).

### 3. Run the Server

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

Open your browser at **http://localhost:3000**

---

## Environment Configuration (`.env`)

### Google Sheets Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → **Enable the Google Sheets API**
3. Go to **IAM & Admin → Service Accounts** → Create a new service account
4. Download the JSON key file
5. Open your Google Sheet → **Share** it with the service account email (Editor access)
6. Copy the **Spreadsheet ID** from the sheet URL:
   `https://docs.google.com/spreadsheets/d/**<SPREADSHEET_ID>**/edit`

Fill in `.env`:
```
GOOGLE_SHEETS_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

### Google Sheet Column Layout

The app writes these columns to **Sheet1**:

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| Submitted At | Company Name | Driver Name | Truck Number | Start Time | # Days | Phone | License File | Signature | Status |

> Add these headers to row 1 of your sheet manually.

### Email (SMTP) Setup

**Gmail (recommended for testing):**
1. Enable 2-Factor Authentication on your Google account
2. Go to [App Passwords](https://myaccount.google.com/apppasswords)
3. Generate an app password for "Mail"

```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=you@gmail.com
EMAIL_PASS=your_16_char_app_password
EMAIL_FROM="DFW Oil Energy <no-reply@dfwoilenergy.com>"
EMAIL_TO=admin@dfwoilenergy.com
```

**SendGrid:**
```
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=SG.your_sendgrid_api_key
```

---

## Project Structure

```
DFW Oil Energy/
├── public/
│   ├── assets/
│   │   └── logo.jpg          # DFW Oil Energy logo
│   ├── index.html            # Main form page
│   ├── style.css             # Branded styles
│   └── app.js                # Frontend logic (validation, sig pad, submit)
├── uploads/                  # Uploaded licenses & signatures (git-ignored)
├── server.js                 # Express server (API, Sheets, Email)
├── package.json
├── .env.example              # Configuration template
├── .env                      # Your actual credentials (DO NOT COMMIT)
└── .gitignore
```

---

## Security Notes

- The `.env` file is git-ignored — never commit real credentials
- Uploaded files are stored locally in `/uploads/` and are not publicly accessible
- Rate limiting prevents submission abuse
- Server-side validation runs independently of client-side validation
- File uploads are restricted to JPEG, PNG, and PDF, with a 10 MB size limit
