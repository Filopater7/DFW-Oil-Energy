/* ============================================================
   api/verify/[token].js  –  Vercel Serverless Function
   GET /api/verify/:token
   ============================================================ */
'use strict';

const store = require('../../lib/store');

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')
    return res.status(405).json({ valid: false, message: 'Method not allowed.' });

  const { token } = req.query;

  if (!token)
    return res.status(400).json({ valid: false, status: 'error', message: 'Token is required.' });

  const record = store.findByToken(token);

  if (!record) {
    return res.status(404).json({
      valid:   false,
      status:  'not_found',
      message: 'QR code not found.'
    });
  }

  const expired = new Date() > new Date(record.expiresAt);

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
};
