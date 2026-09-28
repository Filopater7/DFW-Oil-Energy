/* ============================================================
   index.js  –  API-only Express handler for Vercel
   Static files are served directly by Vercel from public/
   ============================================================ */
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode  = require('qrcode');
const store   = require('./lib/store');
const { validateDriverForm }    = require('./lib/validate');
const { sendNotificationEmail } = require('./lib/email');

const app = express();
app.use(express.json({ limit: '15mb' }));

// ── POST /api/submit ───────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  const body   = req.body || {};
  const errors = validateDriverForm(body);
  if (errors.length)
    return res.status(422).json({ success: false, message: errors[0], errors });

  const { companyName, driverName, truckNumber, startTime,
          numberOfDays, phoneNumber, signatureData, licenseImageData } = body;

  const token     = uuidv4();
  const expiresAt = new Date(
    new Date(startTime).getTime() + Number(numberOfDays) * 86400000
  );

  const protocol  = req.headers['x-forwarded-proto'] || 'https';
  const host      = req.headers.host;
  const verifyUrl = `${protocol}://${host}/verify.html?token=${token}`;

  const qrDataURL = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'H', margin: 2, width: 300,
    color: { dark: '#111111', light: '#FFFFFF' }
  });

  store.save(token, {
    token, expiresAt: expiresAt.toISOString(),
    submittedAt: new Date().toISOString(),
    companyName: companyName.trim(), driverName: driverName.trim(),
    truckNumber: truckNumber.trim(), startTime,
    numberOfDays: Number(numberOfDays), phoneNumber: phoneNumber.trim()
  });

  sendNotificationEmail(
    { companyName, driverName, truckNumber, startTime,
      numberOfDays, phoneNumber, signatureData, licenseImageData,
      expiresAt: expiresAt.toISOString() }, qrDataURL
  ).catch(e => console.warn('[Email]', e.message));

  return res.status(200).json({
    success: true, message: 'Driver record submitted successfully.',
    token, expiresAt: expiresAt.toISOString(), qrDataURL,
    driver: {
      companyName: companyName.trim(), driverName: driverName.trim(),
      truckNumber: truckNumber.trim(), startTime,
      numberOfDays: Number(numberOfDays), phoneNumber: phoneNumber.trim()
    }
  });
});

// ── GET /api/verify/:token ─────────────────────────────────
app.get('/api/verify/:token', (req, res) => {
  const record = store.findByToken(req.params.token);
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
});

// ── GET /api/health ────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// Local dev server
if (require.main === module) {
  require('dotenv').config();
  const path = require('path');
  app.use(require('express').static(path.join(__dirname, 'public')));
  app.listen(process.env.PORT || 3000, () =>
    console.log(`✅ Running at http://localhost:${process.env.PORT || 3000}`)
  );
}

module.exports = app;
