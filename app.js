'use strict';

// ══════════════════════════════════════════════════════════════
//  BUILD + DIAGNOSTIC GLOBAL DE ERORI
//  Orice eroare JS necapturată e afișată pe ecran (cu numărul versiunii),
//  ca să putem diagnostica pe telefon fără consolă de developer.
// ══════════════════════════════════════════════════════════════
const BUILD = 'v19';
function showFatal(msg) {
  let b = document.getElementById('fatal-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'fatal-banner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'background:#ff3b30;color:#fff;font:12px/1.4 sans-serif;padding:8px 40px 8px 8px;' +
      'white-space:pre-wrap;word-break:break-word;';
    // Se poate ÎNCHIDE: o eroare benignă acoperea headerul permanent, peste tot ecranul util.
    const x = document.createElement('button');
    x.textContent = '✕';
    x.style.cssText = 'position:absolute;top:4px;right:6px;background:none;border:0;' +
      'color:#fff;font-size:18px;padding:4px 8px;';
    x.addEventListener('click', () => b.remove());
    b.appendChild(x);
    (document.body || document.documentElement).appendChild(b);
  }
  const t = document.createElement('span');
  t.textContent = 'BUILD ' + BUILD + ' • EROARE: ' + msg;
  b.replaceChildren(b.firstChild, t);   // păstrează ✕, înlocuiește textul
}
window.addEventListener('error', e =>
  showFatal((e.message || 'eroare') + '  @' + String(e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e =>
  showFatal('promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

// ══════════════════════════════════════════════════════════════
//  MIGRARE DE ETAPĂ — Reșița → Sibiu
// ══════════════════════════════════════════════════════════════
// Codul nou nu e destul: telefonul are deja salvate în localStorage presetările RT,
// penalizările și roadbook-ul de la Reșița. Rulează O SINGURĂ DATĂ, înainte de `S`,
// pentru că `S` își citește valorile din localStorage chiar la construire.
// Ce NU se șterge: `rali_distcorr` (calibrarea GPS↔odometru e a mașinii, nu a etapei),
// cheia API, tema și modelul.
(function migrareEtapa() {
  const ETAPA = 'sibiu-2026';
  try {
    if (localStorage.getItem('rali_etapa') === ETAPA) return;
    ['rali_presets', 'rali_pen', 'rali_road', 'rali_road_leg',
     'rali_rt_session', 'rali_nav_session'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('rali_etapa', ETAPA);
  } catch (e) { /* localStorage blocat — mergem mai departe cu ce e în cod */ }
})();

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
const S = {
  gps: { watchId: null, speed: 0, accuracy: null, altitude: null, heading: null, lat: null, lng: null },
  chrono: { running: false, startMs: null, accumulated: 0, raf: null },
  rt: {
    active: false, finishing: false, targetSpd: 40, totalDist: 2.0, type: 'auto',
    startMs: null, distKm: 0, lastPos: null, tickId: null,
    segments: [{ from: 0, speed: 40 }], distFactor: 1, voiceThresh: 3, segAnnounced: {}
  },
  road: {
    // `all` = tot ce s-a scanat, din toate leg-urile. `boxes` = doar leg-ul selectat,
    // sortat pe km — restul modulului NAV navighează un singur leg, monoton crescător.
    // Gardurile de tip (Array.isArray / typeof) nu sunt paranoia: o valoare de alt tip
    // trece de JSON.parse fără excepție, apoi aruncă abia în bindUI (ex. presets.forEach),
    // iar bindUI oprit la jumătate lasă aplicația fără butoane — inclusiv fără Import,
    // deci fără cale de reparare din interior.
    all: (() => { try { const v = JSON.parse(ls('rali_road') || '[]'); return Array.isArray(v) ? v : []; } catch(e) { return []; } })(),
    leg: ls('rali_road_leg') || null,   // cheia leg-ului activ (vezi navLegKey), null = neales
    boxes: [],
    active: false, legDistKm: 0, lastPos: null,
    nextIdx: 0, tickId: null, announced: {}
  },
  presets: (() => { try { const v = JSON.parse(ls('rali_presets') || 'null'); return Array.isArray(v) ? v : DEFAULT_PRESETS(); } catch(e) { return DEFAULT_PRESETS(); } })(),
  tc: { targetMs: null, tickId: null, announced: {} },
  pen: (() => { try { const v = JSON.parse(ls('rali_pen') || '{}'); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; } catch(e) { return {}; } })(),
  voice: { rtLastMs: 0, paceOut: false },
  rec: { obj: null, listening: false, cancelled: false },
  chat: { busy: false },
  cfg: {
    apiKey: ls('rali_key') || '',
    model:  ls('rali_model') || 'claude-haiku-4-5-20251001',
    theme:  ls('rali_theme') || 'dark'
  }
};

// Gol intenționat. Presetările de dinainte erau RT-urile de la Reșița 2026 — viteze și
// distanțe care nu au nicio legătură cu Sibiu. Un preset greșit e mai periculos decât
// niciunul: îl apeși din reflex și cronometrezi după cifra altui raliu.
// RT-urile de la Sibiu NU sunt publicate — regulamentul particular v1 nu le conține, iar
// Anexele 6-8 (roadbook-urile, inclusiv cel de calibrare) lipsesc din PDF. Se completează
// din roadbook, la fața locului, cu „+ Preset nou".
function DEFAULT_PRESETS() {
  return [];
}

function ls(k, v) {
  if (v !== undefined) { localStorage.setItem(k, v); return v; }
  return localStorage.getItem(k);
}

// ══════════════════════════════════════════════════════════════
//  GPS
// ══════════════════════════════════════════════════════════════
function gpsInit() {
  if (!window.isSecureContext) {
    gpsDot('off');
    gpsStatus('GPS-ul cere conexiune securizată (HTTPS). Deschide aplicația printr-o adresă https://, nu http:// sau fișier local.', false);
    return;
  }
  if (!navigator.geolocation) {
    gpsDot('off');
    gpsStatus('Acest browser nu oferă geolocație.', false);
    return;
  }
  gpsDot('searching');
  // Promptul de locație e fiabil DOAR la un gest al utilizatorului (tap), nu automat
  // la încărcare — mai ales într-un PWA. Așa că pornim watch-ul automat doar dacă
  // permisiunea e deja acordată; altfel cerem un tap explicit pe „Activează GPS".
  const q = navigator.permissions?.query?.({ name: 'geolocation' });
  if (!q) {
    // Permissions API indisponibil: încercăm direct, dar lăsăm și butonul ca plasă de siguranță
    gpsStatus('Dacă vitezometrul rămâne pe 0, apasă „Activează GPS" și permite locația.', true);
    startWatch();
    return;
  }
  q.then(p => {
    const handle = () => {
      if (p.state === 'granted') {
        gpsStatus('📡 Caut semnal GPS… (sub cer liber)', false);
        startWatch();
      } else if (p.state === 'denied') {
        gpsDot('off');
        gpsStatus('Permisiunea de locație e refuzată. Apasă 🔒 lângă adresă → Locație → Permite, apoi butonul de mai jos.', true, true);
      } else {
        gpsStatus('Apasă „Activează GPS" și permite locația ca să pornești vitezometrul.', true);
      }
    };
    handle();
    p.onchange = handle; // dacă acorzi permisiunea din setări, pornește singur
  }).catch(() => { gpsStatus('Apasă „Activează GPS" pentru a porni locația.', true); });
}

function startWatch() {
  if (S.gps.watchId != null) navigator.geolocation.clearWatch(S.gps.watchId);
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
  S.gps.lastFixMs = Date.now();   // watchdog-ul de mai jos se uită la vârsta asta
  if (S.gps.lostWarned) { S.gps.lostWarned = false; if (S.rt.active || S.road.active) speak('GPS revenit.', 2); }
  gpsDot('active');
  gpsStatus(null);
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

function gpsErr(e) {
  console.warn('GPS:', e.code, e.message);
  if (e.code === 3) {
    // TIMEOUT — semnal slab, dar watch-ul rămâne activ; rămânem în „căutare"
    gpsDot('searching');
    gpsStatus('Semnal GPS slab — caut fix… (sub cer liber, nu sub copertină)', false);
    return;
  }
  gpsDot('off');
  if (e.code === 1) {
    gpsStatus('Permisiunea de locație e refuzată. Apasă 🔒 lângă adresă → Locație → Permite, apoi butonul de mai jos.', true, true);
  } else if (e.code === 2) {
    gpsStatus('Poziție indisponibilă. Verifică dacă locația e pornită pe telefon (GPS / „Locație" în setări).', true, true);
  } else {
    gpsStatus('Eroare GPS: ' + e.message, true, true);
  }
}

// Afișează/ascunde caseta de status GPS. msg=null => ascunde.
// isError=true colorează chenarul roșu (eroare); altfel e neutru (info/căutare).
function gpsStatus(msg, showRetry, isError) {
  const box = document.getElementById('gps-status');
  if (!box) return;
  if (!msg) { box.classList.add('hidden'); return; }
  document.getElementById('gps-status-txt').textContent = msg;
  document.getElementById('btn-gps-retry').style.display = showRetry ? '' : 'none';
  box.classList.toggle('err', !!isError);
  box.classList.remove('hidden');
}

// Reîncearcă: getCurrentPosition declanșează promptul de permisiune dacă e în „prompt"
function gpsRetry() {
  gpsDot('searching');
  gpsStatus('Caut semnal…', false);
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => { gpsOk(pos); startWatch(); },
    gpsErr,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function gpsDot(s) {
  const d = document.getElementById('gps-dot');
  d.className = 'gps-dot' + (s === 'active' ? ' active' : s === 'searching' ? ' searching' : '');
}

// Watchdog: odată primit primul fix, NIMIC nu semnala oprirea fluxului — bulina rămânea
// verde pentru totdeauna, viteza înghețată, RT-ul numărând timp cu odometrul mort.
// Tipic după foto la un TC: camera Android suspendă PWA-ul și watchPosition amuțește.
// Peste 3 s fără fix → bulină de căutare; peste 8 s → anunț vocal (o dată) + repornirea
// watch-ului; gpsOk readuce totul la normal la primul fix.
function gpsWatchdogTick() {
  if (S.gps.watchId == null || !S.gps.lastFixMs) return;
  const age = Date.now() - S.gps.lastFixMs;
  if (age < 3000) return;
  gpsDot('searching');
  if (age < 8000) return;
  if (!S.gps.lostWarned) {
    S.gps.lostWarned = true;
    if (S.rt.active || S.road.active) speak('Atenție, GPS pierdut.', 2);
    gpsStatus('GPS pierdut — repornesc căutarea…', false, true);
  }
  if (!S.gps.lastRestartMs || Date.now() - S.gps.lastRestartMs > 8000) {
    S.gps.lastRestartMs = Date.now();
    try { navigator.geolocation.clearWatch(S.gps.watchId); } catch (e) {}
    startWatch();
  }
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

// Durată cu unitate corectă: "3:00 min" peste un minut, "45 sec" sub
function fmtSecU(s) {
  return Math.abs(s) >= 60 ? `${fmtSec(s)} min` : `${fmtSec(s)} sec`;
}

// ══════════════════════════════════════════════════════════════
//  RT — SETUP (model pe segmente de medie)
// ══════════════════════════════════════════════════════════════
// Un RT e o listă de segmente { from: km_start, speed: km/h }, primul de la 0.
// Vechiul model (o viteză, eventual o schimbare la mijloc) e doar cazul cu 1-2 segmente.

// Citește segmentele din UI: viteza de bază (rt-spd) + rândurile de schimbări (#rt-segs).
function rtReadSegments() {
  // Math.max(1, …): o viteză 0/negativă/goală ar da timp ideal 0/negativ (deviere coruptă).
  const base = Math.max(1, parseFloat(el('rt-spd').value) || 40);
  const segs = [{ from: 0, speed: base }];
  el('rt-segs').querySelectorAll('.seg-row').forEach(row => {
    const km = parseFloat(row.querySelector('.seg-km').value);
    const sp = parseFloat(row.querySelector('.seg-spd').value);
    if (km > 0 && sp > 0) segs.push({ from: km, speed: sp });
  });
  segs.sort((a, b) => a.from - b.from);
  return segs;
}

// Timp ideal (secunde) pentru a parcurge `dist` km pe segmentele date.
function segIdealTime(dist, segs) {
  let t = 0;
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].from;
    const to = (i + 1 < segs.length) ? segs[i + 1].from : Infinity;
    if (dist <= from) break;
    t += (Math.min(dist, to) - from) * 3600 / segs[i].speed;
  }
  return t;
}

// Viteza țintă activă la distanța `dist`.
function segPhaseSpeed(dist, segs) {
  let s = segs[0].speed;
  for (const seg of segs) if (dist >= seg.from - 1e-9) s = seg.speed;
  return s;
}

// Adaugă un rând de schimbare de medie în editor.
function rtAddSegRow(km, spd) {
  const row = document.createElement('div');
  row.className = 'seg-row';
  row.innerHTML =
    '<input type="number" class="seg-km"  placeholder="la km" min="0.01" step="0.01" inputmode="decimal">' +
    '<input type="number" class="seg-spd" placeholder="km/h"  min="1"    step="0.1"  inputmode="decimal">' +
    '<button class="btn btn-danger btn-sm seg-del" type="button">✕</button>';
  if (km  != null) row.querySelector('.seg-km').value  = km;
  if (spd != null) row.querySelector('.seg-spd').value = spd;
  row.querySelector('.seg-km').addEventListener('input', rtPreview);
  row.querySelector('.seg-spd').addEventListener('input', rtPreview);
  row.querySelector('.seg-del').addEventListener('click', () => { row.remove(); rtPreview(); });
  el('rt-segs').appendChild(row);
  rtPreview();
}

// Calibrare odometru: din ce-a arătat app-ul vs distanța reală a secțiunii etalon.
function rtCalibrate() {
  const measured = parseFloat(String(prompt('Câți km a ARĂTAT aplicația pe secțiunea de probă?')).replace(',', '.'));
  if (!measured || measured <= 0) return;
  const real = parseFloat(String(prompt('Câți km are REAL secțiunea (din roadbook)?')).replace(',', '.'));
  if (!real || real <= 0) return;
  // COMPUNE cu factorul activ, nu-l ignora: cifra „arătată" include deja corecția
  // curentă. Formula veche (real/measured-1) o anula parțial — cu +2% activ și un raport
  // care cerea +4%, scria +1,96%. Aceeași formulă ca la auto-calibrare (rtOfferCalibration).
  const curFactor = parseFloat(ls('rali_distcorr') || '0') / 100 + 1;
  let corr = (curFactor * (real / measured) - 1) * 100;
  corr = Math.max(-15, Math.min(15, corr));
  el('rt-distcorr').value = corr.toFixed(1);
  ls('rali_distcorr', corr.toFixed(1));
  alert(`Corecție distanță setată: ${corr >= 0 ? '+' : ''}${corr.toFixed(1)}%`);
}

function rtPreview() {
  const dst  = parseFloat(el('rt-dst').value) || 2;
  const segs = rtReadSegments();
  const total = segIdealTime(dst, segs);
  const half  = segIdealTime(dst / 2, segs);
  let html = `Timp ideal total: <strong>${fmtSecU(total)}</strong>&nbsp;&nbsp;La 50%: ${fmtSecU(half)}`;
  if (segs.length > 1) {
    html += '<br>' + segs.slice(1).map(s => `↻ ${s.from.toFixed(2)} km → ${s.speed} km/h`).join(' &nbsp;·&nbsp; ');
  }
  el('rt-preview').innerHTML = html;
  const tbl = el('rt-table');
  if (tbl && !tbl.classList.contains('hidden')) rtRenderTable(); // ține tabelul sincron
}

function rtStart() {
  S.rt.totalDist = parseFloat(el('rt-dst').value) || 2;
  S.rt.type      = document.querySelector('input[name="rt-type"]:checked')?.value || S.rt.type || 'auto';
  S.rt.segments  = rtReadSegments();
  S.rt.targetSpd = S.rt.segments[0].speed;
  S.rt.distFactor = 1 + ((parseFloat(el('rt-distcorr').value) || 0) / 100);
  ls('rali_distcorr', String(parseFloat(el('rt-distcorr').value) || 0));
  S.rt.voiceThresh = Math.max(1, parseFloat(el('rt-voicethr').value) || 3);
  ls('rali_voicethr', String(S.rt.voiceThresh));
  S.rt.segAnnounced = {};
  S.rt.startMs   = Date.now();          // pentru reluarea după crash (ceas de perete)
  S.rt.startPerf = performance.now();   // pentru afișaj: imun la corecțiile NTP ale ceasului
  S.rt.distKm    = 0;
  S.rt.lastPos   = S.gps.lat ? { lat: S.gps.lat, lng: S.gps.lng } : null;
  // lastT = acum, nu null: cu null, primul fix după START adăuga 0 — la auto-start cu
  // 40 km/h se pierdeau ~11 m ≈ 1 s de timp ideal, mereu în direcția „în urmă".
  S.rt.lastT     = S.rt.lastPos ? Date.now() : null;
  S.rt.active    = true;
  S.rt.finishing = false;
  S.rt.finalDevS = null; S.rt.lastDevS = null;
  S.rt.estMode = false; S.rt.accWarned = false;
  S.rt.zoneVoiced = false;
  S.rt.runName = S.rt.pendingName || null;    // numele presetului aplicat → rândul din tracker
  el('rt-finish-warn')?.classList.add('hidden');
  el('rt-result')?.classList.add('hidden');   // rezultatul vechi jos — începe proba nouă

  el('rt-setup').classList.add('hidden');
  el('rt-live').classList.remove('hidden');
  el('rt-badge').classList.remove('hidden');
  el('s-phase-row').classList.toggle('hidden', S.rt.segments.length <= 1);

  S.rt.tickId = setInterval(rtRender, 250);
  S.voice.rtLastMs = 0; S.voice.paceOut = false;
  const startType = S.rt.type === 'standing' ? 'standing start' : 'start';
  const nChg = S.rt.segments.length - 1;
  const chgTxt = nChg > 0 ? `, cu ${nChg} ${nChg === 1 ? 'schimbare' : 'schimbări'} de medie` : '';
  speak(`RT pornit — ${S.rt.targetSpd} km pe oră — ${startType}${chgTxt}`, 1);
  vibrate([30]);
  rtPersistSession(true);
}

// auto=true => oprire automată la finish (nu propune calibrare, distanța ≈ oficialul).
// ── Start armat: rtStart se declanșează EXACT la minutul fix al ceasului oficial ──
// La standing start, cronometrul pornit „la reacția degetului" pierde zecimi care sunt
// puncte. Armat, pornirea e a ceasului, nu a reflexului. Folosește offsetul oficial-telefon
// din UTILE (tc-clockoff). A doua apăsare anulează.
let _rtArmT = null, _rtArmTick = null;
function rtArmToggle() {
  const btn = el('btn-rt-arm');
  if (_rtArmT) {
    clearTimeout(_rtArmT); clearInterval(_rtArmTick);
    _rtArmT = null;
    btn.textContent = '⏱ Armează startul la minutul fix';
    speak('Armare anulată.', 1);
    return;
  }
  const offMs = (parseFloat(el('tc-clockoff')?.value) || 0) * 1000;   // oficial − telefon
  const officialNow = Date.now() + offMs;
  let wait = 60000 - (officialNow % 60000);
  if (wait < 3000) wait += 60000;            // sub 3 s nu mai armezi în minutul ăsta
  const fireAt = Date.now() + wait;
  const said = {};
  _rtArmT = setTimeout(() => {
    clearInterval(_rtArmTick); _rtArmT = null;
    btn.textContent = '⏱ Armează startul la minutul fix';
    rtStart();
    vibrate([200, 80, 200]);
  }, wait);
  const upd = () => {
    const remS = Math.ceil((fireAt - Date.now()) / 1000);
    btn.textContent = `⏱ ARMAT — start în ${remS} s (apasă pentru anulare)`;
    if (remS <= 3 && remS >= 1 && !said[remS]) { said[remS] = true; speak(String(remS), 3); }
  };
  upd();
  _rtArmTick = setInterval(upd, 200);
  speak(`Armat. Start peste ${Math.round(wait / 1000)} secunde, la minutul fix.`, 2);
}

// Corecție manuală de distanță în timpul probei — distanța decide penalizarea.
function rtOffset(deltaM) {
  if (!S.rt.active) return;
  S.rt.distKm = Math.max(0, S.rt.distKm + deltaM / 1000);
  vibrate([20]);
  rtRender();
}

function rtStop(auto) {
  const measured = S.rt.distKm;
  const official = S.rt.totalDist;
  const wasActive = S.rt.active;
  // STOP manual în timpul unei probe orchestrate: curăță starea de cursă,
  // altfel cockpitul rămânea pe deviere și proba se relua singură.
  if (S.road.raceRunning) {
    S.road.raceRunning = false;
    S.road.raceIdx++;
    el('race-rt')?.classList.add('hidden');
  }
  // Rezultatul rămâne pe ecran după STOP — cifra de trecut în tracker nu mai dispare.
  const finalDev = S.rt.finalDevS != null ? S.rt.finalDevS : S.rt.lastDevS;
  if (wasActive && finalDev != null) {
    const a = Math.abs(finalDev);
    const pts = Math.round(a * 10) / 10;
    // Scrierea automată în tracker — până acum cifra trebuia reținută din mers și
    // retastată în UTILE. Numele vine din presetul aplicat; fără preset, doar pe ecran.
    let trackTxt = '';
    if (S.rt.runName) {
      S.pen[S.rt.runName] = pts;
      ls('rali_pen', JSON.stringify(S.pen));
      try { renderPenalties(); } catch (e) {}
      trackTxt = ` · scris în tracker la ${S.rt.runName}`;
    }
    const res = el('rt-result');
    if (res) {
      res.textContent = `Ultimul RT: deviere ${finalDev >= 0 ? '+' : '−'}${a.toFixed(1)} s ` +
        `(${finalDev >= 0 ? 'în urmă' : 'în avans'}) ≈ ${pts.toFixed(1)} puncte · ` +
        `${measured.toFixed(2)} km măsurați${trackTxt}`;
      res.classList.remove('hidden');
    }
  }
  S.rt.finalDevS = null; S.rt.lastDevS = null;
  S.rt.active = false; S.rt.finishing = false;
  clearInterval(S.rt.tickId);
  rtClearSession();
  voiceFlush();
  el('rt-live').classList.add('hidden');
  el('rt-setup').classList.remove('hidden');
  el('rt-badge').classList.add('hidden');
  vibrate([50, 50, 50]);
  // Auto-calibrare: la STOP manual, compară ce-a măsurat app-ul cu distanța oficială.
  if (!auto && wasActive && measured > 0.1 && official > 0.1) rtOfferCalibration(measured, official);
}

// Propune un nou factor de corecție din discrepanța măsurat vs oficial la finalul RT.
function rtOfferCalibration(measured, official) {
  // Doar când proba a fost parcursă efectiv (90-110% din oficial). Un STOP apăsat din
  // reflex la 1,2 km din 5,7 producea o „corecție" de +375%, clamp-ată la +15% — care
  // arăta plauzibil în confirm() și, acceptată din reflex la volan, strica măsurarea
  // tuturor RT-urilor rămase din zi.
  const ratio = measured / official;
  if (ratio < 0.9 || ratio > 1.1) return;
  const err = (official / measured - 1) * 100;
  if (Math.abs(err) < 0.8) return; // sub prag — nu deranjăm
  const curFactor = S.rt.distFactor || 1;         // măsuratul include deja acest factor
  let newCorr = (curFactor * (official / measured) - 1) * 100;
  newCorr = Math.max(-15, Math.min(15, newCorr)); // clamp ca în câmpul UI
  if (confirm(`RT terminat.\nApp-ul a măsurat ${measured.toFixed(3)} km, oficial ${official.toFixed(3)} km (${err>=0?'+':''}${err.toFixed(1)}%).\n\nActualizezi corecția de distanță la ${newCorr>=0?'+':''}${newCorr.toFixed(1)}% pentru RT-urile următoare?`)) {
    el('rt-distcorr').value = newCorr.toFixed(1);
    ls('rali_distcorr', newCorr.toFixed(1));
  }
}

// ══════════════════════════════════════════════════════════════
//  RT / NAV — GPS DISTANCE (hibrid: viteză GPS + haversine fallback)
// ══════════════════════════════════════════════════════════════
// Distanța incrementală (km) dintre două fix-uri, cu:
//  • integrarea vitezei GPS (c.speed × dt) când viteza e disponibilă — stabilă la mers,
//    fără driftul de zgomot al integrării poziție-cu-poziție;
//  • haversine ca rezervă când viteza lipsește (cu plafon de sanity < 0.5 km);
//  • gardă de jitter: ignoră mișcarea când ești practic oprit (viteză < 2 km/h) sau
//    când saltul de poziție e sub ~4 m fără viteză validă (tremur GPS staționar).
// `state` are { lastPos, lastT }. Actualizează starea și întoarce km-ul de adăugat.
function gpsDistKm(state, pos, accBad) {
  const c = pos.coords;
  const cur = { lat: c.latitude, lng: c.longitude };
  const t = pos.timestamp;
  let inc = 0;
  const spd = c.speed;                                          // m/s sau null
  const spdOk = spd != null && isFinite(spd) && spd >= 0;
  if (state.lastPos && state.lastT != null) {
    const dt = (t - state.lastT) / 1000;                        // secunde
    const hav = haversine(state.lastPos.lat, state.lastPos.lng, cur.lat, cur.lng); // km
    const spdKmh = spdOk ? spd * 3.6 : null;
    // Staționar doar când sursele disponibile sunt DE ACORD. Viteza singură e des
    // subraportată (0 km/h în plin mers, imediat după recâștigarea fixului); haversine
    // o dă de gol. Înainte, dezacordul se rezolva în favoarea vitezei = distanță pierdută.
    const stationary = spdOk ? (spdKmh < 2 && hav < 0.004) : (hav < 0.004);
    // dt până la 30 s (era 10): o pauză de fix mai lungă se acoperă cu ultima viteză
    // validă, altfel distanța din gaură dispărea definitiv din odometru.
    if (!stationary && dt > 0 && dt < 30) {
      if (spdOk)                       inc = (spd * dt) / 1000;            // Doppler — bun și cu acc slabă
      else if (!accBad && hav < 0.5)   inc = hav;                          // haversine doar cu poziție bună
      else if (state.lastSpdMs != null) inc = (state.lastSpdMs * dt) / 1000; // gol total: ultima viteză validă
      // Viteza zice „stau", poziția zice „m-am mișcat serios" → crede poziția (plauzibilă
      // pentru dt), altfel fiecare recâștigare de fix mănâncă metri reali.
      if (spdOk && !accBad && hav < 0.5 && hav > inc * 2 + 0.01) inc = hav;
    }
  }
  state.lastPos = cur;
  state.lastT = t;
  if (spdOk) state.lastSpdMs = spd;
  return inc;
}

function rtGpsTick(pos) {
  if (!S.rt.active) return;
  const acc = pos.coords.accuracy;
  const accBad = !!(acc && acc > 60);
  // Precizia slabă NU mai oprește odometrul. Înainte: `return` — distanța îngheța, dar
  // cronometrul curgea, devierea urca cu 1 s/secundă, iar vocea comanda „mai repede"
  // pentru o întârziere inexistentă; după 10 s de pauză eroarea devenea permanentă.
  // Viteza Doppler rămâne utilizabilă și când poziția e împrăștiată — doar haversine
  // se taie (în gpsDistKm), nu toată măsurarea.
  S.rt.distKm += gpsDistKm(S.rt, pos, accBad) * (S.rt.distFactor || 1); // + calibrare
  if (accBad && !S.rt.accWarned) {
    S.rt.accWarned = true;
    speak('GPS slab. Țin distanța din viteză — condu constant.', 2);
  } else if (!accBad) S.rt.accWarned = false;
  S.rt.estMode = accBad;   // rtRender marchează distanța ca estimată
}

// ══════════════════════════════════════════════════════════════
//  RT — RENDER
// ══════════════════════════════════════════════════════════════
function rtRender() {
  if (!S.rt.active) return;

  const segs     = S.rt.segments;
  // performance.now când există (monoton — o corecție NTP a ceasului în timpul probei
  // nu mută devierea); Date.now doar ca rezervă după o reluare veche.
  const elapsedS = S.rt.startPerf != null
    ? (performance.now() - S.rt.startPerf) / 1000
    : (Date.now() - S.rt.startMs) / 1000;
  const dist     = S.rt.distKm;
  const total    = S.rt.totalDist;

  const idealS   = segIdealTime(dist, segs);             // timp ideal pt dist parcursă
  const devS     = elapsedS - idealS;                    // + = în urmă, - = în avans
  const remaining = Math.max(0, total - dist);
  const pct      = Math.min(100, (dist / total) * 100);
  const phaseSpd = segPhaseSpeed(dist, segs);            // viteza țintă acum

  // Viteza de recuperare pe fereastră SCURTĂ (500 m), plafonată la ±30% din viteza fazei.
  // Întinsă pe tot restul probei era greșită de două ori: presupunea că nu există puncte
  // de cronometrare ascunse pe traseu, și producea cifre absurde spre final.
  let reqSpd = null, recWinM = 0;
  if (remaining > 0.001 && phaseSpd > 0) {
    const w = Math.min(0.5, remaining);                 // km
    recWinM = Math.round(w * 1000);
    const idealW = (w / phaseSpd) * 3600;               // s la viteza fazei
    const tAvail = idealW - devS;                       // + în urmă → timp mai puțin
    reqSpd = tAvail > 1 ? (w * 3600) / tAvail : phaseSpd * 1.3;
    reqSpd = Math.max(phaseSpd * 0.7, Math.min(phaseSpd * 1.3, reqSpd));
  }

  // Voice: anunță fiecare schimbare de medie la trecerea pragului ei
  for (let i = 1; i < segs.length; i++) {
    if (!S.rt.segAnnounced[i] && dist >= segs[i].from - 0.05) {
      S.rt.segAnnounced[i] = true;
      speak(`Viteză ${segs[i].speed}`, 3, 'seg');
      vibrate([60, 40, 60]);
    }
  }

  // Deviation display — după linia de finiș calculată, cifra afișată e cea ÎNGHEȚATĂ
  // la linie (rezultatul probei), nu una care crește cât aștepți să treci tabela.
  const frozen = S.rt.finishing && S.rt.finalDevS != null;
  const shownDev = frozen ? S.rt.finalDevS : devS;
  const absD = Math.abs(shownDev);
  const sign = shownDev >= 0 ? '+' : '−';
  const arrow = shownDev >= 0 ? '▲' : '▼';   // ▲ = în urmă (mai repede), ▼ = în avans (mai lent)
  el('dev-num').textContent = sign + absD.toFixed(1);
  el('dev-lbl').textContent = frozen ? 'FINISH — nu opri lângă tabelă · STOP după ea'
    : (shownDev >= 0 ? `${arrow} secunde în urmă` : `${arrow} secunde în avans`);

  const cls = absD <= 5 ? 'ok' : absD <= 15 ? 'warn' : 'bad';
  el('dev-num').className = `dev-num ${cls}`;
  el('dev-box').className = `dev-box ${cls}`;

  // Cockpitul de pe ecranul de navigare (proba orchestrată): aceleași cifre, acolo
  // unde se uită deja — fără comutat taburi în mers.
  if (S.road.raceRunning) {
    const rd = el('race-dev');
    if (rd) {
      rd.textContent = sign + absD.toFixed(1);
      rd.className = 'rdev ' + cls;
      el('race-dev-lbl').textContent = frozen ? 'FINISH — NU OPRI LÂNGĂ TABELĂ'
        : (shownDev >= 0 ? 'SECUNDE ÎN URMĂ' : 'SECUNDE ÎN AVANS');
      el('race-spd').textContent = `${Math.round(S.gps.speed || 0)} / ${Math.round(phaseSpd)}`;
    }
  }

  // Alert vibrations at thresholds (gate: max 1x per second window)
  if (!frozen && absD > 15 && Math.floor(elapsedS) % 10 === 0 && (elapsedS % 10) < 0.3) vibrate([100]);

  // Stats
  el('s-elapsed').textContent  = fmtSec(elapsedS) + ' s';
  el('s-ideal').textContent    = fmtSec(idealS) + ' s';
  // „≈" = GPS slab, distanța vine din integrarea vitezei, nu din poziții — de știut
  // când citești cifra, nu de panicat.
  el('s-dist').textContent     = (S.rt.estMode ? '≈' : '') + dist.toFixed(3) + ' km';
  el('s-rem').textContent      = remaining.toFixed(3) + ' km';
  if (segs.length > 1) el('s-phase').textContent = phaseSpd.toFixed(1) + ' km/h';

  if (remaining < 0.01) {
    el('s-reqspd').textContent = 'FINISH';
    el('s-reqspd').style.color = 'var(--green)';
  } else if (reqSpd === null) {
    el('s-reqspd').textContent = '—';
    el('s-reqspd').style.color = '';
  } else {
    el('s-reqspd').textContent = `${reqSpd.toFixed(1)} km/h · ${recWinM} m`;
    el('s-reqspd').style.color = '';
  }

  // ACUM · ȚINTĂ — cifrele mari de sub deviere. Colorare pe diferență: roșu = prea
  // repede (greșeala de la Reșița), galben = prea lent, verde = în fereastră.
  const nowSpd = S.gps.speed || 0;
  el('rt-now-spd').textContent = Math.round(nowSpd);
  el('rt-tgt-spd').textContent = Math.round(phaseSpd);
  const spdRow = el('rt-spd-row');
  if (spdRow) {
    const d = nowSpd - phaseSpd;
    spdRow.className = 'rt-spd-row ' + (d > 2 ? 'over' : d < -2 ? 'under' : 'ok');
  }

  // Zona de finiș: vocal la 300 m (o dată), banda clipitoare sub 200 m — și cât timp
  // devierea e înghețată după linia calculată (fizic încă poți fi ÎNAINTE de tabelă).
  if (!frozen && !S.rt.zoneVoiced && remaining <= 0.3 && remaining > 0.001) {
    S.rt.zoneVoiced = true;
    speak('Zona de finiș în 300 de metri. Nu opri până după tabela roșie.', 3);
  }
  el('rt-finish-warn')?.classList.toggle('hidden', !(frozen || (remaining <= 0.2 && remaining > 0.001)));

  el('prog-fill').style.width  = pct + '%';
  el('prog-pct').textContent   = Math.round(pct) + '%';

  // Voce de pace: anunță la trecerea pragului (imediat), apoi repetă la ~8s cât ești
  // în afara pragului; când revii sub prag, confirmă „în pace". Pragul e reglabil.
  const nowMs = Date.now();
  const thr = S.rt.voiceThresh || 3;
  if (elapsedS > 5 && !frozen) {           // după finiș nu mai comandăm corecții de ritm
    if (absD > thr) {
      const justCrossed = !S.voice.paceOut;
      if (justCrossed || nowMs - S.voice.rtLastMs > 8000) {
        const dir = devS > 0 ? 'în urmă' : 'în avans';
        const action = devS > 0
          ? (absD > 15 ? 'mult mai repede' : absD > 7 ? 'mai repede' : 'ușor mai repede')
          : (absD > 15 ? 'mult mai lent'   : absD > 7 ? 'mai lent'   : 'ușor mai lent');
        // SCURT: „3 virgulă 4 în urmă, ține 32" — jumătate din lungimea veche.
        // cat 'pace': devierea nouă o înlocuiește pe cea neconsumată din coadă —
        // o deviere rostită târziu e o deviere falsă.
        const spdStr = reqSpd ? `, ține ${Math.round(reqSpd)}` : '';
        speak(`${secundeRostite(absD)} ${dir}${spdStr}`, 3, 'pace');
        S.voice.rtLastMs = nowMs; S.voice.paceOut = true;
      }
    } else if (S.voice.paceOut) {
      S.voice.paceOut = false; S.voice.rtLastMs = nowMs;
      speak('În pace.', 1, 'pace');
    }
  }

  // Persistă sesiunea RT (throttle ~1/sec) pentru reluare după reload / OS-kill
  rtPersistSession();

  // FINISH: NU mai oprim automat. Odometrul aplicației poate atinge 100% cu sute de
  // metri înainte sau după tabela reală (drift GPS) — oprirea automată îl relaxa înainte
  // de tabelă (oprirea lângă finiș = 100 pct la Sibiu) și ascundea devierea finală în
  // 1,5 s, exact cifra de trecut în tracker. Acum: devierea îngheață la linia calculată,
  // ecranul spune ce urmează, STOP-ul rămâne manual.
  if (pct >= 100 && dist >= total - 0.01 && !S.rt.finishing) {
    S.rt.finishing = true;
    S.rt.finalDevS = devS;
    speak('Finish R T, ' + secundeRostite(Math.abs(devS)) + ' secunde ' +
          (devS >= 0 ? 'în urmă' : 'în avans') + '. Nu opri lângă tabelă. Apasă STOP după ce treci de ea.', 3);
  }
  S.rt.lastDevS = devS;   // rtStop îngheață rezultatul pe ecran din valoarea asta
}

// ══════════════════════════════════════════════════════════════
//  VISION — camera + Claude multimodal
// ══════════════════════════════════════════════════════════════
// onData: single mode → onData(b64, mime); multiple mode → onData([{b64, mime}, ...])
function openCamera(onData, multiple) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  // multiple: selecție din galerie (mai multe pagini deodată, fără capture forțat pe cameră)
  if (multiple) inp.multiple = true;
  else inp.capture = 'environment';
  inp.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
  // Curățare și când selectorul e ANULAT (onchange nu se declanșează atunci) — altfel
  // fiecare scanare anulată lasă un input orfan în pagină.
  window.addEventListener('focus', () => setTimeout(() => inp.remove(), 1000), { once: true });
  inp.onchange = () => {
    inp.remove();
    const files = Array.from(inp.files || []);
    if (!files.length) return;
    const readOne = f => new Promise(resolve => {
      const r = new FileReader();
      r.onload = () => resolve({ b64: r.result.split(',')[1], mime: f.type });
      r.readAsDataURL(f);
    });
    if (multiple) {
      Promise.all(files.map(readOne)).then(onData);
    } else {
      readOne(files[0]).then(({ b64, mime }) => onData(b64, mime));
    }
  };
  document.body.appendChild(inp);
  inp.click();
}

// POST comun către Claude, cu timeout. Fără timeout, cu semnal slab pe munte fetch-ul
// atârnă nelimitat și butonul rămâne blocat pe „Scanez...". Erorile de timeout/rețea
// primesc mesaj în română — ele ajung direct pe ecran, la volan.
async function fetchClaude(key, body, timeoutMs) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new Error('A expirat — semnal slab? Reîncearcă.');
    throw new Error('Fără conexiune — reîncearcă când ai semnal.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
  const j = await res.json();
  return j.content[0].text.trim();
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
  return fetchClaude(key, body, 90000);   // imagine pe uplink slab — 90s
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
{"speed": 40.0, "distance": 5.74, "start": "standing", "changes": [{"km": 3.06, "speed": 45.0}], "note": "RT 4"}
- speed = viteza medie impusă inițială în km/h (număr zecimal)
- distance = distanța totală RT în km (număr zecimal)
- start = "standing" (start din loc, simbol cu fulg/snowflake) sau "auto" (start din mers)
- changes = lista schimbărilor de medie pe parcurs: la ce km se schimbă și noua viteză. [] dacă viteza e constantă.
- note = identificator scurt (ex: "RT 4", "TR 1")
Dacă nu identifici un parametru cu siguranță, pune null (sau [] pentru changes).`, 300);

      // Lacom, nu non-lacom: cu `changes` nevid, primul `}` e al obiectului interior
      // și non-lacomul tăia JSON-ul la jumătate — scanarea RT-urilor cu schimbare
      // de medie eșua întotdeauna cu „Format neașteptat".
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Format neașteptat');
      const d = JSON.parse(match[0]);

      // Răspunsul modelului e conținut extern — clamp pe limitele fizice ale probei
      // (aceleași ca min/max din HTML). O viteză de 1e9 dintr-o citire greșită ar da
      // timp ideal 0 și devieri absurde, fără niciun semn vizibil de eroare.
      const clamp = (v, lo, hi) => {
        const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
        return (typeof n === 'number' && isFinite(n)) ? Math.min(hi, Math.max(lo, n)) : null;
      };
      const spdV = clamp(d.speed, 5, 120), dstV = clamp(d.distance, 0.1, 50);
      if (spdV != null) el('rt-spd').value = spdV;
      if (dstV != null) el('rt-dst').value = dstV;
      if (d.start === 'standing') document.querySelector('input[name="rt-type"][value="standing"]').checked = true;
      if (d.start === 'auto')     document.querySelector('input[name="rt-type"][value="auto"]').checked     = true;
      el('rt-segs').innerHTML = '';
      (Array.isArray(d.changes) ? d.changes : []).forEach(c => {
        if (!c) return;
        const km = clamp(c.km, 0.01, 50), sp = clamp(c.speed, 5, 120);
        if (km != null && sp != null) rtAddSegRow(km, sp);
      });
      rtPreview();

      const spd = spdV != null ? `${spdV} km/h` : '? km/h';
      const dst = dstV != null ? `${dstV} km` : '? km';
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

// ── Turn-by-turn: tiere de anunț (aproape → departe). Se alege intervalul cel mai
//    strâns pe care l-ai atins; boxurile dense sar automat tierele îndepărtate. ──
const NAV_TIERS = [
  { d: 0.035, now: true },  // ~35 m — execută manevra
  { d: 0.15 },              // 150 m
  { d: 0.30 },              // 300 m
];

// Rotunjește distanța pentru voce (sună natural: „300", nu „283").
function navRoundDist(km) {
  const m = Math.round(km * 1000);
  return m >= 100 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
}

// Distanța cu gramatică RO corectă: „300 de metri" (≥20), „10 metri" (<20).
function navDistPhrase(km) {
  const m = navRoundDist(km);
  return m + (m >= 20 ? ' de metri' : ' metri');
}

// Reperul din box (prima parte a comentariului, curățat) — ex. „biserică", „semafor".
// Scoate un „la " din față ca să nu iasă „la la biserică".
function navLandmark(box) {
  let c = (box.comment || '').split('/')[0].trim().replace(/^la\s+/i, '');
  return c.length > 42 ? c.slice(0, 42) : c;
}

// Manevra ca text vocal. `now` = varianta imperativă la momentul execuției.
function navManeuver(box, now) {
  switch (box.dir) {
    case 'ÎNAINTE':   return 'drept înainte';
    case 'STÂNGA':    return now ? 'stânga acum' : 'la stânga';
    case 'DREAPTA':   return now ? 'dreapta acum' : 'la dreapta';
    case 'STÂNGA-T':  return now ? 'stânga acum, la T' : 'la stânga, la T';
    case 'DREAPTA-T': return now ? 'dreapta acum, la T' : 'la dreapta, la T';
  }
  if (/^GIRATORIU-/.test(box.dir || ''))
    return 'sens giratoriu, ' + (dirLookup(DIR_VOICE, box.dir) || '') + (now ? ', acum' : '');
  // Fără ecou al valorii brute: ce nu e în lista închisă nu se rostește ca instrucțiune.
  // Roadbook-urile scanate înainte de validare stau încă în localStorage, nefiltrate.
  return dirLookup(DIR_VOICE, box.dir) || 'manevră';
}

// Căutare doar pe proprietăți proprii: pe un obiect literal, chei ca "constructor" sau
// "toString" ar întoarce funcții moștenite (truthy) — și ar ajunge pe ecran sau în voce.
function dirLookup(map, key) {
  return (typeof key === 'string' &&
    Object.prototype.hasOwnProperty.call(map, key)) ? map[key] : null;
}

// Textul complet turn-by-turn pentru un box. Flag-urile speciale (TC / RT / CFR / EV / P)
// au prioritate; altfel manevră + reper. `isNow` = tierul de execuție.
// SCURT. Regula, învățată la testul din Dumbrăvița (2026-08-01): la volan, fiecare
// cuvânt în plus e un cuvânt care ține coada ocupată — iar reperul din comentariu,
// citit în instrucțiune („la A doua intersecție, la dreapta"), a sunat ca un viraj
// inexistent. Reperele rămân PE ECRAN; vocea spune doar distanța și manevra.
function navTurnText(box, distKm, isNow) {
  const dp = navDistPhrase(distKm);
  switch (box.flag) {
    case 'TC': return isNow ? 'Time Control — ștampila' : `Time Control în ${dp}`;
    case 'RT_START_STANDING': return isNow ? 'Linia de start' : `Start probă în ${dp}`;
    case 'RT_START_AUTO':     return isNow ? 'START probă' : `Start probă în ${dp}`;
    case 'RT_FINISH':         return isNow ? 'FINISH' : `Finish în ${dp}`;
    case 'STOP-CFR':          return isNow ? 'STOP — cale ferată' : `Cale ferată în ${dp} — vei opri`;
    case 'EV':                return isNow ? 'Stație de încărcare' : `Încărcare în ${dp}`;
    case 'PARKING':           return isNow ? 'Parcare' : `Parcare în ${dp}`;
  }
  const man = navManeuver(box, isNow);
  return isNow ? man : `${dp} — ${man}`;
}

// Coadă de voce cu priorități: un anunț important nu mai e tăiat de unul minor.
// prio: 3 = critic (alertă RT, schimbare medie, countdown TC, finish),
//       2 = navigație (implicit), 1 = confirmări (pornit, setat, test).
// Un anunț cu prioritate strict mai mare întrerupe anunțul curent; altfel se pune la coadă.
const _voiceQ = [];
let _voiceCur = null;
let _voiceCurAtMs = 0;

function _voiceNext() {
  if (_voiceCur || !window.speechSynthesis) return;
  // TTL: un anunț care a stat la coadă prea mult nu se mai spune deloc — pe probă,
  // „300, dreapta" rostit când ești deja în viraj e mai rău decât tăcerea.
  // Prio 3 (timing) expiră mai repede decât restul.
  const now = Date.now();
  for (let i = _voiceQ.length - 1; i >= 0; i--) {
    const age = now - _voiceQ[i].t;
    if (age > (_voiceQ[i].prio >= 3 ? 3500 : 5000)) _voiceQ.splice(i, 1);
  }
  if (!_voiceQ.length) return;
  let idx = 0;
  for (let i = 1; i < _voiceQ.length; i++) if (_voiceQ[i].prio > _voiceQ[idx].prio) idx = i;
  _voiceCur = _voiceQ.splice(idx, 1)[0];
  _voiceCurAtMs = Date.now();
  const mine = _voiceCur;
  const u = new SpeechSynthesisUtterance(mine.text);
  u.lang = 'ro-RO'; u.rate = 1.1; u.volume = 1.0;
  u.onend = u.onerror = () => { if (_voiceCur === mine) { _voiceCur = null; _voiceNext(); } };
  // 60ms delay: Android Chrome drops speak() called imediat după cancel()
  setTimeout(() => { if (_voiceCur === mine) window.speechSynthesis.speak(u); }, 60);
}

// Watchdog: pe Chrome Android, onend/onerror pot să nu vină deloc după pierderea
// focusului audio (apel telefonic, comutare Bluetooth, ecran stins) — _voiceCur rămânea
// setat pentru totdeauna și vocea murea în tăcere pentru tot restul zilei. Dacă anunțul
// curent e mai vechi decât ar putea dura rostit și sinteza tace, îl aruncăm și mergem
// mai departe. resume() periodic tratează bug-ul cunoscut de „pauză spontană".
setInterval(() => {
  if (!window.speechSynthesis) return;
  if (_voiceCur) {
    const maxMs = Math.max(6000, _voiceCur.text.length * 90);
    if (Date.now() - _voiceCurAtMs > maxMs && !window.speechSynthesis.speaking) {
      _voiceCur = null;
      _voiceNext();
    }
  }
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
}, 2000);

// cat (opțional): categoria anunțului — un anunț nou din aceeași categorie ÎNLOCUIEȘTE
// predecesorul care încă așteaptă la coadă. Fără asta, pe probă se strângeau la rând
// devieri și viraje vechi, iar când le venea rândul nu mai erau adevărate.
function speak(text, prio = 2, cat = null) {
  if (!window.speechSynthesis || !text) return;
  if (cat) {
    for (let i = _voiceQ.length - 1; i >= 0; i--) if (_voiceQ[i].cat === cat) _voiceQ.splice(i, 1);
  }
  if (_voiceCur && prio > _voiceCur.prio) {   // întrerupe doar ce e mai puțin important
    _voiceCur = null;
    window.speechSynthesis.cancel();
  }
  _voiceQ.push({ text, prio, cat, t: Date.now() });
  _voiceNext();
}

function speakIfIdle(text, prio = 2) {
  if (!window.speechSynthesis) return;
  if (_voiceCur || _voiceQ.length || window.speechSynthesis.speaking) return;
  speak(text, prio);
}

// Golește coada și oprește vocea (la STOP RT / STOP navigare).
function voiceFlush() {
  _voiceQ.length = 0;
  _voiceCur = null;
  window.speechSynthesis?.cancel();
}

// ══════════════════════════════════════════════════════════════
//  ROAD NAV — scan roadbook pages + GPS navigation + voice
// ══════════════════════════════════════════════════════════════
const NAV_SCAN_PROMPT = `Ești copilot de raliu. Extrage TOATE boxurile vizibile pe această pagină de roadbook în format JSON array.

Pagina poate fi fotografiată rotit (textul pe verticală) — rotește-o mental înainte de a citi.

ANTETUL PAGINII (sus, deasupra tabelului) — citește-l ÎNTÂI și repetă-l pe fiecare box:
exemplu „Day 2 - Leg 2: Sibiu - Bâlea Lac" și „Page: 39" → "day":2, "leg":2, "page":39.
CRITIC: numerotarea boxurilor și kilometrajul REPORNESC de la fiecare leg, deci fără
day+leg boxurile din leg-uri diferite se amestecă. Dacă antetul chiar nu se vede, pune null —
NU ghici și NU reporta valorile de pe altă pagină.

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

Ignoră adnotările scrise de mână (pix albastru/roșu) și textul transparent de pe verso.

Format de returnare — DOAR JSON array valid, fără alt text:
[{"day":2,"leg":3,"page":39,"num":67,"sumKm":19.72,"sectionKm":2.31,"dir":"STÂNGA-T","comment":"Receptie Bar / DJ 582B","flag":"RT_START_AUTO"},...]

Toate boxurile de pe pagină, în ordine crescătoare a numărului.`;

// Scanează o singură imagine de roadbook, întoarce array-ul de boxuri extras.
async function navScanImage(b64, mime) {
  const raw = await callClaudeVision(b64, mime, NAV_SCAN_PROMPT, 1000, null, 'claude-sonnet-4-6');
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Format neașteptat');
  const boxes = JSON.parse(match[0]);
  if (!Array.isArray(boxes) || !boxes.length) throw new Error('Niciun box identificat');
  return navSanitizeBoxes(boxes);
}

// Validarea ieșirii din scanare — GRANIȚA DE ÎNCREDERE a modulului NAV.
// Răspunsul modelului e derivat dintr-o poză a unui document tipărit de altcineva, deci e
// conținut extern, nu date de încredere. Fără validare, două lucruri rele:
//  • un sumKm lipsă sau ca șir ("19,72") face NaN în navRender și bucla de avans îngheață
//    DEFINITIV pe boxul ăla — navigație moartă în mijlocul etapei, fără mesaj de eroare;
//  • un `dir` liber ajunge rostit cu voce tare ca instrucțiune de condus (navManeuver) —
//    text ostil din pagină ar deveni comandă falsă spusă cu autoritate șoferului.
// De aceea: numerele se convertesc sau devin null, dir/flag doar din lista închisă,
// comentariul se taie la 120, iar boxurile fără kilometraj se resping cu mesaj clar.
function navSanitizeBoxes(boxes) {
  const okNum = v => {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  };
  const okDir = v => (typeof v === 'string' &&
    Object.prototype.hasOwnProperty.call(DIR_ARROW, v)) ? v : null;
  const clean = boxes.map(b => ({
    day: okNum(b.day), leg: okNum(b.leg), page: okNum(b.page), num: okNum(b.num),
    sumKm: okNum(b.sumKm), sectionKm: okNum(b.sectionKm),
    dir: okDir(b.dir), flag: okDir(b.flag),
    comment: typeof b.comment === 'string' ? b.comment.slice(0, 120) : ''
  })).filter(b => b.sumKm !== null);   // fără km, boxul nu e navigabil — mai bine refoto
  if (!clean.length) throw new Error('Boxuri fără kilometraj — refotografiază pagina');
  return clean;
}

// ── Identitatea unui leg ────────────────────────────────────────
// Numerele de box și km-ul cumulativ repornesc la fiecare leg (măsurat pe roadbook-ul
// Reșița 2026: Leg 2 p.21 are boxurile 28–36 la 7.02–8.29 km, Leg 3 p.39 are boxurile
// 28–30 la 35.68–35.90 km, iar Leg 2 merge până la 79.72 km — deci intervalele se suprapun).
// Fără leg în cheie, boxurile din leg-uri diferite se amestecă la sortare, iar duplicatele
// de număr trec neobservate. Cheia e (zi, leg); '?' = antet necitit, grup separat.
function navLegKey(b) {
  const d = (typeof b.day === 'number') ? b.day : '?';
  const l = (typeof b.leg === 'number') ? b.leg : '?';
  return `${d}|${l}`;
}

function navLegLabel(key) {
  const [d, l] = String(key).split('|');
  if (d === '?' && l === '?') return 'fără antet';
  return (d !== '?' ? `Ziua ${d} · ` : '') + (l !== '?' ? `Leg ${l}` : 'leg necunoscut');
}

// Ordinea naturală a leg-urilor: zi, apoi leg; '?' (antet necitit) la coadă.
function navLegRank(k) {
  const [d, l] = String(k).split('|');
  return [d === '?' ? 1e6 : +d, l === '?' ? 1e6 : +l];
}
function navLegCmp(a, b) {
  const ra = navLegRank(a), rb = navLegRank(b);
  return ra[0] - rb[0] || ra[1] - rb[1];
}

// Leg-urile prezente în `all`, în ordine.
function navLegsPresent() {
  return Array.from(new Set(S.road.all.map(navLegKey))).sort(navLegCmp);
}

// Reconstruiește `boxes` = doar leg-ul activ, sortat pe km cumulativ.
// Restul modulului NAV (navRender, navStart, navBoxPassed) presupune un singur
// leg monoton crescător — aici se garantează asta.
function navRebuildBoxes() {
  const legs = navLegsPresent();
  if (!legs.length) { S.road.boxes = []; S.road.leg = null; return; }
  if (!S.road.leg || !legs.includes(S.road.leg)) S.road.leg = legs[0];
  ls('rali_road_leg', S.road.leg);
  // Doar boxuri cu kilometraj numeric: navScanImage validează de-acum la sursă, dar
  // roadbook-urile scanate cu versiuni vechi stau în localStorage nefiltrate, iar un
  // sumKm lipsă făcea NaN în bucla de avans din navRender — navigație înghețată definitiv.
  const drop = [];
  S.road.boxes = S.road.all
    .filter(b => navLegKey(b) === S.road.leg)
    .filter(b => {
      const ok = typeof b.sumKm === 'number' && isFinite(b.sumKm);
      // doar numeric — lista ajunge în innerHTML, iar `num` din date vechi e nevalidat
      if (!ok) drop.push(typeof b.num === 'number' ? b.num : '?');
      return ok;
    })
    .sort((a, b) => a.sumKm - b.sumKm);
  S.road.dropped = drop;   // navStageConfirm le raportează, ca paginile să fie refotografiate
}

function navSelectLeg(key) {
  if (S.road.active) return;           // nu schimba traseul din mers
  S.road.leg = key;
  navRebuildBoxes();
  navUpdateList(); navRenderLegPicker(); navStageConfirm();
}

// Selectorul de leg — vizibil doar când există mai mult de un leg scanat.
function navRenderLegPicker() {
  const row = el('nav-leg-row'), sel = el('nav-leg-select');
  if (!row || !sel) return;
  const legs = navLegsPresent();
  if (legs.length < 2) { row.classList.add('hidden'); return; }
  sel.textContent = '';
  legs.forEach(k => {
    const n = S.road.all.filter(b => navLegKey(b) === k).length;
    const o = document.createElement('option');   // textContent, nu innerHTML: eticheta e derivată din scanare
    o.value = k;
    o.textContent = `${navLegLabel(k)} — ${n} boxuri`;
    if (k === S.road.leg) o.selected = true;
    sel.appendChild(o);
  });
  row.classList.remove('hidden');
}

// Îmbină boxuri noi peste cele existente (dedup pe leg+num+sumKm), sortează pe leg apoi km.
// sumKm poate lipsi (null) → îl trimitem la coadă la sortare, nu blocăm.
function navMergeBoxes(boxes) {
  const key = b => `${navLegKey(b)}_${b.num}_${Math.round((b.sumKm ?? -1) * 100)}`;
  const map = new Map(S.road.all.map(b => [key(b), b]));
  boxes.forEach(b => map.set(key(b), b));
  S.road.all = Array.from(map.values()).sort((a, b) => {
    const ka = navLegKey(a), kb = navLegKey(b);
    return navLegCmp(ka, kb) || (a.sumKm ?? 1e9) - (b.sumKm ?? 1e9);
  });
  // Sari pe leg-ul tocmai scanat: e cel pe care îl pregătește acum.
  if (boxes.length) S.road.leg = navLegKey(boxes[boxes.length - 1]);
  navRebuildBoxes();
  ls('rali_road', JSON.stringify(S.road.all));
}

// O singură pagină, cu camera.
async function navScan() {
  if (!S.cfg.apiKey) { alert('Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    const btn = el('btn-nav-scan');
    const sta = el('nav-scan-status');
    btn.disabled = true; btn.textContent = '⏳ Scanez...';
    sta.classList.remove('hidden');
    sta.className = 'scan-status'; sta.style.color = 'var(--dim)'; sta.textContent = '';
    try {
      const boxes = await navScanImage(b64, mime);
      navMergeBoxes(boxes);
      navUpdateList(); navRenderLegPicker();
      navStageConfirm(1);
      sta.textContent = `✓ ${boxes.length} boxuri adăugate — total ${S.road.all.length}`;
      sta.style.color = 'var(--green)';
    } catch (e) {
      sta.textContent = `✗ ${e.message}`; sta.style.color = 'var(--red)';
    } finally {
      btn.disabled = false; btn.textContent = '📷 Adaugă pagină roadbook';
    }
  });
}

// Mai multe pagini deodată (o etapă pe mai multe foi) — selecție din galerie.
async function navScanMulti() {
  if (!S.cfg.apiKey) { alert('Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (images) => {
    if (!images || !images.length) return;
    // Plafon: fiecare pagină = un apel Sonnet cu imagine. O selecție „toate pozele" din
    // galerie ar lansa sute de apeluri, secvențial, fără buton de oprire.
    const MAX_PAGES = 12;
    if (images.length > MAX_PAGES) {
      alert(`Maxim ${MAX_PAGES} pagini o dată (ai selectat ${images.length}). Scanează în tranșe.`);
      return;
    }
    if (images.length > 5 &&
        !confirm(`${images.length} pagini = ${images.length} apeluri către Claude. Continui?`)) return;
    const btn = el('btn-nav-scan-multi');
    const btn1 = el('btn-nav-scan');
    const sta = el('nav-scan-status');
    btn.disabled = true; btn1.disabled = true;
    sta.classList.remove('hidden');
    sta.className = 'scan-status'; sta.style.color = 'var(--dim)';
    let added = 0, failed = 0;
    // Secvențial (nu în paralel) — feedback pe pagini + evită rate-limit.
    for (let i = 0; i < images.length; i++) {
      sta.textContent = `⏳ Scanez pagina ${i + 1}/${images.length}...`;
      try {
        const boxes = await navScanImage(images[i].b64, images[i].mime);
        navMergeBoxes(boxes);
        added += boxes.length;
        navUpdateList(); navRenderLegPicker();
      } catch (e) { failed++; }
    }
    navStageConfirm(images.length);
    sta.textContent = `✓ ${images.length} pagini procesate` +
      (failed ? ` (${failed} eșuate)` : '') + ` — ${added} boxuri, total ${S.road.all.length}`;
    sta.style.color = failed ? 'var(--yellow)' : 'var(--green)';
    btn.disabled = false; btn1.disabled = false;
    btn.textContent = '🖼️ Adaugă mai multe pagini';
  }, true);
}

// Confirmă că a înțeles etapa: de la Box X la Box Y, câte pagini, și verifică continuitatea numerotării.
function navStageConfirm(pageCount) {
  const box = el('nav-stage-confirm');
  if (!box) return;
  if (!S.road.all.length) { box.classList.add('hidden'); return; }
  const fmtKm = v => (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '?';
  const legs = navLegsPresent();
  // Continuitatea se verifică ÎN INTERIORUL fiecărui leg. Verificată global, ea raporta
  // „fără goluri" peste boxuri din leg-uri diferite amestecate — semafor verde fals.
  let anyWarn = false;
  const lines = legs.map(k => {
    const bs = S.road.all.filter(b => navLegKey(b) === k)
      .sort((a, b) => (a.sumKm ?? 1e9) - (b.sumKm ?? 1e9));
    const nums = bs.map(b => b.num).filter(n => typeof n === 'number').sort((a, b) => a - b);
    const kms = bs.map(b => b.sumKm).filter(v => typeof v === 'number' && isFinite(v));
    const sel = (k === S.road.leg);
    let line = `${sel ? '▶ ' : ''}<b>${navLegLabel(k)}</b>: ` +
      (nums.length ? `Box ${nums[0]}–${nums[nums.length - 1]} · ` : '') +
      `${bs.length} boxuri` +
      (kms.length ? ` · ${fmtKm(kms[0])}–${fmtKm(kms[kms.length - 1])} km` : '');

    const missing = [];
    const dupes = [];
    if (nums.length) {
      const seen = new Map();
      nums.forEach(n => seen.set(n, (seen.get(n) || 0) + 1));
      for (let i = nums[0]; i <= nums[nums.length - 1]; i++) if (!seen.has(i)) missing.push(i);
      seen.forEach((c, n) => { if (c > 1) dupes.push(n); });
    }
    if (missing.length) {
      anyWarn = true;
      const show = missing.slice(0, 15).join(', ') + (missing.length > 15 ? '…' : '');
      line += `<br>&nbsp;&nbsp;⚠️ Lipsesc ${missing.length} box${missing.length > 1 ? 'uri' : ''}: ${show}. Mai scanează paginile lipsă.`;
    }
    if (dupes.length) {
      anyWarn = true;
      line += `<br>&nbsp;&nbsp;⚠️ Numere de box duplicate: ${dupes.slice(0, 15).join(', ')}. Verifică dacă o pagină e din alt leg.`;
    }
    if (!missing.length && !dupes.length) line += `<br>&nbsp;&nbsp;✓ Numerotare continuă, fără goluri.`;
    return line;
  });

  if (legs.some(k => k.includes('?'))) {
    anyWarn = true;
    lines.push(`⚠️ Unele pagini n-au avut antetul citit (zi/leg). Rescanează-le — altfel nu se știe din ce leg sunt.`);
  }
  if (S.road.dropped && S.road.dropped.length) {
    anyWarn = true;
    lines.push(`⚠️ ${S.road.dropped.length} box${S.road.dropped.length > 1 ? 'uri' : ''} fără kilometraj, scos${S.road.dropped.length > 1 ? 'e' : ''} din navigare (nr. ${S.road.dropped.slice(0, 10).join(', ')}). Refotografiază pagina.`);
  }

  // Valorile interpolate sunt numerice sau '?' (navLegKey le forțează) — fără text liber din AI,
  // deci innerHTML rămâne sigur.
  let html = `<strong>Roadbook înțeles</strong>` +
    (pageCount ? ` · ${pageCount} ${pageCount === 1 ? 'pagină' : 'pagini'} scanate` : '') +
    (legs.length > 1 ? ` · ${legs.length} leg-uri` : '') + `<br>` + lines.join('<br>');
  if (legs.length > 1) html += `<br><em>Navigarea pornește pe leg-ul marcat cu ▶.</em>`;

  box.className = 'stage-confirm ' + (anyWarn ? 'warn' : 'ok');
  box.innerHTML = html;
  box.classList.remove('hidden');
  navRenderRtPrep();
}

// Panoul de pregătire a probelor: ce a găsit în roadbook + vitezele. Se completează
// PARCAT, o singură dată — în mers nu se mai atinge nimic.
function navRenderRtPrep() {
  const wrap = el('nav-rt-prep');
  if (!wrap) return;
  const rts = navDetectRts();
  if (!rts.length) { wrap.classList.add('hidden'); wrap.textContent = ''; return; }
  wrap.classList.remove('hidden');
  wrap.textContent = '';
  const title = document.createElement('p');
  title.className = 'section-label';
  title.textContent = `PROBE GĂSITE ÎN ROADBOOK: ${rts.length}`;
  wrap.appendChild(title);
  rts.forEach(rt => {
    const row = document.createElement('div');
    row.className = 'rtprep-row';
    const lbl = document.createElement('span');
    lbl.textContent = `${rt.name} · box ${S.road.boxes[rt.startIdx].num}→${S.road.boxes[rt.finishIdx].num} · ${rt.dist.toFixed(2)} km · ${rt.type === 'standing' ? 'standing' : 'auto'}`;
    row.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = '5'; inp.max = '120'; inp.step = '0.1';
    inp.inputMode = 'decimal'; inp.placeholder = 'km/h?';
    if (rt.speed != null) inp.value = rt.speed;
    inp.addEventListener('change', () => {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (isFinite(v) && v >= 5 && v <= 120) { navSaveRtSpeed(rt.key, v); navRenderRtPrep(); }
    });
    row.appendChild(inp);
    const st = document.createElement('span');
    st.className = 'rtprep-st';
    st.textContent = rt.speed != null ? '✓' : '⚠ viteza!';
    st.style.color = rt.speed != null ? 'var(--green)' : 'var(--red)';
    row.appendChild(st);
    wrap.appendChild(row);
  });
  const hint = document.createElement('p');
  hint.className = 'info-line';
  hint.style.opacity = '.75';
  const lipsa = rts.filter(r => r.speed == null).length;
  hint.textContent = lipsa
    ? `Completează ${lipsa} vitez${lipsa > 1 ? 'e' : 'ă'} din buletin, apoi START — restul merge singur.`
    : 'Totul complet. START NAVIGARE — probele pornesc și se opresc singure.';
  wrap.appendChild(hint);
}

function navUpdateList() {
  const n = S.road.boxes.length;
  // sumKm poate lipsi (null) dacă scanarea roadbook-ului nu l-a extras pentru un box;
  // fără gardă, .toFixed pe null arunca si bloca tot init-ul (inclusiv GPS-ul).
  const fmtKm = v => (typeof v === 'number' && isFinite(v)) ? v.toFixed(2) : '?';
  const multi = navLegsPresent().length > 1;
  el('nav-box-count').textContent = n === 0 ? '— niciun box scanat' :
    (multi ? navLegLabel(S.road.leg) + ' · ' : '') +
    `${n} boxuri · ${fmtKm(S.road.boxes[0].sumKm)} – ${fmtKm(S.road.boxes[n-1].sumKm)} km`;
  el('btn-nav-start').disabled = n === 0;
}

function navClear() {
  if (!confirm('Ștergi toate boxurile scanate, din toate leg-urile?')) return;
  S.road.all = []; S.road.boxes = []; S.road.leg = null;
  ls('rali_road', '[]'); ls('rali_road_leg', '');
  navUpdateList(); navRenderLegPicker();
  navStageConfirm();
  const sta = el('nav-scan-status'); if (sta) sta.classList.add('hidden');
}

function navStart() {
  if (!S.road.boxes.length) return;
  S.road.active = true; S.road.legDistKm = 0; S.road.announced = {};
  // Planul de cursă: probele detectate din roadbook, cu vitezele lor.
  // De aici, orchestratorul (raceTick) conduce singur — pornire, deviere, finish, scris.
  S.road.racePlan = navDetectRts();
  S.road.raceIdx = 0;
  S.road.raceRunning = false;
  const faraViteza = S.road.racePlan.filter(r => r.speed == null).length;
  if (S.road.racePlan.length) {
    speak(faraViteza
      ? `Navigare pornită. ${S.road.racePlan.length} probe, ${faraViteza} fără viteză.`
      : `Navigare pornită. ${S.road.racePlan.length} probe, totul automat.`, 2);
  } else speak('Navigare pornită.', 1);
  S.road.lastPos = S.gps.lat ? { lat: S.gps.lat, lng: S.gps.lng } : null;
  S.road.lastT = null;
  // Skip boxes within 80m to avoid voice spam at start
  const firstIdx = S.road.boxes.findIndex(b => b.sumKm > 0.08);
  S.road.nextIdx = firstIdx === -1 ? 0 : firstIdx;
  el('nav-setup').classList.add('hidden');
  el('nav-active').classList.remove('hidden');
  S.road.tickId = setInterval(navRender, 500);
  navPersistSession(true);
}

function navStop() {
  // Dacă o probă orchestrată rulează, o închidem curat înainte de a opri navigarea.
  if (S.road.raceRunning && S.rt.active) rtStop(true);
  S.road.raceRunning = false;
  el('race-rt')?.classList.add('hidden');
  S.road.active = false; clearInterval(S.road.tickId);
  navClearSession();
  voiceFlush();
  el('nav-active').classList.add('hidden');
  el('nav-setup').classList.remove('hidden');
}

function navGpsTick(pos) {
  const acc = pos.coords.accuracy;
  // Același tratament ca la RT: precizia slabă taie doar haversine, nu tot odometrul.
  S.road.legDistKm += gpsDistKm(S.road, pos, !!(acc && acc > 60));
  navTurnDetect(pos);
}

// ── Resincronizare AUTOMATĂ pe viraje ──────────────────────────
// Roadbook-ul n-are coordonate — doar km și viraje. Dar virajele sunt repere fizice:
// când GPS-ul (heading) arată că mașina chiar a virat, căutăm boxul de viraj din
// fereastra apropiată și fixăm kilometrajul pe el. E butonul „AM TRECUT DE BOX"
// apăsat automat — răspunsul la decalajul de la testul din Dumbrăvița, unde toate
// anunțurile alunecaseră și șoferul n-avea mâini libere să corecteze.
function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }

function navTurnDetect(pos) {
  if (!S.road.active || !S.road.boxes.length) return;
  const c = pos.coords;
  const spd = (c.speed != null && isFinite(c.speed)) ? c.speed * 3.6 : (S.gps.speed || 0);
  const hdg = c.heading;
  const t = pos.timestamp;
  const st = S.road.turnSt || (S.road.turnSt = { acc: 0, lastHdg: null, lastT: 0, quietMs: 0, snapT: 0 });
  // heading-ul GPS e valid doar în mers; sub 8 km/h e zgomot
  if (hdg == null || !isFinite(hdg) || spd < 8) { st.lastHdg = null; st.acc = 0; return; }
  if (st.lastHdg == null || t - st.lastT > 5000) {
    st.lastHdg = hdg; st.lastT = t; st.acc = 0; st.quietMs = 0; return;
  }
  const d = angDiff(hdg, st.lastHdg);
  const dt = t - st.lastT;
  st.lastHdg = hdg; st.lastT = t;
  if (Math.abs(d) < 3) {
    st.quietMs += dt;
    // virajul s-a TERMINAT (direcție stabilă 2,5 s după o rotație acumulată de peste 55°)
    if (st.quietMs > 2500 && Math.abs(st.acc) >= 55) {
      navTurnSnap(st.acc);
      st.acc = 0;
    } else if (st.quietMs > 2500) st.acc = 0;   // mers drept — uită micile corecții
  } else {
    st.acc += d;
    st.quietMs = 0;
  }
}

function navTurnSnap(accDeg) {
  const st = S.road.turnSt;
  const now = Date.now();
  if (now - st.snapT < 10000) return;   // max un snap la 10 s
  const dist = S.road.legDistKm;
  const right = accDeg > 0;             // heading crește în sensul acelor = viraj dreapta
  // Candidați: boxuri de VIRAJ din fereastra ±350 m, cu sensul potrivit.
  // Giratoriile se acceptă indiferent de semn (rotația netă depinde de ieșire).
  // Conservator: fără candidat potrivit → NICIUN snap; un snap greșit e mai rău decât driftul.
  let best = -1, bestGap = 0.35;
  for (let i = 0; i < S.road.boxes.length; i++) {
    const b = S.road.boxes[i];
    if (typeof b.sumKm !== 'number' || !isFinite(b.sumKm)) continue;
    const gap = Math.abs(b.sumKm - dist);
    if (gap > bestGap) continue;
    const dir = b.dir || '';
    const isTurn = /^GIRATORIU/.test(dir) ? true
      : right ? (dir === 'DREAPTA' || dir === 'DREAPTA-T')
              : (dir === 'STÂNGA' || dir === 'STÂNGA-T');
    if (!isTurn) continue;
    best = i; bestGap = gap;
  }
  if (best === -1) return;
  const box = S.road.boxes[best];
  const target = box.sumKm + 0.02;      // virajul se încheie puțin după box
  const deltaKm = target - dist;
  st.snapT = now;
  S.road.legDistKm = target;
  S.road.nextIdx = best + 1;
  if (S.rt.active && Math.abs(deltaKm) < 0.5) S.rt.distKm = Math.max(0, S.rt.distKm + deltaKm);
  const key = `${box.num}_${Math.round(box.sumKm * 100)}`;
  for (let tt = 0; tt < NAV_TIERS.length; tt++) S.road.announced[key + '_t' + tt] = true;
  const sta = el('nav-sync-status');
  if (sta) {
    const m = Math.round(Math.abs(deltaKm) * 1000);
    sta.textContent = `✓ auto-sync Box ${box.num} (corecție ${deltaKm >= 0 ? '+' : '−'}${m} m)`;
    sta.classList.remove('warn'); sta.classList.remove('hidden');
    clearTimeout(S.road.syncMsgId);
    S.road.syncMsgId = setTimeout(() => sta.classList.add('hidden'), 5000);
  }
  navPersistSession(true);
}

function navRender() {
  if (!S.road.active) return;
  const dist = S.road.legDistKm;
  el('nav-pos-km').textContent = dist.toFixed(3) + ' km';
  navPersistSession(); // throttle ~1/sec, pentru reluare după reload / OS-kill
  raceTick(dist);      // orchestratorul: pornește/oprește probele singur, după plan

  // Advance past already-passed boxes. Garda pe tip e plasa finală: un sumKm ne-numeric
  // ar face comparația mereu falsă (NaN) și ar îngheța avansul definitiv, fără eroare.
  while (S.road.nextIdx < S.road.boxes.length) {
    const km = S.road.boxes[S.road.nextIdx].sumKm;
    if (typeof km === 'number' && isFinite(km) && dist <= km + 0.08) break;
    S.road.nextIdx++;   // trecut de box — sau box corupt, peste care sari, nu blochezi leg-ul
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
  const arrow  = dirLookup(DIR_ARROW, next.dir)  || '?';
  const fArrow = dirLookup(DIR_ARROW, next.flag) || '';

  el('nav-dist-next').textContent    = distToNext < 0.1 ?
    `${Math.round(distToNext * 1000)} m` : `${distToNext.toFixed(2)} km`;
  el('nav-dir-next').textContent     = arrow + (fArrow ? ' ' + fArrow : '');
  el('nav-comment-next').textContent = next.comment || '';
  el('nav-boxnum-next').textContent  = `Box ${next.num}`;

  // Butonul „RT din roadbook" — vizibil doar când urmează o pereche start→finish de RT
  const btnRt = el('btn-nav-rt');
  if (btnRt) {
    const rtA = navRtAhead();
    if (rtA) {
      btnRt.textContent = `▶ Pregătește RT: box ${rtA.start.num}→${rtA.finish.num} · ${rtA.dist.toFixed(2)} km`;
      btnRt.classList.remove('hidden');
    } else btnRt.classList.add('hidden');
  }

  if (ni + 1 < boxes.length) {
    const af = boxes[ni + 1];
    el('nav-after-text').textContent =
      `Box ${af.num} · ${af.sectionKm != null ? af.sectionKm.toFixed(2) + ' km' : '?'} · ${dirLookup(DIR_ARROW, af.dir) || '?'}` +
      (af.flag ? ' ' + (dirLookup(DIR_ARROW, af.flag) || '') : '') + (af.comment ? ' · ' + af.comment : '');
  } else {
    el('nav-after-text').textContent = '— finish leg —';
  }

  // ── Turn-by-turn vocal ──
  // Alege tierul cel mai strâns atins (35m/150m/300m); marchează-l pe el + cele mai
  // îndepărtate ca spuse, ca boxurile apropiate să nu declanșeze anunțuri „în 300m" greșite.
  const key = `${next.num}_${Math.round(next.sumKm * 100)}`;
  let chosen = -1;
  for (let i = 0; i < NAV_TIERS.length; i++) {
    if (distToNext <= NAV_TIERS[i].d) { chosen = i; break; }
  }
  if (chosen >= 0 && !S.road.announced[key + '_t' + chosen]) {
    for (let j = chosen; j < NAV_TIERS.length; j++) S.road.announced[key + '_t' + j] = true;
    const isNow = !!NAV_TIERS[chosen].now;
    // Boxurile „drept înainte" fără flag nu se rostesc deloc — sunt pe ecran; vocea
    // se păstrează pentru viraje și evenimente. cat 'turn': un anunț nou de viraj
    // înlocuiește predecesorul neconsumат din coadă.
    if (next.dir !== 'ÎNAINTE' || next.flag) {
      speak(navTurnText(next, distToNext, isNow), isNow ? 3 : 2, 'turn');
    }
    if (next.flag === 'EV') vibrate([40, 30, 40, 30, 40]);
    else if (next.flag === 'STOP-CFR' && isNow) vibrate([200, 80, 200]);
  }
}

// ══════════════════════════════════════════════════════════════
//  CLAUDE API
// ══════════════════════════════════════════════════════════════
const SYSTEM = `Ești RALI, copilotul virtual al lui Andreas Suciu la Transilvania eCLASIC 2026 (regularitate 100% electric, A.R.E.S. Championship).
Mașina: Tesla Model Y Juniper AWD Long Range — 82 kWh, consum munte ~20 kWh/100 km, autonomie munte 280-320 km la 100%.
Regularitate: 1 punct = 1 secundă deviere. La Sibiu 2026 se cronometrează la zecime: 0,1 punct per 0,1 secundă, maxim 900 pct pe RT — deci și zecimile contează, nu rotunji.
Sibiu 2026: oprirea pe RT între tabela galbenă (~50 m înainte) și cea roșie de finiș = 100 pct. Punctele de eficiență se SCAD din penalizări: Ziua 1 = km − consum(Wh/km) + baterie(kWh); Ziua 2 = km − 2×consum + baterie. Ziua 1 = 173,10 km, Ziua 2 = 264,79 km peste Transfăgărășan (Bâlea Lac, 2043 m).
TC = time control cu ștampilă (300 pct dacă blochezi alt echipaj). RT = test timed — menții viteză medie.
Formula RT: timp ideal (s) = (km × 3600) ÷ viteză medie. Deviere + = în urmă. Deviere - = în avans.
Regula lui cea mai scumpă: la viteze impuse mici (sub 30 km/h) instinctul îl face să meargă prea repede. Dacă viteza RT e sub 30, avertizează-l din prima.
Program Sibiu: vineri start 12:01, pauză Orlat 15:31-17:01, finiș 18:21. Sâmbătă start 07:01, cafea Albota 10:21-12:01, masă 14:41-16:31, finiș 18:31. Toate din/în Piața Mică.
Calendar rămas: Sinaia 11-12 sep | Iași-Chișinău 9-10 oct | Christmas Tour 4-5 dec.
Răspunde în română, SCURT (max 3 rânduri). Direcțiile cu MAJUSCULE. Calculezi calm, nu panicăm.`;

function rtContext() {
  if (!S.rt.active) return '';
  const el_ = (Date.now() - S.rt.startMs) / 1000;
  // Timp ideal pe segmente — identic cu afișajul RT (segIdealTime), nu formula plată.
  // Altfel copilotul AI primea o deviere greșită la RT-urile cu schimbare de medie.
  const idealS = segIdealTime(S.rt.distKm, S.rt.segments);
  const dev = el_ - idealS;
  const phaseSpd = segPhaseSpeed(S.rt.distKm, S.rt.segments);
  return `[RT activ: ${phaseSpd} km/h țintă acum (start ${S.rt.targetSpd}), deviere ${dev>=0?'+':''}${dev.toFixed(1)}s, `+
         `distanță ${S.rt.distKm.toFixed(3)}/${S.rt.totalDist} km, viteză GPS ${Math.round(S.gps.speed)} km/h]`;
}

async function callClaude(msg) {
  const key = S.cfg.apiKey;
  if (!key) return 'Adaugă Claude API Key în tab-ul SETĂRI.';
  const context = rtContext();
  const full = context ? context + '\n\n' + msg : msg;
  return fetchClaude(key, {
    model: S.cfg.model,
    max_tokens: 280,
    system: SYSTEM,
    messages: [{ role: 'user', content: full }]
  }, 45000);   // chat, fără imagine — 45s ajung
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
let _wakeFailWarned = false;
let _hiddenAtMs = null;   // când a plecat pagina din prim-plan (pentru deviarea fantomă)

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    el('wake-icon').classList.add('on');
    _wakeFailWarned = false;
    const warn = el('wake-warn'); if (warn) warn.classList.add('hidden');
    _wakeLock.addEventListener('release', () => {
      el('wake-icon').classList.remove('on');
      // re-acquire when tab becomes visible again
    });
  } catch (_) {
    // Eșecul era înghițit complet — pe Samsung cu economisire de baterie, cererea e
    // respinsă, ecranul se stinge în mijlocul probei și pagina îngheață, dar cronometrul
    // (Date.now) curge: deviere fantomă la trezire. Iconița de 14px nu e un avertisment.
    el('wake-icon').classList.remove('on');
    const warn = el('wake-warn');
    if (warn) warn.classList.remove('hidden');
    if (!_wakeFailWarned) {
      _wakeFailWarned = true;
      speak('Atenție: ecranul se poate stinge singur. Oprește economisirea bateriei.', 2);
    }
    // re-cerere la primul tap — gestul utilizatorului deblochează des cererea
    document.addEventListener('click', () => acquireWakeLock(), { once: true });
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    acquireWakeLock();
    // Pagina a fost suspendată (cameră, ecran stins, alt app). Cronometrul a curs,
    // odometrul nu — deci pentru pauze de peste 3 s cu RT activ, umple distanța cu
    // viteza-țintă (estimarea neutră: dacă chiar a ținut media, corecția e exactă)
    // și spune-i pe ecran + voce ce s-a întâmplat, în loc de o deviere fantomă mută.
    if (_hiddenAtMs && S.rt.active) {
      const gapS = (Date.now() - _hiddenAtMs) / 1000;
      if (gapS > 3) {
        const spd = segPhaseSpeed(S.rt.distKm, S.rt.segments) || S.rt.targetSpd || 0;
        const addKm = (spd * gapS) / 3600;
        S.rt.distKm += addKm;
        S.rt.lastPos = null; S.rt.lastT = null;   // primul fix nou nu întinde haversine peste gaură
        speak(`Ecran stins ${Math.round(gapS)} secunde. Am estimat ${Math.round(addKm * 1000)} metri — verifică devierea.`, 2);
      }
    }
    _hiddenAtMs = null;
  } else {
    _hiddenAtMs = Date.now();
  }
});

// ══════════════════════════════════════════════════════════════
//  RT PRESETS
// ══════════════════════════════════════════════════════════════
function renderPresets() {
  const row = el('preset-row');
  row.innerHTML = '';
  S.presets.forEach((p, i) => {
    const chip = document.createElement('button');
    chip.className = 'preset-chip';
    const nChg = p.changes ? p.changes.length : (p.spd2 ? 1 : 0);
    const chgTxt = nChg ? `+${nChg}` : '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;                       // textContent: fără injecție HTML
    const pxSpan = document.createElement('span');
    pxSpan.className = 'px';
    pxSpan.textContent = `${p.spd}${chgTxt}·${p.dist}km`;
    chip.append(nameSpan, pxSpan);

    let lpFired = false, lp;
    chip.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }           // suprimă click după long-press
      applyPreset(i);
    });
    chip.addEventListener('contextmenu', e => { e.preventDefault(); lpFired = true; deletePreset(i); });
    chip.addEventListener('touchstart', () => {
      lpFired = false;
      lp = setTimeout(() => { lpFired = true; deletePreset(i); }, 700);
    }, { passive: true });
    chip.addEventListener('touchend', () => clearTimeout(lp));
    chip.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
    row.appendChild(chip);
  });
  const add = document.createElement('button');
  add.className = 'preset-chip preset-add';
  add.textContent = '+ salvează';
  add.addEventListener('click', savePreset);
  row.appendChild(add);
  // Fără presetări (cazul normal la începutul unei etape noi) spune de unde vin, ca să nu
  // pară că s-a stricat ceva. Presetările vechi erau de la Reșița și au fost scoase.
  const hint = el('preset-hint');
  if (hint) hint.classList.toggle('hidden', S.presets.length > 0);
}

function applyPreset(i) {
  const p = S.presets[i];
  if (!p) return;
  S.rt.pendingName = p.name || null;   // rtStop scrie automat devierea în rândul ăsta din tracker
  el('rt-spd').value = p.spd;
  el('rt-dst').value = p.dist;
  // Doar valorile cunoscute: un preset importat cu type lipsă sau cu ghilimele în valoare
  // ar da null.checked / SyntaxError la querySelector și ar opri funcția la jumătate.
  const t = p.type === 'standing' ? 'standing' : 'auto';
  const radio = document.querySelector(`input[name="rt-type"][value="${t}"]`);
  if (radio) radio.checked = true;
  // Schimbările pot veni din formatul nou (changes[]) sau cel vechi (spd2/changeKm).
  el('rt-segs').innerHTML = '';
  const changes = p.changes || (p.spd2 && p.changeKm ? [{ km: p.changeKm, speed: p.spd2 }] : []);
  changes.forEach(c => rtAddSegRow(c.km, c.speed));
  rtPreview();
  vibrate([20]);
}

function savePreset() {
  const name = prompt('Nume preset (ex: RT1):');
  if (!name) return;
  const segs = rtReadSegments();
  S.presets.push({
    name: name.trim().slice(0, 8),
    spd: segs[0].speed,
    dist: parseFloat(el('rt-dst').value) || 2,
    type: document.querySelector('input[name="rt-type"]:checked').value,
    changes: segs.slice(1).map(s => ({ km: s.from, speed: s.speed }))
  });
  ls('rali_presets', JSON.stringify(S.presets));
  renderPresets();
}

function deletePreset(i) {
  if (!confirm(`Ștergi presetul "${S.presets[i].name}"?`)) return;
  S.presets.splice(i, 1);
  ls('rali_presets', JSON.stringify(S.presets));
  renderPresets();
}

// ══════════════════════════════════════════════════════════════
//  PUNCTE DE EFICIENȚĂ — Sibiu, art. 6.3.2
// ══════════════════════════════════════════════════════════════
// Ziua 1: km − consum(Wh/km) + baterie(kWh) · Ziua 2: km − 2×consum + baterie.
// Punctele se SCAD din penalizări. Sâmbătă 1 Wh/km = 2 puncte = 2 s de deviere pe RT —
// cifra care spune, în timp real, dacă merită vânat consumul sau zecimile.
let _effDay = 1;
function effCalc() {
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
  const cons = num(el('eff-cons').value);
  const km = num(el('eff-km').value);
  const out = el('eff-out');
  if (cons == null || km == null) { out.textContent = 'Pune consumul de pe bord și km-ii zilei.'; return; }
  const BATT = 82;
  const pts = _effDay === 2 ? km - 2 * cons + BATT : km - cons + BATT;
  const marginal = _effDay === 2 ? 2 : 1;
  const rez = pts >= 0
    ? `BONUS ${pts.toFixed(1)} puncte (se scad din penalizări)`
    : `${Math.abs(pts).toFixed(1)} puncte ÎN PLUS la penalizări`;
  out.textContent = `Ziua ${_effDay}: ${km} − ${_effDay === 2 ? '2×' : ''}${cons} + ${BATT} = ` +
    `${pts.toFixed(1)} → ${rez}. Fiecare 1 Wh/km economisit = ${marginal} punct${marginal > 1 ? 'e' : ''}.`;
}

function effSelectDay(btn) {
  _effDay = parseInt(btn.dataset.effday, 10) || 1;
  el('eff-km').value = btn.dataset.km || '';
  document.querySelectorAll('#eff-day-row .preset-chip').forEach(b =>
    b.classList.toggle('sel', b === btn));
  if (el('eff-cons').value) effCalc();
}

// ══════════════════════════════════════════════════════════════
//  TC DEPARTURE COUNTDOWN
// ══════════════════════════════════════════════════════════════
function tcSet() {
  const v = el('tc-time').value;
  if (!v) { alert('Pune ora de plecare.'); return; }
  const parts = v.split(':').map(Number);
  const now = new Date();
  const t = new Date();
  t.setHours(parts[0], parts[1], parts[2] || 0, 0);
  if (t.getTime() < now.getTime() - 1000) t.setDate(t.getDate() + 1); // dacă a trecut, mâine
  S.tc.targetMs = t.getTime();
  S.tc.announced = {};
  clearInterval(S.tc.tickId);
  S.tc.tickId = setInterval(tcTick, 200);
  speak(`Countdown setat pentru ora ${parts[0]} ${pad(parts[1])}`, 1);
}

function tcSyncPlus1() {
  // plecare la minutul rotund următor AL CEASULUI OFICIAL; sub 20s, sare la cel de după
  const off = tcClockOffMs();
  const t = new Date(Date.now() + off);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  if (t.getTime() - (Date.now() + off) < 20000) t.setMinutes(t.getMinutes() + 1);
  S.tc.targetMs = t.getTime();
  S.tc.announced = {};
  el('tc-time').value = `${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
  clearInterval(S.tc.tickId);
  S.tc.tickId = setInterval(tcTick, 200);
  vibrate([20]);
}

function tcStop() {
  clearInterval(S.tc.tickId);
  S.tc.targetMs = null;
  el('tc-display').textContent = '--:--';
  el('tc-display').className = 'cd-display';
}

// Offsetul oficial−telefon (secunde, din câmpul de sub countdown). Ora de pe time card
// e în CEASUL RALIULUI; telefonul poate diferi cu secunde bune — la 300 pct pentru
// plecare timpurie și 900 pentru start ratat, secundele alea contează.
function tcClockOffMs() { return (parseFloat(el('tc-clockoff')?.value) || 0) * 1000; }

function tcTick() {
  if (!S.tc.targetMs) return;
  // ținta e în ceas oficial; oficialul o atinge când telefonul arată țintă − offset
  const remMs = S.tc.targetMs - tcClockOffMs() - Date.now();
  const rem = remMs / 1000;
  const disp = el('tc-display');

  if (rem <= 0) {
    disp.textContent = 'GO!';
    disp.className = 'cd-display go';
    if (!S.tc.announced.go) { S.tc.announced.go = true; speak('Pleacă! GO!', 3); vibrate([200, 80, 200]); }
    if (rem < -3) tcStop();
    return;
  }

  const m = Math.floor(rem / 60);
  const s = Math.floor(rem % 60);
  disp.textContent = `${m}:${pad(s)}`;
  disp.className = 'cd-display' + (rem <= 5 ? ' now' : rem <= 30 ? ' soon' : '');

  // Anunțuri vocale — FĂRĂ fereastră de 0,25 s: un singur tick întârziat (GC, GPS,
  // cerere AI) sărea complet marcajul, iar „3-2-1" cu o cifră lipsă naște panică la start.
  // Regula: orice marcaj sub care am coborât se marchează; se ROSTEȘTE doar dacă suntem
  // încă la sub o secundă de el — un „3" strigat la 1,8 s rămase ar fi mai rău decât lipsa lui.
  const names = { 60: '60 secunde', 30: '30 secunde', 10: '10 secunde', 5: '5', 4: '4', 3: '3', 2: '2', 1: '1' };
  for (const mk of [60, 30, 10, 5, 4, 3, 2, 1]) {
    if (rem <= mk && !S.tc.announced[mk]) {
      S.tc.announced[mk] = true;
      if (rem > mk - 1.0) {
        speak(names[mk], 3, 'cd');   // cifra nouă o înlocuiește pe cea stătută din coadă
        if (mk <= 5) vibrate([80]);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════
//  BATTERY CALCULATOR
// ══════════════════════════════════════════════════════════════
const BATT_KWH = 82;
function battCalc() {
  const now  = parseFloat(el('batt-now').value)  || 0;
  const km   = parseFloat(el('batt-km').value)   || 0;
  const cons = parseFloat(el('batt-cons').value) || 20;
  // Ajustare la frig: sub 10°C autonomia scade (~+15% consum), sub 0°C mai mult (~+30%).
  const temp = parseFloat(el('batt-temp')?.value);
  let consEff = cons, tempNote = '';
  if (!isNaN(temp)) {
    const mult = temp < 0 ? 1.30 : temp < 10 ? 1.15 : 1.0;
    if (mult > 1) { consEff = cons * mult; tempNote = ` · ajustat ${temp}°C (+${Math.round((mult - 1) * 100)}%)`; }
  }
  const kwhNeed = km * consEff / 100;
  const pctNeed = (kwhNeed / BATT_KWH) * 100;
  const pctEnd  = now - pctNeed;
  const out = el('batt-out');

  let cls, msg, voice;
  if (pctEnd >= 15) {
    cls = 'var(--green)';
    msg = `Finish estimat la <span class="big" style="color:${cls}">${pctEnd.toFixed(0)}%</span> — OK, peste buffer-ul de 15%.`;
    voice = `Baterie suficientă. Finish estimat la ${pctEnd.toFixed(0)} la sută.`;
  } else if (pctEnd >= 5) {
    cls = 'var(--yellow)';
    msg = `Finish estimat la <span class="big" style="color:${cls}">${pctEnd.toFixed(0)}%</span> — sub buffer-ul de 15%. Condu economic, regenerare Hold.`;
    voice = `Atenție. Finish estimat la ${pctEnd.toFixed(0)} la sută, sub buffer. Condu economic.`;
  } else {
    cls = 'var(--red)';
    msg = `Finish estimat la <span class="big" style="color:${cls}">${pctEnd.toFixed(0)}%</span> — INSUFICIENT. Planifică încărcare pe traseu.`;
    voice = `Baterie insuficientă. Finish estimat la ${pctEnd.toFixed(0)} la sută. Recomand încărcare pe traseu.`;
  }
  out.innerHTML = `${msg}<br><span style="color:var(--dim)">Consum estimat: ${kwhNeed.toFixed(1)} kWh (${pctNeed.toFixed(0)}% baterie) pentru ${km} km${tempNote}.</span>`;
  speak(voice, 1);
}

// ══════════════════════════════════════════════════════════════
//  PENALTY TRACKER
// ══════════════════════════════════════════════════════════════
// Rândurile nu mai sunt fixate pe 6 (numărul de la Reșița) — câte RT-uri are Sibiu nu se
// știe încă. Lista se compune din presetările create din roadbook plus orice RT deja notat,
// iar dacă nu există niciunul se pornește de la RT1.
function penKeys() {
  const set = new Set();
  S.presets.forEach(p => { if (p && p.name) set.add(p.name); });
  // Fără filtru pe null: un rând adăugat manual, sau golit ca să-l retastezi, trebuie
  // să rămână pe ecran. Altfel dispare sub degete în timp ce ștergi valoarea.
  Object.keys(S.pen).forEach(k => set.add(k));
  if (!set.size) set.add('RT1');
  return Array.from(set).sort((a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ''), 10);
    const nb = parseInt(String(b).replace(/\D/g, ''), 10);
    if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
    return String(a).localeCompare(String(b), 'ro');
  });
}

function addPenaltyRow() {
  const keys = penKeys();
  let n = 1;
  keys.forEach(k => {
    // Rândurile afișate pot fi doar sintetice (RT1 implicit, sau nume de presetare).
    // Le fixăm în S.pen înainte de a adăuga, altfel dispar la prima apăsare pe „+".
    if (!(k in S.pen)) S.pen[k] = null;
    const v = parseInt(String(k).replace(/\D/g, ''), 10);
    if (isFinite(v) && v >= n) n = v + 1;
  });
  S.pen['RT' + n] = null;
  ls('rali_pen', JSON.stringify(S.pen));
  renderPenalties();
}

function renderPenalties() {
  const list = el('pen-list');
  list.innerHTML = '';
  let total = 0;
  for (const key of penKeys()) {
    const val = S.pen[key] != null ? S.pen[key] : '';
    if (val !== '') total += parseFloat(val) || 0;
    const row = document.createElement('div');
    row.className = 'pen-row';
    // textContent, nu innerHTML: numele vine din presetări scrise de mână, nu mai e 'RT1'..'RT6' fix.
    const lbl = document.createElement('span');
    lbl.className = 'lbl'; lbl.textContent = key;
    row.appendChild(lbl);
    const inp = document.createElement('input');
    inp.type = 'number'; inp.step = '0.1'; inp.inputMode = 'decimal';
    inp.placeholder = '—'; inp.value = val;
    inp.addEventListener('input', () => {
      S.pen[key] = inp.value === '' ? null : parseFloat(inp.value);
      ls('rali_pen', JSON.stringify(S.pen));
      updatePenTotal();
    });
    row.appendChild(inp);
    const unit = document.createElement('span');
    unit.style.cssText = 'color:var(--dim);font-size:12px;'; unit.textContent = 'sec';
    row.appendChild(unit);
    list.appendChild(row);
  }
  const add = document.createElement('button');
  add.className = 'btn btn-sec btn-sm';
  add.textContent = '+ încă un RT';
  add.addEventListener('click', addPenaltyRow);
  list.appendChild(add);
  // Rotunjire la zecime ÎNAINTE de toFixed: 12.85 e reprezentat binar puțin sub 12.85,
  // deci (12.85).toFixed(1) dă „12.8". Aici zecimea e un punct de penalizare.
  el('pen-total').textContent = (Math.round(total * 10) / 10).toFixed(1) + ' sec';
}

function updatePenTotal() {
  let total = 0;
  for (const k of penKeys()) total += parseFloat(S.pen[k]) || 0;
  // Rotunjire la zecime ÎNAINTE de toFixed: 12.85 e reprezentat binar puțin sub 12.85,
  // deci (12.85).toFixed(1) dă „12.8". Aici zecimea e un punct de penalizare.
  el('pen-total').textContent = (Math.round(total * 10) / 10).toFixed(1) + ' sec';
}

function resetPenalties() {
  if (!confirm('Resetezi toate penalizările?')) return;
  S.pen = {}; ls('rali_pen', '{}'); renderPenalties();
}

// ══════════════════════════════════════════════════════════════
//  VOICE INPUT (Speech-to-Text)
// ══════════════════════════════════════════════════════════════
function micToggle() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { addMsg('bot', 'Recunoaștere vocală indisponibilă pe acest browser.'); return; }
  // A doua apăsare = anulează (fără trimitere)
  if (S.rec.listening) { S.rec.cancelled = true; S.rec.obj?.stop(); return; }

  const rec = new SR();
  rec.lang = 'ro-RO'; rec.interimResults = false; rec.maxAlternatives = 1;
  S.rec.obj = rec; S.rec.listening = true; S.rec.cancelled = false;
  el('btn-chat-mic').classList.add('listening');

  let heard = false;   // trimite DOAR ce s-a dictat acum — nu textul tastat mai demult
  rec.onresult = e => {
    const txt = e.results[0][0].transcript;
    el('chat-in').value = txt;
    heard = true;
  };
  rec.onerror = () => {};
  rec.onend = () => {
    S.rec.listening = false;
    el('btn-chat-mic').classList.remove('listening');
    // Înainte se trimitea orice era în câmp, inclusiv un mesaj început cu degetele și
    // netrimis — microfonul devenea un buton de „trimite orice" accidental.
    if (!S.rec.cancelled && heard && el('chat-in').value.trim()) sendChat();
  };
  try {
    rec.start();
    vibrate([20]);
  } catch (e) {
    S.rec.listening = false;
    el('btn-chat-mic').classList.remove('listening');
  }
}

// ══════════════════════════════════════════════════════════════
//  QUIZ HELPER
// ══════════════════════════════════════════════════════════════
function quizHelper() {
  if (!S.cfg.apiKey) { addMsg('bot', 'Adaugă Claude API Key în SETĂRI.'); return; }
  openCamera(async (b64, mime) => {
    addMsg('user', '📸 [quiz time card]');
    addTyping();
    S.chat.busy = true;
    try {
      const reply = await callClaudeVision(b64, mime,
        'Aceasta e o întrebare quiz de pe time card-ul unui raliu. Citește întrebarea și răspunde DIRECT și SCURT cu răspunsul corect. Dacă sunt variante, spune litera + textul.',
        300, SYSTEM);
      removeTyping();
      addMsg('bot', reply);
    } catch (e) {
      removeTyping();
      addMsg('bot', `Eroare: ${e.message}`);
    } finally {
      S.chat.busy = false;
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
const THEME_COLOR = { dark: '#0a0a0a', light: '#f1f1f4', night: '#000000' };
function applyTheme(t) {
  S.cfg.theme = t;
  ls('rali_theme', t);
  if (t === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[t] || '#0a0a0a');
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t));
}

// ══════════════════════════════════════════════════════════════
//  NAV OFFSET
// ══════════════════════════════════════════════════════════════
function navOffset(meters) {
  S.road.legDistKm = Math.max(0, S.road.legDistKm + meters / 1000);
  // permite re-anunțarea boxurilor după corecție
  S.road.announced = {};
  vibrate([15]);
  if (S.road.active) navRender();
}

// ══════════════════════════════════════════════════════════════
//  NAV RE-SYNC — „✓ Am trecut de box"
//  Copilotul apasă exact când mașina trece de boxul afișat: odometrul
//  se fixează la sumKm-ul boxului, ștergând tot driftul GPS acumulat.
// ══════════════════════════════════════════════════════════════
function navBoxPassed() {
  if (!S.road.active || !S.road.boxes.length) return;
  const boxes = S.road.boxes;
  const dist  = S.road.legDistKm;

  // Candidați: boxul „next" și cel dinaintea lui (dacă apeși puțin după ce
  // afișajul a avansat deja). Îl alegem pe cel mai apropiat în km de poziția curentă.
  const cand = [];
  if (S.road.nextIdx - 1 >= 0) cand.push(S.road.nextIdx - 1);
  if (S.road.nextIdx < boxes.length) cand.push(S.road.nextIdx);
  const valid = cand.filter(i => typeof boxes[i].sumKm === 'number' && isFinite(boxes[i].sumKm));
  if (!valid.length) {
    // Fără feedback, butonul părea mort — spune de ce nu se poate sincroniza.
    const st = el('nav-sync-status');
    if (st) { st.textContent = 'Box fără kilometraj — nu pot sincroniza aici.'; st.classList.remove('hidden'); }
    return;
  }
  const idx = valid.reduce((a, b) =>
    Math.abs(boxes[a].sumKm - dist) <= Math.abs(boxes[b].sumKm - dist) ? a : b);
  const box = boxes[idx];
  const deltaM = Math.round((box.sumKm - dist) * 1000);

  // Snap: de aici înainte, „în X metri" e din nou exact roadbook-ul.
  S.road.legDistKm = box.sumKm;
  S.road.nextIdx = idx + 1;
  // Același drift GPS a afectat și odometrul RT, dacă rulează — corectează-l cu aceeași
  // diferență (gratuit: boxul e o poziție confirmată fizic). Sanity: sub 500 m.
  if (S.rt.active && Math.abs(deltaM) < 500) S.rt.distKm = Math.max(0, S.rt.distKm + deltaM / 1000);
  // Re-permite anunțurile pentru boxurile care urmează; cel confirmat rămâne „spus".
  S.road.announced = {};
  const key = `${box.num}_${Math.round(box.sumKm * 100)}`;
  for (let t = 0; t < NAV_TIERS.length; t++) S.road.announced[key + '_t' + t] = true;

// Verificare de coerență: corecție mare = posibil traseu greșit sau box confirmat greșit.
  const sta = el('nav-sync-status');
  const absM = Math.abs(deltaM);
  const sign = deltaM >= 0 ? '+' : '−';
  if (absM > 200) {
    sta.textContent = `⚠ Diferență mare: ${sign}${absM} m față de roadbook — verificați poziția!`;
    sta.classList.add('warn');
    speak(`Atenție, diferență de ${absM} de metri față de roadbook. Verificați poziția.`, 1);
    vibrate([200, 80, 200]);
  } else {
    sta.textContent = `✓ Sincronizat la Box ${box.num} (corecție ${sign}${absM} m)`;
    sta.classList.remove('warn');
    vibrate([30]);
  }
  sta.classList.remove('hidden');
  clearTimeout(S.road.syncMsgId);
  S.road.syncMsgId = setTimeout(() => sta.classList.add('hidden'), 6000);

  navRender();
  navPersistSession(true);
}
// ↑ aici se ÎNCHIDE navBoxPassed. Funcțiile de mai jos sunt globale — prima versiune le
// definise din greșeală în corpul lui (ancoră de editare greșită): bindUI dădea
// ReferenceError la navJumpToBox și toate legările de după linia aia mureau.

// ── Probele, detectate integral din roadbook ───────────────────
// Cerința lui Andreas de la testul din Dumbrăvița: „îi dau roadbook-ul scanat, își ia
// de acolo TOATE probele, vitezele, timpii — apoi doar START și merge fără întrerupere."
// Perechile RT_START_* → primul RT_FINISH de după dau distanțele; viteza se citește
// din comentariul boxului de start dacă e scrisă acolo („30 km/h"); ce lipsește se
// completează O DATĂ, parcat, în panoul de pregătire — niciodată în mers.
function navDetectRts() {
  const boxes = S.road.boxes;
  const rts = [];
  let saved = {};
  try { saved = JSON.parse(ls('rali_road_rts') || '{}'); } catch (e) {}
  for (let i = 0; i < boxes.length; i++) {
    const f = boxes[i].flag;
    if (f !== 'RT_START_AUTO' && f !== 'RT_START_STANDING') continue;
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[j].flag === 'RT_FINISH') {
        const dist = boxes[j].sumKm - boxes[i].sumKm;
        if (dist > 0.05 && dist < 60) {
          const n = rts.length + 1;
          // viteza din comentariul boxului de start, dacă organizatorul a scris-o acolo
          const m = String(boxes[i].comment || '').match(/(\d+(?:[.,]\d+)?)\s*km\s*\/?\s*h/i);
          const key = `${S.road.leg}|${boxes[i].num}_${Math.round(boxes[i].sumKm * 100)}`;
          rts.push({
            name: 'RT' + n, key,
            startIdx: i, finishIdx: j,
            startKm: boxes[i].sumKm, finishKm: boxes[j].sumKm,
            dist: Math.round(dist * 100) / 100,
            type: f === 'RT_START_STANDING' ? 'standing' : 'auto',
            speed: saved[key] != null ? saved[key]
                 : (m ? parseFloat(m[1].replace(',', '.')) : null)
          });
        }
        break;
      }
    }
  }
  return rts;
}

function navSaveRtSpeed(key, speed) {
  let saved = {};
  try { saved = JSON.parse(ls('rali_road_rts') || '{}'); } catch (e) {}
  saved[key] = speed;
  ls('rali_road_rts', JSON.stringify(saved));
}

// Compat: prima probă din față (folosit de butonul manual „Pregătește RT").
function navRtAhead() {
  const rts = navDetectRts();
  const boxes = S.road.boxes;
  for (const rt of rts) {
    if (rt.startIdx >= Math.max(0, S.road.nextIdx - 1))
      return { start: boxes[rt.startIdx], finish: boxes[rt.finishIdx], dist: rt.dist, rt };
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  ORCHESTRATORUL DE CURSĂ — zero apăsări în mers
// ══════════════════════════════════════════════════════════════
// Rulează din navRender. Stări per probă: 'liaison' (drum) → 'staged' (la linie,
// standing) → RT pornit automat → oprit automat după finish → următoarea probă.
// Regula lui Andreas de la testul din Dumbrăvița: „doar îi dau start navigație și
// trebuie să meargă fără întrerupere până la final."
function raceTick(dist) {
  const plan = S.road.racePlan;
  if (!plan || S.road.raceIdx >= plan.length) return;
  const cur = plan[S.road.raceIdx];

  if (!S.rt.active) {
    const dToStart = cur.startKm - dist;

    // avertizare unică la ~500 m de start
    if (dToStart <= 0.5 && dToStart > 0 && !cur._warned) {
      cur._warned = true;
      speak(cur.speed != null
        ? `Proba în 500. Viteza ${cur.speed}.`
        : `Proba în 500 — FĂRĂ viteză setată, cronometrez manual.`, 3, 'race');
      vibrate([60, 40, 60]);
    }

    if (cur.speed == null) {
      // fără viteză nu putem cronometra — sărim proba când am trecut de finish-ul ei
      if (dist > cur.finishKm + 0.1) { S.road.raceIdx++; }
      return;
    }

    if (cur.type === 'standing') {
      // Standing: oprit la linie → cronometrul pornește CÂND PLECI, nu când ajungi.
      if (!cur._staged && Math.abs(dToStart) <= 0.04 && (S.gps.speed || 0) < 5) {
        cur._staged = true;
        speak('La linie. Pornesc când pleci.', 3, 'race');
      }
      if (cur._staged && (S.gps.speed || 0) > 6) raceStartRt(cur, 0);
      // plasă: dacă trece de linie din rulare (start dat din mers), pornim oricum
      else if (!cur._staged && dist >= cur.startKm && (S.gps.speed || 0) > 6) {
        raceStartRt(cur, dist - cur.startKm);
      }
    } else {
      // Auto-start: cronometrul pornește la trecerea liniei
      if (dist >= cur.startKm) raceStartRt(cur, dist - cur.startKm);
    }
  } else if (S.road.raceRunning) {
    // proba rulează — o închidem singuri la ~120 m după linia de finish (după tabele)
    if (dist >= cur.finishKm + 0.12 || (S.rt.finishing && S.rt.distKm >= cur.dist + 0.1)) {
      raceFinishRt(cur);
    }
  }
}

function raceStartRt(cur, overshootKm) {
  el('rt-spd').value = cur.speed;
  el('rt-dst').value = cur.dist;
  const radio = document.querySelector(`input[name="rt-type"][value="${cur.type}"]`);
  if (radio) radio.checked = true;
  S.rt.pendingName = cur.name;
  rtStart();
  // Compensarea depășirii liniei: GPS-ul bate la ~1 s, deci trecerea se detectează cu
  // câțiva metri întârziere. Și distanța, și ceasul se retro-datează la LINIE, altfel
  // fiecare probă începea cu ~1 s de deviere falsă.
  if (overshootKm > 0.001) {
    const v = (S.gps.speed || 0) / 3.6;   // m/s
    S.rt.distKm = overshootKm;
    if (v > 3) {
      const backMs = (overshootKm * 1000 / v) * 1000;
      S.rt.startMs -= backMs;
      if (S.rt.startPerf != null) S.rt.startPerf -= backMs;
    }
  }
  S.road.raceRunning = true;
  el('race-rt')?.classList.remove('hidden');
  speak(`Start. Ține ${cur.speed}.`, 3, 'race');
  vibrate([100, 60, 100]);
  activateTab('nav');   // cockpitul e ecranul de navigare — devierea apare acolo
}

function raceFinishRt(cur) {
  const dev = S.rt.finalDevS != null ? S.rt.finalDevS : S.rt.lastDevS;
  S.road.raceRunning = false;   // ÎNAINTE de rtStop — garda lui pentru STOP manual să nu incrementeze dublu
  rtStop(true);   // auto: fără dialogul de calibrare — niciun confirm() la volan
  el('race-rt')?.classList.add('hidden');
  if (dev != null) {
    const a = Math.abs(dev);
    speak(`Gata. ${secundeRostite(a)} ${dev >= 0 ? 'în urmă' : 'în avans'}. Scris la ${cur.name}.`, 3, 'race');
  }
  S.road.raceIdx++;
}

function navPrepRt() {
  const rtA = navRtAhead();
  if (!rtA) return;
  el('rt-dst').value = rtA.dist.toFixed(2);
  const type = rtA.start.flag === 'RT_START_STANDING' ? 'standing' : 'auto';
  const radio = document.querySelector(`input[name="rt-type"][value="${type}"]`);
  if (radio) radio.checked = true;
  S.rt.pendingName = null;   // proba nu are nume de preset — trackerul se completează manual
  rtPreview();
  activateTab('rt');
  const sta = el('rt-scan-status');
  if (sta) {
    sta.classList.remove('hidden');
    sta.className = 'scan-status';
    sta.style.color = 'var(--green)';
    sta.textContent = `✓ Din roadbook: box ${rtA.start.num}→${rtA.finish.num}, ${rtA.dist.toFixed(2)} km, ${type}. Completează viteza din buletin.`;
  }
  vibrate([30]);
}

// Repornire la mijloc de leg — „sunt la box N". navStart pleacă mereu de la km 0, deci
// după o oprire (pauza de la Orlat) navigarea era inutilizabilă pentru restul leg-ului:
// navBoxPassed acceptă doar boxul curent ±1, iar butoanele mută 10-100 m per apăsare.
function navJumpToBox() {
  if (!S.road.active || !S.road.boxes.length) return;
  const v = prompt('La ce număr de box ești acum?');
  if (v == null) return;
  const n = parseInt(String(v).replace(/\D/g, ''), 10);
  const st = el('nav-sync-status');
  const idx = S.road.boxes.findIndex(b => b.num === n);
  if (idx === -1) {
    if (st) { st.textContent = `Box ${isFinite(n) ? n : '?'} nu există în leg-ul ăsta.`; st.classList.remove('hidden'); }
    return;
  }
  const box = S.road.boxes[idx];
  S.road.legDistKm = box.sumKm;
  S.road.nextIdx = idx + 1;
  S.road.announced = {};
  S.road.lastPos = null; S.road.lastT = null;
  if (st) { st.textContent = `✓ Poziție setată la Box ${box.num} (km ${box.sumKm.toFixed(2)})`; st.classList.remove('hidden'); }
  navRender();
  navPersistSession(true);
  speak(`Poziție setată la box ${box.num}.`, 2);
}

// ══════════════════════════════════════════════════════════════
//  UTIL
// ══════════════════════════════════════════════════════════════
function el(id) { return document.getElementById(id); }
function vibrate(pattern) { navigator.vibrate?.(pattern); }

// Secunde rostite cu o zecimală, pentru sinteza vocală românească.
// La Sibiu 2026 cronometrarea e la 0,1 s (0,1 punct per zecime), deci rotunjirea
// la secunda întreagă ascundea până la o jumătate de punct pe fiecare anunț.
// „virgulă" scris în litere, nu ca simbol: nu depindem de cum citește vocea „3,4".
// Zecimea 0 se omite — „3 secunde", nu „3 virgulă 0 secunde".
function secundeRostite(x) {
  const v = Math.round(Math.abs(x) * 10) / 10;
  const intreg = Math.floor(v);
  const zecime = Math.round((v - intreg) * 10);
  return zecime === 0 ? `${intreg}` : `${intreg} virgulă ${zecime}`;
}

// Comută tab-ul activ (folosit de reluarea sesiunii).
function activateTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el('tab-' + name)?.classList.add('active');
}

// ══════════════════════════════════════════════════════════════
//  CRASH-RECOVERY — persistă RT/NAV în curs, oferă reluare la pornire
// ══════════════════════════════════════════════════════════════
const SESSION_MAXAGE = 3 * 3600 * 1000; // 3h — peste asta, considerăm sesiunea abandonată
let _rtPersistMs = 0, _navPersistMs = 0;

function rtPersistSession(force) {
  if (!S.rt.active) return;
  const now = Date.now();
  if (!force && now - _rtPersistMs < 1000) return; // throttle ~1/sec
  _rtPersistMs = now;
  try {
    ls('rali_rt_session', JSON.stringify({
      active: true, startMs: S.rt.startMs, distKm: S.rt.distKm,
      segments: S.rt.segments, totalDist: S.rt.totalDist, targetSpd: S.rt.targetSpd,
      type: S.rt.type, distFactor: S.rt.distFactor, voiceThresh: S.rt.voiceThresh,
      savedAt: now
    }));
  } catch (e) {}
}
function rtClearSession() { try { localStorage.removeItem('rali_rt_session'); } catch (e) {} }

function navPersistSession(force) {
  if (!S.road.active) return;
  const now = Date.now();
  if (!force && now - _navPersistMs < 1000) return;
  _navPersistMs = now;
  try {
    ls('rali_nav_session', JSON.stringify({
      // `leg` e obligatoriu: nextIdx e index în leg-ul activ, nu în tot roadbook-ul.
      active: true, leg: S.road.leg, legDistKm: S.road.legDistKm,
      nextIdx: S.road.nextIdx, savedAt: now
    }));
  } catch (e) {}
}
function navClearSession() { try { localStorage.removeItem('rali_nav_session'); } catch (e) {} }

function resumeRt(r) {
  S.rt.segments   = Array.isArray(r.segments) && r.segments.length ? r.segments : [{ from: 0, speed: r.targetSpd || 40 }];
  S.rt.totalDist  = r.totalDist || 2;
  S.rt.targetSpd  = r.targetSpd || S.rt.segments[0].speed;
  S.rt.type       = r.type || 'auto';
  S.rt.distFactor = r.distFactor || 1;
  S.rt.voiceThresh = r.voiceThresh || 3;
  S.rt.startMs    = r.startMs;              // timpul curge mai departe (corect pentru cursă)
  // ancorează cronometrul monoton la timpul de perete scurs până acum
  S.rt.startPerf  = performance.now() - (Date.now() - r.startMs);
  S.rt.distKm     = r.distKm || 0;

  // Distanța dintre crash și „Reia" era PIERDUTĂ: timpul continua, odometrul nu, deci
  // fiecare secundă de pauză devenea o secundă falsă de „în urmă", permanentă și
  // necorectabilă. Umplem golul cu viteza-țintă (dacă a ținut media, corecția e exactă)
  // și spunem explicit cât am estimat — cifră, nu tăcere.
  let gapTxt = '';
  if (r.savedAt) {
    const gapS = Math.max(0, (Date.now() - r.savedAt) / 1000);
    if (gapS > 3) {
      const spd = segPhaseSpeed(S.rt.distKm, S.rt.segments) || S.rt.targetSpd || 0;
      const addKm = (spd * gapS) / 3600;
      S.rt.distKm += addKm;
      gapTxt = ` Pauză ${Math.round(gapS)} secunde — am estimat ${Math.round(addKm * 1000)} metri. Verifică devierea.`;
    }
  }

  // Segmentele deja trecute se marchează ca anunțate — altfel reluarea le striga pe
  // toate în rafală („Schimbare viteză — 45… — 50…"), fix în momentul cel mai prost.
  S.rt.segAnnounced = {};
  S.rt.segments.forEach((sg, i) => { if (i > 0 && sg.from <= S.rt.distKm) S.rt.segAnnounced[i] = true; });

  // Repopulează câmpurile din setup: după STOP, ecranul arăta 40 km/h / 2,00 km
  // în loc de proba tocmai rulată.
  try {
    el('rt-spd').value = S.rt.targetSpd;
    el('rt-dst').value = S.rt.totalDist;
    const radio = document.querySelector(`input[name="rt-type"][value="${S.rt.type === 'standing' ? 'standing' : 'auto'}"]`);
    if (radio) radio.checked = true;
    el('rt-segs').innerHTML = '';
    S.rt.segments.slice(1).forEach(sg => rtAddSegRow(sg.from, sg.speed));
  } catch (e) {}

  S.rt.lastPos = null; S.rt.lastT = null;
  S.rt.active = true; S.rt.finishing = false;
  el('rt-setup').classList.add('hidden');
  el('rt-live').classList.remove('hidden');
  el('rt-badge').classList.remove('hidden');
  el('s-phase-row').classList.toggle('hidden', S.rt.segments.length <= 1);
  clearInterval(S.rt.tickId);
  S.rt.tickId = setInterval(rtRender, 250);
  S.voice.rtLastMs = 0; S.voice.paceOut = false;
  activateTab('rt');
  speak('RT reluat.' + gapTxt, 2);
}

function resumeNav(r) {
  // Reia pe leg-ul salvat, nu pe cel selectat acum — altfel nextIdx ar indica în alt traseu.
  if (r.leg && r.leg !== S.road.leg && navLegsPresent().includes(r.leg)) {
    S.road.leg = r.leg; navRebuildBoxes(); navUpdateList(); navRenderLegPicker();
  }
  if (!S.road.boxes.length) return;         // fără roadbook nu avem ce relua
  S.road.active = true;
  S.road.legDistKm = r.legDistKm || 0;
  S.road.nextIdx = r.nextIdx || 0;
  S.road.announced = {};
  S.road.lastPos = null; S.road.lastT = null;
  el('nav-setup').classList.add('hidden');
  el('nav-active').classList.remove('hidden');
  clearInterval(S.road.tickId);
  S.road.tickId = setInterval(navRender, 500);
  activateTab('nav');
  speak('Navigare reluată.', 1);
}

// Banner discret de reluare (fără să blocheze pornirea GPS-ului ca un confirm()).
function showResumeBanner(rtS, navS) {
  const bar = document.createElement('div');
  bar.id = 'resume-banner';
  bar.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:9000;' +
    'background:#1c1c1e;color:#fff;border:1px solid #ff9f0a;border-radius:12px;' +
    'padding:10px 12px;font:13px/1.4 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5);';
  const msg = document.createElement('div');
  const age = s => {
    const sec = Math.max(0, Math.round((Date.now() - (s.savedAt || Date.now())) / 1000));
    return sec < 90 ? `acum ${sec} s` : `acum ${Math.round(sec / 60)} min`;
  };
  const parts = [];
  if (rtS)  parts.push(`RT în curs (${(rtS.distKm || 0).toFixed(2)} km, ${age(rtS)})`);
  if (navS) parts.push(`Navigare în curs (${(navS.legDistKm || 0).toFixed(2)} km, ${age(navS)})`);
  msg.textContent = '↩ Reiei sesiunea? ' + parts.join(' + ');
  msg.style.marginBottom = '8px';
  bar.appendChild(msg);
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';
  const mkBtn = (label, bg, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `flex:1;padding:10px;border:0;border-radius:8px;font-weight:700;` +
      `background:${bg};color:#fff;`;
    b.addEventListener('click', fn);
    return b;
  };
  const dismiss = () => bar.remove();
  btnRow.appendChild(mkBtn('Reia', '#ff9f0a', () => {
    if (rtS)  resumeRt(rtS);
    if (navS) resumeNav(navS);
    dismiss();
  }));
  btnRow.appendChild(mkBtn('Renunță', '#3a3a3c', () => {
    rtClearSession(); navClearSession(); dismiss();
  }));
  bar.appendChild(btnRow);
  (document.body || document.documentElement).appendChild(bar);
}

function checkResumeSessions() {
  let rtS = null, navS = null;
  try { rtS  = JSON.parse(ls('rali_rt_session')  || 'null'); } catch (e) {}
  try { navS = JSON.parse(ls('rali_nav_session') || 'null'); } catch (e) {}
  const rtOk  = rtS  && rtS.active  && (Date.now() - rtS.savedAt)  < SESSION_MAXAGE;
  const navOk = navS && navS.active && (Date.now() - navS.savedAt) < SESSION_MAXAGE;
  if (!rtOk)  rtClearSession();
  if (!navOk) navClearSession();
  if (rtOk || navOk) showResumeBanner(rtOk ? rtS : null, navOk ? navS : null);
}

// ══════════════════════════════════════════════════════════════
//  RT — TABEL TIMPI IDEALI INTERMEDIARI (speed table, ca la Blunik)
// ══════════════════════════════════════════════════════════════
function rtRenderTable() {
  const cont = el('rt-table');
  if (!cont) return;
  const dst  = parseFloat(el('rt-dst').value) || 2;
  const segs = rtReadSegments();
  const step = dst > 12 ? 1 : 0.5;               // păstrează tabelul scurt la RT lungi
  cont.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'speed-table';
  const head = document.createElement('tr');
  ['km', 'timp ideal', 'țintă'].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; head.appendChild(th);
  });
  table.appendChild(head);
  const marks = [];
  for (let d = step; d < dst - 1e-9; d += step) marks.push(+d.toFixed(3));
  marks.push(+dst.toFixed(3));                    // rândul final = distanța totală
  marks.forEach(d => {
    const tr = document.createElement('tr');
    const c1 = document.createElement('td'); c1.textContent = d.toFixed(2);
    const c2 = document.createElement('td'); c2.textContent = fmtSec(segIdealTime(d, segs));
    const c3 = document.createElement('td'); c3.textContent = segPhaseSpeed(d, segs).toFixed(0);
    tr.append(c1, c2, c3);
    table.appendChild(tr);
  });
  cont.appendChild(table);
}

function rtToggleTable() {
  const cont = el('rt-table');
  if (!cont) return;
  const show = cont.classList.contains('hidden');
  cont.classList.toggle('hidden', !show);
  if (show) rtRenderTable();
  el('btn-rt-table').textContent = show ? '📊 Ascunde tabelul' : '📊 Tabel timpi ideali';
}

// ══════════════════════════════════════════════════════════════
//  EXPORT / IMPORT — backup presetări + roadbook + config (FĂRĂ cheia API)
// ══════════════════════════════════════════════════════════════
const EXPORT_KEYS = ['rali_presets', 'rali_road', 'rali_pen', 'rali_distcorr',
                     'rali_voicethr', 'rali_model', 'rali_theme', 'rali_batt_temp'];

function exportData() {
  const data = {};
  EXPORT_KEYS.forEach(k => { const v = ls(k); if (v != null) data[k] = v; });
  const json = JSON.stringify({ _app: 'RALI', _ver: BUILD, _at: new Date().toISOString(), data }, null, 2);
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rali-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {}
  navigator.clipboard?.writeText(json).catch(() => {});
  const s = el('set-status');
  if (s) { s.textContent = 'Backup exportat ✓ (fără cheia API)'; setTimeout(() => { s.textContent = ''; }, 3000); }
}

function importData() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const s = el('set-status');
      try {
        const obj = JSON.parse(r.result);
        // Doar backup-uri făcute de exportData (au _app: 'RALI'). Orice alt JSON e refuzat —
        // un fișier greșit înlocuia tăcut roadbook-ul și presetările, apoi reîncărca.
        if (!obj || obj._app !== 'RALI' || !obj.data || typeof obj.data !== 'object')
          throw new Error('Nu e un backup RALI');
        const data = obj.data;
        const found = EXPORT_KEYS.filter(k => data[k] != null);
        if (!found.length) throw new Error('Fișierul nu conține date RALI');
        // Structura valorilor critice — un rali_presets ne-array trecea de aici și arunca
        // în bindUI la următoarea pornire, lăsând aplicația fără butoane, nereparabilă
        // din interior (Import și câmpul de cheie se leagă tot în bindUI).
        const shape = { rali_presets: 'array', rali_road: 'array', rali_pen: 'object' };
        for (const k of found) {
          if (!shape[k]) continue;
          let v = data[k];
          if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { throw new Error(k + ' e corupt'); } }
          const ok = shape[k] === 'array' ? Array.isArray(v)
                                          : (v && typeof v === 'object' && !Array.isArray(v));
          if (!ok) throw new Error(k + ' are structură greșită');
        }
        if (!confirm(`Înlocuiesc ${found.length} seturi de date (presetări, roadbook, penalizări)?\nDatele actuale se pierd.`)) {
          if (s) s.textContent = 'Import anulat.';
          return;
        }
        // Plasă de salvare: starea de dinainte, recuperabilă manual dacă importul a fost o greșeală.
        try {
          localStorage.setItem('rali_pre_import', JSON.stringify(
            Object.fromEntries(EXPORT_KEYS.map(k => [k, ls(k)]))));
        } catch (e) {}
        let n = 0;
        found.forEach(k => {
          ls(k, typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k])); n++;
        });
        if (s) s.textContent = `Import reușit ✓ (${n} chei) — reîncarc…`;
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        if (s) s.textContent = '✗ Fișier invalid: ' + e.message;
      }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
function init() {
  // Legările de UI sunt grupate într-un try: dacă vreun element lipsește
  // (ex. HTML vechi din cache), nu mai blocăm pornirea GPS-ului de mai jos.
  try { bindUI(); } catch (err) { showFatal('init/bindUI: ' + err.message); }

  // Critice — rulează indiferent de erorile de mai sus:
  const bt = document.getElementById('build-tag');
  if (bt) bt.textContent = BUILD;
  try { acquireWakeLock(); } catch (_) {}
  try { gpsInit(); } catch (err) { showFatal('gpsInit: ' + err.message); }
  setInterval(gpsWatchdogTick, 1000);      // detectează fluxul GPS mort (vezi gpsWatchdogTick)
  try { checkResumeSessions(); } catch (err) { console.warn('resume:', err); }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
}

function bindUI() {
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
  el('btn-gps-retry')?.addEventListener('click', gpsRetry);

  // RT
  el('rt-spd').addEventListener('input', rtPreview);
  el('rt-dst').addEventListener('input', rtPreview);
  el('rt-distcorr').value = ls('rali_distcorr') || '0';
  el('rt-voicethr').value = ls('rali_voicethr') || '3';
  el('btn-rt-calib').addEventListener('click', rtCalibrate);
  el('btn-rt-addseg').addEventListener('click', () => rtAddSegRow());
  el('btn-rt-start').addEventListener('click', rtStart);
  el('btn-rt-stop').addEventListener('click', () => rtStop()); // fără arg => nu e auto-finish
  el('btn-rt-savepreset').addEventListener('click', savePreset);
  el('btn-rt-table')?.addEventListener('click', rtToggleTable);
  renderPresets();
  rtPreview();

  // Tools — TC countdown
  el('btn-tc-start').addEventListener('click', tcSet);
  el('btn-tc-sync').addEventListener('click', tcSyncPlus1);
  el('btn-tc-stop').addEventListener('click', tcStop);

  // Tools — battery
  el('btn-batt-calc').addEventListener('click', battCalc);
  if (el('batt-temp')) {
    el('batt-temp').value = ls('rali_batt_temp') || '';
    el('batt-temp').addEventListener('input', () => ls('rali_batt_temp', el('batt-temp').value));
  }

  // Tools — penalties
  renderPenalties();
  el('btn-pen-reset').addEventListener('click', resetPenalties);
  el('batt-quick')?.querySelectorAll('[data-km]').forEach(b =>
    b.addEventListener('click', () => { el('batt-km').value = b.dataset.km; }));

  // Îmbunătățirile pentru Sibiu (audit 2026-08-01) — toate cu ?. ca HTML-ul vechi din
  // cache să nu rupă restul legărilor
  el('btn-rt-arm')?.addEventListener('click', rtArmToggle);
  el('btn-rtoff-m100')?.addEventListener('click', () => rtOffset(-100));
  el('btn-rtoff-m10') ?.addEventListener('click', () => rtOffset(-10));
  el('btn-rtoff-p10') ?.addEventListener('click', () => rtOffset(10));
  el('btn-rtoff-p100')?.addEventListener('click', () => rtOffset(100));
  el('btn-nav-rt')?.addEventListener('click', navPrepRt);
  el('btn-eff-calc')?.addEventListener('click', effCalc);
  document.querySelectorAll('#eff-day-row .preset-chip').forEach(b =>
    b.addEventListener('click', () => effSelectDay(b)));
  const tco = el('tc-clockoff');
  if (tco) {
    tco.value = ls('rali_clockoff') || '0';
    tco.addEventListener('change', () => ls('rali_clockoff', tco.value));
  }

  // Theme
  applyTheme(S.cfg.theme);
  document.querySelectorAll('.theme-opt').forEach(b =>
    b.addEventListener('click', () => applyTheme(b.dataset.theme)));

  // NAV offset
  el('btn-nav-passed').addEventListener('click', navBoxPassed);
  el('btn-nav-jump')?.addEventListener('click', navJumpToBox);
  el('btn-off-m100').addEventListener('click', () => navOffset(-100));
  el('btn-off-m10').addEventListener('click',  () => navOffset(-10));
  el('btn-off-p10').addEventListener('click',  () => navOffset(10));
  el('btn-off-p100').addEventListener('click', () => navOffset(100));

  // Road Nav
  el('btn-nav-scan').addEventListener('click', navScan);
  el('btn-nav-clear').addEventListener('click', navClear);
  el('btn-nav-start').addEventListener('click', navStart);
  el('btn-nav-stop').addEventListener('click', navStop);
  el('btn-nav-scan-multi').addEventListener('click', navScanMulti);
  // Tolerant la null: dacă telefonul are încă HTML-ul vechi în cache, restul
  // legărilor de mai jos trebuie să se facă oricum.
  el('nav-leg-select')?.addEventListener('change', e => navSelectLeg(e.target.value));
  navRebuildBoxes();          // migrează roadbook-ul salvat (fără leg = un singur grup)
  navUpdateList();
  navRenderLegPicker();
  navStageConfirm();

  // RT Scan
  el('btn-rt-scan').addEventListener('click', rtScan);

  // Chat
  el('btn-send').addEventListener('click', sendChat);
  el('btn-chat-photo').addEventListener('click', chatPhoto);
  el('btn-chat-mic').addEventListener('click', micToggle);
  el('chat-in').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  document.querySelectorAll('.qbtn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.quiz) { quizHelper(); return; }
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
  // Cheia NU se rescrie în DOM la pornire — un nod input cu valoarea completă e o copie
  // în plus, gratuit de evitat. Placeholder-ul arată doar coada, ca să vezi CARE cheie e.
  if (S.cfg.apiKey) el('api-key').placeholder = 'salvată ✓ (…' + S.cfg.apiKey.slice(-4) + ')';
  el('model-sel').value  = S.cfg.model;

  el('btn-save-key').addEventListener('click', () => {
    const v = el('api-key').value.trim();
    // Câmp gol = „nu schimb nimic", nu „șterge cheia" — ștergerea din greșeală, în mașină,
    // ar lăsa scanarea și chatul moarte până acasă. Ștergerea se face tastând „sterge".
    if (!v) {
      const s0 = el('set-status');
      s0.textContent = S.cfg.apiKey ? 'Cheia rămâne cea salvată. Scrie „sterge" ca s-o elimini.' : 'Nicio cheie salvată.';
      setTimeout(() => { s0.textContent = ''; }, 3500);
      return;
    }
    S.cfg.apiKey = (v.toLowerCase() === 'sterge') ? '' : v;
    ls('rali_key', S.cfg.apiKey);
    el('api-key').value = '';
    el('api-key').placeholder = S.cfg.apiKey ? 'salvată ✓ (…' + S.cfg.apiKey.slice(-4) + ')' : 'sk-ant-api03-…';
    const s = el('set-status');
    s.textContent = S.cfg.apiKey ? 'API key salvat ✓' : 'Key șters.';
    setTimeout(() => { s.textContent = ''; }, 2500);
  });

  el('btn-test-voice').addEventListener('click', () => {
    const sta = el('voice-status');
    if (!window.speechSynthesis) {
      sta.textContent = '✗ speechSynthesis indisponibil pe acest browser';
      sta.style.color = 'var(--red)'; return;
    }
    // getVoices() e des GOL la primul apel pe Chrome (lista vine async, la voiceschanged)
    // — raporta fals „voce română indisponibilă" și îl speria degeaba.
    const report = () => {
      const voices = window.speechSynthesis.getVoices();
      const roVoice = voices.find(v => v.lang.startsWith('ro'));
      sta.style.color = roVoice ? 'var(--green)' : 'var(--yellow)';
      sta.textContent = roVoice
        ? `✓ Voce română găsită: ${roVoice.name}`
        : `⚠ Voce română indisponibilă — folosesc vocea implicită (${voices[0]?.name || '?'})`;
    };
    if (!window.speechSynthesis.getVoices().length) {
      sta.style.color = 'var(--dim)'; sta.textContent = '… încarc lista de voci';
      window.speechSynthesis.addEventListener('voiceschanged', report, { once: true });
      setTimeout(report, 1500);   // plasă: unele WebView-uri nu declanșează voiceschanged
    } else report();
    speak('Test voce copilot raliu. Stânga în 300 metri. Finish RT.', 1);
  });

  el('model-sel').addEventListener('change', () => {
    S.cfg.model = el('model-sel').value;
    ls('rali_model', S.cfg.model);
  });

  // Backup / restore date (fără cheia API)
  el('btn-export')?.addEventListener('click', exportData);
  el('btn-import')?.addEventListener('click', importData);
}

document.addEventListener('DOMContentLoaded', init);
