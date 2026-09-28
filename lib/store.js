/* ============================================================
   lib/store.js  –  In-memory submission store
   Works perfectly for testing on Vercel.
   NOTE: Data resets when the serverless function cold-starts.
   Replace with MongoDB Atlas later for production persistence.
   ============================================================ */
'use strict';

// Global map survives across warm invocations of the same function instance
const submissions = global._dfwSubmissions || (global._dfwSubmissions = new Map());

module.exports = {
  save(token, record) {
    submissions.set(token, record);
  },
  findByToken(token) {
    return submissions.get(token) || null;
  },
  count() {
    return submissions.size;
  }
};
