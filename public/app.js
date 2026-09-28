/* ============================================================
   DFW Oil Energy – Driver Tracking Portal
   Frontend Logic: validation, camera capture, signature pad, submit
   ============================================================ */

(() => {
  'use strict';

  // ── DOM refs ───────────────────────────────────────────────
  const form          = document.getElementById('driver-form');
  const submitBtn     = document.getElementById('submit-btn');
  const btnText       = document.getElementById('btn-text');
  const btnSpinner    = document.getElementById('btn-spinner');
  const successBanner = document.getElementById('success-banner');
  const errorBanner   = document.getElementById('error-banner');
  const errorMessage  = document.getElementById('error-message');

  // Signature pad
  const canvas   = document.getElementById('signature-pad');
  const ctx      = canvas.getContext('2d');
  const clearBtn = document.getElementById('clear-signature');
  const sigInput = document.getElementById('signatureData');

  // Camera capture
  const openCameraBtn     = document.getElementById('open-camera-btn');
  const cameraIdle        = document.getElementById('camera-idle');
  const cameraPreviewWrap = document.getElementById('camera-preview-wrap');
  const cameraVideo       = document.getElementById('camera-video');
  const captureBtn        = document.getElementById('capture-btn');
  const cancelCameraBtn   = document.getElementById('cancel-camera-btn');
  const switchCameraBtn   = document.getElementById('switch-camera-btn');
  const cameraCaptured    = document.getElementById('camera-captured');
  const capturedImg       = document.getElementById('captured-img');
  const retakeBtn         = document.getElementById('retake-btn');
  const licenseImageData  = document.getElementById('licenseImageData');

  // ── Signature Pad ──────────────────────────────────────────
  let isDrawing = false;
  let sigEmpty  = true;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width  = rect.width;
    canvas.height = rect.height || 180;
    ctx.putImageData(data, 0, 0);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  canvas.addEventListener('mousedown', e => {
    e.preventDefault(); isDrawing = true;
    const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y);
  });
  canvas.addEventListener('mousemove', e => {
    if (!isDrawing) return; e.preventDefault();
    const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); sigEmpty = false;
  });
  canvas.addEventListener('mouseup',    () => { isDrawing = false; });
  canvas.addEventListener('mouseleave', () => { isDrawing = false; });
  canvas.addEventListener('touchstart', e => {
    e.preventDefault(); isDrawing = true;
    const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (!isDrawing) return; e.preventDefault();
    const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); sigEmpty = false;
  }, { passive: false });
  canvas.addEventListener('touchend', () => { isDrawing = false; });

  clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigEmpty = true; sigInput.value = '';
    clearFieldError('signatureData');
  });

  window.addEventListener('load',   resizeCanvas);
  window.addEventListener('resize', resizeCanvas);

  // ── Camera Capture ─────────────────────────────────────────
  let stream         = null;
  let facingMode     = 'environment'; // start with rear camera
  let licenseCaptured = false;

  async function startCamera(facing) {
    // Stop any existing stream first
    stopStream();
    facingMode = facing;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      cameraVideo.srcObject = stream;
      cameraIdle.hidden        = true;
      cameraPreviewWrap.hidden = false;
      cameraCaptured.hidden    = true;
      clearFieldError('scanLicense');
    } catch (err) {
      console.error('Camera error:', err);
      let msg = 'Could not access camera.';
      if (err.name === 'NotAllowedError')  msg = 'Camera permission denied. Please allow camera access and try again.';
      if (err.name === 'NotFoundError')    msg = 'No camera found on this device.';
      if (err.name === 'NotReadableError') msg = 'Camera is in use by another app.';
      showFieldError('scanLicense', msg);
    }
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      cameraVideo.srcObject = null;
    }
  }

  // Open camera
  openCameraBtn.addEventListener('click', () => startCamera(facingMode));

  // Switch between front / rear camera
  switchCameraBtn.addEventListener('click', () => {
    startCamera(facingMode === 'environment' ? 'user' : 'environment');
  });

  // Cancel – go back to idle
  cancelCameraBtn.addEventListener('click', () => {
    stopStream();
    cameraPreviewWrap.hidden = true;
    cameraIdle.hidden        = false;
    if (!licenseCaptured) licenseImageData.value = '';
  });

  // Capture photo
  captureBtn.addEventListener('click', () => {
    const offscreen = document.createElement('canvas');
    offscreen.width  = cameraVideo.videoWidth  || 1280;
    offscreen.height = cameraVideo.videoHeight || 720;
    offscreen.getContext('2d').drawImage(cameraVideo, 0, 0);

    const dataUrl = offscreen.toDataURL('image/jpeg', 0.92);
    licenseImageData.value = dataUrl;
    capturedImg.src        = dataUrl;
    licenseCaptured        = true;

    stopStream();
    cameraPreviewWrap.hidden = true;
    cameraCaptured.hidden    = false;
    clearFieldError('scanLicense');
  });

  // Retake
  retakeBtn.addEventListener('click', () => {
    licenseCaptured        = false;
    licenseImageData.value = '';
    capturedImg.src        = '';
    cameraCaptured.hidden  = true;
    startCamera(facingMode);
  });

  // ── Validation ─────────────────────────────────────────────
  const validators = {
    companyName:      { test: v => v.trim().length >= 2, msg: 'Company name must be at least 2 characters.' },
    driverName:       { test: v => v.trim().length >= 2, msg: 'Driver name must be at least 2 characters.' },
    truckNumber:      { test: v => /^[A-Za-z0-9\-]+$/.test(v.trim()), msg: 'Truck number may only contain letters, numbers, and hyphens.' },
    phoneNumber:      { test: v => /^[\d\s\(\)\+\-\.]{7,20}$/.test(v.trim()), msg: 'Enter a valid phone number.' },
    startTime:        { test: v => v.trim() !== '', msg: 'Please select a start date and time.' },
    numberOfDays:     { test: v => Number(v) >= 1 && Number(v) <= 365, msg: 'Number of days must be between 1 and 365.' },
    scanLicense:      { test: () => licenseCaptured, msg: 'Please capture a photo of your license.' },
    signatureData:    { test: () => !sigEmpty, msg: 'Please provide your signature.' }
  };

  function showFieldError(fieldId, msg) {
    const el    = document.getElementById(`err-${fieldId}`);
    const input = document.getElementById(fieldId);
    if (el)    el.textContent = msg;
    if (input) input.classList.add('invalid');
  }

  function clearFieldError(fieldId) {
    const el    = document.getElementById(`err-${fieldId}`);
    const input = document.getElementById(fieldId);
    if (el)    el.textContent = '';
    if (input) input.classList.remove('invalid');
  }

  function validateAll() {
    let valid = true;
    for (const [fieldId, rule] of Object.entries(validators)) {
      const input = document.getElementById(fieldId);
      const value = input ? input.value : '';
      if (!rule.test(value)) {
        showFieldError(fieldId, rule.msg);
        valid = false;
      } else {
        clearFieldError(fieldId);
      }
    }
    return valid;
  }

  // Live blur validation for text inputs
  ['companyName', 'driverName', 'truckNumber', 'phoneNumber', 'startTime', 'numberOfDays']
    .forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const rule = validators[id];
      el.addEventListener('blur', () => {
        if (!rule.test(el.value)) showFieldError(id, rule.msg);
        else clearFieldError(id);
      });
      el.addEventListener('input', () => {
        if (el.classList.contains('invalid') && rule.test(el.value)) clearFieldError(id);
      });
    });

  // ── Form Submit ────────────────────────────────────────────
  form.addEventListener('submit', async e => {
    e.preventDefault();
    hideBanners();

    // Capture signature before validation
    sigInput.value = sigEmpty ? '' : canvas.toDataURL('image/png');

    if (!validateAll()) {
      // Find and show the first error visibly
      const firstErr = form.querySelector('.field-error:not(:empty)');
      if (firstErr) {
        firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        // Fallback: collect all failing fields and show in error banner
        const failing = Object.entries(validators)
          .filter(([id, rule]) => {
            const el = document.getElementById(id);
            return !rule.test(el ? el.value : '');
          })
          .map(([, rule]) => rule.msg);
        if (failing.length) showError(failing[0]);
      }
      return;
    }

    setLoading(true);

    try {
      const payload = {
        companyName:      document.getElementById('companyName').value,
        driverName:       document.getElementById('driverName').value,
        truckNumber:      document.getElementById('truckNumber').value,
        startTime:        document.getElementById('startTime').value,
        numberOfDays:     document.getElementById('numberOfDays').value,
        phoneNumber:      document.getElementById('phoneNumber').value,
        licenseImageData: licenseImageData.value,
        signatureData:    sigInput.value,
        tzOffset:         new Date().getTimezoneOffset()  // minutes behind UTC (e.g. -180 for UTC+3)
      };

      const response = await fetch('/api/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Store in localStorage (survives refresh) and redirect
        localStorage.setItem('dfw_confirm_data', JSON.stringify({
          qrDataURL: result.qrDataURL,
          token:     result.token,
          expiresAt: result.expiresAt,
          driver:    result.driver
        }));
        window.location.href = 'confirm.html?token=' + result.token;
      } else {
        showError(result.message || 'Submission failed. Please try again.');
      }
    } catch (err) {
      console.error('Submission error:', err);
      showError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  });

  function resetForm() {
    form.reset();
    // Reset signature
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sigEmpty = true; sigInput.value = '';
    // Reset camera
    stopStream();
    licenseCaptured = false;
    licenseImageData.value = '';
    capturedImg.src = '';
    cameraCaptured.hidden    = true;
    cameraPreviewWrap.hidden = true;
    cameraIdle.hidden        = false;
  }

  // ── UI Helpers ─────────────────────────────────────────────
  function setLoading(on) {
    submitBtn.disabled = on;
    btnText.hidden     = on;
    btnSpinner.hidden  = !on;
  }

  function hideBanners() {
    errorBanner.hidden = true;
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.hidden = false;
    if (successBanner) successBanner.hidden = true;
  }

  // Stop camera if user navigates away
  window.addEventListener('beforeunload', stopStream);

  // Force fresh page when driver navigates back (clears all form data)
  window.addEventListener('pageshow', e => {
    if (e.persisted) window.location.reload();
  });

})();
