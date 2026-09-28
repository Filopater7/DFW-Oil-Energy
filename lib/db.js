/* ============================================================
   lib/db.js
   Cached mongoose connection for Vercel serverless functions.
   Re-uses the same connection across warm invocations.
   ============================================================ */
'use strict';

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

// Cache on the global object so warm Lambda containers reuse it
let cached = global._mongoose || { conn: null, promise: null };
global._mongoose = cached;

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000,
    }).then(m => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDB;
