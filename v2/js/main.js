// RALI 2 · main.js — cablajul: leagă modulele, ține meniul parcat, pornește cursa.

import { makeClock } from './time.js';
import { buildTrace } from './geo.js';
import { makeStore, exportDay, importDay, resumeStateFromJournal } from './store.js';
import { makeVoice, makeEars, secRo } from './voice.js';
import { makeLiveGps, makeSyntheticGps, makeReplayGps } from './gps.js';
import { buildPlan, detectRts, sanitizeBoxes } from './route.js';
import { makeMachine } from './machine.js';
import { makeDriverModel } from './learn.js';
import { makeUi, startHeaderClock } from './ui.js';
import { scanRoadbookPage, scanTimeCard } from './scan.js';
import { makeBleSpeed } from './ble.js';
import { makeSync } from './sync.js';
import { efficiencyPoints, efficiencyGap } from './pace.js';

const $ = id => document.getElementById(id);
let store, clock, voice, ui, driver, machine = null, gps = null, plan = null, sync = null;
let boxesRaw = [], reconRec = null;

async function init() {
  store = await makeStore();
  clock = makeClock();
  const off = parseFloat(localStorage.getItem('r2_clockoff') || '0');
  clock.setOffsetMs(off * 1000);
  voice = makeVoice({ audio: audioCtx() });
  ui = makeUi();
  driver = makeDriverModel(await store.get('driver_model') || {});
  startHeaderClock(clock);

  // cheia API: o refolosim pe cea a aplicației vechi dacă există (aceeași origine)
  if (!localStorage.getItem('r2_key') && localStorage.getItem('rali_key'))
    localStorage.setItem('r2_key', localStorage.getItem('rali_key'));

  // Sanitizat la ÎNCĂRCARE, nu doar la scanare: planul poate veni și din import
  // (fișier de pe alt telefon = conținut extern) sau dintr-un IndexedDB scris de o
  // versiune veche. Singurul punct prin care trec toate căile. (Audit 02.08.2026, P3.)
  boxesRaw = sanitizeBoxes((await store.get('plan_raw')) || []);
  await rebuildPlan();
  sync = makeSync({
    getToken: () => localStorage.getItem('r2_gh_token'),
    repo: localStorage.getItem('r2_gh_repo') || 'Calatorescu/rali-jurnale',
    exportFn: () => exportDay(store),
    onStatus: s => { const e = $('sync-st'); if (e) e.textContent = s; }
  });
  sync.startAuto();
  bind();
  try { navigator.wakeLock && await navigator.wakeLock.request('screen'); } catch (e) { $('cp-wake').classList.remove('hidden'); }
  // gestul utilizatorului deblochează des cererea refuzată — reîncercăm la primul tap
  document.addEventListener('click', async () => {
    try { await navigator.wakeLock.request('screen'); $('cp-wake').classList.add('hidden'); } catch (e) {}
  }, { once: true });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try { await navigator.wakeLock.request('screen'); } catch (e) {}
      // suspendarea putea opri performance.now — cronometrul probei se re-ancorează
      // pe ceasul raliului, iar proiecția face full-scan la primul fix
      if (machine) machine.reanchor();
    }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

let _audioCtx = null;
function audioCtx() { return () => (_audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)()); }

async function rebuildPlan() {
  const speeds = (await store.get('rt_speeds')) || {};
  const recon = await store.get('recon');
  plan = buildPlan(boxesRaw, speeds, recon || null);
  machine = makeMachine({ plan, clock, voice, store, ui, driver });
  // programul TC scanat ieri nu se pierde la repornire — se reîncarcă din stocare
  const tcs = await store.get('tc_schedule');
  if (tcs && tcs.length) machine.setTcSchedule(tcs);
  renderPrep();
  ui.render(machine.M, plan);
}

function renderPrep() {
  $('prep-boxes').textContent = boxesRaw.length
    ? `${boxesRaw.length} boxuri · 0–${plan.totalKm.toFixed(2)} km` : 'niciun box scanat';
  const rts = plan.rts;
  const wrap = $('prep-rts'); wrap.textContent = '';
  rts.forEach(rt => {
    const row = document.createElement('div'); row.className = 'prep-rt';
    const lbl = document.createElement('span');
    lbl.textContent = `${rt.name} · ${rt.distKm.toFixed(2)} km · ${rt.type}` +
      (rt.zones && rt.zones.length ? ` · ${rt.zones.length} zone lente` : '');
    const inp = document.createElement('input');
    inp.type = 'number'; inp.placeholder = 'km/h'; inp.min = 5; inp.max = 120; inp.step = 0.1;
    if (rt.kmh != null) inp.value = rt.kmh;
    inp.addEventListener('change', async () => {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (isFinite(v) && v >= 5 && v <= 120) {
        const speeds = (await store.get('rt_speeds')) || {};
        speeds[rt.key] = v; await store.put('rt_speeds', speeds);
        await rebuildPlan();
      }
    });
    const ok = document.createElement('b');
    ok.textContent = rt.kmh != null ? '✓' : '⚠';
    ok.style.color = rt.kmh != null ? 'var(--ok)' : 'var(--bad)';
    row.append(lbl, inp, ok); wrap.appendChild(row);
  });
  $('prep-recon').textContent = plan.trace
    ? `urmă: ${(plan.trace.totalM / 1000).toFixed(2)} km · ${plan.anchorMap ? plan.anchorMap.anchors.length + ' ancore' : 'fără ancore'}`
    : 'fără recunoaștere (merg pe odometru + viraje)';
}

// ── GPS live + cursă ────────────────────────────────────────────────────────
function startDay() {
  if (!plan.boxes.length) { alert('Scanează întâi roadbook-ul.'); return; }
  stopGps();
  gps = makeLiveGps({
    onFix: f => machine.onFix(f),
    onLost: () => voice.say('Atenție, GPS pierdut.', 3),
    onBack: () => voice.say('GPS revenit.', 2)
  });
  if (!gps.start()) { alert('GPS indisponibil.'); return; }
  machine.start();
  showScreen('run');
}

function stopGps() { if (gps) { gps.stop(); gps = null; } }

// ── recunoașterea: înregistrează urma + ancorele ────────────────────────────
function startRecon() {
  stopGps();
  reconRec = { raw: [], samples: [], anchors: [] };
  let cum = 0, lastPt = null;
  gps = makeLiveGps({
    onFix: f => {
      reconRec.raw.push({ lat: f.lat, lng: f.lng, tMs: f.tMs, speedMs: f.speedMs, accM: f.accM });
      if (lastPt) {
        const d = Math.hypot((f.lat - lastPt.lat) * 110574, (f.lng - lastPt.lng) * 111320 * Math.cos(f.lat * Math.PI / 180));
        if (d > 3 && d < 500) cum += d;
      }
      lastPt = f;
      if (f.speedMs != null) reconRec.samples.push({ cumM: cum, kmh: f.speedMs * 3.6 });
      $('rec-dist').textContent = (cum / 1000).toFixed(2) + ' km';
    },
    onLost: () => {}, onBack: () => {}
  });
  reconRec.cum = () => cum;
  gps.start();
  showScreen('recon');
  voice.say('Recunoaștere pornită. Marchează boxurile din mers.', 2);
}

async function reconMark() {
  const num = parseInt($('rec-box').value, 10);
  if (!isFinite(num)) { alert('Pune numărul boxului.'); return; }
  const b = boxesRaw.find(x => x.num === num);
  if (!b) { alert(`Boxul ${num} nu e în roadbook.`); return; }
  reconRec.anchors.push({ officialKm: b.sumKm, traceM: reconRec.cum() });
  voice.tone('tick'); voice.say(`Box ${num} marcat.`, 1);
  $('rec-box').value = String(num + 1);
  $('rec-anchors').textContent = reconRec.anchors.length + ' ancore';
}

async function reconStop() {
  stopGps();
  const trace = buildTrace(reconRec.raw);
  await store.put('recon', { trace, samples: reconRec.samples, anchors: reconRec.anchors, at: Date.now() });
  await rebuildPlan();
  voice.say(`Recunoaștere salvată: ${(trace.totalM / 1000).toFixed(1)} kilometri, ${reconRec.anchors.length} ancore.`, 2);
  showScreen('prep');
}

// ── repetiția-fantomă: aceeași mașină, sursă sintetică ──────────────────────
function rehearse() {
  if (!plan.rts.length || plan.rts.some(r => r.kmh == null)) { alert('Probele au nevoie de viteze.'); return; }
  const minute = Math.round((plan.totalKm / 45) * 60);
  if (!confirm(`Repetiție în timp REAL: ~${minute} minute, exact ritmul cursei.\n` +
               `Poți opri oricând cu STOP ZIUA. Pornim?`)) return;
  stopGps();
  // Mașină SEPARATĂ pentru repetiție: cea de cursă nu se atinge. La final se revine
  // la ea prin rebuildPlan() — altfel un START ZIUA de după repetiție ar fi pornit
  // pe mașina-fantomă, cu starea ei.
  const mach = makeMachine({ plan, clock, voice, store, ui, driver, opts: { ghost: true } });
  const speedPlan = cumM => {
    const km = plan.anchorMap ? plan.anchorMap.officialKm(cumM) : cumM / 1000;
    const rt = plan.rts.find(r => km >= r.startKm - 0.05 && km <= r.finishKm + 0.05);
    return rt ? rt.kmh : 45;
  };
  const gata = async () => {
    voice.say('Repetiție încheiată.', 2);
    stopGps();
    await rebuildPlan();     // înapoi la mașina de cursă, curată
    showScreen('prep');
  };
  gps = makeSyntheticGps({
    trace: plan.trace || { pts: [], totalM: plan.totalKm * 1000 },
    speedPlan, stepMs: 1000, delayMs: 1000,   // RITM REAL — fără asta inundă vocea și jurnalul
    t0: Date.now(),
    onFix: f => mach.onFix(f),
    onDone: gata
  });
  // Ordinea contează: dacă pornirea sursei crapă, NU rămânem cu mașina-fantomă în loc
  // de cea de cursă (așa arăta „aplicația s-a blocat" la testul din 2026-08-01).
  try {
    gps.start();
    mach.start();
    machine = mach;
    _rehearsing = true;
    showScreen('run');
  } catch (e) {
    stopGps();
    voice.say('Repetiția n-a putut porni.', 2);
    alert('Repetiția n-a putut porni: ' + (e && e.message ? e.message : e));
    rebuildPlan();
  }
}
let _rehearsing = false;

// ── scanări ─────────────────────────────────────────────────────────────────
function pickImages(multiple, cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; if (multiple) inp.multiple = true;
  window.addEventListener('focus', () => setTimeout(() => inp.remove(), 1000), { once: true });
  inp.onchange = () => {
    inp.remove();
    const files = [...(inp.files || [])].slice(0, 12);
    Promise.all(files.map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = () => res({ b64: r.result.split(',')[1], mime: f.type });
      r.readAsDataURL(f);
    }))).then(cb);
  };
  document.body.appendChild(inp); inp.click();
}

async function doScanRoadbook() {
  const key = localStorage.getItem('r2_key');
  if (!key) { alert('Pune cheia API în Setări.'); return; }
  pickImages(true, async imgs => {
    if (!imgs.length) return;
    const st = $('prep-scan-st'); st.textContent = '';
    const all = [...boxesRaw];
    for (let i = 0; i < imgs.length; i++) {
      st.textContent = `Scanez pagina ${i + 1}/${imgs.length}…`;
      try {
        const boxes = await scanRoadbookPage(key, imgs[i].b64, imgs[i].mime);
        for (const b of boxes) {
          const dupe = all.find(x => x.num === b.num && Math.abs(x.sumKm - b.sumKm) < 0.005);
          if (!dupe) all.push(b);
        }
      } catch (e) { st.textContent = '✗ ' + e.message; }
    }
    all.sort((a, b) => a.sumKm - b.sumKm);
    boxesRaw = all;
    await store.put('plan_raw', boxesRaw);
    await rebuildPlan();
    st.textContent = `✓ ${boxesRaw.length} boxuri, ${detectRts(boxesRaw).length} probe`;
  });
}

async function doScanTimecard() {
  const key = localStorage.getItem('r2_key');
  if (!key) { alert('Pune cheia API în Setări.'); return; }
  pickImages(false, async imgs => {
    if (!imgs.length) return;
    const st = $('prep-tc-st'); st.textContent = 'Citesc time card-ul…';
    try {
      const tcs = await scanTimeCard(key, imgs[0].b64, imgs[0].mime);
      await store.put('tc_schedule', tcs);
      machine.setTcSchedule(tcs);
      st.textContent = '✓ ' + tcs.map(t => `${t.name} ${t.time}`).join(' · ');
    } catch (e) { st.textContent = '✗ ' + e.message; }
  });
}

// ── jurnal: export / preluare ───────────────────────────────────────────────
async function doExport() {
  const dump = await exportDay(store);
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rali2-zi-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}

function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const dump = JSON.parse(r.result);
        if (!confirm('Import + PRELUARE cursă? Datele locale se înlocuiesc.')) return;
        await importDay(store, dump);
        // Sanitizat la ÎNCĂRCARE, nu doar la scanare: planul poate veni și din import
  // (fișier de pe alt telefon = conținut extern) sau dintr-un IndexedDB scris de o
  // versiune veche. Singurul punct prin care trec toate căile. (Audit 02.08.2026, P3.)
  boxesRaw = sanitizeBoxes((await store.get('plan_raw')) || []);
        await rebuildPlan();
        const st = resumeStateFromJournal(await store.journalAll());
        startDay();
        machine.resume(st);
      } catch (e) { alert('Import eșuat: ' + e.message); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ── ecrane + legături ───────────────────────────────────────────────────────
function showScreen(name) {
  for (const s of ['prep', 'run', 'recon', 'set']) $('scr-' + s).classList.toggle('hidden', s !== name);
}

function bind() {
  $('btn-start').addEventListener('click', startDay);
  $('btn-stop').addEventListener('click', async () => {
    machine.stop(); stopGps(); showScreen('prep');
    if (_rehearsing) {              // repetiție oprită din mers: înapoi la mașina de cursă
      _rehearsing = false;
      await rebuildPlan();
      return;                       // repetiția nu se raportează ca zi
    }
    if (sync) sync.pushNow('day_stop');
  });
  // ── Selectorul de box ────────────────────────────────────────────────────
  // Se apasă la volan, singur, uneori în probă. Deci: zero tastare, poziția
  // curentă vizibilă, distanța până la fiecare box, iar corecțiile mari spun
  // ce strică înainte s-o facă.
  const bp = $('boxpick');
  const bpInchide = () => { bp.classList.add('hidden'); $('bp-confirm').classList.add('hidden'); };

  function bpDeschide() {
    const M = machine.M;
    $('bp-now').textContent = M.routeKm.toFixed(2) + ' km';
    const urm = machine.M.nextBoxIdx;
    const b = plan.boxes[urm];
    $('bp-ctx').textContent = b
      ? `următorul box așteptat: ${b.num}, la ${Math.round((b.sumKm - M.routeKm) * 1000)} m`
      : 'după ultimul box';
    const lista = $('bp-list');
    lista.textContent = '';
    for (const c of machine.boxuriApropiate(7)) {
      const semn = c.deltaM >= 0 ? '+' : '−';
      const dist = Math.abs(c.deltaM) >= 1000
        ? (Math.abs(c.deltaM) / 1000).toFixed(2) + ' km' : Math.abs(c.deltaM) + ' m';
      // textContent, nu innerHTML: `comment` vine din scanarea Vision a unui roadbook —
      // document EXTERN. Un comentariu cu HTML (ajung 44 de caractere pentru un overlay
      // fullscreen pe style inline, pe care CSP-ul îl permite) s-ar randa fix în modalul
      // de corecție, fix când e deschis în probă. Confirmat la auditul din 02.08.2026, P2.
      const btn = document.createElement('button');
      btn.className = 'btn bp-item' + (c.idx === urm ? ' pri' : ' sec');
      const nume = document.createElement('b');
      nume.textContent = 'box ' + (c.box.num != null ? c.box.num : '?');
      const com = document.createElement('span');
      com.className = 'bp-com';
      com.textContent = (c.box.comment || '').split('/')[0].trim().slice(0, 44);
      btn.append(nume, document.createTextNode(` · ${semn}${dist}`), com);
      btn.addEventListener('click', () => bpAlege(c.box.num));
      lista.appendChild(btn);
    }
    bp.classList.remove('hidden');
  }

  function bpAlege(num, confirmat) {
    const r = machine.atBox(num, confirmat);
    if (r === true) { bpInchide(); return; }
    if (!r) return;
    // corecție mare sau probă în joc — se cere confirmarea, cu cifra pe ecran
    const semn = r.deltaM >= 0 ? 'ÎNAINTE' : 'ÎNAPOI';
    $('bp-warn').textContent =
      `Te mută ${semn} ${Math.abs(r.deltaM)} m` + (r.rupeRt ? ` și ${r.rupeRt}` : '') + '.';
    $('bp-confirm').classList.remove('hidden');
    $('bp-yes').onclick = () => bpAlege(num, true);
    $('bp-no').onclick = () => $('bp-confirm').classList.add('hidden');
  }

  $('btn-atbox').addEventListener('click', bpDeschide);
  $('bp-close').addEventListener('click', bpInchide);
  $('btn-talk').addEventListener('click', () => {
    const ears = makeEars({ onCommand: c => {
      if (c.cmd === 'at_box') {
        // Pe voce nu se execută corecții mari: recunoașterea vocală greșește un
        // număr mult mai ușor decât un deget greșește un buton dintr-o listă.
        const r = machine.atBox(c.num);
        if (r !== true && r) {
          voice.say(`Boxul ${c.num} te-ar muta ${Math.abs(r.deltaM)} metri. ` +
                    `Confirmă pe ecran, la SUNT LA BOX.`, 3, 'sync');
        }
      }
      else if (c.cmd === 'status') {
        const M = machine.M;
        if (M.rt) voice.say(`${secRo(Math.abs(M.rt.lastDev || 0))} ${((M.rt.lastDev || 0) >= 0) ? 'în urmă' : 'în avans'}.`, 3);
        else voice.say(`Kilometrul ${M.routeKm.toFixed(1).replace('.', ' virgulă ')}.`, 2);
      }
      else if (c.cmd === 'speed') voice.say(`${Math.round(machine.M.speedKmh)} km pe oră.`, 2);
      else voice.say('N-am înțeles.', 1);
    } });
    if (!ears.listen()) voice.say('Microfonul nu e disponibil.', 1);
  });
  $('btn-scan-rb').addEventListener('click', doScanRoadbook);
  $('btn-scan-tc').addEventListener('click', doScanTimecard);
  $('btn-clear-rb').addEventListener('click', async () => {
    if (!confirm('Ștergi roadbook-ul și recunoașterea?')) return;
    boxesRaw = []; await store.del('plan_raw'); await store.del('recon');
    await store.del('rt_speeds'); await rebuildPlan();
  });
  $('btn-recon').addEventListener('click', startRecon);
  $('btn-rec-mark').addEventListener('click', reconMark);
  $('btn-rec-stop').addEventListener('click', reconStop);
  $('btn-rehearse').addEventListener('click', rehearse);
  $('btn-export').addEventListener('click', doExport);
  $('btn-import').addEventListener('click', doImport);
  $('btn-set').addEventListener('click', () => showScreen('set'));
  $('btn-set-back').addEventListener('click', () => showScreen('prep'));
  $('btn-journal-clear').addEventListener('click', async () => {
    if (confirm('Jurnal nou (zi nouă)?')) { await store.journalClear(); }
  });
  // setări
  const key = $('set-key');
  key.placeholder = localStorage.getItem('r2_key') ? 'salvată ✓' : 'sk-ant-…';
  $('btn-set-key').addEventListener('click', () => {
    const v = key.value.trim();
    if (v) { localStorage.setItem('r2_key', v); key.value = ''; key.placeholder = 'salvată ✓'; }
  });
  const co = $('set-clockoff');
  co.value = localStorage.getItem('r2_clockoff') || '0';
  co.addEventListener('change', () => {
    localStorage.setItem('r2_clockoff', co.value);
    clock.setOffsetMs((parseFloat(co.value) || 0) * 1000);
  });
  const gt = $('set-ghtoken');
  gt.placeholder = localStorage.getItem('r2_gh_token') ? 'salvat ✓' : 'github_pat_…';
  $('btn-set-ghtoken').addEventListener('click', () => {
    const v = gt.value.trim();
    if (v) { localStorage.setItem('r2_gh_token', v); gt.value = ''; gt.placeholder = 'salvat ✓'; sync.pushNow('setup'); }
  });
  $('btn-sync-now').addEventListener('click', () => sync.pushNow('manual'));
  $('btn-ble').addEventListener('click', async () => {
    const ble = makeBleSpeed({
      onSpeedKmh: kmh => machine.extSpeed(kmh),
      onStatus: s => { $('ble-st').textContent = s; }
    });
    await ble.connect({
      serviceUuid: $('ble-svc').value.trim() || undefined,
      charUuid: $('ble-chr').value.trim() || undefined
    });
  });
  // Bateria — acum doar pentru autonomie. Implicit 75 (utilizabil), nu 82: cifra de 82
  // era a mea și nu e susținută de nicio sursă pentru Model Y Juniper AWD LR.
  const battInp = $('set-batt');
  battInp.value = localStorage.getItem('r2_batt') || '75';
  battInp.addEventListener('change', () => localStorage.setItem('r2_batt', battInp.value));

  // Eficiența — A.R.E.S. art. 6.3. Cifra declarată se ține minte: se află o dată,
  // la verificările administrative, și nu e sigură (sursele publice dau 148-166).
  const declInp = $('eff-decl');
  declInp.value = localStorage.getItem('r2_eff_decl') || '153';
  const effCalc = () => {
    const num = v => parseFloat(String(v).replace(',', '.'));
    const decl = num(declInp.value), real = num($('eff-cons').value);
    if (!isFinite(decl)) { $('eff-out').textContent = 'Pune consumul declarat de producător.'; return; }
    localStorage.setItem('r2_eff_decl', String(decl));
    if (!isFinite(real)) {
      $('eff-out').textContent = `Declarat ${decl} Wh/km. Pune realizatul, din tabul A.R.C (meniul Trips).`;
      return;
    }
    const pef = efficiencyPoints(decl, real);
    const gap = efficiencyGap(decl, real);
    $('eff-out').textContent = `(${decl} − ${real}) × 2 = ` +
      (pef >= 0 ? `+${pef.toFixed(0)} puncte CÂȘTIGATE. ` : `${pef.toFixed(0)} puncte, te trag ÎN JOS. `) +
      (gap ? `Până la zero îți trebuie ${gap} Wh/km mai puțin. ` : '') +
      `1 Wh/km = 2 puncte. Clasament: eficiență − penalizări + bonus, câștigă cine are mai mult.`;
  };
  declInp.addEventListener('change', effCalc);
  $('eff-cons').addEventListener('change', effCalc);
  effCalc();

  window.addEventListener('beforeunload', async () => {
    await store.put('driver_model', driver.toJSON());
  });
}

document.addEventListener('DOMContentLoaded', init);
