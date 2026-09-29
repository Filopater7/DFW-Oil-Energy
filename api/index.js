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
    if (!b.phoneNumber  || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(String(b.phoneNumber).trim()))
      return res.status(422).json({ success: false, message: 'A valid phone number is required.' });
    if (!b.driverEmail  || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.driverEmail).trim()))
      return res.status(422).json({ success: false, message: 'A valid email address is required.' });
    if (!b.startTime    || isNaN(Date.parse(b.startTime)))
      return res.status(422).json({ success: false, message: 'A valid start date and time is required.' });
    const days  = Number(b.durationDays)  || 0;
    const hours = Number(b.durationHours) || 0;
    const mins  = Number(b.durationMins)  || 0;
    const totalMins = days * 1440 + hours * 60 + mins;
    if (totalMins < 1)
      return res.status(422).json({ success: false, message: 'Parking duration must be at least 1 minute.' });
    if (!b.phoneNumber  || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(String(b.phoneNumber).trim()))
      return res.status(422).json({ success: false, message: 'A valid phone number is required.' });
    if (!b.licenseImageData || !String(b.licenseImageData).startsWith('data:image/'))
      return res.status(422).json({ success: false, message: 'A captured license photo is required.' });
    if (!b.signatureData    || !String(b.signatureData).startsWith('data:image/'))
      return res.status(422).json({ success: false, message: 'A driver signature is required.' });

    // Generate token and expiry
    const token      = uuidv4();
    const tzOffset   = Number(b.tzOffset) || 0;
    const startUTC   = new Date(new Date(b.startTime).getTime() + tzOffset * 60000);
    const expiresAt  = new Date(startUTC.getTime() + totalMins * 60000);
    const durationLabel = [
      days  > 0 ? `${days}d`  : '',
      hours > 0 ? `${hours}h` : '',
      mins  > 0 ? `${mins}m`  : ''
    ].filter(Boolean).join(' ') || '0m';

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
      expiresAt:     expiresAt.toISOString(),
      startTimeUTC:  startUTC.toISOString(),
      submittedAt:   new Date().toISOString(),
      companyName:   String(b.companyName).trim(),
      driverName:    String(b.driverName).trim(),
      truckNumber:   String(b.truckNumber).trim(),
      driverEmail:   String(b.driverEmail).trim(),
      startTime:     b.startTime,
      durationDays:  days,
      durationHours: hours,
      durationMins:  mins,
      durationLabel,
      phoneNumber:   String(b.phoneNumber).trim()
    });

    // ── Save to Google Sheet (fire and forget) ──────────────
    const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxJ4v990ZHPfBPQkt7LGfgaDHJDovsHiBWZwMDEWCAXR6bFQKsEKu2Ml9cuvoqTYFNm/exec';
    const sheetPayload = {
      submittedAt:   new Date().toISOString(),
      companyName:   String(b.companyName).trim(),
      driverName:    String(b.driverName).trim(),
      driverEmail:   String(b.driverEmail).trim(),
      truckNumber:   String(b.truckNumber).trim(),
      phoneNumber:   String(b.phoneNumber).trim(),
      startTime:     b.startTime,
      parkingDuration: durationLabel,
      expiresAt:     expiresAt.toISOString(),
      token,
      verifyUrl
    };

    fetch(SHEET_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(sheetPayload)
    })
    .then(r => r.text())
    .then(t => console.log('[Sheets] Response:', t))
    .catch(e => console.warn('[Sheets] Error:', e.message));

    return res.json({
      success:   true,
      message:   'Driver record submitted successfully.',
      token,
      expiresAt: expiresAt.toISOString(),
      qrDataURL,
      driver: {
        companyName:   String(b.companyName).trim(),
        driverName:    String(b.driverName).trim(),
        truckNumber:   String(b.truckNumber).trim(),
        driverEmail:   String(b.driverEmail).trim(),
        startTime:     b.startTime,
        durationDays:  days,
        durationHours: hours,
        durationMins:  mins,
        durationLabel,
        phoneNumber:   String(b.phoneNumber).trim()
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
      driverName:    rec.driverName,
      companyName:   rec.companyName,
      truckNumber:   rec.truckNumber,
      driverEmail:   rec.driverEmail,
      startTime:     rec.startTime,
      durationLabel: rec.durationLabel,
      durationDays:  rec.durationDays,
      durationHours: rec.durationHours,
      durationMins:  rec.durationMins,
      phoneNumber:   rec.phoneNumber
    });
  } catch (e) {
    console.error('[/api/verify crash]', e.stack || e.message);
    return res.status(500).json({ valid: false, message: 'Server error: ' + e.message });
  }
});

module.exports = app;
