/* ============================================================
   api/health.js  –  Vercel Serverless Function
   GET /api/health
   ============================================================ */
'use strict';

module.exports = function handler(req, res) {
  res.status(200).json({
    status:  'ok',
    service: 'DFW Oil Energy Driver Tracking',
    time:    new Date().toISOString()
  });
};
