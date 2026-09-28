/* ============================================================
   lib/email.js  –  Nodemailer notification helper
   ============================================================ */
'use strict';

const nodemailer = require('nodemailer');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendNotificationEmail(data, qrDataURL) {
  const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE,
          EMAIL_USER, EMAIL_PASS, EMAIL_FROM, EMAIL_TO } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) {
    console.warn('[Email] Not configured – skipping.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   EMAIL_HOST,
    port:   Number(EMAIL_PORT) || 587,
    secure: EMAIL_SECURE === 'true',
    auth:   { user: EMAIL_USER, pass: EMAIL_PASS }
  });

  const attachments = [];

  // Embed QR as inline image
  if (qrDataURL) {
    const buf = Buffer.from(qrDataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
    attachments.push({ filename: 'qrcode.png', content: buf, cid: 'qr_code' });
  }

  // Embed license photo as inline image
  if (data.licenseImageData) {
    const buf = Buffer.from(data.licenseImageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    attachments.push({ filename: 'license.jpg', content: buf, cid: 'license_photo' });
  }

  const submittedAt = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const expiresAt   = new Date(data.expiresAt).toLocaleString('en-US', { timeZone: 'America/Chicago' });

  const htmlBody = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#111;color:#eee;border-radius:10px;overflow:hidden;">
    <div style="background:linear-gradient(90deg,#C9A84C,#E07B20);padding:20px 28px;text-align:center;">
      <h1 style="margin:0;color:#111;font-size:1.4rem;letter-spacing:1px;">DFW OIL ENERGY</h1>
      <p style="margin:4px 0 0;color:#111;font-size:0.85rem;">Wholesale Distributor — Driver Trip Notification</p>
    </div>
    <div style="padding:28px;">
      <p style="color:#C9A84C;font-size:1rem;font-weight:bold;margin-bottom:18px;">New Driver Record Submitted</p>
      <table style="width:100%;border-collapse:collapse;font-size:0.93rem;">
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;width:40%;">Company Name</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.companyName)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Driver Name</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.driverName)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Truck Number</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.truckNumber)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Start Time</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.startTime)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Number of Days</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(String(data.numberOfDays))}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">Phone</td><td style="padding:9px 6px;font-weight:600;">${escapeHtml(data.phoneNumber)}</td></tr>
        <tr style="border-bottom:1px solid #333;"><td style="padding:9px 6px;color:#aaa;">QR Expires</td><td style="padding:9px 6px;font-weight:600;color:#E07B20;">${expiresAt} (CST)</td></tr>
        <tr><td style="padding:9px 6px;color:#aaa;">Submitted At</td><td style="padding:9px 6px;font-weight:600;">${submittedAt} (CST)</td></tr>
      </table>
      ${qrDataURL ? '<p style="margin-top:24px;color:#C9A84C;font-weight:bold;font-size:0.88rem;">DRIVER QR PASS</p><img src="cid:qr_code" alt="QR Code" style="width:180px;height:180px;margin-top:8px;border-radius:8px;" />' : ''}
      ${data.licenseImageData ? '<p style="margin-top:24px;color:#C9A84C;font-weight:bold;font-size:0.88rem;">SCANNED LICENSE</p><img src="cid:license_photo" alt="License" style="border:1px solid #444;border-radius:6px;background:#fff;max-width:100%;margin-top:8px;" />' : ''}
      ${data.signatureData ? `<p style="margin-top:24px;color:#C9A84C;font-weight:bold;font-size:0.88rem;">DRIVER SIGNATURE</p><img src="${data.signatureData}" alt="Signature" style="border:1px solid #444;border-radius:6px;background:#fff;max-width:100%;margin-top:8px;" />` : ''}
    </div>
    <div style="background:#0d0d0d;text-align:center;padding:14px;font-size:0.75rem;color:#555;">&copy; 2026 DFW Oil Energy — Wholesale Distributor.</div>
  </div>`;

  await transporter.sendMail({
    from:        EMAIL_FROM || `"DFW Oil Energy" <${EMAIL_USER}>`,
    to:          EMAIL_TO,
    subject:     `[DFW Oil Energy] New Driver Record – ${data.driverName} | ${data.truckNumber}`,
    html:        htmlBody,
    attachments
  });

  console.log('[Email] Sent to', EMAIL_TO);
}

module.exports = { sendNotificationEmail };
