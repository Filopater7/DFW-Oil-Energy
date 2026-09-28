/* ============================================================
   lib/Submission.js  –  Mongoose model for driver submissions
   ============================================================ */
'use strict';

const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
  token:        { type: String, required: true, unique: true, index: true },
  expiresAt:    { type: Date,   required: true },
  submittedAt:  { type: Date,   default: Date.now },
  companyName:  { type: String, required: true },
  driverName:   { type: String, required: true },
  truckNumber:  { type: String, required: true },
  startTime:    { type: String, required: true },
  numberOfDays: { type: Number, required: true },
  phoneNumber:  { type: String, required: true },
  // Base64 images stored in DB (keeps Vercel stateless)
  licenseImage:   { type: String },   // data:image/jpeg;base64,...
  signatureImage: { type: String },   // data:image/png;base64,...
}, { timestamps: false });

// Avoid model recompilation on hot-reload in serverless
module.exports = mongoose.models.Submission ||
  mongoose.model('Submission', SubmissionSchema);
