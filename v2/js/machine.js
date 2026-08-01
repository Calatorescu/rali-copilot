// RALI 2 · machine.js — dirijorul. O singură mașină de stări conduce toată ziua.
//
//   PREP ──start──▶ LIAISON ──aproape de probă──▶ (avertizare)
//     LIAISON ──linie standing, oprit──▶ STAGED ──pleacă──▶ RT_RUN
//     LIAISON ──linie auto, în mers────────────────────────▶ RT_RUN
//     RT_RUN ──finish + 50 m──▶ (rezultat + debrief) ──▶ LIAISON
//     LIAISON ──ultimul box──▶ DAY_END
//
// Toate dependențele sunt injectate (ceas, gps, voce, store, ui) — aceeași mașină
// rulează cursa reală, repetiția-fantomă, modul umbră și testele, pe același drum
// de cod. Kilometrul de traseu vine din proiecția pe urmă când există recunoaștere,
// altfel din odometrul fuzionat; „AM TRECUT DE BOX" (buton sau voce) rămâne suveran.

import { makeOdometer, projectOnTrace, angDiff } from './geo.js';
import { idealTimeS, deviationS, recoverySpeed, speedAt, bankingAdvice } from './pace.js';
import { TURN_DIRS } from './route.js';
import { secRo, distRo } from './voice.js';
import { makeDebrief } from './debrief.js';
import { parseRallyTime } from './time.js';

const TIERS_M = [300, 150];   // + „acum", calculat din modelul șoferului

export function makeMachine({ plan, clock, voice, store, ui, driver, opts = {} }) {
  const M = {
    state: 'PREP',
    routeKm: 0,            // km OFICIAL pe traseu
    traceM: null,          // poziția pe urmă (dacă există recunoaștere)
    speedKmh: 0,
    rtIdx: 0,
    rt: null,              // proba activă: { def, t0Mono, distKm, log, lastDev }
    nextBoxIdx: 0,
    results: {},
    tcs: [],               // [{name, time, rallyMs, km|null, warned:{}}]
    shadow: !!opts.shadow, // modul umbră: totul rulează, vocea tace, jurnalul ține minte
    ghost: !!opts.ghost,
    _ann: {}, _staged: false, _warnedRt: {}, _lastBank: 0,
    _turnAcc: 0, _lastHdg: null, _lastHdgT: 0, _quietMs: 0, _lastSnapT: 0,
    _lastToneT: 0, _extSpeedKmh: null, _extSpeedT: 0
  };
  const odo = makeOdometer();

  const say = (txt, prio, cat) => {
    if (M.shadow) { store.log('would_say', { txt }, clock.rally()); return; }
    voice.say(txt, prio, cat);
  };
  const tone = k => { if (!M.shadow) voice.tone(k); };
  const log = (type, data) => store.log(type, data, clock.rally());

  // ── programul TC ──────────────────────────────────────────────────────────
  function setTcSchedule(list) {
    M.tcs = list.map(tc => {
      // legăm ora de boxul TC corespunzător după ordine, dacă există
      return { ...tc, rallyMs: parseRallyTime(tc.time, clock), km: null, warned: {} };
    });
    const tcBoxes = plan.boxes.filter(b => b.flag === 'TC');
    M.tcs.forEach((tc, i) => { if (tcBoxes[i]) tc.km = tcBoxes[i].sumKm; });
    log('tc_schedule', { tcs: M.tcs.map(t => ({ name: t.name, time: t.time, km: t.km })) });
  }

  function tcTick() {
    for (const tc of M.tcs) {
      if (tc.rallyMs == null || tc.km == null || tc.km <= M.routeKm) continue;
      const minLeft = (tc.rallyMs - clock.rally()) / 60000;
      const kmLeft = tc.km - M.routeKm;
      const v = Math.max(15, M.speedKmh || 25);
      const etaMin = (kmLeft / v) * 60;
      for (const th of [5, 2, 1]) {
        if (minLeft <= th && !tc.warned[th]) {
          tc.warned[th] = true;
          const ok = etaMin <= minLeft - 0.3;
          say(`${tc.name} în ${th === 1 ? 'un minut' : th + ' minute'}, ${kmLeft.toFixed(1).replace('.', ' virgulă ')} kilometri. ${ok ? 'Ești bine.' : 'STRÂNGE.'}`, 3, 'tc');
          if (!ok) tone('alarm');
        }
      }
    }
  }

  // ── poziția ───────────────────────────────────────────────────────────────
  function onFix(fix) {
    const extFresh = M._extSpeedKmh != null && clock.mono() - M._extSpeedT < 3000;
    M.speedKmh = extFresh ? M._extSpeedKmh
      : (fix.speedMs != null ? fix.speedMs * 3.6 : M.speedKmh);

    const incM = odo.step(fix);
    if (plan.trace && plan.anchorMap) {
      // prima prindere pe urmă: căutare pe TOATĂ urma (poți porni de oriunde —
      // preluare, repornire la mijloc de leg); după aceea, fereastra monotonă
      // După o suspendare lungă (cameră, ecran stins) mașina poate fi cu mult peste
      // fereastra monotonă — la al 5-lea fix fără proiecție, căutăm pe TOATĂ urma.
      const fullScan = M.traceM == null || M._projMiss >= 5;
      const proj = fullScan
        ? projectOnTrace(plan.trace, fix.lat, fix.lng, 0, { backM: 1e9, fwdM: 1e9 })
        : projectOnTrace(plan.trace, fix.lat, fix.lng, M.traceM);
      if (proj) {
        M._projMiss = 0;
        M.traceM = proj.cumM;
        M.routeKm = plan.anchorMap.officialKm(proj.cumM);
      } else {
        // în afara coridorului: mergem pe odometru până revine proiecția
        M._projMiss = (M._projMiss || 0) + 1;
        if (M.traceM != null) M.traceM += incM;
        M.routeKm += incM / 1000;
      }
    } else {
      M.routeKm += incM / 1000;
      turnDetect(fix);   // fără geometrie, virajele rămân reperele de resincronizare
    }

    if (M.rt) {
      M.rt.distKm += incM / 1000;
      rtTick();
    }
    // STAGED e tot „legătură" din punctul de vedere al tick-ului: fără el aici,
    // plecarea de pe linia standing n-ar mai porni proba niciodată (prins de teste).
    if (M.state === 'LIAISON' || M.state === 'STAGED') liaisonTick();
    tcTick();
    if (clock.mono() % 5000 < 600) log('pos', { routeKm: r2(M.routeKm), kmh: Math.round(M.speedKmh) });
    ui.render(M, plan);
  }

  // ── legătura ──────────────────────────────────────────────────────────────
  function liaisonTick() {
    announceBoxes();

    const rt = plan.rts[M.rtIdx];
    if (!rt) {
      if (plan.totalKm && M.routeKm >= plan.totalKm - 0.03 && M.state !== 'DAY_END') dayEnd();
      return;
    }
    const dTo = rt.startKm - M.routeKm;

    if (dTo <= 0.5 && dTo > 0 && !M._warnedRt[rt.name]) {
      M._warnedRt[rt.name] = true;
      say(rt.kmh != null ? `Proba în 500. Viteza ${rt.kmh}.`
                         : `Proba în 500 — fără viteză setată, o sar.`, 3, 'race');
      // pacing predictiv: dacă proba începe cu o zonă lentă, spune planul de-acum
      if (rt.kmh != null && rt.zones && rt.zones.length) {
        const adv = bankingAdvice(0, rt.kmh, rt.zones, { lookaheadM: 800 });
        if (adv) say(`Plan: ia ${secRo(adv.bankS)} avans din start — zonă lentă la ${distRo(adv.inM)}.`, 2, 'bank');
      }
    }
    if (rt.kmh == null) {
      if (M.routeKm > rt.finishKm + 0.1) { M.rtIdx++; }
      return;
    }

    if (rt.type === 'standing') {
      if (!M._staged && Math.abs(dTo) <= 0.04 && M.speedKmh < 5) {
        M._staged = true; M.state = 'STAGED';
        say('La linie. Pornesc când pleci.', 3, 'race');
        ui.render(M, plan);
      } else if (M._staged && M.speedKmh > 6) rtStart(rt, 0);
      else if (!M._staged && M.routeKm >= rt.startKm && M.speedKmh > 6) rtStart(rt, M.routeKm - rt.startKm);
    } else if (M.routeKm >= rt.startKm) {
      rtStart(rt, M.routeKm - rt.startKm);
    }
  }

  function announceBoxes() {
    const boxes = plan.boxes;
    while (M.nextBoxIdx < boxes.length && M.routeKm > boxes[M.nextBoxIdx].sumKm + 0.08) M.nextBoxIdx++;
    const b = boxes[M.nextBoxIdx];
    if (!b) return;
    const dM = (b.sumKm - M.routeKm) * 1000;
    const silent = b.dir === 'ÎNAINTE' && !b.flag;   // „drept înainte" nu se rostește
    const key = `${b.num}_${Math.round(b.sumKm * 100)}`;
    const nowM = Math.max(25, driver.leadM(M.speedKmh || 30));  // anticipare personalizată

    const tiers = [...TIERS_M, nowM].sort((a, b2) => b2 - a);
    for (let ti = 0; ti < tiers.length; ti++) {
      const isNow = ti === tiers.length - 1;
      if (dM <= tiers[ti] && !M._ann[key + '_' + ti]) {
        for (let j = ti; j < tiers.length; j++) M._ann[key + '_' + j] = true;
        if (!silent) {
          say(turnText(b, dM, isNow), (isNow || M.rt) ? 3 : 2, 'turn');
          if (isNow) { driver.cueGiven(b.num, clock.wall()); log('cue', { boxNum: b.num }); }
        }
        break;
      }
    }
  }

  function turnText(b, dM, isNow) {
    const dp = distRo(Math.max(20, dM));
    switch (b.flag) {
      case 'TC': return isNow ? 'Time Control — ștampila' : `Time Control în ${dp}`;
      case 'RT_START_STANDING': return isNow ? 'Linia de start' : `Start probă în ${dp}`;
      case 'RT_START_AUTO': return isNow ? 'START probă' : `Start probă în ${dp}`;
      case 'RT_FINISH': return isNow ? 'FINISH' : `Finish în ${dp}`;
      case 'STOP-CFR': return isNow ? 'STOP — cale ferată' : `Cale ferată în ${dp} — vei opri`;
      case 'PARKING': return isNow ? 'Parcare' : `Parcare în ${dp}`;
      case 'EV': return isNow ? 'Stație de încărcare' : `Încărcare în ${dp}`;
    }
    const man = maneuver(b.dir, isNow);
    return isNow ? man : `${dp} — ${man}`;
  }

  function maneuver(dir, now) {
    switch (dir) {
      case 'STÂNGA': return now ? 'stânga acum' : 'stânga';
      case 'DREAPTA': return now ? 'dreapta acum' : 'dreapta';
      case 'STÂNGA-T': return now ? 'stânga acum, la T' : 'stânga la T';
      case 'DREAPTA-T': return now ? 'dreapta acum, la T' : 'dreapta la T';
    }
    if (/^GIRATORIU-/.test(dir || '')) return `giratoriu, ieșirea ${dir.slice(-1)}`;
    return 'manevră';
  }

  // ── proba ─────────────────────────────────────────────────────────────────
  function rtStart(rt, overshootKm) {
    M.state = 'RT_RUN'; M._staged = false;
    M.rt = { def: rt, t0Mono: clock.mono(), t0Rally: clock.rally(), distKm: 0, log: [], frozen: null };
    if (overshootKm > 0.001 && M.speedKmh > 10) {
      const backMs = (overshootKm * 1000 / (M.speedKmh / 3.6)) * 1000;
      M.rt.t0Mono -= backMs; M.rt.distKm = overshootKm;   // retro-datare la linie
    }
    say(`Start. Ține ${rt.kmh}.`, 3, 'race');
    tone('ok');
    log('rt_start', { rtIdx: M.rtIdx, name: rt.name, kmh: rt.kmh });
    ui.render(M, plan);
  }

  function rtTick() {
    const rt = M.rt, def = rt.def;
    const segs = [{ fromKm: 0, kmh: def.kmh }];
    const elapsed = (clock.mono() - rt.t0Mono) / 1000;
    const dev = rt.frozen != null ? rt.frozen : deviationS(elapsed, Math.min(rt.distKm, def.distKm), segs);
    rt.lastDev = dev;
    rt.log.push({ distKm: Math.min(rt.distKm, def.distKm), devS: dev });

    // linia calculată: îngheață devierea (nu opri lângă tabele — doar cifra îngheață)
    if (rt.frozen == null && rt.distKm >= def.distKm) {
      rt.frozen = dev;
      say(`Finish. ${secRo(Math.abs(dev))} ${dev >= 0 ? 'în urmă' : 'în avans'}. Nu opri lângă tabelă.`, 3, 'race');
    }

    // starea continuă prin TONURI, nu prin propoziții: la fiecare ~4 s, un semn scurt
    if (rt.frozen == null && clock.mono() - M._lastToneT > 4000 && elapsed > 5) {
      M._lastToneT = clock.mono();
      const a = Math.abs(dev);
      if (a <= 1) tone('ok'); else tone(dev < 0 ? 'ahead' : 'behind');
      // cuvinte doar când devierea depășește pragul — și scurt
      if (a > (def.voiceThr || 3)) {
        const rec = recoverySpeed(dev, rt.distKm, def.distKm, segs);
        say(`${secRo(a)} ${dev >= 0 ? 'în urmă' : 'în avans'}${rec ? `, ține ${Math.round(rec.kmh)}` : ''}`, 3, 'pace');
      }
      // banca de timp: zonele lente din față cer avans acum
      if (rt.zonesAdvised !== false && def.zones && def.zones.length && clock.mono() - M._lastBank > 15000) {
        const adv = bankingAdvice(rt.distKm * 1000, def.kmh, def.zones);
        if (adv) { M._lastBank = clock.mono(); say(`Bancă: ia ${secRo(adv.bankS)} avans — zonă lentă în ${distRo(adv.inM)}.`, 3, 'bank'); }
      }
    }

    // închiderea: 50 m după linia de finish
    if (rt.distKm >= def.distKm + 0.05) rtFinish();
  }

  function rtFinish() {
    const rt = M.rt, def = rt.def;
    const finalDev = rt.frozen != null ? rt.frozen : rt.lastDev || 0;
    const deb = makeDebrief(def, rt.log, finalDev);
    M.results[def.name] = deb.pts;
    log('rt_result', { rtIdx: M.rtIdx, name: def.name, pts: deb.pts, finalDevS: deb.finalDevS, worst: deb.lines });
    say(`Gata. ${secRo(Math.abs(finalDev))} ${finalDev >= 0 ? 'în urmă' : 'în avans'}.`, 3, 'race');
    M.lastDebrief = deb;

    // indexul sare pe boxul de după linia de finish — virajul următor se anunță IMEDIAT
    M.nextBoxIdx = Math.max(M.nextBoxIdx, def.finishIdx + 1);
    const fb = plan.boxes[def.finishIdx];
    if (fb) { const k = `${fb.num}_${Math.round(fb.sumKm * 100)}`; for (let t = 0; t < 3; t++) M._ann[k + '_' + t] = true; }
    const nb = plan.boxes[M.nextBoxIdx];
    if (nb) {
      const dTo = (nb.sumKm - M.routeKm) * 1000;
      if (dTo > -30 && dTo < 350 && (nb.dir !== 'ÎNAINTE' || nb.flag))
        say(`Urmează: ${turnText(nb, Math.max(20, dTo), dTo < 60)}`, 3, 'turn');
    }
    // debrieful vocal vine la 6 s după — întâi drumul, apoi lecția
    if (!M.shadow) setTimeout(() => { if (M.state === 'LIAISON') say(deb.voiceTxt, 1, 'debrief'); }, 6000);

    M.rt = null; M.rtIdx++; M.state = 'LIAISON';
    ui.render(M, plan);
  }

  function dayEnd() {
    M.state = 'DAY_END';
    log('day_end', { results: M.results });
    const total = Object.values(M.results).reduce((a, b) => a + b, 0);
    say(`Final de zi. Total regularitate: ${secRo(total)} puncte.`, 2);
    ui.render(M, plan);
  }

  // ── resincronizarea: butonul/vocea „sunt la box N" + virajele detectate ──
  function atBox(num) {
    const i = plan.boxes.findIndex(b => b.num === num);
    if (i === -1) { say(`Boxul ${num} nu există.`, 2); return false; }
    snapToBox(i, 'manual');
    say(`Setat box ${num}.`, 2);
    return true;
  }

  function snapToBox(i, how) {
    const b = plan.boxes[i];
    const before = M.routeKm;
    M.routeKm = b.sumKm + 0.02;
    if (plan.anchorMap) M.traceM = plan.anchorMap.traceM(M.routeKm);
    M.nextBoxIdx = i + 1;
    const deltaKm = M.routeKm - before;
    if (M.rt && Math.abs(deltaKm) < 0.5) M.rt.distKm = Math.max(0, M.rt.distKm + deltaKm);
    driver.turnDone(b.num, clock.wall());
    log('sync', { how, boxNum: b.num, deltaM: Math.round(deltaKm * 1000) });
    tone('tick');
    ui.render(M, plan);
  }

  function turnDetect(fix) {
    const hdg = fix.headingDeg;
    if (hdg == null || M.speedKmh < 8) { M._lastHdg = null; M._turnAcc = 0; return; }
    if (M._lastHdg == null || fix.tMs - M._lastHdgT > 5000) {
      M._lastHdg = hdg; M._lastHdgT = fix.tMs; M._turnAcc = 0; M._quietMs = 0; return;
    }
    const d = angDiff(hdg, M._lastHdg), dt = fix.tMs - M._lastHdgT;
    M._lastHdg = hdg; M._lastHdgT = fix.tMs;
    if (Math.abs(d) < 3) {
      M._quietMs += dt;
      if (M._quietMs > 2500 && Math.abs(M._turnAcc) >= 55) { trySnapTurn(M._turnAcc); M._turnAcc = 0; }
      else if (M._quietMs > 2500) M._turnAcc = 0;
    } else { M._turnAcc += d; M._quietMs = 0; }
  }

  function trySnapTurn(acc) {
    if (clock.mono() - M._lastSnapT < 10000) return;
    const right = acc > 0;
    let best = -1, gap = 0.35;
    for (let i = 0; i < plan.boxes.length; i++) {
      const b = plan.boxes[i];
      const g = Math.abs(b.sumKm - M.routeKm);
      if (g > gap || !TURN_DIRS.has(b.dir || '')) continue;
      const ok = /^GIRATORIU/.test(b.dir) || (right ? /^DREAPTA/.test(b.dir) : /^STÂNGA/.test(b.dir));
      if (!ok) continue;
      best = i; gap = g;
    }
    if (best === -1) return;               // conservator: fără candidat, fără snap
    M._lastSnapT = clock.mono();
    snapToBox(best, 'turn');
  }

  // ── API public ────────────────────────────────────────────────────────────
  return {
    M, onFix, atBox, setTcSchedule,
    start() {
      M.state = 'LIAISON';
      odo.reset();
      const faraViteza = plan.rts.filter(r => r.kmh == null).length;
      say(plan.rts.length
        ? (faraViteza ? `Pornit. ${plan.rts.length} probe, ${faraViteza} fără viteză.`
                      : `Pornit. ${plan.rts.length} probe, totul automat.`)
        : 'Pornit.', 2);
      log('day_start', { rts: plan.rts.map(r => ({ name: r.name, kmh: r.kmh, type: r.type })) });
      ui.render(M, plan);
    },
    stop() {
      if (M.rt) rtFinish();
      M.state = 'PREP';
      voice.flush();
      log('day_stop', {});
      ui.render(M, plan);
    },
    extSpeed(kmh) { M._extSpeedKmh = kmh; M._extSpeedT = clock.mono(); },   // priza BLE
    // După suspendare (ecran stins, cameră): performance.now poate să fi stat pe loc,
    // dar ceasul raliului nu — cronometrul probei se re-ancorează pe el.
    reanchor() {
      if (M.rt && M.rt.t0Rally != null) {
        M.rt.t0Mono = clock.mono() - (clock.rally() - M.rt.t0Rally);
      }
      M._projMiss = 5;   // primul fix după revenire face full-scan pe urmă
    },
    resume(st) {  // preluarea de pe alt telefon / după repornire
      M.routeKm = st.routeKm; M.rtIdx = st.rtIdx; M.results = {};
      if (plan.anchorMap) M.traceM = plan.anchorMap.traceM(st.routeKm);   // proiecția se re-prinde aici
      for (const [k, v] of Object.entries(st.done || {})) M.results[k] = v;
      M.state = st.state === 'DAY_END' ? 'DAY_END' : 'LIAISON';
      // proba în curs se reia cu ceasul de perete ancorat (ora raliului e comună)
      if (st.state === 'RT_RUN' && st.rtStartRally != null && plan.rts[st.rtIdx]) {
        const rt = plan.rts[st.rtIdx];
        M.state = 'RT_RUN';
        M.rt = { def: rt, t0Mono: clock.mono() - (clock.rally() - st.rtStartRally),
                 t0Rally: st.rtStartRally, distKm: Math.max(0, M.routeKm - rt.startKm), log: [], frozen: null };
      }
      // indexul boxurilor se aliniază pe poziție
      M.nextBoxIdx = 0;
      while (M.nextBoxIdx < plan.boxes.length && plan.boxes[M.nextBoxIdx].sumKm < M.routeKm - 0.05) M.nextBoxIdx++;
      say('Cursă preluată.', 2);
      log('takeover', { routeKm: r2(M.routeKm), state: M.state });
      ui.render(M, plan);
    }
  };
}

function r2(x) { return Math.round(x * 100) / 100; }
