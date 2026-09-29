/* ============================================================
   api/index.js  –  Vercel serverless handler
   QR codes contain all data encoded as base64 JSON.
   Verification is purely client-side — no DB, no lookup.
   Google Sheet is still written to for your records.
   ============================================================ */
'use strict';

const express = require('express');
const QRCode  = require('qrcode');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const app = express();
app.use(express.json({ limit: '15mb' }));

const SHEET_URL = process.env.GOOGLE_SHEET_URL || '';
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
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
    if (!b.licenseImageData || !String(b.licenseImageData).startsWith('data:image/'))
      return res.status(422).json({ success: false, message: 'A captured license photo is required.' });
    if (!b.signatureData    || !String(b.signatureData).startsWith('data:image/'))
      return res.status(422).json({ success: false, message: 'A driver signature is required.' });

    // Generate token + expiry
    const token      = uuidv4();
    const tzOffset   = Number(b.tzOffset) || 0;
    const startUTC   = new Date(new Date(b.startTime).getTime() + tzOffset * 60000);
    const expiresAt  = new Date(startUTC.getTime() + totalMins * 60000);
    const durationLabel = [
      days  > 0 ? `${days}d`  : '',
      hours > 0 ? `${hours}h` : '',
      mins  > 0 ? `${mins}m`  : ''
    ].filter(Boolean).join(' ') || '0m';

    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host  = req.headers.host;

    // ── Encode minimal record into the QR URL ──────────────
    // Use unix timestamps (seconds) instead of ISO strings — much shorter
    // Only include fields needed for verification display
    const record = {
      t:  token,                              // token
      cn: String(b.companyName).trim(),       // companyName
      dn: String(b.driverName).trim(),        // driverName
      de: String(b.driverEmail).trim(),       // driverEmail
      tn: String(b.truckNumber).trim(),       // truckNumber
      ph: String(b.phoneNumber).trim(),       // phoneNumber
      st: Math.floor(startUTC.getTime()/1000),// startTime (unix seconds UTC)
      ex: Math.floor(expiresAt.getTime()/1000),// expiresAt (unix seconds)
      dl: durationLabel                        // e.g. "1d" or "2d 3h"
    };

    // Base64url encode (URL-safe)
    const encoded   = Buffer.from(JSON.stringify(record)).toString('base64url');
    const verifyUrl = `${proto}://${host}/verify.html?d=${encoded}`;

    // Generate QR code containing the full encoded URL
    const qrDataURL = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: 'M',   // M = smaller QR, still reliable
      margin: 2,
      width: 300,
      color: { dark: '#111111', light: '#FFFFFF' }
    });

    // Save to Google Sheet (fire and forget)
    if (process.env.GOOGLE_SHEET_URL) {
      fetch(process.env.GOOGLE_SHEET_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName:      String(b.companyName).trim(),
          driverName:       String(b.driverName).trim(),
          driverEmail:      String(b.driverEmail).trim(),
          truckNumber:      String(b.truckNumber).trim(),
          phoneNumber:      String(b.phoneNumber).trim(),
          startTime:        new Date(startUTC).toLocaleString('en-US', { timeZone: 'America/Chicago' }),
          parkingDuration:  durationLabel,
          expiresAt:        new Date(expiresAt).toLocaleString('en-US', { timeZone: 'America/Chicago' }),
          verifyUrl,
          licenseImage:     String(b.licenseImageData || ''),
          signatureImage:   String(b.signatureData || '')
        }),
        redirect: 'follow'
      })
      .then(r => r.text())
      .then(t => console.log('[Sheets]', t.substring(0, 100)))
      .catch(e => console.warn('[Sheets] Error:', e.message));
    }

    return res.json({
      success:   true,
      message:   'Parking registration submitted successfully.',
      token,
      expiresAt: expiresAt.toISOString(),
      qrDataURL,
      driver: {
        companyName:   record.cn,
        driverName:    record.dn,
        truckNumber:   record.tn,
        driverEmail:   record.de,
        startTime:     record.st,
        durationDays:  days,
        durationHours: hours,
        durationMins:  mins,
        durationLabel,
        phoneNumber:   record.ph
      }
    });

  } catch (e) {
    console.error('[/api/submit crash]', e.stack || e.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + e.message });
  }
});

// ── Verify (kept for any legacy token= URLs) ───────────────
app.get('/api/verify/:token', (_req, res) => {
  res.status(404).json({ valid: false, status: 'not_found', message: 'QR code not found.' });
});

module.exports = app;
