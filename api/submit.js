/* ============================================================
   api/submit.js  –  Vercel Serverless Function
   POST /api/submit
   ============================================================ */
'use strict';

const { v4: uuidv4 }          = require('uuid');
const QRCode                   = require('qrcode');
const connectDB                = require('../lib/db');
const Submission               = require('../lib/Submission');
const { validateDriverForm }   = require('../lib/validate');
const { sendNotificationEmail }= require('../lib/email');

// Google Sheets helper (inline to avoid extra file)
async function appendToGoogleSheet(rowData) {
  const { GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  if (!GOOGLE_SHEETS_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.warn('[Sheets] Not configured – skipping.');
    return;
  }
  const { google } = require('googleapis');
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
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed.' });

  const body = req.body || {};

  // Server-side validation
  const errors = validateDriverForm(body);
  if (errors.length) return res.status(422).json({ success: false, message: errors[0], errors });

  const { companyName, driverName, truckNumber, startTime,
          numberOfDays, phoneNumber, signatureData, licenseImageData } = body;

  // Generate unique token + expiry
  const token      = uuidv4();
  const startMs    = new Date(startTime).getTime();
  const expiresAt  = new Date(startMs + Number(numberOfDays) * 24 * 60 * 60 * 1000);
  const submittedAt = new Date();

  // Build the verify URL
  const host      = `https://${req.headers.host}`;
  const verifyUrl = `${host}/verify.html?token=${token}`;

  // Generate QR code PNG as base64 data URL
  const qrDataURL = await QRCode.toDataURL(verifyUrl, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 300,
    color: { dark: '#111111', light: '#FFFFFF' }
  });

  // Save to MongoDB
  try {
    await connectDB();
    await Submission.create({
      token,
      expiresAt,
      submittedAt,
      companyName:    companyName.trim(),
      driverName:     driverName.trim(),
      truckNumber:    truckNumber.trim(),
      startTime,
      numberOfDays:   Number(numberOfDays),
      phoneNumber:    phoneNumber.trim(),
      licenseImage:   licenseImageData,
      signatureImage: signatureData
    });
  } catch (err) {
    console.error('[DB] Save failed:', err.message);
    return res.status(500).json({ success: false, message: 'Database error. Please try again.' });
  }

  // Google Sheets + Email (non-blocking — don't fail the request if these error)
  const sheetRow = [
    submittedAt.toISOString(),
    companyName.trim(), driverName.trim(), truckNumber.trim(),
    startTime, numberOfDays, phoneNumber.trim(),
    'stored_in_db', 'stored_in_db',
    token, expiresAt.toISOString()
  ];

  await Promise.allSettled([
    appendToGoogleSheet(sheetRow).catch(e => console.error('[Sheets]', e.message)),
    sendNotificationEmail(
      { companyName, driverName, truckNumber, startTime,
        numberOfDays, phoneNumber, signatureData, licenseImageData, expiresAt },
      qrDataURL
    ).catch(e => console.error('[Email]', e.message))
  ]);

  return res.status(200).json({
    success:   true,
    message:   'Driver record submitted successfully.',
    token,
    expiresAt: expiresAt.toISOString(),
    qrDataURL,
    driver: {
      companyName:  companyName.trim(),
      driverName:   driverName.trim(),
      truckNumber:  truckNumber.trim(),
      startTime,
      numberOfDays: Number(numberOfDays),
      phoneNumber:  phoneNumber.trim()
    }
  });
};
