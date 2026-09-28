/* ============================================================
   api/index.js  –  Single self-contained Vercel serverless handler
   No external lib/ imports — everything inlined to avoid crashes
   ============================================================ */
'use strict';

const express        = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode         = require('qrcode');

const app = express();
app.use(express.json({ limit: '15mb' }));

// ── In-memory store ────────────────────────────────────────
const store = global._dfwStore || (global._dfwStore = new Map());

// ── Validation ─────────────────────────────────────────────
function validate(b) {
  if (!b.companyName  || b.companyName.trim().length < 2)          return 'Company name must be at least 2 characters.';
  if (!b.driverName   || b.driverName.trim().length < 2)           return 'Driver name must be at least 2 characters.';
  if (!b.truckNumber  || !/^[A-Za-z0-9\-]+$/.test(b.truckNumber.trim())) return 'Truck number: letters, numbers, hyphens only.';
  if (!b.startTime    || isNaN(Date.parse(b.startTime)))           return 'A valid start date and time is required.';
  const d = Number(b.numberOfDays);
  if (isNaN(d) || d < 1 || d > 365)                               return 'Number of days must be between 1 and 365.';
  if (!b.phoneNumber  || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(b.phoneNumber.trim())) return 'A valid phone number is required.';
  if (!b.licenseImageData || !b.licenseImageData.startsWith('data:image/')) return 'A captured license photo is required.';
  if (!b.signatureData    || !b.signatureData.startsWith('data:image/'))    return 'A driver signature is required.';
  return null;
}

// ── POST /api/submit ───────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  try {
    const b   = req.body || {};
    const err = validate(b);
    if (err) return res.status(422).json({ success: false, message: err });

    const token     = uuidv4();
    const expiresAt = new Date(new Date(b.startTime).getTime() + Number(b.numberOfDays) * 86400000);
    const proto     = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const verifyUrl = `${proto}://${req.headers.host}/verify.html?token=${token}`;

    const qrDataURL = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'H', margin: 2, width: 300,
      color: { dark: '#111111', light: '#FFFFFF' }
    });

    store.set(token, {
      token,
      expiresAt:    expiresAt.toISOString(),
      submittedAt:  new Date().toISOString(),
      companyName:  b.companyName.trim(),
      driverName:   b.driverName.trim(),
      truckNumber:  b.truckNumber.trim(),
      startTime:    b.startTime,
      numberOfDays: Number(b.numberOfDays),
      phoneNumber:  b.phoneNumber.trim()
    });

    return res.json({
      success: true,
      message: 'Driver record submitted successfully.',
      token,
      expiresAt: expiresAt.toISOString(),
      qrDataURL,
      driver: {
        companyName:  b.companyName.trim(),
        driverName:   b.driverName.trim(),
        truckNumber:  b.truckNumber.trim(),
        startTime:    b.startTime,
        numberOfDays: Number(b.numberOfDays),
        phoneNumber:  b.phoneNumber.trim()
      }
    });
  } catch (e) {
    console.error('[submit]', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /api/verify/:token ─────────────────────────────────
app.get('/api/verify/:token', (req, res) => {
  const rec = store.get(req.params.token);
  if (!rec) return res.status(404).json({ valid: false, status: 'not_found', message: 'QR code not found.' });
  const expired = new Date() > new Date(rec.expiresAt);
  return res.json({
    valid: !expired, status: expired ? 'expired' : 'active',
    token: rec.token, expiresAt: rec.expiresAt, submittedAt: rec.submittedAt,
    driverName: rec.driverName, companyName: rec.companyName,
    truckNumber: rec.truckNumber, startTime: rec.startTime,
    numberOfDays: rec.numberOfDays, phoneNumber: rec.phoneNumber
  });
});

// ── GET /api/health ────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', entries: store.size, time: new Date().toISOString() })
);

module.exports = app;
