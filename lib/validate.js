/* ============================================================
   lib/validate.js  –  Shared server-side validation
   ============================================================ */
'use strict';

function validateDriverForm(body) {
  const errors = [];
  const { companyName, driverName, truckNumber, startTime,
          numberOfDays, phoneNumber, signatureData, licenseImageData } = body;

  if (!companyName || companyName.trim().length < 2)
    errors.push('Company name must be at least 2 characters.');
  if (!driverName || driverName.trim().length < 2)
    errors.push('Driver name must be at least 2 characters.');
  if (!truckNumber || !/^[A-Za-z0-9\-]+$/.test(truckNumber.trim()))
    errors.push('Truck number may only contain letters, numbers, and hyphens.');
  if (!startTime || isNaN(Date.parse(startTime)))
    errors.push('A valid start date and time is required.');
  const days = Number(numberOfDays);
  if (isNaN(days) || days < 1 || days > 365)
    errors.push('Number of days must be between 1 and 365.');
  if (!phoneNumber || !/^[\d\s\(\)\+\-\.]{7,20}$/.test(phoneNumber.trim()))
    errors.push('A valid phone number is required.');
  if (!licenseImageData || !licenseImageData.startsWith('data:image/'))
    errors.push('A captured license photo is required.');
  if (!signatureData || !signatureData.startsWith('data:image/'))
    errors.push('A driver signature is required.');

  return errors;
}

module.exports = { validateDriverForm };
