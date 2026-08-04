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

import { makeOdometer, makeCalibrator, projectOnTrace, angDiff, haversineM,
         bearingDeg, traceAheadPoint, directieRo } from './geo.js';
import { idealTimeS, deviationS, speedAt, bankingAdvice } from './pace.js';
import { TURN_DIRS } from './route.js';
import { secRo, distRo } from './voice.js';
import { makeDebrief } from './debrief.js';
import { parseRallyTime } from './time.js';

const TIERS_M = [300, 150];   // + „acum", calculat din modelul șoferului

// COADA anunțului „acum" — ce urmează DUPĂ manevra tocmai anunțată (cererea lui Andreas,
// 04.08.2026: „fă acum la dreapta și următoarea la stânga", „fă acum stânga și în 300 de
// metri la dreapta"). Pragurile, cu jurnalele reale în față (02-04.08.2026):
//  • manevrele consecutive din roadbook-urile conduse până acum sunt la 30, 70 și 90 m
//    (bucla József), apoi sar direct la 2600 m. Între 100 și 2500 m nu s-a măsurat NIMIC,
//    deci pragurile nu pot fi citite dintr-o distribuție — se aleg pe TIMP, la vitezele
//    măsurate acolo (în buclă: mediana 18 km/h; pe legătură: mediana 37, p90 61 km/h).
//  • 80 m ≈ 5 s la 61 km/h și ≈ 8 s la 37 km/h. Sub atât, o cifră („în 50 de metri") e
//    consumată înainte să se termine fraza care o rostește, deci se spune „imediat".
//    Regula veche de boxuri înlănțuite tăia la 60 m și lăsa pe dinafară exact bucla din
//    04.08 (70 și 90 m între manevre) — de-aia pragul urcă la 80.
//  • 500 m e primul prag peste treapta de 300 m: de acolo în sus manevra își primește
//    oricum anunțul propriu în câteva secunde, iar coada n-ar face decât să lungească
//    fraza fix în virajul în care pilotul are nevoie de cuvinte puține.
const COADA_IMEDIAT_M = 80;
const COADA_MAX_M = 500;

// CÂT DE DEVREME POATE FI ROSTIT „ACUM". Anticiparea vine din modelul șoferului
// (learn.js), dar are nevoie de un plafon aici, la consumator: „acum" e un cuvânt care
// spune „pune mâna pe volan", iar la 120 m de intersecție e pur și simplu fals.
//
// Măsurat în tura Tresor (04.08.2026): cele 14 anunțuri „acum" au plecat cu 32, 40, 59,
// 62, 63, 81, 98, 101, 115, 121, 122, 124, 34 și 13 m înainte de box — la 49-59 km/h,
// între 100 și 124 m. Două efecte, ambele rele: pilotul aude „stânga acum" cu 7 secunde
// prea devreme, iar anunțul se lipește de treapta de 150 m și o taie la mijloc de cuvânt
// (măsurat: 5 fraze de manevră aruncate cu „intrerupt", toate în aceeași secundă cu
// „acum"-ul aceluiași box). 60 m = 3,6 s la 60 km/h și 4,3 s la 50 — destul ca să pui
// mâna pe volan, prea puțin ca să uiți până acolo. Podeaua de 25 m rămâne.
const ACUM_MAX_M = 60;

// VIRAJUL DE IMEDIAT DUPĂ LINIA DE FINISH intră în anunțul de finish, dinainte.
// Tura Tresor, 04.08.2026, RT 2: boxul 11 e FINISH la km 3,50, boxul 12 e o stângă la
// 3,55 — 50 m după tabelă. Ce s-a întâmplat, din jurnal: „stânga acum" a plecat la
// 16:34:28, la 13 m de viraj, și a intrat în coadă în spatele frazei de finish („Finish.
// 33 virgulă 8 în urmă. Nu opri lângă tabelă.", ~4 s), iar rezultatul probei a venit la
// 16:34:31. Pilotul era deja în intersecție. Cauza de fond: în probă lista de boxuri
// tace, iar linia de finish se procesează prima — deci singurul moment în care manevra
// mai poate fi spusă la timp e ÎNAINTE de linie, în anunțul liniei.
// 200 m: la Sibiu virajul de după tabela roșie e cazul obișnuit, iar ambele finish-uri
// din tura asta au manevra la 50 și la 140 m. Peste 200 m manevra își primește oricum
// anunțurile ei normale, după ce proba s-a închis.
const COADA_FINISH_M = 200;

// ── IEȘIREA DE PE TRASEU ────────────────────────────────────────────────────
// Cererea lui Andreas (04.08.2026): „să verifice pe GPS unde sunt și dacă o iau pe alt
// drum să-și dea seama și să-mi refacă traseul înapoi cât mai repede".
//
// Cazul-etalon e tot tura Tresor, secvența 16:34:28-16:39:01: virajul de la boxul 12
// (stânga, la 55 m după finish-ul probei 2) a fost ratat, iar aplicația a continuat ca
// și cum nimic — ba mai rău, a POTRIVIT viraje de pe drumul greșit cu boxuri din
// roadbook (sync „turn" pe boxul 13 cu −92 m la 16:37:18, pe boxul 17 cu −133 m la
// 16:39:01) și a dat cue-uri pentru boxurile 15, 16, 17, 18. Primele avertizări de
// desincronizare au venit abia la 259 și 261 m după boxuri (16:38:05 și 16:38:25).
//
// PRAGURILE, din secvența aia:
//  • 120 m — cât se lasă un box de manevră în urmă, fără viraj confirmat, până devine
//    SEMN. Măsurat: la 16:35:11 mașina era deja la 140 m după boxul 12, adică semnul
//    exista la ~40 s după virajul ratat; regula veche de 250 m l-a produs abia după
//    3 minute și jumătate. Sub 120 m nu se coboară: atâta poate greși singură poziția
//    după o gaură de GPS (măsurat în aceeași tură: sărituri de podea de 58 și 24 m).
//  • DOUĂ semne independente, în 3 minute, ca să se declare starea. Un singur semn
//    poate fi poziția, nu drumul — exact confuzia care a născut „te-am prins, recalez".
//    Excepție: cu geometrie de recunoaștere, ieșirea din coridor e semn SINGUR și
//    decisiv, fiindcă e singura măsurătoare care spune direct „nu sunt pe drumul ăla".
//  • 20 s de liniște după revenirea GPS-ului. În secvența etalon sunt două găuri de
//    16 s (16:35:40 și 16:36:38); poziția de imediat după e cea mai proastă din zi și
//    n-are voie să declare nimic.
//  • 40° — sub atât, drumul pe la boxul ăla a fost DREPT. Peste, s-a virat acolo, chiar
//    dacă detectorul n-a prins virajul (măsurat 03.08: un viraj sub 8 km/h nu produce
//    nicio detectare, în ambele ture). Fără discriminarea asta, două viraje reale dar
//    nedetectate ar declara „ai ieșit de pe traseu" fix acolo unde pilotul conduce bine.
const OFF_BOX_M = 120, OFF_SEMNE_CERUTE = 2, OFF_FEREASTRA_MS = 180000;
const OFF_DUPA_GPS_MS = 20000, OFF_PRINS_M = 40, OFF_VORBA_MS = 12000;
const OFF_COT_GRD = 40, OFF_DRIFT_M = 250, OFF_VORBA_MAX_M = 2000;

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
    _ann: {}, _staged: false, _warnedRt: {}, _lastBank: 0, _coadaFinish: null,
    _turnAcc: 0, _lastHdg: null, _lastHdgT: 0, _quietMs: 0, _lastSnapT: 0, _virajRefuzat: null,
    _dirEtapa: 0, _dirStart: null, dirAlerta: null,
    _lastToneT: 0, _extSpeedKmh: null, _extSpeedT: 0,
    corectie: null,        // ultima corecție de poziție, pentru ECRAN (vezi anuntaCorectia)
    // ieșirea de pe traseu: starea, semnele strânse și firimiturile de drum
    offRoute: null, offRouteOn: opts.offRoute !== false, _offSemne: [], _urme: [],
    _offVorbaMono: 0, _offSector: null, _hdg: null,
    // auto-calibrarea odometrului (vezi calibreaza + makeCalibrator din geo.js)
    calFactor: 1, _rawSinceAnchor: 0, _calAnchorKm: 0, _calN: 0,
    _anchorKm: 0,
    // poziția absolută: ancora geografică + cât s-a curbat drumul de la ea
    _anchorPos: null, _lastPos: null, _curveDeg: 0, _curveHdg: null
  };
  const odo = makeOdometer();
  let cal = makeCalibrator();

  // `cls` = clasa de anunț pentru coada de voce: 'manevra' (unde se virează) sau
  // 'ritm' (secunde, viteze, bancă). Regula cerută de Andreas: ritmul nu taie niciodată
  // manevra. Vezi voice.js.
  const say = (txt, prio, cat, cls) => {
    if (M.shadow) { store.log('would_say', { txt }, clock.rally()); return; }
    voice.say(txt, prio, cat, cls);
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
    let urmator = null;
    for (const tc of M.tcs) {
      if (tc.rallyMs == null || tc.km == null || tc.km <= M.routeKm) continue;
      if (!urmator || tc.rallyMs < urmator.rallyMs) urmator = tc;
      const minLeft = (tc.rallyMs - clock.rally()) / 60000;
      const kmLeft = tc.km - M.routeKm;
      const v = Math.max(15, M.speedKmh || 25);
      const etaMin = (kmLeft / v) * 60;
      for (const th of [5, 2, 1]) {
        if (minLeft <= th && !tc.warned[th]) {
          tc.warned[th] = true;
          const ok = etaMin <= minLeft - 0.3;
          say(`${tc.name} în ${th === 1 ? 'un minut' : th + ' minute'}, ${kmLeft.toFixed(1).replace('.', ' virgulă ')} kilometri. ${ok ? 'Ești bine.' : 'STRÂNGE.'}`, 3, 'tc', 'ritm');
          if (!ok) tone('alarm');
        }
      }
    }
    // Banda permanentă de pe ecran (propunerea 4): avertizările vocale se pot pierde
    // în coadă — cifra de TC trebuie să existe și vizual, tot timpul.
    if (urmator) {
      const minLeft = (urmator.rallyMs - clock.rally()) / 60000;
      const kmLeft = urmator.km - M.routeKm;
      const v = Math.max(15, M.speedKmh || 25);
      M.tcBand = { name: urmator.name, minLeft, kmLeft, ok: (kmLeft / v) * 60 <= minLeft - 0.3 };
    } else M.tcBand = null;
  }

  // ── poziția ───────────────────────────────────────────────────────────────
  function onFix(fix) {
    // După o gaură lungă de GPS, tick() a avansat deja poziția pe estimare —
    // odometrul NU are voie să adune și el aceeași gaură (fixul nou vs. cel vechi).
    if (M._lastFixMono != null && clock.mono() - M._lastFixMono > 15000) {
      odo.reset();
      // momentul revenirii semnalului: poziția de imediat după o gaură e cea mai proastă
      // din zi, deci nu are voie să declare ieșirea de pe traseu (vezi OFF_DUPA_GPS_MS)
      M._gpsRevenitMono = clock.mono();
    }
    M._lastFixMono = clock.mono();
    M._lastPos = { lat: fix.lat, lng: fix.lng };
    // Prima ancoră geografică = primul fix după START. La start() poziția încă nu e
    // cunoscută (n-a venit niciun fix), deci se pune aici — altfel poziția absolută
    // n-ar avea niciodată de unde pleca și corecția n-ar porni deloc.
    if (!M._anchorPos && M.state !== 'PREP') {
      M._lastPos = { lat: fix.lat, lng: fix.lng };
      ancoreazaGeo(M.routeKm);
      M._calAnchorKm = M.routeKm; M._rawSinceAnchor = 0;
    }
    // punctul de plecare al leg-ului, pentru paznicul de direcție
    if (!M._dirStart && M.state !== 'PREP') M._dirStart = { lat: fix.lat, lng: fix.lng };
    // cât s-a curbat drumul de la ultima ancoră (sumă de valori ABSOLUTE: și un „S"
    // care revine la aceeași direcție e tot drum mai lung decât linia dreaptă)
    if (fix.headingDeg != null && M.speedKmh > 8) {
      if (M._curveHdg != null) M._curveDeg += Math.abs(angDiff(fix.headingDeg, M._curveHdg));
      M._curveHdg = fix.headingDeg;
    }
    // corecția stă pe ecran 20 s, apoi dispare singură — și când e rostită, și când nu
    if (M.corectie && clock.mono() > M.corectie.panaMono) M.corectie = null;
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
        // Trei fixuri la rând în afara coridorului de recunoaștere = singura măsurătoare
        // care spune DIRECT „nu sunt pe drumul ăla". De-aia e semn singur și decisiv.
        // (În tura Tresor n-a existat: recunoașterea era goală, plan.trace null.)
        if (M._projMiss >= 3) semnOffRoute('in_afara_coridorului', null, M.nextBoxIdx);
      }
    } else {
      // Fără geometrie (cazul REAL de la Sibiu: roadbook-ul vine cu o oră înainte de
      // start, deci recunoaștere nu există), poziția vine din odometru — corectat cu
      // factorul învățat din roadbook, vezi calibrează().
      M.routeKm += (incM / 1000) * M.calFactor;
      M._rawSinceAnchor += incM / 1000;
      pozitieAbsoluta(fix);   // vezi mai jos — GPS-ul nu e doar odometru
      turnDetect(fix);        // virajele rămân reperele de resincronizare
    }

    if (M.rt) {
      // Distanța din probă se DERIVĂ din poziția pe traseu, nu se adună separat.
      // Altfel proba și-ar duce propriul odometru, cu propriile erori, exact acolo
      // unde precizia decide puncte — iar corecțiile de poziție n-ar ajunge la ea.
      M.rt.distKm = Math.max(0, M.routeKm - M.rt.def.startKm);
      rtTick();
    }
    // Navigația vorbește în TOATE stările active — inclusiv în probă. Versiunea veche
    // anunța virajele doar în legătură: în RT_RUN pilotul ținea viteza pe drum
    // necunoscut și nimeni nu-i mai spunea unde se virează, iar ecranul îngheța pe
    // boxul de start toată proba. (Audit 02.08, #2.)
    // FIRIMITURILE de drum: unde am fost, la ce kilometru credeam că sunt. Fără
    // recunoaștere, ăsta e SINGURUL loc din care se poate afla poziția geografică a
    // unui box — și fără ea, „întoarce-te la boxul 12" n-ar avea unde să arate.
    if (M.state !== 'PREP' && fix.lat != null) {
      const u = M._urme[M._urme.length - 1];
      if (!u || haversineM(u.lat, u.lng, fix.lat, fix.lng) >= 10) {
        M._urme.push({ lat: fix.lat, lng: fix.lng, km: M.routeKm });
        if (M._urme.length > 800) M._urme.shift();     // ~8 km de drum, memorie neglijabilă
      }
    }
    if (fix.headingDeg != null && M.speedKmh > 5) M._hdg = fix.headingDeg;
    if (M.state !== 'PREP' && M.state !== 'DAY_END') {
      directieCheck(fix);
      offRouteCheck(); offRouteGhidaj(fix);
      announceBoxes(); desyncCheck();
    }
    // STAGED e tot „legătură" din punctul de vedere al tick-ului: fără el aici,
    // plecarea de pe linia standing n-ar mai porni proba niciodată (prins de teste).
    // Pe dinafară nu se pornește nicio probă: kilometrajul de pe drumul greșit ar
    // trece „linia de start" într-un loc care n-are nicio legătură cu ea.
    if ((M.state === 'LIAISON' || M.state === 'STAGED') && !M.offRoute) liaisonTick();
    tcTick();
    // Jurnalul poziției: o dată la 5 s de timp REAL. Testul cu fereastra pe modulo
    // („mono % 5000 < 600") scria de zeci de ori pe secundă când fixurile veneau rapid —
    // fiecare scriere e o tranzacție IndexedDB, iar telefonul s-a blocat.
    if (!M._lastPosLog || clock.mono() - M._lastPosLog >= 5000) {
      M._lastPosLog = clock.mono();
      // Coordonatele intră în jurnal, nu doar kilometrajul. Fără ele, un debrief nu
      // poate verifica NIMIC — pe 02.08.2026 n-am putut spune unde era mașina când
      // s-a apăsat greșit un box, doar ce credea aplicația. Deducție, nu măsurătoare.
      // 6 zecimale = ~0,1 m, mai mult decât precizia oricărui GPS de telefon.
      log('pos', { routeKm: r2(M.routeKm), kmh: Math.round(M.speedKmh),
                   lat: r6(fix.lat), lng: r6(fix.lng),
                   accM: fix.accM != null ? Math.round(fix.accM) : null });
    }
    ui.render(M, plan);
  }

  // ── PAZNICUL DE DIRECȚIE ─────────────────────────────────────────────────
  // 03.08.2026, Leg 2: roadbook-ul cerea la start o stângă peste linie dublă continuă —
  // manevră ilegală. Andreas a făcut singura variantă legală (dreapta, spre nord-est),
  // aplicația conducea traseul spre sud-vest, și NIMIC n-a spus nimic: proba a pornit
  // singură după 370 m de mers în direcția opusă. Măsurat în jurnal: deplasarea față de
  // punctul de plecare creștea monoton — 121 m la 11 s, 314 m la 34 s, 2897 m la capăt.
  //
  // Pragurile, alese din datele alea:
  //  • 120 m deplasare în linie dreaptă — la 50 km/h vine în ~9 s, iar la 120 m mașina
  //    e deja pe drum, nu în manevra de ieșire din parcare (sub 100 m, azimutul e
  //    zgomotul unui fix de 4-8 m);
  //  • 110° diferență — un viraj normal la prima intersecție schimbă direcția cu cel
  //    mult 90°, deci 110° nu se mai poate atinge decât mergând în sens opus. La bucla
  //    József, unde direcția se schimbă des, coarda primilor 120 m e NE și pentru mașină,
  //    și pentru urmă — deci nu latră.
  // Fără geometrie de recunoaștere, paznicul TACE: roadbook-ul n-are direcții absolute,
  // iar a ghici din el ar însemna alarme inventate.
  const DIR_PRAG_M = 120, DIR_PRAG_GRD = 110;

  function directieCheck(fix) {
    if (M._dirEtapa >= 2 || !M._dirStart) return;
    if (!plan.trace || !plan.trace.pts || plan.trace.pts.length < 2) return;
    const strM = haversineM(M._dirStart.lat, M._dirStart.lng, fix.lat, fix.lng);
    if (strM < DIR_PRAG_M * (M._dirEtapa + 1)) return;
    // de unde pleacă traseul: kilometrul primului box al leg-ului, tradus pe urmă
    const m0 = plan.anchorMap && plan.boxes.length
      ? plan.anchorMap.traceM(plan.boxes[0].sumKm) : 0;
    const seg = traceAheadPoint(plan.trace, Math.max(0, m0), strM);
    if (!seg) { M._dirEtapa = 2; return; }        // urma se termină — n-avem cu ce compara
    const mers = bearingDeg(M._dirStart.lat, M._dirStart.lng, fix.lat, fix.lng);
    const traseu = bearingDeg(seg.from.lat, seg.from.lng, seg.to.lat, seg.to.lng);
    const dif = Math.abs(angDiff(mers, traseu));
    M._dirEtapa++;
    if (dif <= DIR_PRAG_GRD) { M._dirEtapa = 2; M.dirAlerta = null; return; }
    M.dirAlerta = { text: `Direcție greșită — traseul pleacă spre ${directieRo(traseu)}`,
                    difGrd: Math.round(dif) };
    say(`Direcție greșită. Traseul pleacă spre ${directieRo(traseu)}. Verifică unde ești.`,
        4, 'dir', 'manevra');
    tone('alarm');
    log('directie_gresita', { difGrd: Math.round(dif), azimutMers: Math.round(mers),
                              azimutTraseu: Math.round(traseu), deplasareM: Math.round(strM),
                              aDouaOara: M._dirEtapa >= 2 });
  }

  // ── legătura ──────────────────────────────────────────────────────────────
  // (announceBoxes/desyncCheck au urcat în onFix — rulează în toate stările active)
  function liaisonTick() {
    const rt = plan.rts[M.rtIdx];
    if (!rt) {
      // pe dinafară, kilometrajul crește pe drumuri care nu sunt ale traseului — ziua
      // n-are voie să se declare terminată din rătăcire
      if (plan.totalKm && M.routeKm >= plan.totalKm - 0.03 && M.state !== 'DAY_END' && !M.offRoute) dayEnd();
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
        if (adv) say(`Plan: ia ${secRo(adv.bankS)} avans din start — zonă lentă la ${distRo(adv.inM)}.`, 2, 'bank', 'ritm');
      }
    }
    if (rt.kmh == null) {
      if (M.routeKm > rt.finishKm + 0.1) { M.rtIdx++; }
      return;
    }

    if (rt.type === 'standing') {
      // fereastra de armare: ±100 m, nu ±40 — poziția crezută poate fi cu zeci de metri
      // pe lângă la sosirea la linie, iar o linie ne-armată = cronometrul pornește greșit
      if (!M._staged && Math.abs(dTo) <= 0.10 && M.speedKmh < 5) {
        M._staged = true; M.state = 'STAGED';
        say('La linie. Pornesc când pleci.', 3, 'race');
        ui.render(M, plan);
      } else if (M._staged && M.speedKmh > 6) rtStart(rt, 0);
      else if (!M._staged && M.routeKm >= rt.startKm && M.speedKmh > 6) rtStart(rt, M.routeKm - rt.startKm);
    } else if (M.routeKm >= rt.startKm) {
      rtStart(rt, M.routeKm - rt.startKm);
    }
  }

  // Kilometrul de la care boxul `i` se consideră TRECUT pentru ecran și pentru anunțuri:
  // 80 m după el — dar niciodată dincolo de jumătatea distanței până la boxul următor.
  // Bucla József (03.08.2026): boxurile 2, 3 și 4 sunt la 29 și 22 m unul de altul, iar
  // regula fixă de 80 m ținea pe ecran cardul boxului deja trecut peste următoarele DOUĂ
  // manevre. Măsurat în jurnal: 22 s de „0 m" pe boxul 2, apoi încă 23 s până când apărea
  // boxul 4 — care era la 60 m de boxul 2. Pilotul afla de manevră după ce trecea de ea.
  function pragTrecere(i) {
    const b = plan.boxes[i], nb = plan.boxes[i + 1];
    if (!b) return Infinity;
    const prag = b.sumKm + 0.08;
    return nb ? Math.min(prag, (b.sumKm + nb.sumKm) / 2) : prag;
  }

  // MANEVRA URMĂTOARE, pentru coada anunțului „acum". Generalizarea regulii de boxuri
  // înlănțuite din v28: „înlănțuit" a devenit pur și simplu cazul „imediat" de mai jos,
  // ca să existe UN SINGUR loc care produce fraza dublă.
  //
  // Ce intră în coadă: doar VIRAJELE și GIRATORIILE (TURN_DIRS). Un „ÎNAINTE", un reper,
  // un TC sau o linie de probă nu sunt decizii de volan — se sar, dar căutarea merge mai
  // departe, iar distanța rostită e cea până la MANEVRA găsită, nu până la boxul sărit.
  // Distanța e cea dintre BOXURI (nu de la poziția de acum): pilotul aude coada în timp
  // ce ia virajul, deci „în 300 de metri" înseamnă 300 de metri de la virajul ăsta —
  // exact cifra pe care o are și în roadbook, în fața ochilor.
  function coadaManevra(i) {
    const b = plan.boxes[i];
    if (!b) return null;
    for (let j = i + 1; j < plan.boxes.length; j++) {
      const nb = plan.boxes[j];
      const gapM = Math.round((nb.sumKm - b.sumKm) * 1000);
      if (gapM > COADA_MAX_M) return null;              // prea departe: vine anunțul ei
      if (!TURN_DIRS.has(nb.dir || '')) continue;       // nu e manevră — sar peste ea
      if (gapM <= COADA_IMEDIAT_M) return { box: nb, gapM, text: `imediat ${maneuver(nb.dir, false)}` };
      // rotunjire la 50 m: coada e o pregătire, nu un reper de măsurat cu odometrul —
      // „în 100 de metri" se ține minte la volan, „în 90 de metri" doar sună precis.
      // Podeaua de 50 m e o plasă pentru ziua în care pragul de sus se mai mișcă:
      // „în 0 metri" n-are voie să se rostească niciodată.
      const rotund = Math.max(50, Math.round(gapM / 50) * 50);
      return { box: nb, gapM, text: `în ${distRo(rotund)} ${maneuver(nb.dir, false)}` };
    }
    return null;
  }

  function announceBoxes() {
    // Pe dinafară, planul ÎNGHEAȚĂ. În teren, aplicația a continuat să dea cue-uri
    // pentru boxurile 15, 16, 17 și 18 în timp ce mașina era pe alte străzi — instrucțiuni
    // de virat aplicate unui drum pe care nu se afla. Tăcerea e mai bună.
    if (M.offRoute) return;
    const boxes = plan.boxes;
    while (M.nextBoxIdx < boxes.length && M.routeKm > pragTrecere(M.nextBoxIdx)) M.nextBoxIdx++;
    const b = boxes[M.nextBoxIdx];
    if (!b) return;
    const dM = (b.sumKm - M.routeKm) * 1000;
    const silent = b.dir === 'ÎNAINTE' && !b.flag;   // „drept înainte" nu se rostește
    const key = `${b.num}_${Math.round(b.sumKm * 100)}`;
    // anticipare personalizată, dar plafonată: vezi ACUM_MAX_M
    const nowM = Math.min(ACUM_MAX_M, Math.max(25, driver.leadM(M.speedKmh || 30)));

    const tiers = [...TIERS_M, nowM].sort((a, b2) => b2 - a);
    // Se alege treapta cea mai APROPIATĂ care se aplică și nu s-a rostit — dacă apari
    // direct lângă box (repornire, salt) primești „acum", nu „în 300" (#23).
    let ti = -1;
    for (let j = tiers.length - 1; j >= 0; j--) {
      if (dM <= tiers[j] && !M._ann[key + '_' + j]) { ti = j; break; }
    }
    if (ti === -1) return;
    const isNow = ti === tiers.length - 1;
    // ULTIMA treaptă cu cifră (150 m) — vezi coada de mai jos: ea e anunțul pe care
    // pilotul îl aude sigur, chiar dacă „acum" ajunge târziu sau se pierde.
    const ultimaCuCifra = ti === tiers.length - 2;
    // Se marchează treapta aleasă și cele mai DEPĂRTATE — nu cele apropiate. Versiunea
    // veche le bifa pe cele apropiate: fiecare box era anunțat O DATĂ, la ~290 m, iar
    // „acum" nu se rostea NICIODATĂ — la 50 km/h, 21 de secunde de tăcere în care
    // pilotul trebuia să țină minte. Și modelul șoferului era mort: cueGiven nu se
    // apela deloc. (Audit 02.08, #3.)
    for (let j = 0; j <= ti; j++) M._ann[key + '_' + j] = true;
    if (!silent) {
      // „acum" = prio 4: întrerupe orice și nu expiră repede (audit, #9)
      let txt = turnText(b, dM, isNow);
      // CE URMEAZĂ DUPĂ MANEVRĂ, spus din timp: „dreapta acum, și imediat stânga" /
      // „150 de metri — dreapta, apoi în 300 de metri stânga". Pilotul are nevoie de
      // secvență cât mai are timp să aleagă banda și viteza. (Andreas, 04.08.2026.)
      //
      // Coada stă pe DOUĂ anunțuri, nu doar pe „acum": și pe ultima treaptă cu cifră
      // (150 m). Motivul e măsurat în tura Tresor: „acum" poate ajunge la ureche prea
      // târziu sau deloc — la boxul 12 a plecat cu 13 m înainte de viraj și a intrat în
      // coadă în spatele frazei de finish, iar pilotul a ratat ieșirea. Treapta cu cifră
      // e anunțul pe care îl aude sigur, la viteză, cu drum în față. Dublarea nu strică
      // (aceeași informație, la 90 m distanță una de alta); lipsa costă un viraj.
      // Legătura diferă, ca urechea să știe pe ce anunț e: „apoi" pe treapta cu cifră,
      // „și" pe „acum". Virgula dinainte nu e ortografie, e pauza de TTS.
      //
      // Coadă primesc boxurile de MANEVRĂ (un TC n-are „ce urmează" de planificat) și
      // liniile de FINISH — vezi COADA_FINISH_M: acolo e singura ocazie de a spune la
      // timp virajul de după tabelă. În rest, în probă rămâne doar cazul „imediat":
      // urechea e pe cifrele de ritm, iar un anunț separat ar ajunge după viraj.
      const capManevra = TURN_DIRS.has(b.dir || ''), capFinish = b.flag === 'RT_FINISH';
      if ((isNow || ultimaCuCifra) && (capManevra || capFinish)) {
        const coada = coadaManevra(M.nextBoxIdx);
        const limita = capFinish ? COADA_FINISH_M : (M.rt ? COADA_IMEDIAT_M : COADA_MAX_M);
        if (coada && coada.gapM <= limita) {
          txt += `${isNow ? ', și ' : ', apoi '}${coada.text}`;
          // ce s-a spus aici nu se mai repetă după linie, la închiderea probei
          if (capFinish) M._coadaFinish = coada.box.num;
        }
      }
      // Clasa 'manevra' lipsea tocmai de la anunțurile de viraj — adică fix de la ce
      // descrie regula. Comitul „paznic de directie" (03.08) a pus clasele pe alarme și
      // pe ritm, dar anunțul principal („150 de metri — dreapta") rămăsese neclasificat,
      // deci orice mesaj cu prioritate mai mare îl putea tăia din difuzor. Măsurat în
      // jurnalul de 04.08, bucla József: „40 de metri — stânga" (11:27:58), „30 de metri
      // — stânga la T" (11:28:25) și „Start probă în 140 de metri" (11:28:55) apar toate
      // în `voce_aruncata` cu motivul „intrerupt".
      say(txt, isNow ? 4 : (M.rt ? 3 : 2), 'turn', 'manevra');
      // Distanța la care s-a rostit „acum" intră în jurnal. Fără ea, întrebarea „de la
      // câți metri a vorbit?" se reconstruia din poziția logată la 5-6 s distanță, adică
      // se estima (04.08, analiza turei Tresor — o eroare de până la 75 m la 54 km/h).
      if (isNow) {
        driver.cueGiven(b.num, clock.wall());
        log('cue', { boxNum: b.num, dM: Math.round(dM), kmh: Math.round(M.speedKmh) });
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
    // Retro-datarea CEASULUI la linie: GPS-ul bate la ~1 s, deci trecerea se observă
    // cu câțiva metri întârziere. Distanța nu se mai atinge — se derivă din routeKm.
    // PLAFONAT (audit 02.08, #14): după o gaură de GPS, „podeaua" poate împinge poziția
    // cu sute de metri într-un singur fix — retro-datarea aia nu mai e o corecție de
    // sampling, e o fabricație de 16 secunde. Peste plafon, proba pornește de ACUM și
    // pilotul e anunțat că startul e estimat.
    if (overshootKm > 0.001 && M.speedKmh > 10) {
      const backMs = (overshootKm * 1000 / (M.speedKmh / 3.6)) * 1000;
      if (overshootKm <= 0.15 && backMs <= 5000) M.rt.t0Mono -= backMs;
      else {
        log('rt_start_estimat', { overshootM: Math.round(overshootKm * 1000), backMs: Math.round(backMs) });
        say('Start estimat — am pierdut linia, verifică.', 3, 'race');
      }
    }
    // Poziția de ACUM devine ancoră GEOGRAFICĂ. Invariantul e „_anchorKm este
    // kilometrul din _anchorPos" — versiunea veche punea kilometrul LINIEI pe poziția
    // de DUPĂ linie, iar regula „drum drept" încuia proba cu ~25 m în urmă permanent:
    // +2,2 s de deviere fabricată la 40 km/h, la fiecare start din mers (audit, #7).
    // Ancora de calibrare NU se atinge: linia e poziție dedusă, nu box confirmat.
    ancoreazaGeo(M.routeKm);
    say(`Start. Ține ${rt.kmh}.`, 4, 'race');
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
      say(`Finish. ${secRo(Math.abs(dev))} ${dev >= 0 ? 'în urmă' : 'în avans'}. Nu opri lângă tabelă.`, 4, 'race', 'ritm');
    }

    // starea continuă prin TONURI, nu prin propoziții: la fiecare ~4 s, un semn scurt
    if (rt.frozen == null && clock.mono() - M._lastToneT > 4000 && elapsed > 5) {
      M._lastToneT = clock.mono();
      const a = Math.abs(dev);
      if (a <= 1) tone('ok'); else tone(dev < 0 ? 'ahead' : 'behind');
      // cuvinte doar când devierea depășește pragul — și scurt
      if (a > (def.voiceThr || 3)) {
        // Viteza REALĂ care anulează devierea până la finish, FĂRĂ plafon (cerut de
        // Andreas, 02.08, după tura 4): „ține 52" plafonat la +30% suna identic la 20
        // și la 40 de secunde întârziere. Acum cifra e cea adevărată — 58, 65, cât
        // iese din aritmetică — iar decizia dacă e prudentă îi aparține pilotului.
        // Indicatoarele rutiere rămân oricum ale lui, nu ale aplicației.
        const remKm = Math.max(0, def.distKm - Math.min(rt.distKm, def.distKm));
        let fraza = `${secRo(a)} ${dev >= 0 ? 'în urmă' : 'în avans'}`;
        if (remKm > 0.03) {
          const tDisponibilS = (remKm / def.kmh) * 3600 - dev;   // în urmă = timp mai puțin
          if (tDisponibilS > 1) fraza += `, ține ${Math.round(remKm * 3600 / tDisponibilS)}`;
          else fraza += ' — nu se mai prinde până la finish';
        }
        say(fraza, 3, 'pace', 'ritm');
      }
      // banca de timp: zonele lente din față cer avans acum
      if (rt.zonesAdvised !== false && def.zones && def.zones.length && clock.mono() - M._lastBank > 15000) {
        const adv = bankingAdvice(rt.distKm * 1000, def.kmh, def.zones);
        if (adv) { M._lastBank = clock.mono(); say(`Bancă: ia ${secRo(adv.bankS)} avans — zonă lentă în ${distRo(adv.inM)}.`, 3, 'bank', 'ritm'); }
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
    say(`Gata. ${secRo(Math.abs(finalDev))} ${finalDev >= 0 ? 'în urmă' : 'în avans'}.`, 4, 'race', 'ritm');
    M.lastDebrief = deb;

    // indexul sare pe boxul de după linia de finish — virajul următor se anunță IMEDIAT
    M.nextBoxIdx = Math.max(M.nextBoxIdx, def.finishIdx + 1);
    const fb = plan.boxes[def.finishIdx];
    if (fb) { const k = `${fb.num}_${Math.round(fb.sumKm * 100)}`; for (let t = 0; t < 3; t++) M._ann[k + '_' + t] = true; }
    const nb = plan.boxes[M.nextBoxIdx];
    if (nb) {
      const dTo = (nb.sumKm - M.routeKm) * 1000;
      // „Urmează: …" rămâne doar pentru ce N-a intrat deja în anunțul liniei de finish
      // (vezi COADA_FINISH_M). Altfel aceeași manevră s-ar auzi de două ori în trei
      // secunde, printre cifrele rezultatului — măsurat în tura Tresor: „Urmează:
      // stânga acum" imediat după „stânga acum".
      const dejaSpus = M._coadaFinish != null && M._coadaFinish === nb.num;
      if (!dejaSpus && dTo > -30 && dTo < 350 && (nb.dir !== 'ÎNAINTE' || nb.flag))
        say(`Urmează: ${turnText(nb, Math.max(20, dTo), dTo < 60)}`, 3, 'turn', 'manevra');
    }
    M._coadaFinish = null;
    // debrieful vocal vine la 6 s după — întâi drumul, apoi lecția
    if (!M.shadow) setTimeout(() => { if (M.state === 'LIAISON') say(deb.voiceTxt, 1, 'debrief', 'ritm'); }, 6000);

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
  // Ce s-ar întâmpla dacă am sări la boxul `num` — CALCULAT, nu executat.
  // Interfața cere confirmare pe baza asta. Lecția din 02.08.2026: o apăsare greșită
  // a mutat poziția cu 1330 m înapoi, în plină probă, tăcut. Odometrul era corect;
  // butonul l-a stricat. O corecție mare trebuie să spună CE strică, înainte s-o facă.
  function previzualizeazaBox(num) {
    const i = plan.boxes.findIndex(b => b.num === num);
    if (i === -1) return null;
    const b = plan.boxes[i];
    const deltaM = Math.round(((b.sumKm + 0.02) - M.routeKm) * 1000);
    // Ar închide o probă în curs? (saltul ar trece peste linia de finiș)
    let rupeRt = null;
    if (M.rt) {
      const fin = M.rt.def.finishKm;
      if (M.routeKm < fin && b.sumKm + 0.02 >= fin) rupeRt = `ar ÎNCHIDE ${M.rt.def.name}`;
      else if (b.sumKm + 0.02 < M.rt.def.startKm) rupeRt = `ar scoate mașina din ${M.rt.def.name}`;
    }
    return { idx: i, box: b, deltaM, mare: Math.abs(deltaM) > 400, rupeRt };
  }

  function atBox(num, confirmat) {
    const p = previzualizeazaBox(num);
    if (!p) { say(`Boxul ${num} nu există.`, 2); return false; }
    // Confirmare la: salt peste 400 m, salt care atinge liniile probei, sau ORICE salt
    // cu proba în curs (audit, #8) — un −112 m tăcut în probă schimbă devierea afișată
    // cu zeci de secunde și pilotul reacționează la o cifră falsă. v1 era deja strict
    // aici; v2 devine la fel.
    if ((p.mare || p.rupeRt || M.rt) && confirmat !== true) {
      log('sync_refuzat', { boxNum: num, deltaM: p.deltaM, rupeRt: p.rupeRt || null });
      return p;                      // interfața primește datele și întreabă
    }
    snapToBox(p.idx, 'manual');
    say(`Setat box ${num}.`, 2);
    return true;
  }

  // Boxurile plauzibile pentru poziția de acum, cel mai apropiat primul.
  function boxuriApropiate(n = 6) {
    return plan.boxes
      .map((b, i) => ({ box: b, idx: i, deltaM: Math.round((b.sumKm - M.routeKm) * 1000) }))
      .sort((a, z) => Math.abs(a.deltaM) - Math.abs(z.deltaM))
      .slice(0, n)
      .sort((a, z) => a.idx - z.idx);
  }

  // `lagM` = cât a mers mașina de la locul fizic al boxului până la momentul snapului
  // (întârzierea detectorului de viraje). Poziția devine box + lag, iar invariantul
  // „ancora e kilometrul poziției de ACUM" ține. La apăsarea manuală lag = 0: contractul
  // butonului e „apeși EXACT la box".
  function snapToBox(i, how, lagM = 0) {
    const b = plan.boxes[i];
    const before = M.routeKm;
    const snapKm = b.sumKm + lagM / 1000;
    // Boxul confirmat rămâne confirmat: desyncCheck nu mai are voie să se plângă de
    // el. La testul din 02.08 (după-amiaza), virajul de la boxul 5 a fost detectat și
    // sincronizat, apoi la 20 s — fix cât fereastra de tăcere — mașina făcuse 278 m pe
    // drum drept și alarma a urlat „trebuia să virezi la boxul 5", în plină probă.
    // Alarmă falsă prin construcție: distanța de la box nu spune nimic dacă virajul
    // ăla a fost DEJA făcut.
    M._confirmedIdx = Math.max(M._confirmedIdx != null ? M._confirmedIdx : -1, i);
    // „SUNT LA BOX" apăsat de pilot = adevărul de referință: orice bănuială de ieșire
    // de pe traseu strânsă până acum se șterge, altfel o bănuială veche ar bloca
    // potrivirea virajelor trei minute după ce omul a lămurit unde e.
    if (how === 'manual') M._offSemne = [];
    // Poziția devine kilometrul boxului + lag-ul REAL de detectare (zero la apăsare
    // manuală). Fără constante inventate (vechiul +20 m umbla la riglă — audit #13),
    // dar și fără să te tragă în urmă cu întârzierea detectorului (tura 5).
    calibreaza(snapKm);                  // ÎNAINTE de a rescrie poziția
    M.routeKm = snapKm;
    if (plan.anchorMap) M.traceM = plan.anchorMap.traceM(M.routeKm);
    M.nextBoxIdx = i + 1;
    const deltaKm = M.routeKm - before;
    // rt.distKm nu se mai corectează aici: se derivă din routeKm la fiecare fix.
    driver.turnDone(b.num, clock.wall());
    log('sync', Object.assign({ how, boxNum: b.num, deltaM: Math.round(deltaKm * 1000) },
                              lagM ? { lagM: Math.round(lagM) } : {}));
    tone('tick');
    // Din DAY_END se poate ieși: un salt de poziție (podea GPS, snap greșit) putea
    // declara ziua terminată fără cale de întoarcere (audit, #18).
    if (M.state === 'DAY_END') M.state = 'LIAISON';
    // Starea de probă se re-evaluează imediat: dacă snapul te-a pus chiar pe linia
    // unei probe standing și stai pe loc, intri în STAGED acum, nu „poate la fixul
    // următor" — altfel cronometrul pornea cu ~4 s înaintea mașinii (audit, #15).
    if (M.state === 'LIAISON' || M.state === 'STAGED') liaisonTick();
    ui.render(M, plan);
  }

  // ── POZIȚIA ABSOLUTĂ — GPS-ul nu e doar odometru ─────────────────────────
  // Observația lui Andreas (2026-08-01): dacă știm distanțele exacte între boxuri ȘI
  // avem poziție GPS, de ce am lăsa eroarea să se adune? Are dreptate. Odometrul
  // ADUNĂ (deci adună și erorile); linia dreaptă de la ultima ancoră până la poziția
  // de acum NU se acumulează — greșește cu precizia GPS-ului, atât, oricât ai merge.
  //
  // Cele două surse se completează exact unde cealaltă e slabă:
  //  • pe drum cu viraje → virajele sunt ancore dese, odometrul n-apucă să driftze;
  //  • pe drum drept     → odometrul driftează liber, dar drumul E linia dreaptă,
  //                        deci poziția absolută e practic exactă.
  // Și, întotdeauna: drumul real ≥ linia dreaptă, deci avem o PODEA garantată.
  function pozitieAbsoluta(fix) {
    if (!M._anchorPos) return;
    if (fix.accM != null && fix.accM > 35) return;        // fix prea împrăștiat
    const straightM = haversineM(M._anchorPos.lat, M._anchorPos.lng, fix.lat, fix.lng);
    if (straightM > 60000) return;                        // absurd — ignoră
    const straightKm = M._anchorKm + straightM / 1000;

    // 1) PODEA: dacă linia dreaptă spune că ai depășit poziția crezută, ai depășit-o.
    if (straightKm > M.routeKm + 0.004) {
      log('pozitie_podea', { deM: Math.round((straightKm - M.routeKm) * 1000), curbaGrd: Math.round(M._curveDeg) });
      M.routeKm = straightKm;
    }
    // 2) DRUM DREPT: direcția nu s-a schimbat de la ancoră → linia dreaptă e drumul.
    //    Aici poziția devine exactă, indiferent cât de prost măsoară odometrul.
    else if (M._curveDeg < 12 && straightM > 150) {
      M.routeKm = straightKm;
    }
  }

  // ── AUTO-CALIBRAREA ODOMETRULUI ──────────────────────────────────────────
  // Regula de învățare stă în makeCalibrator (geo.js), cu tot cu cifrele din jurnalul
  // de 04.08 care au impus-o. Aici rămâne doar cuplarea la boxurile confirmate.
  // La Sibiu calibrarea e cea mai importantă apărare pe care o avem fără recunoaștere:
  // 2% eroare pe o probă de 2 km înseamnă 40 m, adică o probă pornită greșit — dar
  // exact de-aceea nu are voie să învețe zgomot: un factor greșit strică ACTIV, pe
  // toată ziua, ceea ce ar fi trebuit să repare.
  //
  // Două ancore, nu una — le-am confundat o dată și calibrarea a ieșit cu 0,5% greșită
  // chiar pe un odometru perfect:
  //  • ancora GEOGRAFICĂ se reîmprospătează des (orice poziție de încredere, inclusiv
  //    linia de start a probei), ca poziția absolută să aibă curbură mică de la ea;
  //  • ancora de CALIBRARE se mișcă doar la boxuri confirmate fizic, pentru că doar
  //    acolo avem o distanță oficială — adică o riglă independentă de odometru.
  function ancoreazaGeo(km) {
    M._anchorPos = M._lastPos ? { ...M._lastPos } : null;
    M._anchorKm = km;
    M._curveDeg = 0; M._curveHdg = null;
  }

  function calibreaza(targetKm) {
    const masurat = M._rawSinceAnchor;
    const oficial = targetKm - M._calAnchorKm;
    M._rawSinceAnchor = 0;
    M._calAnchorKm = targetKm;
    ancoreazaGeo(targetKm);                   // boxul confirmat e și ancoră geografică
    const r = cal.adauga(oficial, masurat);
    if (r.stare === 'scurt') return;          // segment prea scurt = zgomot, nu semnal
    if (r.stare === 'refuzat') {              // în afara plajei = snap greșit, nu odometru
      log('cal_refuzat', { raport: r3(r.raport), masurat: r3(masurat), oficial: r3(oficial) });
      return;
    }
    M._calN = cal.segmente;
    // Ce s-a măsurat intră în jurnal ȘI când NU se aplică nimic — altfel, la debrief,
    // tăcerea calibrării arată identic cu absența măsurătorilor (04.08: din jurnal nu
    // se putea vedea că cele două segmente se contraziceau, doar factorul rezultat).
    const cifre = { segmentOficial: r3(oficial), segmentMasurat: r3(masurat),
                    raportSegment: r3(r.raport), dinMasuratori: r.n,
                    kmCumulat: r3(r.kmOficial), medie: r3(r.medie),
                    imprastiere: r3(r.imprastiere), marja: r3(r.marja) };
    if (r.stare === 'asteapta') { log('cal_asteapta', { motiv: r.motiv, ...cifre }); return; }
    M.calFactor = r.factor;
    const proc = (M.calFactor - 1) * 100;
    log('calibrare', { factor: r3(M.calFactor), procent: r3(proc),
                       tinta: r3(r.tinta), plafonat: !!r.plafonat, ...cifre });
    // „plus 1 virgulă 5 la sută" s-a auzit „5 la sută" la volan (02.08) — corecțiile
    // mici se anunță ca „mică", fără cifră; cifra rămâne doar la corecții mari.
    if (Math.abs(proc) >= 2 && M._calN <= 4)
      say(`Odometru calibrat: ${proc > 0 ? 'plus' : 'minus'} ${Math.abs(proc).toFixed(1)} la sută.`, 2, 'cal', 'ritm');
    else if (Math.abs(proc) >= 0.8 && M._calN <= 4)
      say('Calibrare mică făcută. E bine.', 1, 'cal', 'ritm');
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
    } else {
      M._turnAcc += d; M._quietMs = 0;
      // ultima poziție în care direcția ÎNCĂ se schimba = sfârșitul fizic al virajului;
      // de aici se măsoară cât ai mers până când detectorul se hotărăște (vezi snapul)
      M._turnMovePos = { lat: fix.lat, lng: fix.lng };
    }
  }

  // Snap pe viraj — REGULI STRÂNSE (rescrise 2026-08-01, după testul din Dumbrăvița).
  // Ce s-a întâmplat acolo: la ieșirea din parcare, detectorul a văzut virajul, a găsit
  // în fereastra de ±350 m un box de dreapta și l-a împins pe Andreas cu 238 m înainte.
  // De acolo, aplicația era permanent înaintea realității și proba a pornit singură cu
  // mult prea devreme. Un snap greșit e mai rău decât driftul pe care îl repară, deci:
  //  • doar spre boxul pe care CHIAR îl aștepți (nextBoxIdx ±1), nu orice viraj din zonă;
  //  • fereastră 150 m, nu 350;
  //  • niciun snap în primii 150 m de leg (manevrele de ieșire din parcare nu sunt boxuri);
  //  • corecțiile mari se anunță — dacă e greșită, șoferul o aude și o poate corecta.
  function trySnapTurn(acc) {
    if (clock.mono() - M._lastSnapT < 10000) return;
    if (M.routeKm < 0.15) { log('snap_refuzat', { motiv: 'start_leg', routeKm: r2(M.routeKm) }); return; }
    const right = acc > 0;
    // PE DINAFARĂ: virajele de pe drumul greșit NU se mai potrivesc cu roadbook-ul.
    // Măsurat în teren exact contrariul: două viraje rătăcite au fost lipite de boxurile
    // 13 și 17 (−92 și −133 m), ceea ce a convins aplicația că totul e în regulă.
    // Singurul viraj care contează acum e cel de la punctul de reintrare.
    if (M.offRoute) {
      const b = plan.boxes[M.offRoute.idx];
      const potrivit = b && M.offRoute.distM <= 150 &&
        (/^GIRATORIU/.test(b.dir || '') || (right ? /^DREAPTA/ : /^STÂNGA/).test(b.dir || ''));
      if (potrivit) { iesiOffRoute('viraj'); return; }
      log('snap_ignorat_offroute', { spreDreapta: right, distM: M.offRoute.distM });
      return;
    }
    // ÎNTÂRZIEREA DETECTĂRII (tura 5, 02.08): virajul se confirmă abia la ~2,5 s după
    // ce s-a terminat — timp în care mașina a mai mers 60-130 m. Snapul care punea
    // poziția FIX la box te trăgea sistematic în urmă cu distanța aia (−99/−133/−121 m
    // în jurnal, la fiecare viraj), iar segmentul de calibrare pierdea aceleași bucăți
    // (+5,2% fals la box 12). Boxul e locul VIRAJULUI; tu ești la box + cât ai mers
    // de la terminarea lui.
    let lagM = M._turnMovePos && M._lastPos
      ? haversineM(M._turnMovePos.lat, M._turnMovePos.lng, M._lastPos.lat, M._lastPos.lng)
      : (M.speedKmh / 3.6) * 2.5;
    lagM = Math.max(0, Math.min(200, lagM));
    // …și de-aceea lag-ul se scade ÎNAINTE de căutarea candidatului, nu după (03.08.2026).
    // Fereastra se măsura de unde s-a TREZIT detectorul, deși boxul e acolo unde s-a
    // VIRAT. Măsurat în bucla József, în ambele ture identice: virajul de la boxul 4
    // (stânga la T) s-a confirmat la routeKm 0,51 și 0,52, adică 160 și 170 m după
    // kilometrul oficial al boxului (0,35) — fereastra de 150 m îl rata la 10-20 m și
    // aplicația scria „fara_candidat" exact la virajul pe care pilotul tocmai îl făcuse.
    const virajKm = M.routeKm - lagM / 1000;
    // Cine poate fi candidat: orice box NEconfirmat până la unul peste cel așteptat.
    // Înainte era o fereastră de trei indici în jurul lui nextBoxIdx, ceea ce mergea
    // doar cât timp boxurile erau rare: la 22-30 m între ele, până se hotărăște
    // detectorul (2,5 s + colțul propriu-zis), indicele a trecut deja de boxul virat,
    // iar virajul rămânea fără candidat DEȘI era la 50 m de el. Înainte NU se sare
    // niciodată mai mult de un box (regula care a oprit saltul de +238 m din 01.08);
    // înapoi decide distanța, plafonată la 150 m mai jos.
    const de = Math.max(0, (M._confirmedIdx != null ? M._confirmedIdx : -1) + 1);
    const pana = Math.min(plan.boxes.length - 1, M.nextBoxIdx + 1);
    let best = -1, gap = 0.15;
    for (let i = de; i <= pana; i++) {
      const b = plan.boxes[i];
      if (!b || !TURN_DIRS.has(b.dir || '')) continue;
      const g = Math.abs(b.sumKm - virajKm);
      if (g > gap) continue;
      const ok = /^GIRATORIU/.test(b.dir) || (right ? /^DREAPTA/.test(b.dir) : /^STÂNGA/.test(b.dir));
      if (!ok) continue;
      best = i; gap = g;
    }
    if (best === -1) {                     // conservator: fără candidat plauzibil, fără snap
      // Virajul EXISTĂ, doar că nu i-am găsit box. Se ține minte: dacă imediat după
      // asta desyncCheck vrea să-l acuze pe pilot că n-a virat, dovada asta îl contrazice.
      M._virajRefuzat = { mono: clock.mono(), routeKm: M.routeKm, virajKm, right, lagM,
                          prevIdx: M.nextBoxIdx - 1 };
      log('snap_refuzat', { motiv: 'fara_candidat', routeKm: r2(M.routeKm),
                            virajKm: r2(virajKm), lagM: Math.round(lagM), spreDreapta: right });
      // …și poate fi un SEMN de ieșire de pe traseu: ai virat unde roadbook-ul nu știe
      // de niciun viraj. Două condiții, amândouă din date:
      //  • doar în afara probei — în tura Tresor, două din cele trei „fara_candidat"
      //    au fost înăuntrul probei 1, pe traseu, la viteză (16:28:20 și 16:28:59);
      //  • și doar dacă virajul ăsta nu se explică prin POZIȚIE. Dacă la ±250 m există
      //    un box de viraj neconfirmat în sensul potrivit, atunci nu ești pe alt drum,
      //    ci poziția a rămas în urmă — cazul „te-am prins, recalez" (03.08, măsurat:
      //    virajul de la T confirmat la 160-170 m după kilometrul oficial al boxului).
      const explicatDePozitie = plan.boxes.some((bb, ii) =>
        ii > (M._confirmedIdx != null ? M._confirmedIdx : -1) &&
        TURN_DIRS.has(bb.dir || '') &&
        Math.abs(bb.sumKm - virajKm) * 1000 <= OFF_DRIFT_M &&
        (/^GIRATORIU/.test(bb.dir) || (right ? /^DREAPTA/ : /^STÂNGA/).test(bb.dir)));
      if (!M.rt && !explicatDePozitie)
        semnOffRoute('viraj_fara_box', Math.round(virajKm * 1000), M.nextBoxIdx - 1);
      return;
    }
    // VIRAJ DUPĂ O MANEVRĂ RATATĂ: nu se mai potrivește cu boxuri de mai încolo.
    // Momentul-cheie din tura Tresor, 16:37:18: exista deja semnul că boxul 12 fusese
    // depășit fără viraj, iar aplicația a lipit virajul următor de boxul 13 (−92 m) —
    // și de acolo a mers convinsă că e pe traseu încă două minute. Dacă boxul 12 chiar
    // a fost ratat, strada boxului 13 n-a fost niciodată atinsă: virajul ăsta e de pe
    // alt drum, iar potrivirea lui nu e o corecție, e o minciună confortabilă.
    const ratareVie = M.offRouteOn && M._offSemne.some(s =>
      s.tip === 'manevra_neconfirmata' && s.idx <= best);
    if (ratareVie) {
      log('snap_refuzat', { motiv: 'dupa_manevra_ratata', routeKm: r2(M.routeKm),
                            virajKm: r2(virajKm), boxCandidat: plan.boxes[best].num });
      semnOffRoute('viraj_dupa_ratare', plan.boxes[best].num, best);
      incearcaOffRoute();
      return;
    }
    M._lastSnapT = clock.mono();
    const before = M.routeKm;
    snapToBox(best, 'turn', lagM);
    anuntaCorectia(Math.round((M.routeKm - before) * 1000), plan.boxes[best].num);
  }

  // ── ANUNȚUL DE CORECȚIE — informație, nu manevră ─────────────────────────
  // 04.08.2026, bucla József, Leg 2: snapul pe boxul 4 a mutat poziția cu −116 m și a
  // rostit „Corectat înapoi 116 metri, box 4" — o frază de vreo 3 secunde, într-o buclă
  // în care boxurile 2-3-4 sunt la 70-91 m unul de altul, adică la 6-8 secunde de mers.
  // Corecția e o EXPLICAȚIE pentru ce s-a văzut deja pe ecran; manevra următoare e o
  // decizie de peste câteva secunde. Deci:
  //  • clasa e 'ritm': nu întrerupe niciodată o manevră care se rostește și nu i-o ia
  //    înainte în coadă (regula claselor din 03.08);
  //  • sub 150 m până la boxul următor rămâne doar „Corectat." — pragul vine din
  //    roadbook-ul real: secțiunile din buclă au 70-91 m, iar de la boxul 4 până la
  //    startul probei sunt 360 m, unde fraza întreagă încape liniștită;
  //  • sub 60 m nu se rostește nimic — „acum"-ul manevrei e practic aici;
  //  • ecranul primește informația ÎNTOTDEAUNA, chiar și când gura tace.
  const CORECTIE_MIN_M = 60, CORECTIE_SPATIU_M = 150;

  function anuntaCorectia(deltaM, boxNum) {
    const semn = deltaM > 0 ? 'înainte' : 'înapoi';
    M.corectie = { text: `corectat ${semn} ${Math.abs(deltaM)} m · box ${boxNum}`,
                   deltaM, boxNum, panaMono: clock.mono() + 20000 };
    if (Math.abs(deltaM) <= CORECTIE_MIN_M) return;
    const urm = plan.boxes[M.nextBoxIdx];
    const panaLaUrm = urm ? (urm.sumKm - M.routeKm) * 1000 : Infinity;
    log('corectie_anunt', { deltaM, boxNum, panaLaUrmatorulM: isFinite(panaLaUrm) ? Math.round(panaLaUrm) : null,
                            rostit: panaLaUrm < CORECTIE_MIN_M ? 'deloc'
                                  : panaLaUrm < CORECTIE_SPATIU_M ? 'scurt' : 'intreg' });
    if (panaLaUrm < CORECTIE_MIN_M) return;
    if (panaLaUrm < CORECTIE_SPATIU_M) { say('Corectat.', 1, 'sync', 'ritm'); return; }
    say(`Corectat ${semn} ${Math.abs(deltaM)} metri, box ${boxNum}.`, 2, 'sync', 'ritm');
  }

  // „Merg drept, dar aplicația crede că trebuia să fi virat." Fără geometrie, ăsta e
  // singurul semn că poziția s-a desincronizat — și exact ce i-a lipsit lui Andreas
  // la testul din Dumbrăvița. Dacă am depășit cu >250 m un box de VIRAJ fără ca
  // detectorul să fi văzut vreun viraj, spunem cu voce tare că suntem pe dinafară.
  function desyncCheck() {
    if (M.offRoute) return;        // se știe deja că nu ești pe traseu; nu se mai latră
    const prevIdx = M.nextBoxIdx - 1;
    const prev = plan.boxes[prevIdx];
    if (!prev || !TURN_DIRS.has(prev.dir || '')) return;
    // virajul confirmat (snap pe viraj sau manual) nu mai poate genera alarmă —
    // distanța față de el crește normal pe drumul drept de după (02.08, alarma falsă)
    if (M._confirmedIdx != null && prevIdx <= M._confirmedIdx) return;
    const past = M.routeKm - prev.sumKm;
    if (past < 0.25 || M._desyncSaid === prev.num) return;
    if (clock.mono() - M._lastSnapT < 20000) return;   // tocmai am sincronizat, e în regulă
    M._desyncSaid = prev.num;
    // Am VĂZUT virajul boxului ăstuia, dar l-am refuzat fiindcă poziția era prea departe?
    // Atunci vinovată e poziția, nu pilotul — și se aude altfel. Măsurat 03.08, în ambele
    // ture: „virajul de la boxul 4 pare ratat" a venit la 2 s după ce aplicația însăși
    // detectase virajul de la boxul 4. Pilotul îl făcuse; aplicația i-a spus că nu.
    const vz = M._virajRefuzat;
    const potrivit = !!(vz && vz.prevIdx === prevIdx &&
      clock.mono() - vz.mono <= 90000 &&
      Math.abs(vz.virajKm - prev.sumKm) < 0.4 &&
      (/^GIRATORIU/.test(prev.dir) || (vz.right ? /^DREAPTA/ : /^STÂNGA/).test(prev.dir)));
    log('desync_warn', { boxNum: prev.num, pastM: Math.round(past * 1000), inRt: !!M.rt,
                         virajVazut: potrivit });
    if (potrivit) {
      M._virajRefuzat = null;
      if (M.rt) {
        // În probă poziția NU se atinge: o corecție de sute de metri schimbă devierea
        // afișată, iar pilotul reacționează la o cifră care sare (audit #8).
        say(`Boxul ${prev.num}: virajul l-am văzut, dar poziția nu se potrivește. Continuă proba.`, 3, 'desync', 'manevra');
        tone('tick');
      } else {
        // În legătură se recalează, cu același contract ca la snap: ești la box + cât
        // ai mers de la virajul ăla, nu fix pe box.
        const lagAcum = Math.min(400, vz.lagM + Math.max(0, (M.routeKm - vz.routeKm) * 1000));
        say(`Te-am prins la boxul ${prev.num} — recalez.`, 3, 'desync', 'manevra');
        M._lastSnapT = clock.mono();
        snapToBox(prevIdx, 'turn_tardiv', lagAcum);
      }
      return;
    }
    // În probă instrucțiunea e diferită: lista de boxuri NU se folosește la 50 km/h.
    say(M.rt
      ? `Atenție: virajul de la boxul ${prev.num} pare ratat. Continuă — corectezi când poți opri.`
      : `Atenție: ar fi trebuit să virezi la boxul ${prev.num}. Dacă ești tot pe drept, apasă SUNT LA BOX.`, 3, 'desync', 'manevra');
    tone('alarm');
  }

  // ── IEȘIREA DE PE TRASEU ──────────────────────────────────────────────────
  // Pragurile și cazul-etalon: sus, la OFF_BOX_M. Aici sunt cele patru bucăți:
  // strângerea semnelor, declararea, ghidajul înapoi și prinderea.
  //
  // LIMITA, spusă pe față: aplicația NU are hartă rutieră. Ghidajul e „punctul de
  // reintrare e la atâția metri, în direcția aia" — linie dreaptă, ca o busolă, nu
  // traseu pe străzi. Rerutarea adevărată ar cere date de drumuri (offline sau API) și
  // e alt proiect. Pe un drum de raliu, unde pilotul tocmai a greșit o intersecție pe
  // care o are în roadbook, busola către punctul ratat e de obicei destul.

  // Punctul geografic al unui kilometru de traseu, din firimiturile pe care chiar
  // le-am condus. Cu recunoaștere există și urma, dar firimiturile sunt disponibile
  // ÎNTOTDEAUNA — inclusiv în tura Tresor, unde recunoaștere nu exista.
  function idxUrmaLaKm(km) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < M._urme.length; i++) {
      const d = Math.abs(M._urme[i].km - km);
      if (d < bd) { bd = d; bi = i; }
    }
    return bd < 0.25 ? bi : -1;
  }

  function punctLaKm(km) {
    const i = idxUrmaLaKm(km);
    return i >= 0 ? { lat: M._urme[i].lat, lng: M._urme[i].lng } : null;
  }

  // firimitura aflată la ~`dist` metri înainte (+) sau înapoi (−) de indexul dat
  function urmaLaDistanta(i, dist) {
    const pas = dist > 0 ? 1 : -1;
    let d = 0;
    for (let j = i; j + pas >= 0 && j + pas < M._urme.length; j += pas) {
      d += haversineM(M._urme[j].lat, M._urme[j].lng, M._urme[j + pas].lat, M._urme[j + pas].lng);
      if (d >= Math.abs(dist)) return M._urme[j + pas];
    }
    return null;
  }

  // AM VIRAT ACOLO SAU AM MERS DREPT? Întrebarea care desparte „am ratat boxul" de
  // „am virat, dar detectorul n-a văzut" — a doua se întâmplă des și e deja tratată
  // („te-am prins, recalez"). Măsurat 03.08: un viraj făcut sub 8 km/h nu produce
  // niciun viraj detectat, în ambele ture.
  // Se compară direcția pe 60 m ÎNAINTE de box cu cea pe 60 m DUPĂ — coardă lungă,
  // deci zgomotul GPS (±8 m) intră cu vreo 8°, nu cu 30 ca la pași de 10 m.
  function schimbareDirectieLaKm(km) {
    const i = idxUrmaLaKm(km);
    if (i < 0) return null;
    const b = M._urme[i], a = urmaLaDistanta(i, -60), c = urmaLaDistanta(i, 60);
    if (!a || !c) return null;
    return Math.abs(angDiff(bearingDeg(b.lat, b.lng, c.lat, c.lng),
                            bearingDeg(a.lat, a.lng, b.lat, b.lng)));
  }

  function semnOffRoute(tip, boxNum, idx) {
    if (!M.offRouteOn || M.offRoute) return;
    const acum = clock.mono();
    const cheie = `${tip}:${boxNum}`;
    M._offSemne = M._offSemne.filter(s => acum - s.mono <= OFF_FEREASTRA_MS);
    if (M._offSemne.some(s => s.cheie === cheie)) return;
    M._offSemne.push({ cheie, tip, boxNum, idx, mono: acum });
    log('offroute_semn', { tip, boxNum, semne: M._offSemne.length });
  }

  function offRouteCheck() {
    if (!M.offRouteOn || M.offRoute) return;
    // SEMN: box de manevră lăsat în urmă fără viraj confirmat. Se caută independent de
    // nextBoxIdx — în teren indexul trecuse deja peste boxul ratat (12) când distanța
    // a devenit concludentă, iar alarma veche s-a pierdut exact așa.
    const de = Math.max(0, (M._confirmedIdx != null ? M._confirmedIdx : -1) + 1);
    for (let i = de; i < plan.boxes.length; i++) {
      const b = plan.boxes[i];
      if (b.sumKm > M.routeKm - OFF_BOX_M / 1000) break;
      if (!TURN_DIRS.has(b.dir || '')) continue;
      // …dar numai dacă mașina chiar a mers DREPT pe acolo. Fără verificarea asta,
      // două viraje făcute și nedetectate (bucla József, la 7 km/h) ar fi declarat
      // ieșirea de pe traseu exact în locul unde pilotul conducea corect.
      const cot = schimbareDirectieLaKm(b.sumKm);
      if (cot == null || cot >= OFF_COT_GRD) continue;
      semnOffRoute('manevra_neconfirmata', b.num, i);
    }
    incearcaOffRoute();
  }

  function incearcaOffRoute() {
    if (!M.offRouteOn || M.offRoute) return;
    const acum = clock.mono();
    M._offSemne = M._offSemne.filter(s => acum - s.mono <= OFF_FEREASTRA_MS);
    const decisiv = M._offSemne.some(s => s.tip === 'in_afara_coridorului');
    if (!decisiv && M._offSemne.length < OFF_SEMNE_CERUTE) return;
    // GARDURI: nu se declară pe GPS mort sau proaspăt înviat, nu în probă (acolo
    // poziția nu se atinge — audit #8), nu la ieșirea din parcare.
    if (M.rt || M.routeKm < 0.15) return;
    const deLaFix = M._lastFixMono != null ? acum - M._lastFixMono : Infinity;
    if (deLaFix > 15000 || acum - (M._gpsRevenitMono || 0) < OFF_DUPA_GPS_MS) return;
    declaraOffRoute('automat');
  }

  // Punctul de reintrare: boxul ratat sau ultimul box confirmat — cel mai APROPIAT
  // dintre ele în linie dreaptă. Ce ratezi într-o buclă strânsă poate fi la 50 m în
  // spate, în timp ce boxul confirmat e la un kilometru.
  function punctDeReintrare() {
    const cand = [];
    const ratat = M._offSemne.find(s => s.tip === 'manevra_neconfirmata');
    if (ratat && plan.boxes[ratat.idx]) cand.push(plan.boxes[ratat.idx]);
    if (M._confirmedIdx != null && plan.boxes[M._confirmedIdx]) cand.push(plan.boxes[M._confirmedIdx]);
    let best = null;
    for (const b of cand) {
      const p = punctLaKm(b.sumKm);
      if (!p || !M._lastPos) continue;
      const d = haversineM(M._lastPos.lat, M._lastPos.lng, p.lat, p.lng);
      if (!best || d < best.distM) best = { box: b, idx: plan.boxes.indexOf(b), pct: p, distM: d };
    }
    return best;
  }

  function declaraOffRoute(cum) {
    const t = punctDeReintrare();
    if (!t) { log('offroute_fara_tinta', { semne: M._offSemne.length, urme: M._urme.length }); return; }
    M.offRoute = { boxNum: t.box.num, idx: t.idx, km: t.box.sumKm, pct: t.pct,
                   distM: Math.round(t.distM), relDeg: null, de: clock.rally(), cum,
                   kmLaIesire: M.routeKm };
    M._offSector = null; M._offVorbaMono = 0;
    log('offroute_intrare', { cum, boxNum: t.box.num, distM: Math.round(t.distM),
                              semne: M._offSemne.map(s => s.tip), routeKm: r2(M.routeKm) });
    say(`Ai ieșit de pe traseu. Întoarcere la boxul ${t.box.num}.`, 4, 'offroute', 'manevra');
    tone('alarm');
    ui.render(M, plan);
  }

  // unde e punctul față de botul mașinii, în cuvinte de pilot
  function ceasRo(rel) {
    const a = Math.abs(rel);
    if (a <= 25) return 'drept în față';
    if (a <= 70) return rel > 0 ? 'în față-dreapta' : 'în față-stânga';
    if (a <= 110) return rel > 0 ? 'la dreapta' : 'la stânga';
    if (a <= 155) return rel > 0 ? 'în spate-dreapta' : 'în spate-stânga';
    return 'în spate';
  }

  function offRouteGhidaj(fix) {
    if (!M.offRoute) return;
    const o = M.offRoute;
    if (!fix || fix.lat == null) return;
    o.distM = Math.round(haversineM(fix.lat, fix.lng, o.pct.lat, o.pct.lng));
    const brg = bearingDeg(fix.lat, fix.lng, o.pct.lat, o.pct.lng);
    o.brgDeg = Math.round(brg);
    o.relDeg = M._hdg != null ? Math.round(angDiff(brg, M._hdg)) : null;
    // PRINS: ești la punctul de reintrare
    if (o.distM <= OFF_PRINS_M) { iesiOffRoute('punct'); return; }
    // vocea: doar când se schimbă sectorul (opt sferturi de ceas) sau la 12 s
    const sector = o.relDeg != null ? Math.round(o.relDeg / 45) : null;
    const acum = clock.mono();
    // peste 2 km de punct, vocea tace: cifra rămâne pe ecran, dar „boxul 12 la 4
    // kilometri, în spate" repetat nu ajută pe nimeni — ori te întorci, ori ai renunțat
    if (o.distM > OFF_VORBA_MAX_M) return;
    if (acum - M._offVorbaMono < OFF_VORBA_MS) return;
    if (sector === M._offSector && acum - M._offVorbaMono < 30000) return;
    M._offSector = sector; M._offVorbaMono = acum;
    say(`Boxul ${o.boxNum} la ${distRo(o.distM)}` +
        (o.relDeg != null ? `, ${ceasRo(o.relDeg)}.` : '.'), 3, 'offroute', 'manevra');
  }

  function iesiOffRoute(cum) {
    const o = M.offRoute;
    if (!o) return;
    M.offRoute = null; M._offSemne = []; M._desyncSaid = null;
    log('offroute_iesire', { cum, boxNum: o.boxNum, ratacitM: Math.round((M.routeKm - o.kmLaIesire) * 1000) });
    M._lastSnapT = clock.mono();
    snapToBox(o.idx, 'offroute_' + cum);
    say(`Te-am prins, continuăm de la boxul ${o.boxNum}.`, 4, 'offroute', 'manevra');
    tone('ok');
    ui.render(M, plan);
  }

  // ── API public ────────────────────────────────────────────────────────────
  return {
    M, onFix, atBox, setTcSchedule, previzualizeazaBox, boxuriApropiate,
    // Butonul „am greșit drumul": pilotul știe primul, întotdeauna. Detectarea automată
    // are nevoie de două semne și, în tura Tresor, al doilea a venit după 3 minute —
    // o apăsare le sare pe amândouă.
    offRouteManual() {
      if (M.offRoute) return true;
      if (!punctDeReintrare()) { say('N-am de unde să te iau înapoi — n-am destul drum în memorie.', 3, 'offroute', 'manevra'); return false; }
      declaraOffRoute('manual');
      return true;
    },
    // „am revenit" — pilotul confirmă că e la punctul de reintrare
    offRouteRevenit() { if (M.offRoute) iesiOffRoute('manual'); },
    setOffRoute(on) { M.offRouteOn = !!on; if (!on && M.offRoute) { M.offRoute = null; ui.render(M, plan); } },
    start() {
      // ZI (sau leg) NOUĂ, explicit și complet — nu jumătate de reset. Versiunea veche
      // reseta ancorele dar NU și routeKm: după STOP la km 3,18 + START, ancora spunea
      // „km 0 e aici", iar regula „drum drept" teleporta mașina înapoi la 0,25 și o
      // încuia acolo (audit 02.08, #4). Contractul lui START e „ești fizic la boxul 1".
      M.state = 'LIAISON';
      odo.reset();
      M.routeKm = 0; M.traceM = null; M._projMiss = 0;
      M.rtIdx = 0; M.rt = null; M.nextBoxIdx = 0; M.results = {}; M.lastDebrief = null;
      M._ann = {}; M._staged = false; M._warnedRt = {}; M._desyncSaid = null; M._confirmedIdx = -1;
      M._virajRefuzat = null; M._turnAcc = 0; M._lastHdg = null; M._lastSnapT = 0;
      // leg nou = drum nou: firimiturile și semnele de ieșire de pe traseu nu se moștenesc
      M.offRoute = null; M._offSemne = []; M._urme = []; M._offSector = null; M._offVorbaMono = 0;
      // paznicul de direcție se re-armează la fiecare zi/leg nou
      M._dirEtapa = 0; M.dirAlerta = null; M.corectie = null;
      M._dirStart = M._lastPos ? { ...M._lastPos } : null;
      M._lastFixMono = null; M._gpsLostSaid = false;
      // zi/leg nou = riglă nouă: măsurătorile de calibrare NU se moștenesc între leg-uri
      cal = makeCalibrator();
      M.calFactor = 1; M._rawSinceAnchor = 0; M._calAnchorKm = 0; M._anchorKm = 0;
      M._calN = 0;
      // linia de start e prima ancoră geografică: de aici încolo poziția absolută lucrează
      M._anchorPos = M._lastPos ? { ...M._lastPos } : null;
      M._curveDeg = 0; M._curveHdg = null;
      const faraViteza = plan.rts.filter(r => r.kmh == null).length;
      say(plan.rts.length
        ? (faraViteza ? `Pornit. ${plan.rts.length} probe, ${faraViteza} fără viteză.`
                      : `Pornit. ${plan.rts.length} probe, totul automat.`)
        : 'Pornit.', 2);
      log('day_start', { rts: plan.rts.map(r => ({ name: r.name, kmh: r.kmh, type: r.type })) });
      ui.render(M, plan);
    },
    stop() {
      // O probă întreruptă cu STOP nu se „închide" cu un rezultat — ar intra în
      // clasament o cifră care descrie apăsarea butonului, nu condusul (audit, #12).
      // Se abandonează explicit, marcat în jurnal.
      if (M.rt) {
        log('rt_abandon', { rtIdx: M.rtIdx, name: M.rt.def.name,
                            laKm: r2(M.rt.distKm), dinKm: M.rt.def.distKm });
        say(`${M.rt.def.name} abandonată.`, 2);
        M.rt = null;
      }
      M.state = 'PREP';
      voice.flush();
      log('day_stop', {});
      ui.render(M, plan);
    },
    // Bătaia de inimă INDEPENDENTĂ de GPS (audit, #5). Tot ceasul intern bătea doar pe
    // fixuri: în tunel sau cu fluxul GPS mort, proba nu se mai închidea niciodată, iar
    // TC-urile nu mai avertizau nici cu mașina oprită lângă control. main.js o apelează
    // la fiecare secundă; testele o pot apela direct.
    tick() {
      if (M.state === 'PREP') return;
      const now = clock.mono();
      // și fără fixuri corecția expiră la timp: altfel, cu GPS-ul mort, ar rămâne pe
      // ecran ore întregi ca o informație proaspătă
      if (M.corectie && now > M.corectie.panaMono) M.corectie = null;
      const stale = M._lastFixMono != null && now - M._lastFixMono > 15000;
      if (stale && !M._gpsLostSaid) {
        M._gpsLostSaid = true;
        say(M.rt ? 'GPS pierdut în probă. Merg pe estimare.' : 'GPS pierdut.', 3, 'gps');
        log('gps_stale', { deS: Math.round((now - M._lastFixMono) / 1000), inRt: !!M.rt });
      }
      if (!stale) M._gpsLostSaid = false;
      if (M.rt) {
        // fără fixuri, poziția avansează pe ESTIMARE cu viteza țintă a probei — marcat
        // în jurnal; altfel proba rămânea deschisă pe vecie și restul zilei era mut
        if (stale) {
          const dtS = (now - (M._lastEstMono || M._lastFixMono)) / 1000;
          M._lastEstMono = now;
          if (dtS > 0 && dtS < 10 && M.rt.def.kmh) {
            M.routeKm += (M.rt.def.kmh / 3600) * dtS;
            M.rt.distKm = Math.max(0, M.routeKm - M.rt.def.startKm);
            log('pos_estimat', { routeKm: r2(M.routeKm) });
          }
        } else M._lastEstMono = null;
        rtTick();
      }
      tcTick();
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
      // indexul boxurilor se aliniază pe poziție; tot ce e în urmă e considerat făcut
      M.nextBoxIdx = 0;
      while (M.nextBoxIdx < plan.boxes.length && plan.boxes[M.nextBoxIdx].sumKm < M.routeKm - 0.05) M.nextBoxIdx++;
      M._confirmedIdx = M.nextBoxIdx - 1;
      say('Cursă preluată.', 2);
      log('takeover', { routeKm: r2(M.routeKm), state: M.state });
      ui.render(M, plan);
    }
  };
}

function r2(x) { return Math.round(x * 100) / 100; }
function r3(x) { return Math.round(x * 1000) / 1000; }
function r6(x) { return typeof x === 'number' && isFinite(x) ? Math.round(x * 1e6) / 1e6 : null; }
