/* ============================================================
   api/index.js  –  Vercel serverless handler
   Approval flow: pending → admin approves → QR issued.
   Persistence: Google Apps Script Web App (Sheets).

   PERFORMANCE OPTIMISATIONS:
   - /api/submit: fire-and-forget Sheet save (no blocking)
   - /api/confirm: server-side TTL cache (4s) for pending polls
   - /api/admin/all: single Sheet call returns list+analytics
   - login ping: no Sheet call (env-var only)
   - approve: setVerifyUrl removed (saves one Sheet round-trip)
   ============================================================ */
'use strict';

const express = require('express');
const QRCode  = require('qrcode');

// ── In-memory caches ───────────────────────────────────────
if (!global._dfwApproved)     global._dfwApproved     = new Map(); // token → {qrDataURL,…}
if (!global._dfwPendingCache) global._dfwPendingCache = new Map(); // token → {data, ts}

const approvedCache = global._dfwApproved;
const pendingCache  = global._dfwPendingCache;
const PENDING_TTL   = 8000; // ms — reuse a pending lookup for 8 seconds

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const app = express();
app.use(express.json({ limit: '15mb' }));

// ── Google Sheet helpers ───────────────────────────────────
async function sheet(payload) {
  const url = process.env.GOOGLE_SHEET_URL;
  if (!url) { console.warn('[Sheets] GOOGLE_SHEET_URL not set'); return null; }
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
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

// ── Build QR from a record ─────────────────────────────────
async function buildQR(rec, proto, host) {
  const startMs   = rec.startTimeUTC  ? new Date(rec.startTimeUTC).getTime()
                                      : new Date(rec.startTime).getTime();
  const expiresMs = rec.expiresAtUTC  ? new Date(rec.expiresAtUTC).getTime()
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
  return { qrDataURL, verifyUrl };
}

// ── Health ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// ── Admin ping (password check only — NO Sheet call) ───────
app.get('/api/admin/ping', adminAuth, (_req, res) =>
  res.json({ ok: true })
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

    const token    = uuidv4();
    const tzOffset = Number(b.tzOffset) || 0;
    const startUTC = new Date(new Date(b.startTime).getTime() + tzOffset * 60000);
    const expiresAt = new Date(startUTC.getTime() + totalMins * 60000);
    const durationLabel = [
      days  > 0 ? `${days}d`  : '',
      hours > 0 ? `${hours}h` : '',
      mins  > 0 ? `${mins}m`  : ''
    ].filter(Boolean).join(' ') || '0m';

    const startTimeCST = new Date(startUTC).toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const expiresAtCST = new Date(expiresAt).toLocaleString('en-US', { timeZone: 'America/Chicago' });

    // ── Fire-and-forget Sheet save — do NOT block the response ──
    sheet({
      action: 'save', token,
      submittedAt:     new Date().toISOString(),
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
    }).catch(e => console.warn('[submit] Sheet save error:', e.message));

    // Respond immediately — driver doesn't wait for Sheet
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
// Polled every 5s by the driver's confirm.html while pending.
// Uses a 8s server-side TTL cache for pending results so repeated
// polls don't all hit Google Sheets.
app.get('/api/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Tier 1: approved cache (instant, no Sheet call)
    const cached = approvedCache.get(token);
    if (cached && cached.qrDataURL) {
      return res.json({
        found: true, approvalStatus: 'approved',
        token, expiresAt: cached.expiresAt,
        qrDataURL: cached.qrDataURL, driver: cached.driver
      });
    }

    // Tier 2: pending TTL cache — reuse recent Sheet lookup
    const cp = pendingCache.get(token);
    if (cp && (Date.now() - cp.ts) < PENDING_TTL) {
      const d = cp.data;
      if (d.approvalStatus !== 'approved') {
        return res.json({
          found: true, approvalStatus: d.approvalStatus || 'pending',
          token: d.token,
          driver: {
            companyName: d.companyName, driverName: d.driverName,
            truckNumber: d.truckNumber, driverEmail: d.driverEmail,
            startTime: d.startTime, durationLabel: d.parkingDuration,
            phoneNumber: d.phoneNumber
          }
        });
      }
    }

    // Tier 3: fresh Sheet lookup
    const data = await sheetGet({ action: 'getByToken', token });

    if (!data || !data.token)
      return res.status(404).json({ found: false, message: 'Registration not found.' });

    if (data.approvalStatus !== 'approved') {
      // Cache this pending result for PENDING_TTL ms
      pendingCache.set(token, { data, ts: Date.now() });
      return res.json({
        found: true, approvalStatus: data.approvalStatus || 'pending',
        token: data.token,
        driver: {
          companyName: data.companyName, driverName: data.driverName,
          truckNumber: data.truckNumber, driverEmail: data.driverEmail,
          startTime: data.startTime, durationLabel: data.parkingDuration,
          phoneNumber: data.phoneNumber
        }
      });
    }

    // Approved — build and cache QR
    pendingCache.delete(token);
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host  = req.headers.host;
    const { qrDataURL } = await buildQR(data, proto, host);
    approvedCache.set(token, {
      qrDataURL, expiresAt: data.expiresAtUTC || data.expiresAt, driver: data
    });

    return res.json({
      found: true, approvalStatus: 'approved',
      token: data.token, expiresAt: data.expiresAtUTC || data.expiresAt,
      qrDataURL,
      driver: {
        companyName: data.companyName, driverName: data.driverName,
        truckNumber: data.truckNumber, driverEmail: data.driverEmail,
        startTime: data.startTime, durationLabel: data.parkingDuration,
        phoneNumber: data.phoneNumber
      }
    });

  } catch (e) {
    console.error('[/api/confirm]', e.stack || e.message);
    return res.status(500).json({ found: false, message: 'Server error: ' + e.message });
  }
});

// ── GET /api/admin/all ─────────────────────────────────────
// ONE Sheet call that returns list + analytics together.
// The Apps Script computes analytics from the same data it returns,
// avoiding a second full-sheet read.
app.get('/api/admin/all', adminAuth, async (req, res) => {
  try {
    // Single call — Apps Script returns { registrations, analytics }
    const data = await sheetGet({ action: 'listWithAnalytics' });
    if (data && data.registrations) {
      return res.json(data);
    }
    // Fallback: two parallel calls if Apps Script is old version
    const [regsData, analyticsData] = await Promise.all([
      sheetGet({ action: 'list' }),
      sheetGet({ action: 'analytics' })
    ]);
    const registrations = Array.isArray(regsData) ? regsData : [];
    return res.json({
      registrations,
      analytics: analyticsData || { today: 0, thisWeek: 0, thisMonth: 0, total: 0 }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/registrations ───────────────────────────
app.get('/api/admin/registrations', adminAuth, async (req, res) => {
  try {
    const data = await sheetGet({ action: 'list' });
    if (!data) return res.json({ registrations: [] });
    return res.json({ registrations: Array.isArray(data) ? data : [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
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

// ── POST /api/admin/approve/:token ─────────────────────────
app.post('/api/admin/approve/:token', adminAuth, async (req, res) => {
  try {
    const { token } = req.params;
    const body  = req.body || {};
    const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host  = req.headers.host;

    let qrDataURL = null, verifyUrl = null;

    // Build QR from record sent by admin page (no Sheet call needed)
    if (body.record && body.record.token) {
      try {
        const built = await buildQR(body.record, proto, host);
        qrDataURL   = built.qrDataURL;
        verifyUrl   = built.verifyUrl;
      } catch (qrErr) {
        console.error('[approve] QR build error:', qrErr.message);
      }
    }

    // Fallback: fetch record from Sheet if admin didn't send it
    if (!qrDataURL) {
      const rec = await sheetGet({ action: 'getByToken', token });
      if (rec && rec.token) {
        const built = await buildQR(rec, proto, host);
        qrDataURL   = built.qrDataURL;
        verifyUrl   = built.verifyUrl;
      }
    }

    // Mark approved in Sheet — fire-and-forget, don't block response
    sheet({ action: 'approve', token })
      .catch(e => console.error('[approve] Sheet error:', e.message));

    // Cache for instant confirm polling — no more Sheet reads for this token
    if (qrDataURL) {
      const rec = body.record || {};
      approvedCache.set(token, {
        qrDataURL, verifyUrl,
        expiresAt: rec.expiresAtUTC || rec.expiresAt || null,
        driver: rec
      });
      pendingCache.delete(token);
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
    // Fire-and-forget — reject is not time-critical for the response
    sheet({ action: 'reject', token })
      .catch(e => console.error('[reject] Sheet error:', e.message));
    pendingCache.delete(token);
    return res.json({ success: true, token });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── Legacy verify stub ─────────────────────────────────────
app.get('/api/verify/:token', (_req, res) =>
  res.status(404).json({ valid: false, status: 'not_found' })
);

module.exports = app;
