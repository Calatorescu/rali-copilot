'use strict';

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const S = {
  gps: { watchId: null, speed: 0, accuracy: null, altitude: null, heading: null, lat: null, lng: null },
  chrono: { running: false, startMs: null, accumulated: 0, raf: null },
  rt: {
    active: false, targetSpd: 40, totalDist: 2.0, type: 'auto',
    startMs: null, distKm: 0, lastPos: null, tickId: null
  },
  chat: { busy: false },
  cfg: {
    apiKey: ls('rali_key') || '',
    model:  ls('rali_model') || 'claude-haiku-4-5-20251001'
  }
};

function ls(k, v) {
  if (v !== undefined) { localStorage.setItem(k, v); return v; }
  return localStorage.getItem(k);
}

// ══════════════════════════════════════════════════════════════
//  GPS
// ══════════════════════════════════════════════════════════════
function gpsInit() {
  if (!navigator.geolocation) { gpsDot('off'); return; }
  gpsDot('searching');
  S.gps.watchId = navigator.geolocation.watchPosition(gpsOk, gpsErr,
    { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 });
}

function gpsOk(pos) {
  const c = pos.coords;
  S.gps.speed    = c.speed != null ? c.speed * 3.6 : calcSpeed(pos);
  S.gps.accuracy = c.accuracy;
  S.gps.altitude = c.altitude;
  S.gps.heading  = c.heading;
  S.gps.lat      = c.latitude;
  S.gps.lng      = c.longitude;
  gpsDot('active');
  renderSpeed();
  if (S.rt.active) rtGpsTick(pos);
}

let _prevPos = null, _prevT = null;
function calcSpeed(pos) {
  if (_prevPos && _prevT) {
    const dt = (pos.timestamp - _prevT) / 1000;
    if (dt > 0.1) {
      const d = haversine(
        _prevPos.coords.latitude, _prevPos.coords.longitude,
        pos.coords.latitude,      pos.coords.longitude);
      const spd = (d / dt) * 3600;
      _prevPos = pos; _prevT = pos.timestamp;
      return spd;
    }
  }
  _prevPos = pos; _prevT = pos.timestamp;
  return S.gps.speed;
}

function gpsErr(e) { gpsDot('off'); console.warn('GPS:', e.message); }

function gpsDot(s) {
  const d = document.getElementById('gps-dot');
  d.className = 'gps-dot' + (s === 'active' ? ' active' : s === 'searching' ? ' searching' : '');
}

function renderSpeed() {
  const spd = Math.round(S.gps.speed);
  document.getElementById('speed-val').textContent = spd;
  el('m-accuracy').textContent = S.gps.accuracy != null ? `±${Math.round(S.gps.accuracy)} m` : '—';
  el('m-altitude').textContent = S.gps.altitude != null ? `${Math.round(S.gps.altitude)} m` : '—';
  el('m-heading').textContent  = S.gps.heading  != null ? `${Math.round(S.gps.heading)}°`  : '—';
}

// ══════════════════════════════════════════════════════════════
//  HAVERSINE
// ══════════════════════════════════════════════════════════════
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ══════════════════════════════════════════════════════════════
//  CHRONO
// ══════════════════════════════════════════════════════════════
function chronoToggle() {
  const btn = el('btn-chrono-toggle');
  if (S.chrono.running) {
    S.chrono.accumulated += Date.now() - S.chrono.startMs;
    S.chrono.running = false;
    cancelAnimationFrame(S.chrono.raf);
    btn.textContent = 'START';
    btn.className = 'btn btn-pri';
  } else {
    S.chrono.startMs = Date.now();
    S.chrono.running = true;
    btn.textContent = 'STOP';
    btn.className = 'btn btn-danger';
    chronoFrame();
  }
}

function chronoReset() {
  cancelAnimationFrame(S.chrono.raf);
  S.chrono.running = false;
  S.chrono.startMs = null;
  S.chrono.accumulated = 0;
  el('btn-chrono-toggle').textContent = 'START';
  el('btn-chrono-toggle').className = 'btn btn-pri';
  el('chrono-disp').textContent = '00:00.0';
}

function chronoFrame() {
  const tot = S.chrono.accumulated + (S.chrono.running ? Date.now() - S.chrono.startMs : 0);
  el('chrono-disp').textContent = fmtChrono(tot / 1000);
  if (S.chrono.running) S.chrono.raf = requestAnimationFrame(chronoFrame);
}

function fmtChrono(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const d = Math.floor((s % 1) * 10);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}.${d}`;
  return `${pad(m)}:${pad(sec)}.${d}`;
}

function fmtSec(s) {
  const abs = Math.abs(s);
  const m = Math.floor(abs / 60);
  const sec = Math.floor(abs % 60);
  if (m > 0) return `${m}:${pad(sec)}`;
  return `${sec}`;
}

function pad(n) { return n.toString().padStart(2, '0'); }

// ══════════════════════════════════════════════════════════════
//  RT — SETUP
// ══════════════════════════════════════════════════════════════
function rtPreview() {
  const spd = parseFloat(el('rt-spd').value) || 40;
  const dst = parseFloat(el('rt-dst').value) || 2;
  const total = (dst * 3600) / spd;
  const half  = (dst / 2 * 3600) / spd;
  const per1  = (1 * 3600) / spd;
  el('rt-preview').innerHTML =
    `Timp ideal total: <strong>${fmtSec(total)} sec</strong>&nbsp;&nbsp;` +
    `La 50%: ${fmtSec(half)} sec&nbsp;&nbsp;` +
    `La 1 km: ${fmtSec(per1)} sec`;
}

function rtStart() {
  S.rt.targetSpd = parseFloat(el('rt-spd').value) || 40;
  S.rt.totalDist = parseFloat(el('rt-dst').value) || 2;
  S.rt.type      = document.querySelector('input[name="rt-type"]:checked').value;
  S.rt.startMs   = Date.now();
  S.rt.distKm    = 0;
  S.rt.lastPos   = S.gps.lat ? { lat: S.gps.lat, lng: S.gps.lng } : null;
  S.rt.active    = true;

  el('rt-setup').classList.add('hidden');
  el('rt-live').classList.remove('hidden');
  el('rt-badge').classList.remove('hidden');

  S.rt.tickId = setInterval(rtRender, 250);
  vibrate([30]);
}

function rtStop() {
  S.rt.active = false;
  clearInterval(S.rt.tickId);
  el('rt-live').classList.add('hidden');
  el('rt-setup').classList.remove('hidden');
  el('rt-badge').classList.add('hidden');
  vibrate([50, 50, 50]);
}

// ══════════════════════════════════════════════════════════════
//  RT — GPS TICK
// ══════════════════════════════════════════════════════════════
function rtGpsTick(pos) {
  if (!S.rt.active) return;
  const acc = pos.coords.accuracy;
  if (acc && acc > 60) return; // skip noisy fix

  const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  if (S.rt.lastPos) {
    const d = haversine(S.rt.lastPos.lat, S.rt.lastPos.lng, cur.lat, cur.lng);
    if (d < 0.5) S.rt.distKm += d; // sanity cap per tick
  }
  S.rt.lastPos = cur;
}

// ══════════════════════════════════════════════════════════════
//  RT — RENDER
// ══════════════════════════════════════════════════════════════
function rtRender() {
  if (!S.rt.active) return;

  const elapsedS = (Date.now() - S.rt.startMs) / 1000;
  const dist     = S.rt.distKm;
  const spd      = S.rt.targetSpd;
  const total    = S.rt.totalDist;

  const idealS   = (dist * 3600) / spd;        // how long it should take to cover dist
  const devS     = elapsedS - idealS;           // + = behind, - = ahead
  const remaining = Math.max(0, total - dist);
  const pct      = Math.min(100, (dist / total) * 100);

  // Required speed to recover deviation on remaining segment
  let reqSpd = null;
  if (remaining > 0.001) {
    const remIdealS = (remaining * 3600) / spd;
    const remActualS = remIdealS - devS;
    reqSpd = remActualS > 1 ? (remaining * 3600) / remActualS : null;
  }

  // Deviation display
  const absD = Math.abs(devS);
  const sign = devS >= 0 ? '+' : '−';
  el('dev-num').textContent = sign + absD.toFixed(1);
  el('dev-lbl').textContent = devS >= 0 ? 'secunde în urmă' : 'secunde în avans';

  const cls = absD <= 5 ? 'ok' : absD <= 15 ? 'warn' : 'bad';
  el('dev-num').className = `dev-num ${cls}`;
  el('dev-box').className = `dev-box ${cls}`;

  // Alert vibrations at thresholds
  if (absD > 15 && Math.floor(elapsedS) % 10 === 0) vibrate([100]);

  // Stats
  el('s-elapsed').textContent  = fmtSec(elapsedS) + ' s';
  el('s-ideal').textContent    = fmtSec(idealS) + ' s';
  el('s-dist').textContent     = dist.toFixed(3) + ' km';
  el('s-rem').textContent      = remaining.toFixed(3) + ' km';

  if (remaining < 0.01) {
    el('s-reqspd').textContent = 'FINISH';
    el('s-reqspd').style.color = 'var(--green)';
  } else if (reqSpd === null) {
    el('s-reqspd').textContent = 'IMPOSIBIL ⚠';
    el('s-reqspd').style.color = 'var(--red)';
  } else {
    el('s-reqspd').textContent = reqSpd.toFixed(1) + ' km/h';
    el('s-reqspd').style.color = '';
  }

  el('prog-fill').style.width  = pct + '%';
  el('prog-pct').textContent   = Math.round(pct) + '%';

  // Auto-stop when done
  if (pct >= 100 && dist >= total - 0.01) {
    setTimeout(() => { if (S.rt.active) rtStop(); }, 1500);
  }
}

// ══════════════════════════════════════════════════════════════
//  VISION — camera + Claude multimodal
// ══════════════════════════════════════════════════════════════
function openCamera(onData) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.capture = 'environment';
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onData(reader.result.split(',')[1], file.type);
    reader.readAsDataURL(file);
  };
  inp.click();
}

async function callClaudeVision(b64, mime, textPrompt, maxTok, sysPrompt) {
  const key = S.cfg.apiKey;
  if (!key) throw new Error('Adaugă API Key în SETĂRI.');
  const body = {
    model: S.cfg.model,
    max_tokens: maxTok || 300,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: textPrompt }
      ]
    }]
  };
  if (sysPrompt) body.system = sysPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
  const j = await res.json();
  return j.content[0].text.trim();
}

async function rtScan() {
  if (!S.cfg.apiKey) { alert('Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const btn = el('btn-rt-scan');
    const sta = el('rt-scan-status');
    btn.textContent = '⏳ Analizez...';
    btn.disabled = true;
    sta.className = 'scan-status';
    sta.style.color = 'var(--dim)';
    sta.textContent = '';
    try {
      const raw = await callClaudeVision(b64, mime,
        `Ești copilotul de raliu. Analizează roadbook-ul din fotografie și extrage parametrii RT (Regularity Test).
Returnează DOAR JSON valid, fără alt text:
{"speed": 40.0, "distance": 5.74, "start": "standing", "note": "RT 4"}
- speed = viteza medie impusă în km/h (număr zecimal)
- distance = distanța totală RT în km (număr zecimal)
- start = "standing" (start din loc, simbol cu fulg/snowflake) sau "auto" (start din mers)
- note = identificator scurt (ex: "RT 4", "TR 1")
Dacă nu identifici un parametru cu siguranță, pune null.`, 200);

      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error('Format neașteptat');
      const d = JSON.parse(match[0]);

      if (d.speed != null)    el('rt-spd').value = d.speed;
      if (d.distance != null) el('rt-dst').value = d.distance;
      if (d.start === 'standing') document.querySelector('input[name="rt-type"][value="standing"]').checked = true;
      if (d.start === 'auto')     document.querySelector('input[name="rt-type"][value="auto"]').checked     = true;
      rtPreview();

      const spd = d.speed    != null ? `${d.speed} km/h` : '? km/h';
      const dst = d.distance != null ? `${d.distance} km` : '? km';
      const stt = d.start === 'standing' ? 'standing start' : d.start === 'auto' ? 'auto-start' : '?';
      sta.textContent = `✓ ${d.note ? d.note + ': ' : ''}${spd} · ${dst} · ${stt}`;
      sta.style.color = 'var(--green)';
    } catch (e) {
      sta.textContent = `✗ ${e.message}`;
      sta.style.color = 'var(--red)';
    } finally {
      btn.disabled = false;
      btn.textContent = '📷 Scanează roadbook';
    }
  });
}

async function chatPhoto() {
  if (S.chat.busy) return;
  if (!S.cfg.apiKey) { addMsg('bot', 'Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const txt = el('chat-in').value.trim();
    el('chat-in').value = '';
    addMsg('user', '📷' + (txt ? ' ' + txt : ' [foto]'));
    addTyping();
    S.chat.busy = true;
    el('btn-chat-photo').disabled = true;
    try {
      const ctx = rtContext();
      const prompt = [ctx, txt || 'Analizează fotografia și spune-mi ce e relevant pentru ralie.'].filter(Boolean).join('\n');
      const reply = await callClaudeVision(b64, mime, prompt, 400, SYSTEM);
      removeTyping();
      addMsg('bot', reply);
    } catch (e) {
      removeTyping();
      addMsg('bot', `Eroare: ${e.message}`);
    } finally {
      S.chat.busy = false;
      el('btn-chat-photo').disabled = false;
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  CLAUDE API
// ══════════════════════════════════════════════════════════════
const SYSTEM = `Ești RALI, copilotul virtual al lui Andreas Suciu la Transilvania eCLASIC 2026 (regularitate 100% electric, A.R.E.S. Championship).
Mașina: Tesla Model Y Juniper AWD Long Range — 82 kWh, consum munte ~20 kWh/100 km, autonomie munte 280-320 km la 100%.
Regularitate: 1 punct = 1 secundă deviere. TC = time control cu ștampilă (300 pct dacă blochezi alt echipaj). RT = test timed — menții viteză medie.
Formula RT: timp ideal (s) = (km × 3600) ÷ viteză medie. Deviere + = în urmă. Deviere - = în avans.
Rezultat Reșița 2026 (etapa 1): loc 14/22, 339.7 pct — TR4 pierdut (viteze mici <30 km/h, mers instinctiv prea repede).
Calendar: Sibiu 6-8 aug | Sinaia 11-12 sep | Iași-Chișinău 9-10 oct | Christmas Tour 4-5 dec.
Răspunde în română, SCURT (max 3 rânduri). Direcțiile cu MAJUSCULE. Calculezi calm, nu panicăm.`;

function rtContext() {
  if (!S.rt.active) return '';
  const el_ = (Date.now() - S.rt.startMs) / 1000;
  const idealS = (S.rt.distKm * 3600) / S.rt.targetSpd;
  const dev = el_ - idealS;
  return `[RT activ: ${S.rt.targetSpd} km/h țintă, deviere ${dev>=0?'+':''}${dev.toFixed(1)}s, `+
         `distanță ${S.rt.distKm.toFixed(3)}/${S.rt.totalDist} km, viteză GPS ${Math.round(S.gps.speed)} km/h]`;
}

async function callClaude(msg) {
  const key = S.cfg.apiKey;
  if (!key) return 'Adaugă Claude API Key în tab-ul SETĂRI.';
  const context = rtContext();
  const full = context ? context + '\n\n' + msg : msg;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: S.cfg.model,
      max_tokens: 280,
      system: SYSTEM,
      messages: [{ role: 'user', content: full }]
    })
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
  const j = await res.json();
  return j.content[0].text.trim();
}

// ══════════════════════════════════════════════════════════════
//  CHAT UI
// ══════════════════════════════════════════════════════════════
function addMsg(role, text) {
  const wrap = el('chat-msgs');
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'msg-me' : 'msg-bot'}`;
  const bub = document.createElement('span');
  bub.className = 'bubble';
  bub.textContent = text;
  div.appendChild(bub);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function addTyping() {
  const wrap = el('chat-msgs');
  const div = document.createElement('div');
  div.id = 'typing';
  div.className = 'msg msg-bot';
  div.innerHTML = '<span class="bubble typing-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function removeTyping() { document.getElementById('typing')?.remove(); }

async function sendChat() {
  if (S.chat.busy) return;
  const input = el('chat-in');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  addMsg('user', msg);
  addTyping();
  S.chat.busy = true;
  el('btn-send').disabled = true;
  try {
    const reply = await callClaude(msg);
    removeTyping();
    addMsg('bot', reply);
  } catch (e) {
    removeTyping();
    addMsg('bot', `Eroare: ${e.message}`);
  } finally {
    S.chat.busy = false;
    el('btn-send').disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
//  WAKE LOCK
// ══════════════════════════════════════════════════════════════
let _wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    el('wake-icon').classList.add('on');
    _wakeLock.addEventListener('release', () => {
      el('wake-icon').classList.remove('on');
      // re-acquire when tab becomes visible again
    });
  } catch (_) {}
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquireWakeLock();
});

// ══════════════════════════════════════════════════════════════
//  UTIL
// ══════════════════════════════════════════════════════════════
function el(id) { return document.getElementById(id); }
function vibrate(pattern) { navigator.vibrate?.(pattern); }

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
function init() {
  // Tab switching
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      el('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Chrono
  el('btn-chrono-toggle').addEventListener('click', chronoToggle);
  el('btn-chrono-reset').addEventListener('click', chronoReset);

  // RT
  el('rt-spd').addEventListener('input', rtPreview);
  el('rt-dst').addEventListener('input', rtPreview);
  el('btn-rt-start').addEventListener('click', rtStart);
  el('btn-rt-stop').addEventListener('click', rtStop);
  rtPreview();

  // RT Scan
  el('btn-rt-scan').addEventListener('click', rtScan);

  // Chat
  el('btn-send').addEventListener('click', sendChat);
  el('btn-chat-photo').addEventListener('click', chatPhoto);
  el('chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  document.querySelectorAll('.qbtn').forEach(b => {
    b.addEventListener('click', () => {
      el('chat-in').value = b.dataset.p;
      // switch to copilot tab if not already
      document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.nav-btn[data-tab="copilot"]').classList.add('active');
      el('tab-copilot').classList.add('active');
      sendChat();
    });
  });

  // Settings
  el('api-key').value    = S.cfg.apiKey;
  el('model-sel').value  = S.cfg.model;

  el('btn-save-key').addEventListener('click', () => {
    S.cfg.apiKey = el('api-key').value.trim();
    ls('rali_key', S.cfg.apiKey);
    const s = el('set-status');
    s.textContent = S.cfg.apiKey ? 'API key salvat ✓' : 'Key șters.';
    setTimeout(() => { s.textContent = ''; }, 2500);
  });

  el('model-sel').addEventListener('change', () => {
    S.cfg.model = el('model-sel').value;
    ls('rali_model', S.cfg.model);
  });

  // Wake lock + GPS
  acquireWakeLock();
  gpsInit();

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
}

document.addEventListener('DOMContentLoaded', init);
