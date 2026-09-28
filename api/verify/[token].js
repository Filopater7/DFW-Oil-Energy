/* ============================================================
   api/verify/[token].js  –  Vercel Serverless Function
   GET /api/verify/:token
   ============================================================ */
'use strict';

const connectDB    = require('../../lib/db');
const Submission   = require('../../lib/Submission');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ valid: false, message: 'Method not allowed.' });

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ valid: false, status: 'error', message: 'Token is required.' });
  }

  try {
    await connectDB();
    const record = await Submission.findOne({ token }).lean();

    if (!record) {
      return res.status(404).json({
        valid:   false,
        status:  'not_found',
        message: 'QR code not found.'
      });
    }

    const now     = new Date();
    const expires = new Date(record.expiresAt);
    const expired = now > expires;

    return res.status(200).json({
      valid:        !expired,
      status:       expired ? 'expired' : 'active',
      token:        record.token,
      expiresAt:    record.expiresAt,
      submittedAt:  record.submittedAt,
      driverName:   record.driverName,
      companyName:  record.companyName,
      truckNumber:  record.truckNumber,
      startTime:    record.startTime,
      numberOfDays: record.numberOfDays,
      phoneNumber:  record.phoneNumber
    });

  } catch (err) {
    console.error('[Verify] DB error:', err.message);
    return res.status(500).json({ valid: false, status: 'error', message: 'Server error.' });
  }
};
