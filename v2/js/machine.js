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
import { TURN_DIRS, normFlags, areFlag, esteStart, esteFinish } from './route.js';
import { secRo, distRo, vitezaRo } from './voice.js';
// numele strazii pentru „unde sunt se scoate cu acelasi extractor folosit la geocodare:
// un singur loc care stie ce e nume de artera si ce e cuvant de roadbook (vezi repere.js)
import { extrageReper } from './repere.js';
import { makeDebrief } from './debrief.js';
import { parseRallyTime, starturiDinStampila, frazaPragStart, PRAGURI_START_S } from './time.js';

// TREPTELE DE AVERTIZARE, de la v35: 500 / 300 / 150 / „acum" (era doar 300 / 150 / acum).
// Cererea lui Andreas (05.08.2026), din aceeași rădăcină ca harta: pe un tronson lung,
// între două manevre, aplicația tăcea minute întregi, iar tăcerea la un pilot care se
// orientează greu nu înseamnă „merge bine", ci „oare am ratat ceva?". Treapta de 500 m
// e prima veste că urmează o decizie de volan: la 60 km/h sunt 30 de secunde, adică
// exact cât trebuie ca s-o auzi, s-o ții minte și să alegi banda.
//
// SPAȚIUL MINIM: o treaptă are voie să existe doar dacă între boxul dinainte și ăsta
// încape ea plus încă 60 m de mers. Fără regula asta, la boxuri la 290 m unul de altul,
// treapta de 500 ar fi plecat în aceeași secundă cu „acum"-ul boxului dinainte — două
// fraze una peste alta exact în viraj. Boxurile înlănțuite (30-90 m, bucla József) rămân
// cum erau: doar „acum", plus coada cu manevra imediat următoare.
const TIERS_M = [500, 300, 150];   // + „acum", calculat din modelul șoferului
const TREAPTA_SPATIU_M = 60;

// ── GHIDAJUL CONTINUU pe tronsoanele lungi ──────────────────────────────────
// „Ești pe traseu. Drept încă 1,2 km până la boxul 5." — o confirmare, nu o instrucțiune.
// Pragurile: la 45 s SAU la un kilometru, ce vine primul, dar niciodată sub 250 m de mers
// de la ultima (ca la 100 km/h să nu se dubleze) și niciodată sub 550 m de boxul următor
// (de acolo încolo vorbește treapta de 500, iar peste manevră nu se calcă niciodată).
// Clasa e 'ritm': prin regulile de coadă din v31-v32, ritmul nu poate tăia o manevră.
const GHID_MS = 45000, GHID_KM = 1.0, GHID_MIN_MERS_KM = 0.25, GHID_MIN_MS = 20000;
const GHID_DIST_M = 550, GHID_MIN_KMH = 15;

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
const OFF_COT_GRD = 40, OFF_DRIFT_M = 250, OFF_VORBA_MAX_M = 2000, OFF_REEVAL_MS = 15000;
// ANTI-OSCILAȚIE: cât timp o țintă părăsită rămâne interzisă. City Demo Sibiu,
// 06.08.2026 — ținta a sărit de trei ori în trei minute între boxul 10 și boxul 9, două
// boxuri aflate în direcții OPUSE (19:18:14 → 9, la 711 m; 19:18:29 → 10, la 373 m;
// 19:19:32 → 9, la 798 m). Cauza nu e un bug de calcul: regula preferă un punct „în
// față", iar „în față" se schimbă la fiecare cotitură prin centrul vechi. 60 de secunde
// e cât ține o buclă de cvartal în oraș — sub atât, întoarcerea la boxul tocmai părăsit
// e zgomot de busolă, nu informație nouă. REGULA DE ALEGERE RĂMÂNE NEATINSĂ; asta e
// doar o interdicție pusă peste ea.
const OFF_REVENIRE_MS = 60000;
// Cât din reperul boxului încape într-o frază rostită la volan, la fiecare câteva
// secunde. „Str. Constituției" are 17 caractere, „Tribunalul și Judecătoria Sibiu" 31.
// Peste prag se taie la ultimul cuvânt întreg — se scurtează reperul, nu se adaugă vorbe.
const OFF_REPER_MAX = 40;

// ── CE E IMPOSIBIL NU SE SPUNE ──────────────────────────────────────────────
// 06.08.2026, 08:19:45, la 40 de secunde de la start, vocea a rostit: „Nu ești pe traseu.
// Boxul 5 e la 7933 virgulă 1 kilometri, la stânga." Iar la 08:23:23: „103 virgulă 3 în
// urmă, ține 4557." Ambele cifre erau calculate corect din datele pe care le avea
// aplicația — și ambele erau imposibile în lumea reală.
//
// Regula, de-acum: o cifră imposibilă nu e o cifră, e un semn că datele sunt stricate.
// Nu se rostește și nu se scrie; se spune ce știm cu adevărat, adică „nu știu", plus ce
// are pilotul de făcut. Un pilot care aude o cifră absurdă pierde încrederea în TOATE
// cifrele următoare, inclusiv în cele bune.
//
// PRAGURILE, alese dinainte:
//  • 500 km până la un box — un raliu de o zi are legul cel mai lung sub 100 km, deci
//    500 km e de cinci ori peste orice traseu real. Nimic legitim nu-l atinge.
//  • 200 km/h viteză-țintă rostită — mediile de la Sibiu sunt între 20 și 50 km/h, iar
//    recuperările reale ajung la 60-70. La 200 km/h nu se mai discută despre ritm, ci
//    despre o probă pierdută; cifra n-ar fi un sfat, ci o glumă periculoasă.
const IMPOSIBIL_DIST_M = 500000, IMPOSIBIL_KMH = 200;
const HARTA_STRICATA_TXT = 'Nu știu unde e boxul — harta traseului pare greșită. Mergi după roadbook.';

// ── CÂT DE DES SE VORBEȘTE DESPRE RITM, ÎN PROBĂ (v43) ──────────────────────
// Cererea lui Andreas, 07.08.2026, dimineața cursei. Măsurat în jurnalul City Demo Sibiu
// (06.08.2026, 11:21:03 → 11:21:21): „4 în avans, ține 45" · „6 virgulă 1 în urmă, ține
// 49" · „7 virgulă 6 în urmă, ține 49" · „8 virgulă 2 în urmă, ține 50" — PATRU rostiri
// în 18 secunde, la un pilot care conduce singur. Trei dintre ele spuneau, în fond,
// același lucru: „ești cam cu atâta în urmă".
//
// Două praguri, amândouă cu motivul lângă ele:
//  • RITM_MIN_MS — intervalul minim între două rostiri de ritm. Până azi NU exista un
//    prag propriu: ritmul se rostea în ritmul TONURILOR, adică o dată la 4 s (gardul
//    `clock.mono() - M._lastToneT > 4000` din rtTick), iar în jurnal se văd exact
//    intervale de 4,0-4,1 s. Deci valoarea de azi e 4000 ms și se dublează: 8000 ms.
//    Tonurile rămân la 4 s — ele nu ocupă difuzorul cu cuvinte și sunt singurul canal
//    care rămâne continuu după rărirea asta.
//  • RITM_SALT_S — cât trebuie să se miște devierea ca să merite o frază nouă. Sub 1,5 s
//    diferență față de ULTIMA rostire, cifra nouă nu schimbă nicio decizie de volan: la
//    45 km/h, 1,5 s înseamnă 19 m, adică sub lungimea unei intersecții. Peste prag se
//    vorbește chiar dacă saltul e brusc — regula rărește repetiția, nu ascunde noutatea.
const RITM_MIN_MS = 8000;
const RITM_SALT_S = 1.5;
//  • RITM_MAX_TACERE_MS — plasa de siguranță peste regula de stagnare (07.08, dimineața
//    cursei). Fără ea, o probă condusă CONSTANT ajungea la 4 fraze în 14 minute (măsurat
//    pe RT4 simulată): devierea îngheța, deci poarta tăcea la nesfârșit — iar „ține X"
//    nu se mai actualiza deloc. Andreas a cerut „la jumătate", nu „mai nimic". La 45 s
//    fără nicio rostire, se vorbește oricum o dată, chiar dacă devierea stagnează.
//  • …ȘI SE STRÂNGE SPRE FINISH (cerut de Andreas în aceeași dimineață): pe ultimele
//    minute ale probei, fiecare secundă de deviere devine tot mai greu de recuperat,
//    deci confirmarea trebuie să vină mai des chiar dacă cifra stagnează. Sub 3 minute
//    rămase → 30 s; sub 1 minut → 15 s. Pragurile pe timp IDEAL rămas, nu pe distanță:
//    la 20 km/h și la 50 km/h „un minut până la linie" înseamnă același lucru.
const RITM_MAX_TACERE_MS = 45000;
const RITM_TACERE_FINAL = [[60, 15000], [180, 30000]];   // [sub câte secunde rămase, plafonul]

function ritmPlafonTacere(ramasS) {
  if (ramasS != null) {
    for (const [prag, plafon] of RITM_TACERE_FINAL)
      if (ramasS < prag) return plafon;
  }
  return RITM_MAX_TACERE_MS;
}

// Poarta ritmului, scoasă ca funcție PURĂ ca să poată fi rulată direct pe secvențele din
// jurnalele reale (vezi test-ritm.mjs, care o hrănește cu momentele măsurate pe teren).
// `ultimaMs`/`ultimaA` = momentul și devierea absolută de la ULTIMA rostire de ritm din
// proba curentă; null/undefined la prima. `ramasS` = secundele IDEALE rămase din probă
// (optional; fără el, plafonul e cel de croazieră).
export function ritmPoateVorbi(acumMs, a, ultimaMs, ultimaA, ramasS) {
  if (ultimaMs != null && acumMs - ultimaMs < RITM_MIN_MS) return false;
  if (ultimaMs != null && acumMs - ultimaMs >= ritmPlafonTacere(ramasS)) return true;
  if (ultimaA != null && Math.abs(a - ultimaA) < RITM_SALT_S) return false;
  return true;
}

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
    _ann: {}, _staged: false, _warnedRt: {}, _nuOpriSpus: {}, _lastBank: 0, _coadaFinish: null,
    _turnAcc: 0, _lastHdg: null, _lastHdgT: 0, _quietMs: 0, _lastSnapT: 0, _virajRefuzat: null,
    _dirEtapa: 0, _dirStart: null, dirAlerta: null,
    _lastToneT: 0, _extSpeedKmh: null, _extSpeedT: 0,
    corectie: null,        // ultima corecție de poziție, pentru ECRAN (vezi anuntaCorectia)
    unde: null,            // ultimul raspuns la „unde sunt", tinut 20 s pe ecran
    // ȘTAMPILA TC (v44): momentul apăsat de om la începerea Time Control-ului, din care
    // se calculează orele de start ale probelor cu self-start decalat. Vezi time.js.
    stampila: null,        // { rallyMs, monoMs }
    startLinii: [],        // liniile de numărătoare, pentru ecran
    _stampPraguri: {},     // { 'TR 1': { 300: true, … } } — fiecare prag se rostește o dată
    // ieșirea de pe traseu: starea, semnele strânse și firimiturile de drum
    offRoute: null, offRouteOn: opts.offRoute !== false, _offSemne: [], _urme: [],
    _offVorbaMono: 0, _offSector: null, _hdg: null, _hartaIst: {}, _hartaStricata: false,
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
    const tcBoxes = plan.boxes.filter(b => areFlag(b, 'TC'));
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

  // ── ȘTAMPILA TC ȘI NUMĂRĂTOAREA SPRE STARTURI (v44) ───────────────────────
  // Ce face butonul: înregistrează SECUNDA în care a început Time Control-ul. Atât.
  // Din ea ies orele de start ale probelor cu decalaj (TR 1 la +24 min, TR 2 la +80,
  // TR 3 la +131 — buletinul de azi), numărătoarea de pe ecran și cele patru anunțuri.
  // Cronometrul probei NU se pornește de aici: el rămâne unde era, pe linia de start.

  // NIMIC RETROACTIV. Un prag al cărui moment a trecut deja în clipa ștampilei se
  // marchează ca rostit — deci tace. Asta acoperă și cazul „aplicația a repornit la
  // douăzeci de minute după TC": la reluare nu se strigă un start care e demult trecut.
  function armeazaPraguri(stampilaMs) {
    M._stampPraguri = {};
    for (const l of starturiDinStampila(plan.rts, stampilaMs, clock.rally())) {
      const p = {};
      for (const s of PRAGURI_START_S) p[s] = l.ramasS <= s;
      M._stampPraguri[l.name] = p;
    }
  }

  // `nou` = apăsare adevărată (se scrie în jurnal și în depozit); la reluarea de după
  // o repornire se re-armează doar starea, fără să se inventeze o a doua ștampilă.
  function pornesteStampila(rallyMs, { nou = true } = {}) {
    M.stampila = { rallyMs, monoMs: clock.mono() };
    armeazaPraguri(rallyMs);
    stampilaTick();
    if (nou) {
      log('tc_stampila', { la: rallyMs, probe: M.startLinii.map(l =>
        ({ name: l.name, tc: l.tc, minute: l.minutes, oraStart: l.oraMs })) });
      try {
        const p = store.put('tc_stamp', { rallyMs });
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
    ui.render(M, plan);
    return M.stampila;
  }

  function stampilaTick() {
    if (!M.stampila) { M.startLinii = []; return; }
    const linii = starturiDinStampila(plan.rts, M.stampila.rallyMs, clock.rally());
    M.startLinii = linii;
    for (const l of linii) {
      const p = M._stampPraguri[l.name] || (M._stampPraguri[l.name] = {});
      for (const prag of PRAGURI_START_S) {
        if (p[prag] || l.ramasS > prag) continue;
        p[prag] = true;
        // ÎNTR-O PROBĂ ACTIVĂ nu se rostește numărătoarea altei probe: acolo urechea
        // pilotului e a devierii. Pragul se CONSUMĂ totuși — altfel ar sări pe difuzor
        // la finish, vechi de minute întregi, exact peste anunțul de rezultat.
        if (!M.rt) {
          // prioritate mare (4), dar clasa 'ritm': nu taie niciodată o manevră „acum"
          // și așteaptă după ea în coadă. Categoria e pe PROBĂ, ca numărătoarea unei
          // probe să nu arunce din coadă anunțul alteia.
          say(frazaPragStart(l.name, prag), 4, 'start_' + l.name, 'ritm');
          tone(prag === 0 ? 'alarm' : 'ok');
        }
        log('start_prag', { name: l.name, pragS: prag, oraStart: l.oraMs, inProba: !!M.rt });
      }
    }
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
    if (M.unde && clock.mono() > M.unde.panaMono) M.unde = null;
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
      hartaOffCheck(); offRouteCheck(); offRouteGhidaj(fix);
      announceBoxes(); desyncCheck(); ghidajContinuu();
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
    refaTintaMaps();
    // Pentru ECRAN: pe secțiune deasă se arată DOUĂ manevre, nu una. Andreas a cerut deja
    // text și săgeți mai mari (v32); aici e vorba de a vedea CE URMEAZĂ, nu doar ce e acum.
    M.deasa = sectiuneDeasa();
    M.lant = M._lant ? M._lant.idx.map(j => plan.boxes[j] && plan.boxes[j].num) : null;
    ui.render(M, plan);
  }

  // Ținta butonului de Maps stă pe M, ca ecranul să rămână o funcție de stare (vezi
  // ui.js). Se recalculează la 2 s: căutarea punctului unui box parcurge urma de
  // recunoaștere, iar la 265 km aia are zeci de mii de puncte — de zece ori pe secundă
  // ar fi muncă degeaba fix în bucla care trebuie să rămână liberă pentru GPS.
  function refaTintaMaps(fortat) {
    const acum = clock.mono();
    if (!fortat && M._tintaMapsT != null && acum - M._tintaMapsT < 2000) return;
    M._tintaMapsT = acum;
    M.tintaMaps = tintaMaps();
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
    if (!plan.trace || !plan.trace.pts || plan.trace.pts.length < 2) return hartaDirectieCheck(fix);
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

  // PAZNICUL DE PLECARE, cu harta traseului. Fără urmă de recunoaștere, singura direcție
  // absolută pe care o avem e cea către coordonata boxului următor. Se compară coarda
  // primilor ~80 m de mers cu azimutul spre el: peste 100° înseamnă că boxul e în spate.
  // 80 m, nu 120 ca la paznicul cu urmă, fiindcă aici comparăm cu un PUNCT, nu cu un
  // traseu — reperul nu se pierde dacă drumul face o curbă între timp.
  const HARTA_START_M = 80, HARTA_START_GRD = 100;

  function hartaDirectieCheck(fix) {
    if (!hartaOk() || M._dirEtapa >= 2 || !M._dirStart) return;
    const strM = haversineM(M._dirStart.lat, M._dirStart.lng, fix.lat, fix.lng);
    if (strM < HARTA_START_M) return;
    // primul box de după cel de start care are coordonată
    let tinta = null;
    for (let i = 1; i < plan.boxes.length && i <= 4; i++) {
      const p = plan.harta[plan.boxes[i].num];
      if (p) { tinta = { box: plan.boxes[i], p }; break; }
    }
    if (!tinta) { M._dirEtapa = 2; return; }
    // paznicul de plecare nu are voie să judece direcția după o ancoră imposibilă: la
    // 7933 km orice azimut e „corect" din întâmplare, iar pe 06.08 a ieșit difGrd 90 —
    // adică sub pragul de alarmă, deci tăcere, deci încredere într-o hartă otrăvită
    if (haversineM(M._dirStart.lat, M._dirStart.lng, tinta.p.lat, tinta.p.lng) > IMPOSIBIL_DIST_M) {
      stricaHarta(haversineM(M._dirStart.lat, M._dirStart.lng, tinta.p.lat, tinta.p.lng), tinta.box.num);
      M._dirEtapa = 2; return;
    }
    const mers = bearingDeg(M._dirStart.lat, M._dirStart.lng, fix.lat, fix.lng);
    const spre = bearingDeg(M._dirStart.lat, M._dirStart.lng, tinta.p.lat, tinta.p.lng);
    const dif = Math.abs(angDiff(mers, spre));
    M._dirEtapa = 2;
    log('directie_start_harta', { difGrd: Math.round(dif), azimutMers: Math.round(mers),
                                  azimutBox: Math.round(spre), boxNum: tinta.box.num,
                                  deplasareM: Math.round(strM) });
    if (dif <= HARTA_START_GRD) { M.dirAlerta = null; return; }
    M.dirAlerta = { text: `Direcție greșită — boxul ${tinta.box.num} e în spatele tău`,
                    difGrd: Math.round(dif) };
    say(`Direcție greșită. Boxul ${tinta.box.num} e în spatele tău.`, 4, 'dir', 'manevra');
    tone('alarm');
  }

  // LINIA DREAPTĂ NU POATE FI MAI LUNGĂ DECÂT DRUMUL. Cu coordonata boxului următor,
  // asta devine o măsurătoare, nu o presupunere: dacă distanța în linie dreaptă până la
  // el depășește drumul care ți-a mai rămas până acolo (din roadbook), nu ești pe traseu.
  // Nu e un prag de reglat — e o imposibilitate geometrică. Marja de 200 m acoperă
  // zgomotul GPS și driftul de odometru.
  //
  // Ăsta e semnul care lipsea în tura poligon: după virajul greșit de la boxul 2, mașina
  // s-a depărtat de traseu cu 50 km/h, iar aplicația a continuat să anunțe boxurile 4, 5
  // și 6 pentru că odometrul mergea înainte. Kilometrajul nu poate ști că ai greșit
  // drumul; coordonata, da.
  // Marja de zgomot (GPS + drift de odometru), peste incertitudinea ancorei.
  //
  // 04.08.2026, 21:48 — ALARMĂ FALSĂ pe traseu corect, în 27 de secunde de la start.
  // Măsurat în jurnal: boxul 3 avea ancora geocodată la 512 m de mașină, iar roadbook-ul
  // spunea 268 m de drum → „depășire" 243 m, peste pragul fix de 200. Numai că mașina SE
  // APROPIA: 512, 507, 502, 497, 495, 492, 488, 483, 478, 471, 466, 460, 455 m, treisprezece
  // fixuri la rând, iar aplicația însăși măsurase cu 1 secundă înainte că merge SPRE box
  // (directie_start_harta, difGrd 16). Depășirea rămânea constantă la ~245 m fiindcă
  // ancora era mijlocul străzii Quasar, nu colțul ei: o eroare de poziție a ANCOREI,
  // citită ca abatere de traseu. Trei apărări, fiecare suficientă singură:
  //  • incertitudinea ancorei intră în prag (300 m implicit pentru geocodare);
  //  • dacă distanța până la ancoră scade pe ultimele 8 fixuri, nu se dă niciun semn;
  //  • dacă botul mașinii arată spre ancoră (±40°), la fel.
  const HARTA_MARJA_M = 200;
  const HARTA_INC_IMPLICIT_M = 300, HARTA_TREND_N = 8, HARTA_TREND_MIN = 4, HARTA_SPRE_GRD = 40;

  // HARTA POATE FI DECLARATĂ STRICATĂ ÎN MERS, nu doar la încărcare. Ancora otrăvită de
  // pe 06.08 era deja salvată în telefon când a pornit cursa — deci nu ajunge s-o oprim
  // la geocodare, trebuie și o poartă care se închide din mașină. Odată închisă, harta nu
  // mai e folosită de nimeni (nici direcția de plecare, nici ghidajul de întoarcere), iar
  // aplicația merge FĂRĂ hartă — stare sigură, deja gestionată: „nu știu unde e boxul
  // dacă greșești drumul", și atât.
  function hartaOk() { return !!plan.harta && !M._hartaStricata; }

  function stricaHarta(dreaptaM, boxNum) {
    if (M._hartaStricata) return;
    M._hartaStricata = true;
    M.dirAlerta = null;
    log('harta_imposibila', { boxNum, dreaptaM: Math.round(dreaptaM), pragM: IMPOSIBIL_DIST_M });
    say('Harta traseului e greșită — o opresc. Mergi după roadbook.', 4, 'harta', 'manevra');
  }

  function hartaOffCheck() {
    if (!hartaOk() || M.offRoute || !M._lastPos || M.rt) return;
    for (let i = M.nextBoxIdx; i < plan.boxes.length && i <= M.nextBoxIdx + 3; i++) {
      const b = plan.boxes[i];
      const p = plan.harta[b.num];
      if (!p) continue;
      const dreaptaM = haversineM(M._lastPos.lat, M._lastPos.lng, p.lat, p.lng);
      // Înainte de orice judecată despre traseu: e cifra asta posibilă? Un box la 7933 km
      // nu înseamnă „ai greșit drumul", înseamnă „harta minte". Diferența contează:
      // prima citire l-a scos pe Andreas de pe traseu la 40 de secunde de la start.
      if (dreaptaM > IMPOSIBIL_DIST_M) { stricaHarta(dreaptaM, b.num); return; }
      const drumM = Math.max(0, (b.sumKm - M.routeKm) * 1000);
      const depasireM = dreaptaM - drumM;
      // CÂT DE BINE ȘTIM UNDE E ANCORA. O coordonată geocodată e MIJLOCUL străzii, nu
      // colțul: pe o stradă de 400 m, boxul poate fi la 200 m de punctul întors de
      // serviciu. Incertitudinea vine cu ancora (vezi repere.js), iar aici se adună la
      // marjă — altfel eroarea ancorei se citește ca abatere de traseu.
      const incM = Number.isFinite(p.incM) ? p.incM : HARTA_INC_IMPLICIT_M;
      const prag = incM + HARTA_MARJA_M;
      // Istoricul distanței până la ancoră: dacă SCADE, mașina merge spre box. Poate fi
      // pe alt drum, dar nu se depărtează — iar un semn de „ai ieșit de pe traseu" dat
      // în timp ce te apropii de boxul următor e o alarmă falsă prin construcție.
      const ist = (M._hartaIst[b.num] = M._hartaIst[b.num] || []);
      ist.push(Math.round(dreaptaM));
      if (ist.length > HARTA_TREND_N) ist.shift();
      // Fără fereastra plină nu se acuză nimic: lipsa dovezii nu e dovadă. (Prima
      // versiune dădea semnul chiar la primul fix al zilei, când n-avea nici istoric,
      // nici direcție de mers — exact ce s-a întâmplat la 21:48:32, la 14 secunde de
      // la START ZIUA.)
      // Fereastra e de 8 fixuri, dar se judecă de la 4: pe un roadbook des, boxul
      // urmarit se schimba la fiecare cateva fixuri si o fereastra plina n-ar veni
      // niciodata. Sub 4, nu se acuza nimic.
      const destuleFixuri = ist.length >= HARTA_TREND_MIN;
      const seApropie = destuleFixuri && ist[ist.length - 1] < ist[0] - 20;
      // …și direcția de mers: dacă botul mașinii arată spre ancoră, drumul ăsta duce
      // acolo, oricât de lung ar fi ocolul.
      const spre = bearingDeg(M._lastPos.lat, M._lastPos.lng, p.lat, p.lng);
      const spreBox = M._hdg != null && Math.abs(angDiff(spre, M._hdg)) <= HARTA_SPRE_GRD;
      if (depasireM > prag) {
        log('harta_off', { boxNum: b.num, dreaptaM: Math.round(dreaptaM),
                           drumM: Math.round(drumM), depasireM: Math.round(depasireM),
                           incM: Math.round(incM), prag: Math.round(prag),
                           seApropie, spreBox, destuleFixuri });
        // veto: n-am destule fixuri / te apropii / mergi spre el
        if (!destuleFixuri || seApropie || spreBox) return;
        semnOffRoute('mai_departe_decat_drumul', b.num, i);
        incearcaOffRoute();
      }
      return;   // se judecă după primul box cu coordonată, nu după toate
    }
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
      // schimbarea de medie se anunță ÎNAINTE de start, nu doar la punctul ei: pe TR4
      // de la Reșița media scade de la 24,3 la 20,5 în plină probă, iar un pilot care
      // află abia acolo pierde secundele de reacție exact unde se dau punctele.
      // ZONELE DE LIMITĂ (v44) nu sunt „schimbări de medie": ele se numără separat, iar
      // schimbarea anunțată e prima OFICIALĂ, nu prima din listă — altfel, pe o probă
      // cu o zonă de 30 la început, pilotul ar auzi „apoi schimbare la 30" și ar crede
      // că aia e media probei.
      const urm = (rt.segments || []).slice(1);
      const alta = urm.find(s => !s.limita && !s.iesireLimita);
      const nLim = urm.filter(s => s.limita).length;
      // START DIN MERS (v44, buletinul de azi): „Start din mers, fără oprire. Atenție,
      // oprirea se va penaliza!" Se spune O SINGURĂ DATĂ, la prima avertizare, și numai
      // la probele `auto` — la cele `standing` pilotul TREBUIE să oprească la linie, iar
      // un „nu opri" acolo ar fi exact instrucțiunea inversă.
      let nuOpri = '';
      if (rt.type === 'auto' && rt.kmh != null && !M._nuOpriSpus[rt.name]) {
        M._nuOpriSpus[rt.name] = true;
        nuOpri = ' Din mers — nu opri!';
      }
      say(rt.kmh != null
            ? `Proba în 500. Viteza ${vitezaRo(rt.kmh)}.` + nuOpri +
              (alta != null ? ` Apoi schimbare la ${vitezaRo(alta.kmh)}.` : '') +
              (nLim ? (nLim === 1 ? ' Cu o zonă de limită.' : ` Cu ${nLim} zone de limită.`) : '')
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

  // CARE TREPTE au unde încăpea înaintea boxului `i`. O treaptă care ar pleca odată cu
  // boxul dinainte nu e o avertizare timpurie, e o frază peste altă frază. Vezi TIERS_M.
  function trepteUtile(i) {
    const b = plan.boxes[i];
    if (!b) return [];
    const pb = i > 0 ? plan.boxes[i - 1] : null;
    const gapM = pb ? (b.sumKm - pb.sumKm) * 1000 : Infinity;
    return TIERS_M.filter(t => t <= gapM - TREAPTA_SPATIU_M);
  }

  // ── LANȚURILE DE MANEVRE ȘI SECȚIUNILE DESE ───────────────────────────────
  // Cererea lui Andreas, 05.08.2026, după ce a văzut ruta: „pe ruta cu multe bucle din
  // Brebu am avut cele mai mari probleme de navigație […] trebuie să fie perfect făcute,
  // să nu stea mult într-o fereastră de manevră și să o piardă pe următoarea care este
  // din scurt."
  //
  // MĂSURAT pe roadbook-ul real (Reșița Leg 2, boxurile 75-110, zona Brebu Nou–Gărâna):
  // 23 de manevre, distanța mediană între ele 430 m — dar cinci perechi sub 150 m, iar
  // cazul cel mai greu e 105 → 106 → 107: trei viraje în T în 170 m (120 m, apoi 50 m).
  // La viteza probei RT4 (24,3 km/h = 6,75 m/s) alea sunt 17,8 s și 7,4 s. Paisprezece
  // dintre manevre cad ÎN INTERIORUL probei, unde aplicația vorbește și despre ritm.
  //
  // Trei reguli, în ordinea în care contează:
  //  1. pilotul trebuie să știe DINAINTE că vin trei, altfel le tratează ca surprize;
  //  2. nicio frază n-are voie să ocupe difuzorul până peste momentul „acum" al manevrei
  //     următoare — mai bine scurt și la timp decât complet și târziu;
  //  3. în probă, pe secțiune deasă, ritmul tace: la 24 km/h cifra de deviere poate
  //     aștepta 20 de secunde, un viraj ratat nu se mai recuperează.
  const LANT_N = 3;              // câte manevre fac un lanț
  const LANT_MAX_M = 400;        // pe cât drum (măsurat: 105→107 = 170 m)
  const DEASA_M = 600;           // „secțiune deasă": următoarele 3 manevre în sub atât
  const PREAMBUL_MAX_M = 200;    // mai devreme de atât, treptele normale sunt mai bune
  const ACUM_MIN_M = 8;          // podeaua „acum"-ului: sub atât niciun cuvânt nu mai ajută
  const RITM_DEASA_MS = 30000;   // pe secțiune deasă, ritmul vorbește cel mult o dată la 30 s
  const RITM_TACE_INAINTE_S = 12; // și tace de tot în ultimele 12 s dinaintea unui viraj

  const durataMs = t => (voice && voice.durataMs ? voice.durataMs(t) : 350 + String(t).length * 90);
  const esteManevra = b => !!b && TURN_DIRS.has(b.dir || '');

  // indicii următoarelor `n` manevre, pornind de la `i` (inclusiv)
  function manevreDeLa(i, n) {
    const out = [];
    for (let j = Math.max(0, i); j < plan.boxes.length && out.length < n; j++)
      if (esteManevra(plan.boxes[j])) out.push(j);
    return out;
  }

  // Lanțul care ÎNCEPE la boxul i: trei manevre în sub 400 m. Un box cu semn (TC, linie
  // de probă) nu intră niciodată într-un lanț — acolo se spune semnul, nu o listă.
  function lantDeLa(i) {
    if (!esteManevra(plan.boxes[i])) return null;
    const idx = manevreDeLa(i, LANT_N);
    if (idx.length < LANT_N || idx[0] !== i) return null;
    if (idx.some(j => normFlags(plan.boxes[j]).length)) return null;
    const span = (plan.boxes[idx[LANT_N - 1]].sumKm - plan.boxes[i].sumKm) * 1000;
    return span <= LANT_MAX_M ? idx : null;
  }

  function sectiuneDeasa() {
    const idx = manevreDeLa(M.nextBoxIdx, LANT_N);
    if (idx.length < LANT_N) return false;
    return (plan.boxes[idx[LANT_N - 1]].sumKm - M.routeKm) * 1000 <= DEASA_M;
  }

  // CÂND SE ROSTEȘTE „ACUM" (regula nouă, v37). Până acum era o podea fixă de 25 m, ceea
  // ce la 24 km/h însemna 3,7 s — dar între boxurile 106 și 107 sunt 50 m, deci pragul
  // trebuie să poată coborî. Formula spune ce trebuie: cât drum se face cât se ROSTEȘTE
  // fraza, plus timpul de reacție învățat. Plafonul e jumătate din distanța până la boxul
  // DINAINTE, ca „acum"-ul unei manevre să nu plece înaintea manevrei de dinaintea ei.
  function pragAcum(i, txt) {
    const v = Math.max(2.5, (M.speedKmh || 20) / 3.6);
    const reactie = driver.latencyS ? driver.latencyS() : 1.2;
    const nevoie = (reactie + durataMs(txt) / 1000) * v;
    const b = plan.boxes[i], pb = i > 0 ? plan.boxes[i - 1] : null;
    const gapPrev = pb ? (b.sumKm - pb.sumKm) * 1000 : Infinity;
    const plafon = Math.min(ACUM_MAX_M, gapPrev / 2);
    return Math.max(ACUM_MIN_M, Math.min(nevoie, plafon));
  }

  // Câte secunde mai am până la momentul „acum" al manevrei URMĂTOARE. Asta e fereastra
  // în care trebuie să încapă fraza de acum — dincolo de ea, aș vorbi peste virajul care
  // vine. Exact defectul din tura Tresor, unde „stânga acum" a stat în coadă în spatele
  // unei fraze de patru secunde și pilotul a ratat ieșirea.
  function secundePanaLaUrmatorulCritic(i) {
    const urm = manevreDeLa(i + 1, 1)[0];
    if (urm == null) return Infinity;
    const nb = plan.boxes[urm];
    const kmCritic = nb.sumKm - pragAcum(urm, maneuver(nb.dir, true)) / 1000;
    const v = Math.max(2.5, (M.speedKmh || 20) / 3.6);
    return ((kmCritic - M.routeKm) * 1000) / v;
  }

  // Prima variantă care ÎNCAPE în fereastră. Variantele vin de la cea mai completă la cea
  // mai scurtă; dacă nu încape niciuna, se rostește cea mai scurtă — un cuvânt la timp
  // bate o frază corectă și târzie.
  function alegeFraza(variante, secunde) {
    for (const t of variante) if (durataMs(t) / 1000 <= secunde) return t;
    return variante[variante.length - 1];
  }

  // ecoul dintr-un lanț: un cuvânt, două. Direcția e deja cunoscută din preambul.
  function ecouRo(dir) {
    if (/^GIRATORIU-/.test(dir || '')) return `ieșirea ${dir.slice(-1)}`;
    if (dir === 'STÂNGA' || dir === 'STÂNGA-T') return 'stânga';
    if (dir === 'DREAPTA' || dir === 'DREAPTA-T') return 'dreapta';
    return 'acum';
  }

  // Preambulul, în două lungimi. Cel scurt renunță la „la T" — informația aia se
  // recuperează pe ecran și la ecou; ce nu se recuperează e timpul.
  function texteLant(idx) {
    const lung = idx.map(j => maneuver(plan.boxes[j].dir, false));
    const scurt = idx.map(j => ecouRo(plan.boxes[j].dir));
    return [`Trei la rând: ${lung[0]}, ${lung[1]}, apoi ${lung[2]}.`,
            `Trei la rând: ${scurt[0]}, ${scurt[1]}, ${scurt[2]}.`];
  }

  function announceBoxes() {
    // Pe dinafară, planul ÎNGHEAȚĂ. În teren, aplicația a continuat să dea cue-uri
    // pentru boxurile 15, 16, 17 și 18 în timp ce mașina era pe alte străzi — instrucțiuni
    // de virat aplicate unui drum pe care nu se afla. Tăcerea e mai bună.
    if (M.offRoute) return;
    const boxes = plan.boxes;
    while (M.nextBoxIdx < boxes.length && M.routeKm > pragTrecere(M.nextBoxIdx)) M.nextBoxIdx++;
    const i = M.nextBoxIdx;
    const b = boxes[i];
    // lanțul consumat se uită: altfel un box din față ar fi tratat ca ecou de lanț vechi
    if (M._lant && i > M._lant.idx[M._lant.idx.length - 1]) M._lant = null;
    if (!b) return;
    const dM = (b.sumKm - M.routeKm) * 1000;
    const silent = b.dir === 'ÎNAINTE' && !normFlags(b).length;   // „drept înainte" nu se rostește
    const key = `${b.num}_${Math.round(b.sumKm * 100)}`;

    // ── 1. PREAMBULUL DE LANȚ ────────────────────────────────────────────
    // „Trei la rând: dreapta la T, stânga la T, apoi dreapta la T." O singură dată,
    // înaintea primei manevre. De aici încolo fiecare primește doar un ecou scurt.
    if (!M._lant && !M._ann[key + '_lant']) {
      const lant = lantDeLa(i);
      if (lant) {
        const pb = i > 0 ? boxes[i - 1] : null;
        const gapPrev = pb ? (b.sumKm - pb.sumKm) * 1000 : Infinity;
        const pragPre = Math.min(PREAMBUL_MAX_M, Math.max(40, gapPrev * 0.7));
        if (dM <= pragPre) {
          // ÎNCAPE PREAMBULUL până la momentul în care trebuie rostit primul ecou? Dacă
          // nu încape nici varianta scurtă, lanțul NU se folosește deloc: se cade pe
          // coada normală („dreapta acum, și imediat stânga"), care e făcută exact
          // pentru cazurile foarte strânse. Un preambul care încă vorbește când ajungi
          // în prima intersecție e mai rău decât niciun preambul.
          const v = Math.max(2.5, (M.speedKmh || 20) / 3.6);
          const fereastraS = (dM - pragAcum(i, ecouRo(b.dir))) / v;
          const variante = texteLant(lant);
          const txt = variante.find(t => durataMs(t) / 1000 <= fereastraS);
          if (!txt) {
            M._ann[key + '_lant'] = true;      // nu se mai încearcă la fiecare fix
            log('lant_prea_strans', { boxuri: lant.map(j => boxes[j].num),
                                      fereastraS: Math.round(fereastraS * 10) / 10,
                                      cerutMs: Math.round(durataMs(variante[1])) });
          } else {
          M._ann[key + '_lant'] = true;
          M._lant = { idx: lant, de: clock.mono() };
          say(txt, 4, 'turn', 'manevra');
          M._ghidT = clock.mono(); M._ghidKm = M.routeKm;
          log('lant', { boxuri: lant.map(j => boxes[j].num), dM: Math.round(dM),
                        spanM: Math.round((boxes[lant[2]].sumKm - b.sumKm) * 1000),
                        kmh: Math.round(M.speedKmh), durataMs: Math.round(durataMs(txt)) });
          return;
          }
        }
      }
    }

    // ── 2. ECOUL, pentru boxurile dintr-un lanț deja anunțat ─────────────
    if (M._lant && M._lant.idx.includes(i)) {
      if (M._ann[key + '_ecou']) return;
      const ecou = ecouRo(b.dir);
      if (dM > pragAcum(i, ecou)) return;
      M._ann[key + '_ecou'] = true;
      // cat 'ecou': un ecou nou îl înlocuiește pe cel vechi din coadă, iar TTL-ul lui e
      // de 2,5 s — dacă pilotul merge mai repede decât m-am așteptat, ecoul vechi se
      // aruncă în loc să se rostească peste virajul următor (vezi voice.ttl)
      say(ecou, 4, 'ecou', 'manevra');
      M._ghidT = clock.mono(); M._ghidKm = M.routeKm;
      driver.cueGiven(b.num, clock.wall());
      log('cue', { boxNum: b.num, dM: Math.round(dM), kmh: Math.round(M.speedKmh), ecou: true });
      return;
    }

    // ── 3. TREPTELE NORMALE ──────────────────────────────────────────────
    // Pragul „acum" se calculează pe fraza de bază; variantele mai lungi se aleg mai jos,
    // după cât timp e până la manevra următoare.
    const nowM = pragAcum(i, silent ? '' : turnText(b, dM, true));

    const tiers = [...trepteUtile(i), nowM].sort((a, b2) => b2 - a);
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
      const baza = turnText(b, dM, isNow);
      // CE URMEAZĂ DUPĂ MANEVRĂ, spus din timp: „dreapta acum, și imediat stânga" /
      // „150 de metri — dreapta, apoi în 300 de metri stânga". Pilotul are nevoie de
      // secvență cât mai are timp să aleagă banda și viteza. (Andreas, 04.08.2026.)
      //
      // Coada stă pe DOUĂ anunțuri, nu doar pe „acum": și pe ultima treaptă cu cifră
      // (150 m). Motivul e măsurat în tura Tresor: „acum" poate ajunge la ureche prea
      // târziu sau deloc — la boxul 12 a plecat cu 13 m înainte de viraj și a intrat în
      // coadă în spatele frazei de finish, iar pilotul a ratat ieșirea.
      //
      // NOU în v37: fraza completă se rostește DOAR dacă încape până la momentul „acum"
      // al manevrei următoare. Dacă nu, se scurtează — întâi metrii, apoi legătura.
      const capManevra = TURN_DIRS.has(b.dir || ''), capFinish = esteFinish(b);
      let txt = baza, coadaPusa = false;
      if ((isNow || ultimaCuCifra) && (capManevra || capFinish)) {
        const coada = coadaManevra(i);
        const limita = capFinish ? COADA_FINISH_M : (M.rt ? COADA_IMEDIAT_M : COADA_MAX_M);
        // dacă boxul ăsta e capul unui lanț, coada de pereche se sare: preambulul de
        // lanț spune oricum toate trei, iar două fraze despre aceeași secvență înseamnă
        // doar mai multe cuvinte în difuzor
        if (coada && coada.gapM <= limita && !lantDeLa(i)) {
          const leg = isNow ? ', și ' : ', apoi ';
          const variante = [
            baza + leg + coada.text,                       // „…, și în 100 de metri stânga la T"
            baza + leg + maneuver(coada.box.dir, false),   // „…, și stânga la T" — fără metri
            baza + ' — apoi ' + ecouRo(coada.box.dir),     // „… — apoi stânga"
            baza                                           // doar manevra de acum
          ];
          txt = alegeFraza(variante, secundePanaLaUrmatorulCritic(i));
          coadaPusa = txt !== baza;
          // ce s-a spus aici nu se mai repetă după linie, la închiderea probei
          if (capFinish && txt !== baza) M._coadaFinish = coada.box.num;
        }
      }
      // ── PRIMA AVERTIZARE SPUNE ȘI CE BOX E (v43) ─────────────────────────
      // Cererea lui Andreas, 07.08.2026: „să aud și numărul boxului și ce zice
      // roadbook-ul despre el, ca să mă pot lega de caiet și de hartă dintr-o ureche."
      //   „500 de metri — giratoriu, ieșirea 2 — boxul 10, Str. Constituției"
      // O SINGURĂ DATĂ per box, la prima treaptă care se rostește (de obicei 500 m).
      // De ce nu la toate treptele: pe secțiunile dese (lanțurile v37), frazele lungi
      // la trepte succesive se calcă una pe alta și vocea aruncă anunțuri — în jurnalele
      // reale asta apare ca `voce_aruncata`, adică fix manevra pe care pilotul n-o aude.
      // Trei excepții, din același motiv:
      //  • „acum" nu primește niciodată sufixul — acolo fiecare cuvânt în plus întârzie
      //    decizia de volan cu ~90 ms și e singura frază care nu are voie să întârzie;
      //  • dacă fraza are deja coadă („…, apoi în 300 de metri stânga"), ce urmează bate
      //    orientarea: secvența de manevre e informația care se pierde dacă lipsește;
      //  • în lanțuri (v37, „Trei la rând: …") nu se adaugă nimic — sunt deja comprimate
      //    intenționat, iar ecourile ies pe altă ramură, care nici nu ajunge aici.
      // Reperul trece prin ACEEAȘI sită ca ghidajul offroute din v42 (extrageReper →
      // scurtReper): un singur loc care știe cât din comentariu încape într-o frază.
      if (!isNow && !coadaPusa && capManevra && !M._ann[key + '_box'] && !lantDeLa(i)) {
        const sufix = sufixBox(b);
        if (sufix) {
          // încape? Fereastra e până la momentul „acum" al boxului ĂSTA (nowM e chiar
          // pragul lui) sau până la „acum"-ul manevrei următoare, ce vine mai devreme.
          const vNow = Math.max(2.5, (M.speedKmh || 20) / 3.6);
          const fereastraS = Math.min((dM - nowM) / vNow, secundePanaLaUrmatorulCritic(i));
          txt = alegeFraza([txt + sufix, txt], fereastraS);
          if (txt !== baza) log('box_descris', { boxNum: b.num, dM: Math.round(dM),
                                                 txt, fereastraS: Math.round(fereastraS * 10) / 10 });
        }
      }
      // s-a consumat singura ocazie, indiferent dacă sufixul a încăput sau nu: la treapta
      // următoare fraza trebuie să fie scurtă, nu „mai încerc o dată, poate acum intră"
      M._ann[key + '_box'] = true;
      // Clasa 'manevra' lipsea tocmai de la anunțurile de viraj — adică fix de la ce
      // descrie regula. Comitul „paznic de directie" (03.08) a pus clasele pe alarme și
      // pe ritm, dar anunțul principal („150 de metri — dreapta") rămăsese neclasificat,
      // deci orice mesaj cu prioritate mai mare îl putea tăia din difuzor.
      say(txt, isNow ? 4 : (M.rt ? 3 : 2), 'turn', 'manevra');
      // Orice anunț de box repornește ceasul ghidajului continuu: o confirmare de tipul
      // „ești pe traseu" la două secunde după „stânga acum" e zgomot, nu liniște.
      M._ghidT = clock.mono(); M._ghidKm = M.routeKm;
      // Distanța la care s-a rostit „acum" intră în jurnal. Fără ea, întrebarea „de la
      // câți metri a vorbit?" se reconstruia din poziția logată la 5-6 s distanță, adică
      // se estima (04.08, analiza turei Tresor — o eroare de până la 75 m la 54 km/h).
      if (isNow) {
        driver.cueGiven(b.num, clock.wall());
        log('cue', { boxNum: b.num, dM: Math.round(dM), kmh: Math.round(M.speedKmh),
                     fereastraS: Math.round(secundePanaLaUrmatorulCritic(i) * 10) / 10,
                     durataMs: Math.round(durataMs(txt)) });
      }
    }
  }

  // ── GHIDAJUL CONTINUU ─────────────────────────────────────────────────────
  // Ce rezolvă: tăcerea de pe tronsoanele lungi. Între două manevre aflate la kilometri
  // distanță, aplicația nu spunea nimic — iar pentru cineva care se orientează greu,
  // tăcerea nu se citește ca „merge bine", ci ca „am ratat ceva și nu știu ce".
  //
  // Ce NU face, și de ce:
  //  • nu vorbește în probă — acolo urechea e pe cifrele de ritm, iar vocea e a probei;
  //  • nu vorbește pe dinafară — acolo planul e înghețat, iar „ești pe traseu" ar fi o
  //    minciună curată;
  //  • nu vorbește sub 550 m de boxul următor — de acolo încolo vorbesc treptele;
  //  • nu spune „ești pe traseu" decât dacă CHIAR se poate măsura: fraza cere proiecție
  //    validă pe geometria de recunoaștere. Fără ea, aplicația știe doar cât a rulat
  //    odometrul, deci spune doar atât — distanța rămasă, fără nicio afirmație despre
  //    drumul pe care se află.
  function ghidajContinuu() {
    if (M.offRoute || M.rt || M.state !== 'LIAISON') return;
    if (M.speedKmh < GHID_MIN_KMH) return;
    const b = plan.boxes[M.nextBoxIdx];
    if (!b) return;
    const dM = (b.sumKm - M.routeKm) * 1000;
    if (dM < GHID_DIST_M) return;
    const acum = clock.mono();
    if (M._ghidT == null) { M._ghidT = acum; M._ghidKm = M.routeKm; return; }
    const dtMs = acum - M._ghidT;
    const dKm = M.routeKm - (M._ghidKm != null ? M._ghidKm : M.routeKm);
    const peTimp = dtMs >= GHID_MS && dKm >= GHID_MIN_MERS_KM;
    const peKm = dKm >= GHID_KM && dtMs >= GHID_MIN_MS;
    if (!peTimp && !peKm) return;
    M._ghidT = acum; M._ghidKm = M.routeKm;
    const masurat = !!(plan.trace && plan.anchorMap && M.traceM != null && !(M._projMiss > 0));
    const cine = b.num != null ? `boxul ${b.num}` : 'boxul următor';
    say((masurat ? 'Ești pe traseu. ' : '') + `Drept încă ${distRo(dM)} până la ${cine}.`,
        2, 'ghidaj', 'ritm');
    log('ghidaj', { boxNum: b.num, dM: Math.round(dM), masurat, de: peKm ? 'km' : 'timp' });
  }

  function turnText(b, dM, isNow) {
    const dp = distRo(Math.max(20, dM));
    const flags = normFlags(b);
    // BOXUL CARE E ȘI FINISH, ȘI START. La Reșița, boxul 64 închide proba 2 și o
    // deschide pe 3 în ACELAȘI punct; la Sibiu tiparul se repetă. Dacă s-ar rosti doar
    // unul din cele două semne, pilotul ar trece linia crezând că a terminat — sau că
    // abia începe. Se spune întreg, într-o singură frază, fiindcă acolo nu mai e timp
    // pentru două.
    if (flags.includes('RT_FINISH') && flags.some(f => f === 'RT_START_AUTO' || f === 'RT_START_STANDING'))
      return isNow ? 'FINISH — și imediat START probă nouă'
                   : `Finish în ${dp}, și acolo începe proba următoare`;
    switch (flags[0]) {
      case 'TC': return isNow ? 'Time Control — ștampila' : `Time Control în ${dp}`;
      case 'RT_START_STANDING': return isNow ? 'Linia de start' : `Start probă în ${dp}`;
      case 'RT_START_AUTO': return isNow ? 'START probă' : `Start probă în ${dp}`;
      case 'RT_FINISH': return isNow ? 'FINISH' : `Finish în ${dp}`;
      case 'PARKING': return isNow ? 'Parcare' : `Parcare în ${dp}`;
      case 'EV': return isNow ? 'Stație de încărcare' : `Încărcare în ${dp}`;
    }
    if (b.dir === 'STOP-CFR') return isNow ? 'STOP — cale ferată' : `Cale ferată în ${dp} — vei opri`;
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
    say(`Start. Ține ${vitezaRo(rt.kmh)}.`, 4, 'race');
    tone('ok');
    log('rt_start', { rtIdx: M.rtIdx, name: rt.name, kmh: rt.kmh });
    ui.render(M, plan);
  }

  function rtTick() {
    const rt = M.rt, def = rt.def;
    // O PROBĂ POATE AVEA MAI MULTE MEDII (buletinul de cursă, TR4: 24,3 până la boxul 97,
    // apoi 20,5). `segments` vine gata compus din route.js, cu fromKm măsurat de la linia
    // de start; când lipsește — probă cu medie constantă, roadbook vechi, plan salvat de
    // o versiune anterioară — se compune din `kmh`, exact ca înainte.
    const segs = def.segments && def.segments.length
      ? def.segments : [{ fromKm: 0, kmh: def.kmh }];
    const parcursKm = Math.min(rt.distKm, def.distKm);
    const elapsed = (clock.mono() - rt.t0Mono) / 1000;
    const dev = rt.frozen != null ? rt.frozen : deviationS(elapsed, parcursKm, segs);
    rt.lastDev = dev;
    rt.log.push({ distKm: parcursKm, devS: dev });

    // TRECEREA PESTE PUNCTUL DE SCHIMBARE, rostită scurt și fără echivoc. Pilotul are
    // ochii pe drum: n-are cum să vadă pe ecran că media s-a schimbat, iar de aici încolo
    // fiecare secundă condusă cu media veche e deviere care se adună.
    if (rt.frozen == null && segs.length > 1) {
      let i = 0;
      for (let k = 0; k < segs.length; k++) if (parcursKm >= segs[k].fromKm) i = k; else break;
      if (rt._segIdx == null) rt._segIdx = i;
      else if (i > rt._segIdx) {
        rt._segIdx = i;
        const s = segs[i];
        // ZONA DE LIMITĂ LEGALĂ (v44) se rostește altfel decât o schimbare de medie,
        // fiindcă e altceva: nu „media probei s-a schimbat", ci „aici e plăcuță, iar
        // organizatorul scade porțiunea". La ieșire se spune media la care se REVINE —
        // și, implicit, că nu se recuperează nimic.
        const txt = s.limita ? `Limită ${vitezaRo(s.kmh)}.`
                  : s.iesireLimita ? `Limita gata. Ține ${vitezaRo(s.kmh)}.`
                  : `Acum ${vitezaRo(s.kmh)}.`;
        say(txt, 4, 'race');
        tone('ok');
        log('rt_segment', { name: def.name, kmh: s.kmh, laKm: r2(parcursKm),
                            limita: !!s.limita, iesireLimita: !!s.iesireLimita });
      }
    }

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
      // ── RITMUL TACE PE SECȚIUNE DEASĂ ──────────────────────────────────
      // La 24 km/h, cifra de deviere poate aștepta douăzeci de secunde fără să se
      // schimbe ceva; un viraj ratat nu se mai recuperează. Deci cât timp următoarele
      // trei manevre sunt în sub 600 m, ritmul se reduce la cel mult o frază la 30 s —
      // și tace complet între preambulul unui lanț și ultimul lui ecou, ca să nu se
      // strecoare între „trei la rând" și „dreapta".
      const deasa = sectiuneDeasa();
      // …și, separat de „secțiune deasă", regula simplă care acoperă și perechile
      // izolate (83→84 la 100 m, 87→88 la 110 m, cu drum liber după ele): în ultimele
      // 12 secunde dinaintea unui viraj nu se mai vorbește despre secunde. Coada
      // garantează deja că manevra nu e TĂIATĂ de ritm, dar urechea pilotului nu e o
      // coadă — ce aude în secundele dinaintea unei intersecții trebuie să fie despre
      // intersecție.
      // Prima manevră care e CHIAR ÎN FAȚĂ. `nextBoxIdx` rămâne pe un box până la 80 m
      // după el (vezi pragTrecere), deci „manevra următoare" putea fi în spate cu până
      // la 80 m — adică 12 secunde la viteza probei, cu semn schimbat. Măsurat aici, în
      // testul pe proba RT4: valori de −9,2 și −12 secunde.
      const urmM = manevreDeLa(M.nextBoxIdx, 3).find(j => plan.boxes[j].sumKm > M.routeKm);
      const vNow = Math.max(2.5, (M.speedKmh || 20) / 3.6);
      const secPanaLaViraj = urmM != null
        ? ((plan.boxes[urmM].sumKm - M.routeKm) * 1000) / vNow : Infinity;
      // Fereastra de tăcere se socotește pe MOMENTUL ÎN CARE FRAZA SE TERMINĂ, nu pe cel
      // în care începe: o cifră care începe cu 14 secunde înainte și se aude încă la 11
      // e tot vorbă în intervalul care trebuie să rămână al virajului. Se adaugă și
      // întârzierea maximă în coadă (TTL-ul unui mesaj de ritm, 3,5 s).
      const durataRitmS = durataMs(`${secRo(a)} în avans, ține 99`) / 1000 + 3.5;
      const linisteInainteaVirajului = secPanaLaViraj - durataRitmS < RITM_TACE_INAINTE_S;
      // Ordinea contează: liniștea dinaintea virajului e ABSOLUTĂ, nu o rărire. Regula
      // „cel mult o frază la 30 s" de pe secțiunile dese nu are voie s-o calce — altfel
      // fraza permisă de cronometru pică exact în ultima secundă dinaintea intersecției
      // (măsurat în testul pe RT4: o cifră rostită cu 1,2 s înainte de viraj).
      const potVorbi = linisteInainteaVirajului ? false
        : deasa ? (!M._lant && clock.mono() - (M._ritmVorbaT || 0) >= RITM_DEASA_MS)
        : true;
      // POARTA DE RĂRIRE (v43): intervalul minim dublat (4 → 8 s) și tăcere pe stagnare.
      // Vezi RITM_MIN_MS / RITM_SALT_S. Se aplică DOAR cifrei de deviere — banca de timp
      // de mai jos are pragul ei de 15 s și spune altceva („ia avans, urmează zonă lentă"),
      // iar tonurile rămân la 4 s. Starea se ține pe PROBĂ, nu pe zi: la startul următor
      // obiectul `rt` e nou, deci prima cifră din fiecare probă se rostește imediat.
      const areCeSpune = a > (def.voiceThr || 3);
      // secundele ideale rămase din probă — ele strâng plafonul de tăcere spre finish
      const ramasS = idealTimeS(def.distKm, segs) - idealTimeS(parcursKm, segs);
      const poarta = ritmPoateVorbi(clock.mono(), a, rt._ritmT, rt._ritmA, ramasS);
      if (areCeSpune && potVorbi && !poarta) {
        // două numărătoare: una de la ultima rostire (intră în jurnal, lângă fraza care
        // urmează) și una pe toată proba — asta e cifra care spune, la debrief, cât a
        // tăiat rărirea. Fără ea, „s-a rărit" ar rămâne o impresie.
        rt._ritmTacute = (rt._ritmTacute || 0) + 1;
        rt._ritmTacuteTotal = (rt._ritmTacuteTotal || 0) + 1;
      }
      if (areCeSpune && potVorbi && poarta) {
        // Viteza REALĂ care anulează devierea până la finish, FĂRĂ plafon (cerut de
        // Andreas, 02.08, după tura 4): „ține 52" plafonat la +30% suna identic la 20
        // și la 40 de secunde întârziere. Acum cifra e cea adevărată — 58, 65, cât
        // iese din aritmetică — iar decizia dacă e prudentă îi aparține pilotului.
        // Indicatoarele rutiere rămân oricum ale lui, nu ale aplicației.
        const remKm = Math.max(0, def.distKm - parcursKm);
        let fraza = `${secRo(a)} ${dev >= 0 ? 'în urmă' : 'în avans'}`;
        if (remKm > 0.03) {
          // timpul ideal RĂMAS se citește din segmente, nu din media de bază: pe o probă
          // cu schimbare de medie, „ține 58" calculat pe 24,3 după ce media a devenit
          // 20,5 e o cifră falsă. Cu un singur segment rezultatul e identic cu formula
          // veche (remKm / kmh × 3600), deci nimic nu se schimbă pe probele normale.
          const tDisponibilS = idealTimeS(def.distKm, segs) - idealTimeS(parcursKm, segs) - dev;
          const tinta = tDisponibilS > 1 ? Math.round(remKm * 3600 / tDisponibilS) : null;
          // „ține 4557" (măsurat 06.08, 08:23:23) nu e un sfat, e o împărțire la aproape
          // zero rostită cu voce tare. Peste pragul de imposibil, ritmul nu se mai poate
          // calcula — și asta e informația corectă, nu numărul.
          if (tinta != null && tinta <= IMPOSIBIL_KMH) fraza += `, ține ${tinta}`;
          else if (tinta != null) fraza += ' — ritmul nu se mai poate calcula';
          else fraza += ' — nu se mai prinde până la finish';
        }
        // pe secțiune deasă fraza se scurtează la cifră: „ține 58" cere gândire, iar
        // gândirea aia se face acum cu volanul în mâini
        say(deasa || linisteInainteaVirajului
          ? `${secRo(a)} ${dev >= 0 ? 'în urmă' : 'în avans'}` : fraza, 3, 'pace', 'ritm');
        M._ritmVorbaT = clock.mono();
        const tacute = rt._ritmTacute || 0;
        rt._ritmT = clock.mono(); rt._ritmA = a; rt._ritmTacute = 0;
        // cât drum liber era în față când s-a vorbit despre secunde — ca la debrief
        // („de ce mi-a zis de cifre fix în viraj?") răspunsul să fie o măsurătoare.
        // `tacute` = câte cifre au fost înghițite de poarta de rărire de la ultima
        // rostire încoace; fără el, rărirea n-ar putea fi verificată decât prin lipsă.
        log('ritm_vorba', { secPanaLaViraj: secPanaLaViraj === Infinity ? null
                              : Math.round(secPanaLaViraj * 10) / 10,
                            deasa, scurt: deasa || linisteInainteaVirajului, tacute });
      }
      // banca de timp: zonele lente din față cer avans acum
      if (potVorbi && rt.zonesAdvised !== false && def.zones && def.zones.length && clock.mono() - M._lastBank > 15000) {
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
      if (!dejaSpus && dTo > -30 && dTo < 350 && (nb.dir !== 'ÎNAINTE' || normFlags(nb).length))
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
  // Firimiturile sunt la 10 m una de alta, deci un kilometru pe care CHIAR l-am trecut
  // are întotdeauna una la câțiva metri. Fereastra strânsă (60 m) e ce desparte „știu
  // unde e locul ăla" de „ghicesc": cu toleranța veche de 250 m, un buton apăsat la
  // 120 m de la plecare (tura poligon, 18:01) primea drept „punct de reintrare pentru
  // boxul 2" chiar poziția mașinii — adică „întoarce-te unde ești deja".
  function idxUrmaLaKm(km) {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < M._urme.length; i++) {
      const d = Math.abs(M._urme[i].km - km);
      if (d < bd) { bd = d; bi = i; }
    }
    return bd < 0.06 ? bi : -1;
  }

  function punctLaKm(km) {
    const i = idxUrmaLaKm(km);
    return i >= 0 ? { lat: M._urme[i].lat, lng: M._urme[i].lng, sursa: 'urme' } : null;
  }

  // UNDE E, PE HARTĂ, UN BOX. Trei surse, în ordinea încrederii:
  //  1. RECUNOAȘTEREA — urmă continuă, condusă și legată de kilometraj prin ancore;
  //  2. HARTA TRASEULUI — coordonata boxului, așa cum a ieșit din rutarea care a generat
  //     roadbook-ul. Exactă, dar punctuală (fără drumul dintre boxuri);
  //  3. FIRIMITURILE — unde am fost noi când credeam că suntem la kilometrul ăla.
  //     Singura sursă care există mereu, dar și singura care poate fi de pe drumul
  //     GREȘIT: după o manevră ratată, firimiturile boxurilor următoare sunt pe altă
  //     stradă. De-aia sursa se întoarce odată cu punctul — cine alege ținta trebuie
  //     să știe cu ce are de-a face.
  function pctBox(b) {
    if (!b) return null;
    if (plan.trace && plan.anchorMap) {
      const seg = traceAheadPoint(plan.trace, 0, 0);
      const cum = plan.anchorMap.traceM(b.sumKm);
      const p = pePunctulUrmei(cum);
      if (p) return { lat: p.lat, lng: p.lng, sursa: 'recon' };
      if (seg) { /* urma există, dar kilometrul e în afara ei — cade pe sursele de mai jos */ }
    }
    // harta declarată stricată nu mai e o sursă: mai bine firimituri sau nimic decât un
    // punct despre care AM MĂSURAT că e imposibil
    const h = hartaOk() && b.num != null ? plan.harta[b.num] : null;
    if (h) return { lat: h.lat, lng: h.lng, sursa: 'harta' };
    return punctLaKm(b.sumKm);
  }

  // punctul de pe urmă la `cumM` metri de la începutul ei
  function pePunctulUrmei(cumM) {
    const pts = plan.trace && plan.trace.pts;
    if (!pts || !pts.length || cumM == null || !isFinite(cumM)) return null;
    if (cumM <= pts[0].cum) return pts[0];
    for (let i = 1; i < pts.length; i++) if (pts[i].cum >= cumM) return pts[i];
    return pts[pts.length - 1];
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
    // DECISIV e un singur semn: ieșirea din coridorul RECUNOAȘTERII. Aia e o urmă
    // condusă de noi, punct cu punct, la 45 m toleranță — măsoară direct „nu sunt pe
    // drumul ăla".
    //
    // Semnul din HARTĂ nu e niciodată decisiv singur, oricât de geometric ar arăta:
    // ancorele geocodate sunt centre de stradă, cu eroare de sute de metri (04.08,
    // 21:48: o alarmă falsă declanșată de o singură ancoră, la 27 de secunde de la
    // start, pe traseu corect). Echivalarea lui cu coridorul recunoașterii a fost o
    // greșeală de judecată: aceeași formă matematică, cu totul altă precizie a datelor.
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
  // ÎNAINTE, NU ÎNAPOI. Cererea lui Andreas, 04.08.2026: în tura de la 21:48 aplicația
  // i-a dat ca punct de reintrare boxul 2, DIN SPATE („Boxul 2 la 80 de metri, în spate",
  // apoi 190, apoi 310), în timp ce el mergea înainte pe traseu. Un pilot care a greșit
  // o intersecție rareori vrea să se întoarcă: vrea să prindă traseul din față.
  //
  // Regula, în ordinea asta:
  //  1. dacă între tine și boxurile din față a rămas neconsumată o linie de START sau
  //     FINISH de probă, TE ÎNTORCI — proba ratată nu se mai poate recupera, e singurul
  //     motiv care merită drumul înapoi (și se spune cu voce tare de ce);
  //  2. altfel, primul box NECONFIRMAT a cărui ancoră e ÎN FAȚĂ (±90° față de direcția
  //     de mers), cel mai apropiat pe drum — ținta alunecă natural înainte dacă pilotul
  //     continuă;
  //  3. dacă nu e nimic în față, abia atunci cel mai apropiat, indiferent de direcție.
  function punctDeReintrare() {
    if (!M._lastPos) return null;
    const cand = [];
    const vazut = new Set();
    const pune = (i) => {
      if (!plan.boxes[i] || vazut.has(i)) return;
      vazut.add(i);
      const p = pctBox(plan.boxes[i]);
      if (!p) return;
      // firimiturile de DUPĂ punctul de divergență sunt de pe drumul greșit
      const ratatIdx = (M._offSemne.find(s => s.tip === 'manevra_neconfirmata') || {}).idx;
      const limita = ratatIdx != null ? ratatIdx : M.nextBoxIdx;
      if (p.sursa === 'urme' && i > limita) return;
      const d = haversineM(M._lastPos.lat, M._lastPos.lng, p.lat, p.lng);
      // un punct de reintrare imposibil nu e o țintă, e o hartă stricată. Se scoate din
      // candidați ȘI se închide harta — altfel ecranul ar arăta o săgeată spre Wisconsin.
      if (d > IMPOSIBIL_DIST_M) { if (p.sursa === 'harta') stricaHarta(d, plan.boxes[i].num); return; }
      const brg = bearingDeg(M._lastPos.lat, M._lastPos.lng, p.lat, p.lng);
      const inFata = M._hdg == null ? null : Math.abs(angDiff(brg, M._hdg)) <= 90;
      cand.push({ box: plan.boxes[i], idx: i, pct: p, distM: d, inFata });
    };
    const ratat = M._offSemne.find(s => s.tip === 'manevra_neconfirmata');
    if (ratat) pune(ratat.idx);
    if (M._confirmedIdx != null) pune(M._confirmedIdx);
    pune(M.nextBoxIdx - 1);
    // boxurile din față: se caută mai departe decât următorul, ca ținta să poată aluneca
    for (let i = M.nextBoxIdx; i < plan.boxes.length && i <= M.nextBoxIdx + 6; i++) pune(i);
    if (!cand.length) return null;

    // 1. probă neconsumată între poziție și boxurile din față?
    const proba = probaRatataInainte();
    if (proba) {
      const c = cand.find(x => x.idx === proba.idx) ||
                cand.filter(x => x.idx <= proba.idx).sort((a, b) => b.idx - a.idx)[0];
      if (c) return { ...c, motivIntoarcere: proba.nume };
    }
    // 2. cel mai apropiat dintre cele din față
    const inFata = cand.filter(c => c.inFata === true).sort((a, b) => a.idx - b.idx);
    if (inFata.length) return inFata[0];
    // 3. orice, cel mai apropiat
    return cand.slice().sort((a, b) => a.distM - b.distM)[0];
  }

  // Linia de start sau de finish a unei probe rămasă ÎN URMĂ (kilometrul ei e sub poziția
  // crezută) și neconsumată: dacă mergi mai departe, proba aia e pierdută. Ăsta e
  // singurul motiv pentru care merită să întorci mașina.
  function probaRatataInainte() {
    const rt = plan.rts[M.rtIdx];
    if (!rt) return null;
    if (M.results[rt.name] != null) return null;         // deja alergată
    // startul e în urma poziției crezute, dar proba n-a pornit niciodată
    if (M.routeKm > rt.startKm && !M.rt) return { idx: rt.startIdx, nume: rt.name };
    return null;
  }

  // Intrarea în stare. ÎNGHEȚAREA PLANULUI NU DEPINDE DE NIMIC: se poate face oriunde,
  // oricând, fără hartă, fără firimituri, fără geometrie. Ghidajul e cel care depinde de
  // date — și, când lipsesc, se spune exact CE lipsește.
  //
  // 04.08.2026, 18:01, tura poligon: Andreas a apăsat „AM GREȘIT DRUMUL" de trei ori în
  // 32 de secunde (18:01:11, 18:01:16, 18:01:43) și a primit de fiecare dată „N-am de
  // unde să te iau înapoi — n-am destul drum în memorie", iar aplicația a continuat
  // netulburată să-i dicteze virajele unui traseu pe care nu se afla („stânga acum" la
  // 18:01:27, „dreapta acum" la 18:01:53). Butonul spunea NU la singurul lucru pe care
  // îl putea face oricum: să tacă și să înghețe.
  function declaraOffRoute(cum) {
    const t = punctDeReintrare();
    const desc = t ? descriereBox(t.box) : null;
    M.offRoute = t
      ? { boxNum: t.box.num, idx: t.idx, km: t.box.sumKm, pct: t.pct,
          distM: Math.round(t.distM), relDeg: null, de: clock.rally(), cum,
          kmLaIesire: M.routeKm, orb: false, inFata: t.inFata === true,
          motivIntoarcere: t.motivIntoarcere || null, _reevalMono: clock.mono(),
          // descrierea e rostită chiar în anunțul de intrare, deci ghidajul care urmează
          // nu o mai repetă — o reia doar dacă se schimbă ținta
          descriere: desc, _descrisIdx: desc ? t.idx : null, _parasite: {} }
      : { boxNum: null, idx: null, km: null, pct: null, distM: null, relDeg: null,
          de: clock.rally(), cum, kmLaIesire: M.routeKm, orb: true,
          descriere: null, _descrisIdx: null, _parasite: {} };
    M._offSector = null; M._offVorbaMono = 0;
    log('offroute_intrare', { cum, boxNum: t ? t.box.num : null, orb: !t,
                              distM: t ? Math.round(t.distM) : null, inFata: t ? t.inFata : null,
                              motivIntoarcere: t ? (t.motivIntoarcere || null) : null,
                              semne: M._offSemne.map(s => s.tip), routeKm: r2(M.routeKm) });
    // De ce te trimit acolo, nu doar unde: pilotul care aude „întoarcere" cand merge
    // inainte trebuie sa stie ce pierde daca nu intoarce.
    if (t && t.motivIntoarcere)
      say(`Ai ieșit de pe traseu. Te întorc la boxul ${t.box.num} — altfel ratezi ${t.motivIntoarcere}.`, 4, 'offroute', 'manevra');
    else if (t) say(`Ai ieșit de pe traseu. Prinde traseul la boxul ${t.box.num}` +
                    (desc ? ` — ${desc}.` : '.'), 4, 'offroute', 'manevra');
    // Mesajul „orb" spune ce LIPSEȘTE, nu ce nu poate aplicația. Vechiul „n-am destul
    // drum în memorie" nu-i spunea pilotului nici ce s-a întâmplat, nici ce să facă.
    else say('Am oprit instrucțiunile — nu mai ești pe traseu. Fără harta traseului nu știu unde e boxul; oprește și apasă SUNT LA BOX.', 4, 'offroute', 'manevra');
    tone('alarm');
    refaTintaMaps(true);            // ținta butonului de Maps devine punctul de reintrare
    ui.render(M, plan);
  }

  // Starea „oarbă" nu e definitivă: firimiturile se adună cu fiecare fix, iar harta poate
  // fi încărcată între timp. La prima țintă disponibilă, ghidajul pornește singur.
  function incearcaTintaTarzie() {
    const t = punctDeReintrare();
    if (!t) return;
    const o = M.offRoute;
    o.boxNum = t.box.num; o.idx = t.idx; o.km = t.box.sumKm; o.pct = t.pct;
    o.distM = Math.round(t.distM); o.orb = false;
    o.descriere = descriereBox(t.box); o._descrisIdx = o.descriere ? t.idx : null;
    log('offroute_tinta', { boxNum: t.box.num, distM: o.distM });
    say(`Am punctul: întoarcere la boxul ${t.box.num}` +
        (o.descriere ? ` — ${o.descriere}.` : '.'), 4, 'offroute', 'manevra');
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

  // ── CE E BOXUL DE REINTRARE, nu doar cât și încotro ───────────────────────
  // City Demo Sibiu, 06.08.2026, harta complet goală (0 ancore). Vocea a repetat de opt
  // ori, cu cifre diferite: „Boxul 10 la 350 de metri, în spate-stânga." În centrul vechi
  // al Sibiului, o distanță și un sfert de ceas nu identifică NIMIC. Roadbook-ul scria
  // pentru boxul 10 „GIRATORIU-2 · Str. Constituției" — aplicația avea informația de la
  // scanare și n-a rostit-o niciodată. Andreas s-a rătăcit 1094 m.
  //
  // Descrierea are două bucăți, ambele deja existente în cod:
  //  • CE FEL de box e — aceeași traducere folosită la anunțurile de manevră (tintaRo →
  //    maneuver). „reper" e valoarea ei de umplutură: nu spune nimic, deci nu se rostește;
  //  • REPERUL din comentariu — trecut prin aceeași sită ca la geocodare (extrageReper),
  //    care scoate „Bd. Corneliu Coposu" din „To Center, Bd. Corneliu Coposu". Când sita
  //    nu găsește nimic, se ia prima bucată a comentariului, până la primul separator.
  // Fără nici direcție, nici comentariu, fraza rămâne exact cea de azi.
  function scurtReper(s) {
    const t = String(s || '').split(/\s*[·|;\/]\s*/)[0].replace(/\s+/g, ' ').trim();
    if (t.length < 3) return null;
    if (t.length <= OFF_REPER_MAX) return t;
    const taiat = t.slice(0, OFF_REPER_MAX), sp = taiat.lastIndexOf(' ');
    return (sp > 12 ? taiat.slice(0, sp) : taiat).trim();
  }

  function descriereBox(b) {
    if (!b) return null;
    const bucati = [];
    const ce = tintaRo(b);
    if (ce && ce !== 'reper') bucati.push(ce);
    const rep = scurtReper(extrageReper(b.comment) || b.comment);
    if (rep) bucati.push(rep);
    return bucati.length ? bucati.join(', ') : null;
  }

  // CE SE LIPEȘTE la prima avertizare a unei manevre (v43): numărul boxului și reperul.
  // Nu folosește `descriereBox` fiindcă aia începe cu FELUL boxului („giratoriu, ieșirea
  // 2"), iar aici felul e deja rostit în fraza de manevră — s-ar auzi de două ori.
  // Fără număr de box nu se spune nimic: „boxul necunoscut" nu ajută pe nimeni.
  function sufixBox(b) {
    if (!b || b.num == null) return null;
    const rep = scurtReper(extrageReper(b.comment) || b.comment);
    return ` — boxul ${b.num}` + (rep ? `, ${rep}` : '');
  }

  function offRouteGhidaj(fix) {
    if (!M.offRoute) return;
    const o = M.offRoute;
    if (!fix || fix.lat == null) return;
    // fără punct de reintrare (nici hartă, nici drum în memorie) planul rămâne înghețat,
    // dar nu există ce arăta: ieșirea se face prin buton sau prin „SUNT LA BOX"
    if (o.orb) { incearcaTintaTarzie(); return; }
    // ȚINTA SE REEVALUEAZĂ la fiecare 15 s: dacă pilotul merge înainte, punctul de
    // reintrare alunecă natural pe boxurile următoare, în loc să-l tot cheme înapoi la
    // unul pe care l-a lăsat de mult (04.08, 21:48: „Boxul 2 la 80… 190… 310 m, în
    // spate", în timp ce mașina se ducea înainte).
    if (clock.mono() - (o._reevalMono || 0) > OFF_REEVAL_MS) {
      o._reevalMono = clock.mono();
      const t = punctDeReintrare();
      if (t && t.idx !== o.idx) {
        // ANTI-OSCILAȚIE: nu te întorci la un box pe care TOCMAI l-ai părăsit. Vezi
        // OFF_REVENIRE_MS. Comutarea respinsă se scrie în jurnal, ca debrief-ul să
        // poată arăta câte salturi s-au evitat și către ce.
        const parasitLa = (o._parasite || {})[t.idx];
        const deMs = parasitLa != null ? clock.mono() - parasitLa : Infinity;
        if (deMs < OFF_REVENIRE_MS) {
          log('offroute_tinta_blocata', { tinta: o.boxNum, respins: t.box.num,
                                          deS: Math.round(deMs / 1000),
                                          distM: Math.round(t.distM), inFata: t.inFata });
        } else {
          (o._parasite = o._parasite || {})[o.idx] = clock.mono();
          log('offroute_tinta_noua', { deLaBox: o.boxNum, laBox: t.box.num,
                                       distM: Math.round(t.distM), inFata: t.inFata });
          o.boxNum = t.box.num; o.idx = t.idx; o.km = t.box.sumKm; o.pct = t.pct;
          o.inFata = t.inFata === true; o.motivIntoarcere = t.motivIntoarcere || null;
          o.descriere = descriereBox(t.box);
          M._offSector = null;
        }
      }
    }
    o.distM = Math.round(haversineM(fix.lat, fix.lng, o.pct.lat, o.pct.lng));
    const brg = bearingDeg(fix.lat, fix.lng, o.pct.lat, o.pct.lng);
    o.brgDeg = Math.round(brg);
    o.relDeg = M._hdg != null ? Math.round(angDiff(brg, M._hdg)) : null;
    // PRINS: ești la punctul de reintrare. Nu în primele 10 s de stare — dacă punctul
    // se nimerește chiar lângă tine când apeși butonul, cursa ar ieși din îngheț
    // înainte să apuci să te uiți la ecran.
    if (o.distM <= OFF_PRINS_M && clock.rally() - o.de > 10000) { iesiOffRoute('punct'); return; }
    // vocea: doar când se schimbă sectorul (opt sferturi de ceas) sau la 12 s
    const sector = o.relDeg != null ? Math.round(o.relDeg / 45) : null;
    const acum = clock.mono();
    // peste 2 km de punct, vocea tace: cifra rămâne pe ecran, dar „boxul 12 la 4
    // kilometri, în spate" repetat nu ajută pe nimeni — ori te întorci, ori ai renunțat
    if (o.distM > OFF_VORBA_MAX_M) return;
    if (acum - M._offVorbaMono < OFF_VORBA_MS) return;
    if (sector === M._offSector && acum - M._offVorbaMono < 30000) return;
    M._offSector = sector; M._offVorbaMono = acum;
    // PRIMA DATĂ ÎNTREAGĂ, APOI DOAR CIFRELE — același registru ca la lanțurile de
    // manevre (preambul o dată, pe urmă ecou scurt). Descrierea se reia când se schimbă
    // ținta, fiindcă atunci e vorba despre alt loc. Repetată la fiecare 12 secunde, ar
    // deveni exact zgomotul pe care încearcă să-l înlocuiască.
    const spuneDesc = !!o.descriere && o._descrisIdx !== o.idx;
    if (spuneDesc) o._descrisIdx = o.idx;
    say(`Boxul ${o.boxNum} la ${distRo(o.distM)}` +
        (o.relDeg != null ? `, ${ceasRo(o.relDeg)}` : '') +
        (spuneDesc ? ` — ${o.descriere}.` : '.'), 3, 'offroute', 'manevra');
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
    refaTintaMaps(true);            // înapoi pe traseu: ținta redevine boxul următor
    ui.render(M, plan);
  }

  // ── „UNDE SUNT?" ──────────────────────────────────────────────────────────
  // Butonul care răspunde la întrebarea pe care un pilot cu orientare slabă și-o pune
  // de zece ori pe zi, și pe care aplicația o lăsa până acum fără răspuns: nu „ce
  // urmează", ci „unde sunt ACUM, între ce și ce, pe ce stradă".
  //
  // Trei reguli:
  //  1. răspunde INSTANT și din starea care există deja — nu calculează nimic nou, nu
  //     cere nimic de pe rețea, nu atinge cronometrul. De-aia merge și în probă.
  //  2. spune și CÂT DE BUNĂ e cifra. Cu geometrie de recunoaștere, poziția e măsurată
  //     pe drumul condus; fără ea, e un odometru corectat — și atunci o spune pe față,
  //     „poziție aproximativă", în loc să sune la fel de sigur în ambele cazuri.
  //  3. clasa 'ritm': oricât ar fi de cerut, un răspuns nu are voie să taie un viraj.
  function pozitieMasurata() {
    return !!(plan.trace && plan.anchorMap && M.traceM != null && !(M._projMiss > 0));
  }

  // ce e boxul următor, în cuvinte de pilot
  function tintaRo(b) {
    const flags = normFlags(b);
    if (flags.includes('RT_FINISH') && esteStart(b)) return 'finishul probei, unde începe următoarea';
    switch (flags[0]) {
      case 'TC': return 'Time Control';
      case 'RT_START_AUTO': case 'RT_START_STANDING': return 'startul probei';
      case 'RT_FINISH': return 'finishul probei';
      case 'PARKING': return 'parcare';
      case 'EV': return 'stația de încărcare';
    }
    if (b.dir === 'STOP-CFR') return 'calea ferată';
    if (TURN_DIRS.has(b.dir || '')) return maneuver(b.dir, false);
    return 'reper';
  }

  function textUndeSunt() {
    const masurat = pozitieMasurata();
    const coada = masurat ? '' : ' Poziție aproximativă.';
    // PE DINAFARĂ întrebarea are alt răspuns: nu „între ce boxuri", ci „încotro înapoi".
    if (M.offRoute) {
      const o = M.offRoute;
      if (o.orb)
        return { text: 'Nu ești pe traseu, și nu știu unde e boxul. Oprește și apasă SUNT LA BOX.',
                 masurat: false };
      // cifra imposibilă nu se rostește: „boxul e la 7933 kilometri" nu e o informație,
      // e o hartă stricată care se dă drept informație
      if (o.distM > IMPOSIBIL_DIST_M)
        return { text: 'Nu ești pe traseu. ' + HARTA_STRICATA_TXT, masurat: false };
      // aici descrierea se spune ÎNTOTDEAUNA: butonul e apăsat de om, o dată, exact
      // când vrea să știe unde e locul ăla — nu e o frază repetată în buclă
      return { text: `Nu ești pe traseu. Boxul ${o.boxNum} e la ${distRo(o.distM)}` +
                     (o.relDeg != null ? `, ${ceasRo(o.relDeg)}` : '') +
                     (o.descriere ? ` — ${o.descriere}.` : '.') + coada, masurat };
    }
    const i = M.nextBoxIdx;
    const prev = i > 0 ? plan.boxes[i - 1] : null;
    const next = plan.boxes[i];
    const bucati = [];
    // în probă, prima informație e proba: acolo se dau punctele
    if (M.rt) {
      const ram = Math.max(0, M.rt.def.distKm - M.rt.distKm);
      bucati.push(`În ${M.rt.def.name}, mai ai ${distRo(ram * 1000)} din probă.`);
    }
    // Leg terminat: „mai ai 0 metri până la boxul 6" e adevărat și inutil. Ziua s-a
    // închis, iar răspunsul trebuie să spună asta, nu să descrie ultimul metru.
    const km = M.routeKm.toFixed(1).replace('.', ' virgulă ');
    if (!next || M.state === 'DAY_END') {
      bucati.push(M.state === 'DAY_END'
        ? `Leg-ul s-a terminat, la kilometrul ${km}.`
        : `Ai trecut de ultimul box, la kilometrul ${km}.`);
      return { text: bucati.join(' ') + coada, masurat };
    }
    // Strada pe care ești vine din comentariul boxului pe care l-ai trecut ULTIMUL:
    // „Dreapta pe Str. Pluto" la boxul 4 înseamnă că după boxul 4 ești pe Str. Pluto.
    const strada = prev ? extrageReper(prev.comment) : null;
    if (prev) {
      bucati.push(`Ești între boxul ${prev.num} și boxul ${next.num}` +
                  (strada ? `, pe ${strada}.` : '.'));
    } else {
      bucati.push(`Ești la începutul leg-ului, înainte de boxul ${next.num}.`);
    }
    const dM = Math.max(0, (next.sumKm - M.routeKm) * 1000);
    // sub 20 m, o cifră nu mai e informație — ești acolo
    bucati.push(dM < 20
      ? `Ești chiar la boxul ${next.num}: ${tintaRo(next)}.`
      : `Mai ai ${distRo(dM)} până la ${tintaRo(next)} de la boxul ${next.num}.`);
    return { text: bucati.join(' ') + coada, masurat };
  }

  // ── NAVIGAREA PREDATĂ LUI GOOGLE MAPS ────────────────────────────────────
  // RALI n-are hărți rutiere și nu va avea: ghidajul pe străzi îl face Maps, care are
  // sensurile unice, restricțiile și vocea. Până la v34 butonul apărea DOAR când te
  // rătăceai; Andreas l-a cerut permanent (05.08.2026) — vrea plasa de siguranță tot
  // timpul, nu doar după ce a greșit.
  //
  // ȚINTA, în ordine:
  //  1. pe dinafară — punctul de reintrare (ăla e singurul loc unde vrei să ajungi);
  //  2. pe traseu — boxul următor, dacă i se cunoaște coordonata;
  //  3. dacă boxul următor n-are coordonată — primul de după care are. Un link către
  //     „nimic" e mai rău decât niciun buton: îl apeși în mers și te uiți la o hartă goală.
  // ÎN PROBĂ nu se întoarce nimic: acolo o atingere care trimite aplicația în fundal
  // costă cronometrul, adică exact partea pe care se dau punctele.
  function tintaMaps() {
    if (M.rt || M.state === 'RT_RUN') return null;
    if (M.offRoute && M.offRoute.pct) {
      const s = M.offRoute.pct.sursa;
      return { boxNum: M.offRoute.boxNum, pct: M.offRoute.pct, idx: M.offRoute.idx,
               deCe: 'offroute', sursa: s, aproximativa: s !== 'recon' };
    }
    let sarite = 0;             // boxuri din față pe care pur și simplu nu le știm pe hartă
    for (let i = Math.max(0, M.nextBoxIdx); i < plan.boxes.length; i++) {
      const b = plan.boxes[i];
      // boxul pe care stai nu e o destinație: la START, „boxul următor" e chiar cel de
      // sub roți încă 80 de metri (vezi pragTrecere), iar Maps ar deschide un traseu de
      // zero metri — exact genul de buton care arată că merge și nu face nimic
      if (b.sumKm <= M.routeKm + 0.03) continue;
      const p = pctBox(b);
      // FIRIMITURILE nu sunt o coordonată de box, sunt urma noastră: spun unde am fost
      // NOI când credeam că suntem la kilometrul ăla. Pentru un box din FAȚĂ înseamnă
      // „du-te unde ești deja" (lecția din tura poligon, 04.08, 18:01). Doar recunoașterea
      // și harta au voie să dea ținta; punctul de reintrare, de mai sus, are alte reguli.
      if (!p || p.sursa === 'urme') { sarite++; continue; }
      return { boxNum: b.num, pct: p, idx: i,
               deCe: sarite ? 'primul_cu_ancora' : 'urmator',
               sursa: p.sursa, aproximativa: p.sursa !== 'recon' };
    }
    return null;
  }

  // ── API public ────────────────────────────────────────────────────────────
  return {
    M, onFix, atBox, setTcSchedule, previzualizeazaBox, boxuriApropiate, tintaMaps,
    // ȘTAMPILA TC — apăsarea butonului. O nouă apăsare o resetează pur și simplu
    // (confirmarea o cere ecranul, nu mașina: aici nu se deschide niciun dialog).
    stampeazaTc(rallyMs) { return pornesteStampila(rallyMs != null ? rallyMs : clock.rally()); },
    // reluarea ștampilei salvate, după o repornire a aplicației — fără jurnal nou
    reiaStampila(rallyMs) { return rallyMs != null ? pornesteStampila(rallyMs, { nou: false }) : null; },
    stampilaTick,
    // Butonul „UNDE SUNT": răspunde din starea care există deja, deci nu poate întârzia
    // nimic. Rămâne pe ecran 20 de secunde, fiindcă în mașină un răspuns rostit o dată
    // se pierde exact ca oricare altul.
    undeSunt() {
      const r = textUndeSunt();
      M.unde = { text: r.text, masurat: r.masurat, panaMono: clock.mono() + 20000 };
      say(r.text, 3, 'unde', 'ritm');
      log('unde_sunt', { text: r.text, masurat: r.masurat, routeKm: r2(M.routeKm),
                         inRt: !!M.rt, offRoute: !!M.offRoute });
      ui.render(M, plan);
      return r;
    },
    // Butonul „am greșit drumul": pilotul știe primul, întotdeauna. Detectarea automată
    // are nevoie de două semne și, în tura Tresor, al doilea a venit după 3 minute —
    // o apăsare le sare pe amândouă.
    offRouteManual() {
      if (M.offRoute) return true;
      declaraOffRoute('manual');       // îngheață ÎNTOTDEAUNA; ghidajul e ce poate lipsi
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
      M._ann = {}; M._staged = false; M._warnedRt = {}; M._nuOpriSpus = {};
      M._desyncSaid = null; M._confirmedIdx = -1;
      M._virajRefuzat = null; M._turnAcc = 0; M._lastHdg = null; M._lastSnapT = 0;
      // leg nou = drum nou: firimiturile și semnele de ieșire de pe traseu nu se moștenesc
      M.offRoute = null; M._offSemne = []; M._urme = []; M._offSector = null; M._offVorbaMono = 0;
      // paznicul de direcție se re-armează la fiecare zi/leg nou
      M._dirEtapa = 0; M.dirAlerta = null; M.corectie = null; M.unde = null;
      // ghidajul continuu repornește la fiecare zi/leg: prima confirmare vine după
      // primul tronson lung, nu ca ecou al leg-ului dinainte
      M._ghidT = null; M._ghidKm = null;
      M._lant = null; M.deasa = false; M.lant = null; M._ritmVorbaT = 0;
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
      // Numărătoarea spre starturi bate ÎNAINTE de ieșirea pe PREP: ștampila se poate
      // apăsa și din panoul de pregătire (TC-ul de dimineață, înainte de START ZIUA),
      // iar de acolo încolo secundele curg indiferent ce ecran e deschis.
      stampilaTick();
      if (M.state === 'PREP') return;
      const now = clock.mono();
      // și fără fixuri corecția expiră la timp: altfel, cu GPS-ul mort, ar rămâne pe
      // ecran ore întregi ca o informație proaspătă
      if (M.corectie && now > M.corectie.panaMono) M.corectie = null;
      if (M.unde && now > M.unde.panaMono) M.unde = null;
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
            // viteza de estimare e cea a SEGMENTULUI curent, nu media de bază — altfel,
            // pe o probă cu schimbare de medie, poziția estimată o ia înainte
            const sg = M.rt.def.segments && M.rt.def.segments.length
              ? M.rt.def.segments : [{ fromKm: 0, kmh: M.rt.def.kmh }];
            M.routeKm += (speedAt(Math.max(0, M.routeKm - M.rt.def.startKm), sg) / 3600) * dtS;
            M.rt.distKm = Math.max(0, M.routeKm - M.rt.def.startKm);
            log('pos_estimat', { routeKm: r2(M.routeKm) });
          }
        } else M._lastEstMono = null;
        rtTick();
      }
      tcTick();
      refaTintaMaps();
      ui.render(M, plan);
    },
    extSpeed(kmh) { M._extSpeedKmh = kmh; M._extSpeedT = clock.mono(); },   // priza BLE
    // revenirea semnalului se rostește doar dacă pierderea lui chiar s-a anunțat
    gpsRevenit() {
      if (!M._gpsLostSaid) return;
      M._gpsLostSaid = false;
      say('GPS revenit.', 2, 'gps', 'ritm');
    },
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
