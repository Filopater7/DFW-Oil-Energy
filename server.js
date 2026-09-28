/* ============================================================
   DFW Oil Energy – Driver Tracking Portal
   Express Server: API, Validation, Google Sheets, Email,
                   QR Token generation & verification
   ============================================================ */

'use strict';

require('dotenv').config();

const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const rateLimit  = require('express-rate-limit');
const QRCode     = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Directories ────────────────────────────────────────────
const UPLOAD_DIR  = path.join(__dirname, 'uploads');
const DATA_FILE   = path.join(__dirname, 'data', 'submissions.json');

for (const dir of [UPLOAD_DIR, path.join(__dirname, 'data')]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Submissions store (JSON file) ──────────────────────────
function loadSubmissions() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return {}; }
}

function saveSubmissions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Multer (license/signature sent as base64 in body) ──────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1 } });

// ── Middleware ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Rate limiting
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many submissions. Please wait and try again.' }
});

// ── Server-side Validation ─────────────────────────────────
function validateDriverForm(body) {
  const errors = [];
  const { companyName, driverName, truckNumber, startTime,
          numberOfDays, phoneNumber, signatureData, licenseImageData } = body;

  if (!companyName || companyName.trim().length < 2)
    errors.push('Company name must be at least 2 characters.');
  if (!driverName || driverName.trim().length < 2)
    errors.push('Driver name must be at least 2 characters.');
  if (!truckNumber || !/^[A-Za-z0-9\-]+$/.test(truckNumber.trim()))
    errors.push('Truck number may only contain letters, numbers, and hyphens.');
  if (!startTime || isNaN(Date.parse(startTime)))
    errors.push('A valid start date and time is required.');
  const days = Number(numberOfDays);
  if (isNaN(days) || days < 1 || days > 365)
    errors.push('Number of days must be between 1 and 365.');
  if (!phoneNumber || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(phoneNumber.trim()))
    errors.push('A valid phone number is required.');
  if (!licenseImageData || !licenseImageData.startsWith('data:image/'))
    errors.push('A captured license photo is required.');
  if (!signatureData || !signatureData.startsWith('data:image/'))
    errors.push('A driver signature is required.');

  return errors;
}

// ── Save base64 image to disk ──────────────────────────────
function saveBase64Image(dataUrl, prefix) {
  try {
    const base64   = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const filePath = path.join(UPLOAD_DIR, `${prefix}-${Date.now()}.jpg`);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return filePath;
  } catch (err) {
    console.error(`[Save ${prefix}] Failed:`, err.message);
    return null;
  }
}

// ── QR Token helpers ───────────────────────────────────────
function createToken(submissionData) {
  const token       = uuidv4();
  const startMs     = new Date(submissionData.startTime).getTime();
  const expiresAt   = new Date(startMs + submissionData.numberOfDays * 24 * 60 * 60 * 1000).toISOString();
  const submissions = loadSubmissions();

  submissions[token] = {
    token,
    expiresAt,
    submittedAt:  new Date().toISOString(),
    companyName:  submissionData.companyName,
    driverName:   submissionData.driverName,
    truckNumber:  submissionData.truckNumber,
    startTime:    submissionData.startTime,
    numberOfDays: submissionData.numberOfDays,
    phoneNumber:  submissionData.phoneNumber,
    licenseFile:  submissionData.licenseFile,
    signatureFile: submissionData.signatureFile
  };

  saveSubmissions(submissions);
  return { token, expiresAt };
}

async function generateQRDataURL(verifyUrl) {
  return QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 300,
    color: { dark: '#111111', light: '#FFFFFF' }
  });
}

// ── Google Sheets Helper ───────────────────────────────────
async function appendToGoogleSheet(rowData) {
  const { GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  if (!GOOGLE_SHEETS_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.warn('[Sheets] Not configured – skipping.');
    return;
  }
  const auth = new google.auth.JWT(
    GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
    GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'Sheet1!A:K',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowData] }
  });
  console.log('[Sheets] Row appended.');
}

// ── Email Helper ───────────────────────────────────────────
async function sendNotificationEmail(data, licenseFilePath, qrDataURL) {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE,
          EMAIL_USER, EMAIL_PASS, EMAIL_FROM, EMAIL_TO } = process.env;
  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) {
    console.warn('[Email] Not configured – skipping.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: EMAIL_HOST, port: Number(EMAIL_PORT) || 587,
    secure: EMAIL_SECURE === 'true',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });

  const attachments = [];
  if (licenseFilePath && fs.existsSync(licenseFilePath)) {
    attachments.push({ filename: 'license.jpg', path: licenseFilePath, cid: 'license_photo' });
  }
  if (qrDataURL) {
    const qrBuf = Buffer.from(qrDataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    attachments.push({ filename: 'qrcode.png', content: qrBuf, cid: 'qr_code' });
  }

  const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const expiresAt   = new Date(data.expiresAt).toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const htmlBody = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#111;color:#eee;border-radius:10px;overflow:hidden;">
    <div style="background:linear-gradient(90deg,#C9A84C,#E07B20);padding:20px 28px;text-align:center;">
      <h1 style="margin:0;color:#111;font-size:1.4rem;letter-spacing:1px;">DFW OIL ENERGY</h1>
      <p style="margin:4px 0 0;color:#111;font-size:0.85rem;">Wholesale Distributor — Driver Trip Notification</p>
    </div>
    <div style="padding:28px;">
      <p style="color:#C9A84C;font-size:1rem;font-weight:bold;margin-bottom:18px;">New Driver Record Submitted</p>
      <table style="width:100%;border-collapse:collapse;font-size:0.93rem;">
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;width:40%;">Company Name</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.companyName)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Driver Name</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.driverName)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Truck Number</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.truckNumber)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Start Time</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.startTime)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Number of Days</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(String(data.numberOfDays))}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Phone Number</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.phoneNumber)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">QR Expires</td><td style="padding:9px 6px;font-weight:600;color:#E07B20;">${expiresAt} (CST)</td></tr>
        <tr><td style="padding:9px 6px;color:#aaa;">Submitted At</td><td style="padding:9px 6px;font-weight:600;">${submittedAt} (CST)</td></tr>
      </table>
      ${qrDataURL ? `<p style="margin-top:24px;color:#C9A84C;font-weight:bold;font-size:0.88rem;">DRIVER QR PASS</p><img src="cid:qr_code" alt="QR Code" style="width:180px;height:180px;margin-top:8px;border-radius:8px;" />` : ''}
      ${licenseFilePath ? `<p style="margin-top:24px;color:#C9A84C;font-weight:bold;font-size:0.88rem;">SCANNED LICENSE</p><img src="cid:license_photo" alt="License" style="border:1px solid #444;border-radius:6px;background:#fff;max-width:100%;margin-top:8px;" />` : ''}
      ${data.signatureData ? `<p style="margin-top:24px;color:#C9A84C;font-weight:bold;font-size:0.88rem;">DRIVER SIGNATURE</p><img src="${data.signatureData}" alt="Signature" style="border:1px solid #444;border-radius:6px;background:#fff;max-width:100%;margin-top:8px;" />` : ''}
    </div>
    <div style="background:#0d0d0d;text-align:center;padding:14px;font-size:0.75rem;color:#555;">&copy; 2026 DFW Oil Energy — Wholesale Distributor.</div>
  </div>`;

  await transporter.sendMail({
    from:        EMAIL_FROM || `"DFW Oil Energy" <${EMAIL_USER}>`,
    to:          EMAIL_TO,
    subject:     `[DFW Oil Energy] New Driver Record – ${data.driverName} | ${data.truckNumber}`,
    html:        htmlBody,
    attachments
  });
  console.log('[Email] Sent to', EMAIL_TO);
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── POST /api/submit ───────────────────────────────────────
app.post('/api/submit',
  submitLimiter,
  upload.none(),
  async (req, res) => {
    const errors = validateDriverForm(req.body);
    if (errors.length) return res.status(422).json({ success: false, message: errors[0], errors });

    const { companyName, driverName, truckNumber, startTime,
            numberOfDays, phoneNumber, signatureData, licenseImageData } = req.body;

    const licenseFilePath   = saveBase64Image(licenseImageData, 'license');
    const signatureFilePath = saveBase64Image(signatureData, 'signature');
    const licenseFile       = licenseFilePath   ? path.basename(licenseFilePath)   : '';
    const signatureFile     = signatureFilePath ? path.basename(signatureFilePath) : '';

    // Generate unique token + expiry
    const { token, expiresAt } = createToken({
      companyName: companyName.trim(), driverName: driverName.trim(),
      truckNumber: truckNumber.trim(), startTime, numberOfDays: Number(numberOfDays),
      phoneNumber: phoneNumber.trim(), licenseFile, signatureFile
    });

    // Build the verify URL (the QR code encodes this URL)
    const host      = `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${host}/verify.html?token=${token}`;
    const qrDataURL = await generateQRDataURL(verifyUrl);

    // Google Sheets row (includes token + expiry)
    const sheetRow = [
      new Date().toISOString(),
      companyName.trim(), driverName.trim(), truckNumber.trim(),
      startTime, numberOfDays, phoneNumber.trim(),
      licenseFile, signatureFile,
      token, expiresAt
    ];

    const [sheetsResult, emailResult] = await Promise.allSettled([
      appendToGoogleSheet(sheetRow),
      sendNotificationEmail(
        { companyName, driverName, truckNumber, startTime, numberOfDays,
          phoneNumber, signatureData, expiresAt },
        licenseFilePath, qrDataURL
      )
    ]);

    if (sheetsResult.status === 'rejected') console.error('[Sheets]', sheetsResult.reason);
    if (emailResult.status  === 'rejected') console.error('[Email]',  emailResult.reason);

    return res.status(200).json({
      success: true,
      message: 'Driver record submitted successfully.',
      token,
      expiresAt,
      qrDataURL,
      driver: {
        companyName: companyName.trim(),
        driverName:  driverName.trim(),
        truckNumber: truckNumber.trim(),
        startTime,
        numberOfDays: Number(numberOfDays),
        phoneNumber:  phoneNumber.trim()
      }
    });
  }
);

// ── GET /api/verify/:token ─────────────────────────────────
app.get('/api/verify/:token', (req, res) => {
  const { token } = req.params;
  const submissions = loadSubmissions();
  const record      = submissions[token];

  if (!record) {
    return res.status(404).json({ valid: false, status: 'not_found', message: 'QR code not found.' });
  }

  const now      = new Date();
  const expires  = new Date(record.expiresAt);
  const expired  = now > expires;

  return res.json({
    valid:       !expired,
    status:      expired ? 'expired' : 'active',
    token:       record.token,
    expiresAt:   record.expiresAt,
    submittedAt: record.submittedAt,
    driverName:  record.driverName,
    companyName: record.companyName,
    truckNumber: record.truckNumber,
    startTime:   record.startTime,
    numberOfDays: record.numberOfDays,
    phoneNumber: record.phoneNumber
  });
});

// ── GET /api/health ────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'DFW Oil Energy Driver Tracking', time: new Date().toISOString() });
});

// ── Error handler ──────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ DFW Oil Energy Server running at http://localhost:${PORT}`);
  console.log(`   Google Sheets : ${process.env.GOOGLE_SHEETS_ID ? '✓ configured' : '⚠ not configured'}`);
  console.log(`   Email         : ${process.env.EMAIL_HOST       ? '✓ configured' : '⚠ not configured'}\n`);
});
