'use strict';

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const S = {
  gps: { watchId: null, speed: 0, accuracy: null, altitude: null, heading: null, lat: null, lng: null },
  chrono: { running: false, startMs: null, accumulated: 0, raf: null },
  rt: {
    active: false, finishing: false, targetSpd: 40, totalDist: 2.0, type: 'auto',
    startMs: null, distKm: 0, lastPos: null, tickId: null
  },
  road: {
    boxes: (() => { try { return JSON.parse(ls('rali_road') || '[]'); } catch(e) { return []; } })(),
    active: false, legDistKm: 0, lastPos: null,
    nextIdx: 0, tickId: null, announced: {}
  },
  voice: { rtLastMs: 0, rtLastDev: null },
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
  if (S.rt.active)   rtGpsTick(pos);
  if (S.road.active) navGpsTick(pos);
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
  S.voice.rtLastMs = 0; S.voice.rtLastDev = null;
  const startType = S.rt.type === 'standing' ? 'standing start' : 'start';
  speak(`RT pornit — ${S.rt.targetSpd} km pe oră — ${startType}`);
  vibrate([30]);
}

function rtStop() {
  S.rt.active = false; S.rt.finishing = false;
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

  // Alert vibrations at thresholds (gate: max 1x per second window)
  if (absD > 15 && Math.floor(elapsedS) % 10 === 0 && (elapsedS % 10) < 0.3) vibrate([100]);

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

  // Voice speed feedback (max 1x la 15s, doar dacă deviere > 3s)
  const nowMs = Date.now();
  if (elapsedS > 8 && nowMs - S.voice.rtLastMs > 15000) {
    const prevDev = S.voice.rtLastDev;
    if (absD > 3 && (prevDev === null || Math.abs(devS - prevDev) > 1.5)) {
      const dir = devS > 0 ? 'în urmă' : 'în avans';
      const action = devS > 0
        ? (absD > 15 ? 'URGENT, mult mai repede' : absD > 7 ? 'mai repede' : 'ușor mai repede')
        : (absD > 12 ? 'mult mai lent' : 'ușor mai lent');
      const spdStr = reqSpd ? `, du-te la ${Math.round(reqSpd)} km pe oră` : '';
      speakIfIdle(`${Math.round(absD)} secunde ${dir} — ${action}${spdStr}`);
      S.voice.rtLastMs = nowMs; S.voice.rtLastDev = devS;
    }
  }

  // Auto-stop when done (guard against repeat calls every 250ms)
  if (pct >= 100 && dist >= total - 0.01 && !S.rt.finishing) {
    S.rt.finishing = true;
    speak('Finish RT.');
    setTimeout(() => { if (S.rt.active) { S.rt.finishing = false; rtStop(); } }, 1500);
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
  inp.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
  inp.onchange = () => {
    document.body.removeChild(inp);
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onData(reader.result.split(',')[1], file.type);
    reader.readAsDataURL(file);
  };
  document.body.appendChild(inp);
  inp.click();
}

async function callClaudeVision(b64, mime, textPrompt, maxTok, sysPrompt, modelOverride) {
  const key = S.cfg.apiKey;
  if (!key) throw new Error('Adaugă API Key în SETĂRI.');
  const body = {
    model: modelOverride || S.cfg.model,
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
//  SPEECH (Web Speech API — fără API calls)
// ══════════════════════════════════════════════════════════════
const DIR_ARROW = {
  'ÎNAINTE':'↑', 'STÂNGA':'←', 'DREAPTA':'→',
  'STÂNGA-T':'↰', 'DREAPTA-T':'↱',
  'GIRATORIU-1':'①', 'GIRATORIU-2':'②', 'GIRATORIU-3':'③', 'GIRATORIU-4':'④',
  'STOP-CFR':'⛔', 'TC':'🏁', 'RT_START_AUTO':'⚡', 'RT_START_STANDING':'⚡❄',
  'RT_FINISH':'🏳', 'PARKING':'🅿', 'EV':'🔌'
};
const DIR_VOICE = {
  'ÎNAINTE':'înainte', 'STÂNGA':'stânga', 'DREAPTA':'dreapta',
  'STÂNGA-T':'stânga la T', 'DREAPTA-T':'dreapta la T',
  'GIRATORIU-1':'prima ieșire', 'GIRATORIU-2':'a doua ieșire',
  'GIRATORIU-3':'a treia ieșire', 'GIRATORIU-4':'a patra ieșire',
  'STOP-CFR':'STOP cale ferată'
};

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ro-RO'; u.rate = 1.1; u.volume = 1.0;
  // 50ms delay: Android Chrome drops speak() called immediately after cancel()
  setTimeout(() => window.speechSynthesis.speak(u), 50);
}

function speakIfIdle(text) {
  if (!window.speechSynthesis || window.speechSynthesis.speaking) return;
  speak(text);
}

// ══════════════════════════════════════════════════════════════
//  ROAD NAV — scan roadbook pages + GPS navigation + voice
// ══════════════════════════════════════════════════════════════
const NAV_SCAN_PROMPT = `Ești copilot de raliu. Extrage TOATE boxurile vizibile pe această pagină de roadbook în format JSON array.

COLOANE (stânga→dreapta): Număr box | Sum km (bold) | Sum mile (ignoră) | Section km (bold) | Section mile (ignoră) | Diagrama tulip | Dist to target (ignoră) | Comment text

DIAGRAMA TULIP — interpretează vizual direcția:
"ÎNAINTE"=drept înainte, "STÂNGA"=viraj simplu stânga, "DREAPTA"=viraj simplu dreapta,
"STÂNGA-T"=T-junction viraj stânga, "DREAPTA-T"=T-junction viraj dreapta,
"GIRATORIU-1"/"GIRATORIU-2"/"GIRATORIU-3"/"GIRATORIU-4"=ieșirea 1/2/3/4 din sens giratoriu,
"STOP-CFR"=trecere cale ferată cu oprire

ICOANE DEASUPRA DIAGRAMEI → câmpul "flag":
steag+ceas (fără fulg de nea)="RT_START_AUTO" | steag+ceas+fulg de nea="RT_START_STANDING"
dreptunghi+steag="RT_FINISH" | ceas+steag mare="TC" | P mare="PARKING" | fulger/priză="EV"
Waypoint normal fără icoane speciale: flag=null

Format de returnare — DOAR JSON array valid, fără alt text:
[{"num":67,"sumKm":19.72,"sectionKm":2.31,"dir":"STÂNGA-T","comment":"Receptie Bar / DJ 582B","flag":"RT_START_AUTO"},...]

Toate boxurile de pe pagină, în ordine crescătoare a numărului.`;

async function navScan() {
  if (!S.cfg.apiKey) { alert('Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const btn = el('btn-nav-scan');
    const sta = el('nav-scan-status');
    btn.disabled = true; btn.textContent = '⏳ Scanez...';
    sta.className = 'scan-status'; sta.style.color = 'var(--dim)'; sta.textContent = '';
    try {
      const raw = await callClaudeVision(b64, mime, NAV_SCAN_PROMPT, 1000, null, 'claude-sonnet-4-6');
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Format neașteptat');
      const boxes = JSON.parse(match[0]);
      if (!Array.isArray(boxes) || !boxes.length) throw new Error('Niciun box identificat');

      const map = new Map(S.road.boxes.map(b => [`${b.num}_${Math.round(b.sumKm*100)}`, b]));
      boxes.forEach(b => map.set(`${b.num}_${Math.round(b.sumKm*100)}`, b));
      S.road.boxes = Array.from(map.values()).sort((a, b) => a.sumKm - b.sumKm);
      ls('rali_road', JSON.stringify(S.road.boxes));
      navUpdateList();

      sta.textContent = `✓ ${boxes.length} boxuri adăugate — total ${S.road.boxes.length}`;
      sta.style.color = 'var(--green)';
    } catch (e) {
      sta.textContent = `✗ ${e.message}`; sta.style.color = 'var(--red)';
    } finally {
      btn.disabled = false; btn.textContent = '📷 Adaugă pagină roadbook';
    }
  });
}

function navUpdateList() {
  const n = S.road.boxes.length;
  el('nav-box-count').textContent = n === 0 ? '— niciun box scanat' :
    `${n} boxuri · ${S.road.boxes[0].sumKm.toFixed(2)} – ${S.road.boxes[n-1].sumKm.toFixed(2)} km`;
  el('btn-nav-start').disabled = n === 0;
}

function navClear() {
  if (!confirm('Ștergi toate boxurile scanate?')) return;
  S.road.boxes = []; ls('rali_road', '[]'); navUpdateList();
}

function navStart() {
  if (!S.road.boxes.length) return;
  S.road.active = true; S.road.legDistKm = 0; S.road.announced = {};
  S.road.lastPos = S.gps.lat ? { lat: S.gps.lat, lng: S.gps.lng } : null;
  // Skip boxes within 80m to avoid voice spam at start
  const firstIdx = S.road.boxes.findIndex(b => b.sumKm > 0.08);
  S.road.nextIdx = firstIdx === -1 ? 0 : firstIdx;
  el('nav-setup').classList.add('hidden');
  el('nav-active').classList.remove('hidden');
  S.road.tickId = setInterval(navRender, 500);
  speak('Navigare pornită.');
}

function navStop() {
  S.road.active = false; clearInterval(S.road.tickId);
  window.speechSynthesis?.cancel();
  el('nav-active').classList.add('hidden');
  el('nav-setup').classList.remove('hidden');
}

function navGpsTick(pos) {
  const acc = pos.coords.accuracy;
  if (acc && acc > 60) return;
  const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  if (S.road.lastPos) {
    const d = haversine(S.road.lastPos.lat, S.road.lastPos.lng, cur.lat, cur.lng);
    if (d < 0.5) S.road.legDistKm += d;
  }
  S.road.lastPos = cur;
}

function navRender() {
  if (!S.road.active) return;
  const dist = S.road.legDistKm;
  el('nav-pos-km').textContent = dist.toFixed(3) + ' km';

  // Advance past already-passed boxes
  while (S.road.nextIdx < S.road.boxes.length &&
         dist > S.road.boxes[S.road.nextIdx].sumKm + 0.08) {
    S.road.nextIdx++;
  }

  const boxes = S.road.boxes;
  const ni = S.road.nextIdx;

  if (ni >= boxes.length) {
    el('nav-dir-next').textContent = 'FINISH LEG'; el('nav-dist-next').textContent = '—';
    el('nav-comment-next').textContent = ''; el('nav-boxnum-next').textContent = '';
    el('nav-after-text').textContent = '—'; return;
  }

  const next = boxes[ni];
  const distToNext = Math.max(0, next.sumKm - dist);
  const arrow  = DIR_ARROW[next.dir]  || next.dir  || '?';
  const fArrow = DIR_ARROW[next.flag] || '';

  el('nav-dist-next').textContent    = distToNext < 0.1 ?
    `${Math.round(distToNext * 1000)} m` : `${distToNext.toFixed(2)} km`;
  el('nav-dir-next').textContent     = arrow + (fArrow ? ' ' + fArrow : '');
  el('nav-comment-next').textContent = next.comment || '';
  el('nav-boxnum-next').textContent  = `Box ${next.num}`;

  if (ni + 1 < boxes.length) {
    const af = boxes[ni + 1];
    el('nav-after-text').textContent =
      `Box ${af.num} · ${af.sectionKm != null ? af.sectionKm.toFixed(2) + ' km' : '?'} · ${DIR_ARROW[af.dir]||af.dir||'?'}` +
      (af.flag ? ' '+DIR_ARROW[af.flag] : '') + (af.comment ? ' · '+af.comment : '');
  } else {
    el('nav-after-text').textContent = '— finish leg —';
  }

  // Voice announcements
  const key = `${next.num}_${Math.round(next.sumKm * 100)}`;
  const voice = DIR_VOICE[next.dir] || next.dir || 'manevra';
  const flag  = next.flag;

  if (distToNext <= 0.35 && !S.road.announced[key + 'w']) {
    S.road.announced[key + 'w'] = true;
    const m = Math.round(distToNext * 1000);
    let txt = `Pregătire — ${voice} în ${m} metri`;
    if (flag === 'TC')   txt = `Time Control în ${m} metri — pregătește time card`;
    else if (flag === 'RT_START_AUTO' || flag === 'RT_START_STANDING')
      txt = `Start RT în ${m} metri`;
    else if (flag === 'RT_FINISH') txt = `Finish RT în ${m} metri`;
    else if (flag === 'STOP-CFR')  txt = `ATENȚIE — cale ferată în ${m} metri — vei opri`;
    speak(txt);
  } else if (distToNext <= 0.08 && !S.road.announced[key + 'n']) {
    S.road.announced[key + 'n'] = true;
    let txt = voice;
    if (flag === 'TC')   txt = 'Time Control — oprește și ștampilează';
    else if (flag === 'RT_START_STANDING') txt = 'START RT — standing start';
    else if (flag === 'RT_START_AUTO')     txt = 'START RT';
    else if (flag === 'RT_FINISH')         txt = 'FINISH RT';
    else if (flag === 'STOP-CFR')          txt = 'STOP — cale ferată';
    speak(txt);
  }
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

  // Road Nav
  el('btn-nav-scan').addEventListener('click', navScan);
  el('btn-nav-clear').addEventListener('click', navClear);
  el('btn-nav-start').addEventListener('click', navStart);
  el('btn-nav-stop').addEventListener('click', navStop);
  navUpdateList();

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
