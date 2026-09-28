/* ============================================================
   index.js  –  API-only Express handler for Vercel
   Static files are served directly by Vercel from public/
   ============================================================ */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode  = require('qrcode');

const app = express();
app.use(express.json({ limit: '15mb' }));

// ── In-memory store (no database needed) ──────────────────
const submissions = global._dfwStore || (global._dfwStore = new Map());

// ── Validation ─────────────────────────────────────────────
function validate(body) {
  const { companyName, driverName, truckNumber, startTime,
          numberOfDays, phoneNumber, signatureData, licenseImageData } = body;
  if (!companyName || companyName.trim().length < 2)    return 'Company name must be at least 2 characters.';
  if (!driverName  || driverName.trim().length < 2)     return 'Driver name must be at least 2 characters.';
  if (!truckNumber || !/^[A-Za-z0-9\-]+$/.test(truckNumber.trim())) return 'Truck number: letters, numbers, hyphens only.';
  if (!startTime   || isNaN(Date.parse(startTime)))     return 'A valid start date and time is required.';
  const days = Number(numberOfDays);
  if (isNaN(days)  || days < 1 || days > 365)           return 'Number of days must be between 1 and 365.';
  if (!phoneNumber || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(phoneNumber.trim())) return 'A valid phone number is required.';
  if (!licenseImageData || !licenseImageData.startsWith('data:image/')) return 'A captured license photo is required.';
  if (!signatureData    || !signatureData.startsWith('data:image/'))    return 'A driver signature is required.';
  return null;
}

// ── POST /api/submit ───────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  try {
    const body = req.body || {};
    const err  = validate(body);
    if (err) return res.status(422).json({ success: false, message: err });

    const { companyName, driverName, truckNumber, startTime,
            numberOfDays, phoneNumber, signatureData, licenseImageData } = body;

    const token     = uuidv4();
    const expiresAt = new Date(
      new Date(startTime).getTime() + Number(numberOfDays) * 86400000
    );

    const protocol  = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host      = req.headers.host;
    const verifyUrl = `${protocol}://${host}/verify.html?token=${token}`;

    const qrDataURL = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'H', margin: 2, width: 300,
      color: { dark: '#111111', light: '#FFFFFF' }
    });

    submissions.set(token, {
      token, expiresAt: expiresAt.toISOString(),
      submittedAt: new Date().toISOString(),
      companyName: companyName.trim(), driverName: driverName.trim(),
      truckNumber: truckNumber.trim(), startTime,
      numberOfDays: Number(numberOfDays), phoneNumber: phoneNumber.trim()
    });

    return res.status(200).json({
      success: true,
      message: 'Driver record submitted successfully.',
      token,
      expiresAt: expiresAt.toISOString(),
      qrDataURL,
      driver: {
        companyName: companyName.trim(), driverName: driverName.trim(),
        truckNumber: truckNumber.trim(), startTime,
        numberOfDays: Number(numberOfDays), phoneNumber: phoneNumber.trim()
      }
    });
  } catch (e) {
    console.error('[submit error]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /api/verify/:token ─────────────────────────────────
app.get('/api/verify/:token', (req, res) => {
  try {
    const record = submissions.get(req.params.token);
    if (!record)
      return res.status(404).json({ valid: false, status: 'not_found', message: 'QR code not found.' });

    const expired = new Date() > new Date(record.expiresAt);
    return res.json({
      valid: !expired, status: expired ? 'expired' : 'active',
      token: record.token, expiresAt: record.expiresAt,
      submittedAt: record.submittedAt, driverName: record.driverName,
      companyName: record.companyName, truckNumber: record.truckNumber,
      startTime: record.startTime, numberOfDays: record.numberOfDays,
      phoneNumber: record.phoneNumber
    });
  } catch (e) {
    return res.status(500).json({ valid: false, message: e.message });
  }
});

// ── GET /api/health ────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', store: submissions.size, time: new Date().toISOString() })
);

// ── Local dev ──────────────────────────────────────────────
if (require.main === module) {
  const path = require('path');
  app.use(require('express').static(path.join(__dirname, 'public')));
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`✅ http://localhost:${PORT}`));
}

module.exports = app;
