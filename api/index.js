/* ============================================================
   api/index.js  –  Vercel serverless handler (minimal, no deps)
   ============================================================ */
'use strict';

const express        = require('express');
const QRCode         = require('qrcode');

// Inline UUID v4 — no dependency needed
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const app = express();
app.use(express.json({ limit: '15mb' }));

// In-memory store — survives across warm invocations
if (!global._dfwStore) global._dfwStore = new Map();
const store = global._dfwStore;

// ── Health ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', entries: store.size, time: new Date().toISOString() });
});

// ── Submit ─────────────────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  try {
    const b = req.body || {};

    // Validate
    if (!b.companyName  || String(b.companyName).trim().length < 2)
      return res.status(422).json({ success: false, message: 'Company name must be at least 2 characters.' });
    if (!b.driverName   || String(b.driverName).trim().length < 2)
      return res.status(422).json({ success: false, message: 'Driver name must be at least 2 characters.' });
    if (!b.truckNumber  || !/^[A-Za-z0-9\-]+$/.test(String(b.truckNumber).trim()))
      return res.status(422).json({ success: false, message: 'Truck number: letters, numbers, hyphens only.' });
    if (!b.startTime    || isNaN(Date.parse(b.startTime)))
      return res.status(422).json({ success: false, message: 'A valid start date and time is required.' });
    const days = Number(b.numberOfDays);
    if (isNaN(days) || days < 1 || days > 365)
      return res.status(422).json({ success: false, message: 'Number of days must be between 1 and 365.' });
    if (!b.phoneNumber  || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(String(b.phoneNumber).trim()))
      return res.status(422).json({ success: false, message: 'A valid phone number is required.' });
    if (!b.licenseImageData || !String(b.licenseImageData).startsWith('data:image/'))
      return res.status(422).json({ success: false, message: 'A captured license photo is required.' });
    if (!b.signatureData    || !String(b.signatureData).startsWith('data:image/'))
      return res.status(422).json({ success: false, message: 'A driver signature is required.' });

    // Generate token and expiry
    const token     = uuidv4();
    // Convert local startTime to UTC using browser's timezone offset
    const tzOffset  = Number(b.tzOffset) || 0;  // minutes behind UTC
    const startUTC  = new Date(new Date(b.startTime).getTime() + tzOffset * 60000);
    const expiresAt = new Date(startUTC.getTime() + days * 86400000);

    // Build verify URL
    const proto     = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host      = req.headers.host;
    const verifyUrl = `${proto}://${host}/verify.html?token=${token}`;

    // Generate QR code
    const qrDataURL = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      color: { dark: '#111111', light: '#FFFFFF' }
    });

    // Save to memory
    store.set(token, {
      token,
      expiresAt:    expiresAt.toISOString(),
      startTimeUTC: startUTC.toISOString(),   // UTC start for server-side comparison
      submittedAt:  new Date().toISOString(),
      companyName:  String(b.companyName).trim(),
      driverName:   String(b.driverName).trim(),
      truckNumber:  String(b.truckNumber).trim(),
      startTime:    b.startTime,
      numberOfDays: days,
      phoneNumber:  String(b.phoneNumber).trim()
    });

    return res.json({
      success:   true,
      message:   'Driver record submitted successfully.',
      token,
      expiresAt: expiresAt.toISOString(),
      qrDataURL,
      driver: {
        companyName:  String(b.companyName).trim(),
        driverName:   String(b.driverName).trim(),
        truckNumber:  String(b.truckNumber).trim(),
        startTime:    b.startTime,
        numberOfDays: days,
        phoneNumber:  String(b.phoneNumber).trim()
      }
    });

  } catch (e) {
    console.error('[/api/submit crash]', e.stack || e.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + e.message });
  }
});

// ── Verify ─────────────────────────────────────────────────
app.get('/api/verify/:token', (req, res) => {
  try {
    const rec = store.get(req.params.token);
    if (!rec)
      return res.status(404).json({ valid: false, status: 'not_found', message: 'QR code not found.' });

    const now        = new Date();
    const expired    = now > new Date(rec.expiresAt);
    const notStarted = now < new Date(rec.startTimeUTC || rec.startTime);
    const status     = notStarted ? 'not_started' : expired ? 'expired' : 'active';

    return res.json({
      valid:        status === 'active',
      status,
      token:        rec.token,
      expiresAt:    rec.expiresAt,
      submittedAt:  rec.submittedAt,
      driverName:   rec.driverName,
      companyName:  rec.companyName,
      truckNumber:  rec.truckNumber,
      startTime:    rec.startTime,
      numberOfDays: rec.numberOfDays,
      phoneNumber:  rec.phoneNumber
    });
  } catch (e) {
    console.error('[/api/verify crash]', e.stack || e.message);
    return res.status(500).json({ valid: false, message: 'Server error: ' + e.message });
  }
});

module.exports = app;
