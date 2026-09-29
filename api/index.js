/* ============================================================
   api/index.js  –  Vercel serverless handler
   Approval flow: registrations start as "pending",
   QR only issued after admin approves.
   Persistence: Google Apps Script Web App (Sheets).
   ============================================================ */
'use strict';

const express = require('express');
const QRCode  = require('qrcode');

// ── In-memory approval cache ───────────────────────────────
// Stores approved QR data so confirm page gets instant response
// without waiting for a Google Sheet round-trip
if (!global._dfwApproved) global._dfwApproved = new Map();
const approvedCache = global._dfwApproved;

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const app = express();
app.use(express.json({ limit: '15mb' }));

// ── Google Sheet helper ────────────────────────────────────
async function sheet(payload) {
  const url = process.env.GOOGLE_SHEET_URL;
  if (!url) { console.warn('[Sheets] GOOGLE_SHEET_URL not set'); return null; }
  const res  = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}

async function sheetGet(params) {
  const url = process.env.GOOGLE_SHEET_URL;
  if (!url) return null;
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, { redirect: 'follow' });
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return null; }
}

// ── Admin auth middleware ──────────────────────────────────
function adminAuth(req, res, next) {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) return res.status(500).json({ error: 'ADMIN_PASSWORD env var not set.' });
  const auth = req.headers['x-admin-password'] || req.query.p;
  if (auth !== pwd) return res.status(401).json({ error: 'Unauthorized.' });
  next();
}

// ── Build encoded QR data URL for an approved record ──────
async function buildQR(rec, proto, host) {
  // Always use UTC ISO strings for reliable Date parsing
  const startMs  = rec.startTimeUTC  ? new Date(rec.startTimeUTC).getTime()
                                     : new Date(rec.startTime).getTime();
  const expiresMs = rec.expiresAtUTC ? new Date(rec.expiresAtUTC).getTime()
                                     : new Date(rec.expiresAt).getTime();

  const record = {
    t:  rec.token,
    cn: rec.companyName,
    dn: rec.driverName,
    de: rec.driverEmail,
    tn: rec.truckNumber,
    ph: rec.phoneNumber,
    st: Math.floor(startMs   / 1000),
    ex: Math.floor(expiresMs / 1000),
    dl: rec.parkingDuration || rec.durationLabel || ''
  };
  const encoded   = Buffer.from(JSON.stringify(record)).toString('base64url');
  const verifyUrl = `${proto}://${host}/verify.html?d=${encoded}`;
  const qrDataURL = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'M', margin: 2, width: 300,
    color: { dark: '#111111', light: '#FFFFFF' }
  });
  return { qrDataURL, verifyUrl, encoded };
}

// ── Health ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// ── POST /api/submit ───────────────────────────────────────
app.post('/api/submit', async (req, res) => {
  try {
    const b = req.body || {};

    // Validation
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
    const token    = uuidv4();
    const tzOffset = Number(b.tzOffset) || 0;
    const startUTC = new Date(new Date(b.startTime).getTime() + tzOffset * 60000);
    const expiresAt = new Date(startUTC.getTime() + totalMins * 60000);
    const durationLabel = [
      days  > 0 ? `${days}d`  : '',
      hours > 0 ? `${hours}h` : '',
      mins  > 0 ? `${mins}m`  : ''
    ].filter(Boolean).join(' ') || '0m';

    const submittedAt = new Date().toISOString();
    const startTimeCST = new Date(startUTC).toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const expiresAtCST = new Date(expiresAt).toLocaleString('en-US', { timeZone: 'America/Chicago' });

    // Save to Google Sheet as PENDING (no QR yet)
    try {
      await sheet({
        action:          'save',
        token,
        submittedAt,
        companyName:     String(b.companyName).trim(),
        driverName:      String(b.driverName).trim(),
        driverEmail:     String(b.driverEmail).trim(),
        truckNumber:     String(b.truckNumber).trim(),
        phoneNumber:     String(b.phoneNumber).trim(),
        startTime:       startTimeCST,
        startTimeUTC:    startUTC.toISOString(),
        parkingDuration: durationLabel,
        expiresAt:       expiresAtCST,
        expiresAtUTC:    expiresAt.toISOString(),
        approvalStatus:  'pending'
      });
    } catch (sheetErr) {
      console.warn('[Sheets] Error:', sheetErr.message);
    }

    // Return pending — NO QR code yet
    return res.json({
      success:        true,
      approvalStatus: 'pending',
      token,
      message:        'Registration submitted. Waiting for admin approval.',
      driver: {
        companyName:   String(b.companyName).trim(),
        driverName:    String(b.driverName).trim(),
        truckNumber:   String(b.truckNumber).trim(),
        driverEmail:   String(b.driverEmail).trim(),
        startTime:     startTimeCST,
        durationDays:  days,
        durationHours: hours,
        durationMins:  mins,
        durationLabel,
        phoneNumber:   String(b.phoneNumber).trim()
      }
    });

  } catch (e) {
    console.error('[/api/submit]', e.stack || e.message);
    return res.status(500).json({ success: false, message: 'Server error: ' + e.message });
  }
});

// ── GET /api/confirm/:token ────────────────────────────────
app.get('/api/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // ── Check in-memory cache first (instant, no Sheet call) ──
    const cached = approvedCache.get(token);
    if (cached && cached.qrDataURL) {
      return res.json({
        found:          true,
        approvalStatus: 'approved',
        token,
        expiresAt:      cached.expiresAt,
        qrDataURL:      cached.qrDataURL,
        driver:         cached.driver
      });
    }

    // ── Fall back to Sheet lookup ──────────────────────────
    const data = await sheetGet({ action: 'getByToken', token });

    if (!data || !data.token)
      return res.status(404).json({ found: false, message: 'Registration not found.' });

    if (data.approvalStatus !== 'approved') {
      return res.json({
        found:          true,
        approvalStatus: data.approvalStatus || 'pending',
        token:          data.token,
        driver: {
          companyName:   data.companyName,
          driverName:    data.driverName,
          truckNumber:   data.truckNumber,
          driverEmail:   data.driverEmail,
          startTime:     data.startTime,
          durationLabel: data.parkingDuration,
          phoneNumber:   data.phoneNumber
        }
      });
    }

    // Approved — generate and return QR code
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host  = req.headers.host;
    const { qrDataURL } = await buildQR(data, proto, host);

    return res.json({
      found:          true,
      approvalStatus: 'approved',
      token:          data.token,
      expiresAt:      data.expiresAtUTC || data.expiresAt,
      qrDataURL,
      driver: {
        companyName:   data.companyName,
        driverName:    data.driverName,
        truckNumber:   data.truckNumber,
        driverEmail:   data.driverEmail,
        startTime:     data.startTime,
        durationLabel: data.parkingDuration,
        phoneNumber:   data.phoneNumber
      }
    });

  } catch (e) {
    console.error('[/api/confirm]', e.stack || e.message);
    return res.status(500).json({ found: false, message: 'Server error: ' + e.message });
  }
});

// ── GET /api/admin/registrations ───────────────────────────
app.get('/api/admin/registrations', adminAuth, async (req, res) => {
  try {
    const data = await sheetGet({ action: 'list' });
    if (!data) return res.json({ registrations: [] });
    return res.json({ registrations: Array.isArray(data) ? data : (data.registrations || []) });
  } catch (e) {
    console.error('[/api/admin/registrations]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/approve/:token ─────────────────────────
app.post('/api/admin/approve/:token', adminAuth, async (req, res) => {
  try {
    const { token } = req.params;
    const body  = req.body || {};
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host  = req.headers.host;

    let qrDataURL = null, verifyUrl = null;

    // Step 1: Build QR from record data sent by admin (fast, no Sheet call)
    if (body.record && Object.keys(body.record).length > 0) {
      try {
        const built = await buildQR(body.record, proto, host);
        qrDataURL   = built.qrDataURL;
        verifyUrl   = built.verifyUrl;
        console.log('[approve] QR built from admin record, verifyUrl length:', verifyUrl?.length);
      } catch (qrErr) {
        console.error('[approve] QR build error:', qrErr.message);
      }
    }

    // Step 2: If no record sent or QR build failed, fetch from Sheet
    if (!qrDataURL) {
      console.log('[approve] Fetching record from Sheet for token:', token.substring(0, 8));
      try {
        const rec = await sheetGet({ action: 'getByToken', token });
        if (rec && rec.token) {
          const built = await buildQR(rec, proto, host);
          qrDataURL  = built.qrDataURL;
          verifyUrl  = built.verifyUrl;
        }
      } catch (fetchErr) {
        console.error('[approve] Sheet fetch error:', fetchErr.message);
      }
    }

    // Step 3: Mark approved in Sheet (fire and forget — don't block the response)
    sheet({ action: 'approve', token })
      .then(r => console.log('[approve] Sheet approve result:', JSON.stringify(r)))
      .catch(e => console.error('[approve] Sheet approve error:', e.message));

    // Step 4: Update verifyUrl in Sheet (also fire and forget)
    if (verifyUrl) {
      sheet({ action: 'setVerifyUrl', token, verifyUrl })
        .catch(e => console.error('[approve] setVerifyUrl error:', e.message));
    }

    // Step 5: Cache approval for instant confirm polling response
    if (qrDataURL) {
      const rec = body.record || {};
      approvedCache.set(token, {
        qrDataURL,
        verifyUrl,
        expiresAt: rec.expiresAtUTC || rec.expiresAt || null,
        driver:    rec
      });
      console.log('[approve] Cached QR for token:', token.substring(0, 8));
    }

    return res.json({ success: true, qrDataURL, verifyUrl, token });
  } catch (e) {
    console.error('[/api/admin/approve]', e.message);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── POST /api/admin/reject/:token ──────────────────────────
app.post('/api/admin/reject/:token', adminAuth, async (req, res) => {
  try {
    const { token } = req.params;
    await sheet({ action: 'reject', token });
    return res.json({ success: true, token });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET /api/admin/analytics ───────────────────────────────
app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  try {
    const data = await sheetGet({ action: 'analytics' });
    return res.json(data || { today: 0, thisWeek: 0, thisMonth: 0, total: 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Legacy verify stub ─────────────────────────────────────
app.get('/api/verify/:token', (_req, res) =>
  res.status(404).json({ valid: false, status: 'not_found' })
);

module.exports = app;
