// RALI 2 — GOLUL DE GPS: apelul telefonic și fila din fundal (v47).
//
// Raportat de Andreas pe 08.08.2026: în apel sau cu altă aplicație în față, kilometrii nu
// se mai contorizează, iar la revenire poziția rămâne în urmă cu tot golul. În jurnalul
// zilei se vede urma — la 11:13:53 „GPS pierdut", la 11:14:02 „GPS revenit", nouă secunde
// în care odometrul n-a adunat nimic.
//
// De ce se pierdea TOT: `makeOdometer` refuză pașii cu dt ≥ 30 s, iar peste 15 s `onFix`
// resetează odometrul de tot. Corect ca apărare împotriva unui teleport; greșit ca purtare
// la un gol banal, unde mașina chiar a mers și doar noi n-am privit.
//
// Puntea pune înapoi COARDA — linia dreaptă între ultimul fix de dinainte și primul de
// după. Nu e drumul real (drumul e mai lung, mereu), deci e o PODEA: mai puțin decât
// adevărul, dar în aceeași direcție, în loc de zero.
import { buildPlan, sanitizeBoxes } from '../js/route.js';
import { makeMachine } from '../js/machine.js';
import { makeMemStore } from '../js/store.js';
import { makeClock } from '../js/time.js';
import { makeDriverModel } from '../js/learn.js';
import { makeSantinela, wavAproapeMut } from '../js/santinela.js';

let pass = 0, fail = 0;
const ok = (n, c, d) => c ? (pass++, console.log(`  ✓ ${n}`))
                          : (fail++, console.log(`  ✗ ${n}${d ? '\n      → ' + d : ''}`));

const LUNG = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start' },
  { num: 2, sumKm: 2.00, dir: 'ÎNAINTE', flags: [], comment: '' },
  { num: 3, sumKm: 5.00, dir: 'ÎNAINTE', flags: [], comment: '' },
  { num: 4, sumKm: 9.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish' }
]);

// Roadbook cu o probă, ca să se poată testa interacțiunea cu estimarea din RT.
const CU_PROBA = sanitizeBoxes([
  { num: 1, sumKm: 0.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Start' },
  { num: 2, sumKm: 0.50, dir: 'ÎNAINTE', flags: ['RT_START_AUTO'], comment: 'START TR 1 · 50 km/h' },
  { num: 3, sumKm: 5.00, dir: 'ÎNAINTE', flags: ['RT_FINISH'], comment: 'FINISH TR 1' },
  { num: 4, sumKm: 7.00, dir: 'ÎNAINTE', flags: ['TC'], comment: 'Finish' }
]);

// Lume 1-D: mașina merge spre nord. `mai(km)` conduce cu fixuri la o secundă; `gol(s, km)`
// simulează o gaură — timpul trece, mașina se MUTĂ, dar nu sosește niciun fix. Exact ce
// face Chrome cu `watchPosition` pe o filă din fundal.
function lume(boxes, { kmh = 54, viteze = {} } = {}) {
  let wall = 0, km = 0;
  const said = [];
  const store = makeMemStore();
  const m = makeMachine({ plan: buildPlan(boxes, viteze, null),
    clock: makeClock({ now: () => wall, mono: () => wall }), store, driver: makeDriverModel(),
    voice: { say: (t, p, c, cl) => said.push({ t, cl }), tone() {}, flush() {} },
    ui: { render() {} }, opts: { offRoute: false } });
  m.start(); wall += 1000;
  m.onFix({ lat: 45, lng: 21, tMs: wall, speedMs: 0, accM: 8 });
  const fix = () => m.onFix({ lat: 45 + km / 111.32, lng: 21, tMs: wall,
                              speedMs: (kmh / 3.6), accM: 8 });
  return {
    m, store, said,
    mai(dKm) {
      const tinta = km + dKm;
      while (km < tinta - 1e-9) {
        const pas = Math.min(kmh / 3600, tinta - km);
        km += pas; wall += 1000; fix();
      }
    },
    // GAURA: `secunde` de timp trec, mașina avansează `dKm`, ZERO fixuri. Apoi vine primul
    // fix de după — cel care declanșează puntea.
    gol(secunde, dKm, { tick = true, dinFundal = false } = {}) {
      for (let s = 0; s < secunde; s++) {
        wall += 1000;
        if (tick) m.tick();              // bătaia de inimă merge, doar fixurile lipsesc
      }
      km += dKm;
      if (dinFundal) m.revenitDinFundal();
      fix();
    },
    get km() { return km; },
    jur(t) { return store.journal.filter(e => e.type === t); }
  };
}

console.log('\n═══ Gaură de 30 s la 15 m/s: se pun înapoi ~450 m ═══');
{
  // 30 s × 15 m/s = 450 m conduși. Fără punte s-ar pierde toți.
  const w = lume(LUNG, { kmh: 54 });        // 54 km/h = 15 m/s
  w.mai(1.00);
  const inainte = w.m.M.routeKm;
  w.gol(30, 0.450);
  const crescut = (w.m.M.routeKm - inainte) * 1000;
  ok('odometrul a crescut cu ~450 m, nu cu zero',
     crescut > 430 && crescut < 460, `${crescut.toFixed(0)} m`);
  const g = w.jur('gps_gaura')[0];
  ok('golul e scris în jurnal', !!g, JSON.stringify(w.jur('gps_gaura')));
  ok('cu secundele măsurate', g && g.secunde === 30, g && String(g.secunde));
  ok('cu metrii completați la contorul brut',
     g && g.completatOdo > 430 && g.completatOdo < 460, g && String(g.completatOdo));
  ok('coarda e raportată separat de ce s-a adăugat — se poate verifica la debrief',
     g && g.coardaM > 430 && g.coardaM < 460, JSON.stringify(g));
  // MĂSURAT, și e o distincție care contează: pe drum DREPT, podeaua liniei drepte din
  // `pozitieAbsoluta` (existentă din v45) mișcase deja poziția, deci puntea n-a mai avut
  // ce adăuga la POZIȚIE. Dar CONTORUL BRUT de calibrare pierduse tot golul — `odo.step`
  // refuză pașii lungi — și pe el l-a completat puntea. Cele două socoteli sunt separate.
  ok('și spune cine a mișcat poziția: podeaua liniei drepte a ajuns prima aici',
     g && g.avansatM > 430 && g.metriAdaugati === 0, JSON.stringify(g));
  ok('dar contorul brut de calibrare a fost completat de punte',
     g && g.completatOdo > 400, JSON.stringify(g));
  ok('vocea spune o dată, cu cifra',
     w.said.some(s => /GPS revenit — am completat \d+ de metri/.test(s.t)),
     JSON.stringify(w.said.map(s => s.t).slice(-4)));
  ok('și o spune pe clasa „ritm", ca să nu taie o manevră',
     w.said.filter(s => /am completat/.test(s.t)).every(s => s.cl === 'ritm'));
  ok('segmentul de calibrare e marcat POLUAT — golul nu e o măsurătoare de odometru',
     w.m.M._calPoluat === 'gaura_gps', String(w.m.M._calPoluat));
}

// Lume ȘERPUITĂ: fiecare pas alternează 45° / 315°, deci drumul e cu ~41% mai lung decât
// linia dreaptă. Aici podeaua din `pozitieAbsoluta` NU poate acoperi un gol (linia dreaptă
// de la ancoră rămâne sub kilometrajul crezut), deci puntea e SINGURA care pune ceva
// înapoi. Ăsta e cazul real al lui Andreas: drum de munte cu serpentine, nu autostradă.
function lumeSerpentine({ kmh = 54 } = {}) {
  let wall = 0, lat = 45, lng = 21, dus = 0;
  const said = [], store = makeMemStore();
  const m = makeMachine({ plan: buildPlan(LUNG, {}, null),
    clock: makeClock({ now: () => wall, mono: () => wall }), store, driver: makeDriverModel(),
    voice: { say: (t, p, c, cl) => said.push({ t, cl }), tone() {}, flush() {} },
    ui: { render() {} }, opts: { offRoute: false } });
  m.start(); wall += 1000;
  m.onFix({ lat, lng, tMs: wall, speedMs: 0, accM: 8 });
  let i = 0, hdg = 45;
  // mută mașina `metri` pe un cap compas, fără să trimită fix
  const muta = metri => {
    hdg = (i++ % 2) ? 315 : 45;
    const r = hdg * Math.PI / 180;
    lat += (metri * Math.cos(r)) / 111320;
    lng += (metri * Math.sin(r)) / (111320 * Math.cos(45 * Math.PI / 180));
    dus += metri;
  };
  // BUSOLA E OBLIGATORIE aici, și motivul e o lecție de test: fără `headingDeg`,
  // `pozitieAbsoluta` vede curbură ZERO, crede că drumul e drept și suprascrie poziția cu
  // linia dreaptă de la ancoră — adică lumea „șerpuită" se purta exact ca una dreaptă, iar
  // testul măsura altceva decât credea. Cu busola, curbura trece pragul de 12° și regula
  // „drum drept" se stinge, cum se stinge și în mașină pe serpentine.
  const fix = () => m.onFix({ lat, lng, tMs: wall, speedMs: kmh / 3.6, headingDeg: hdg, accM: 8 });
  return {
    m, store, said,
    mai(dKm) {
      const pasi = Math.round(dKm * 1000 / (kmh / 3.6));
      for (let k = 0; k < pasi; k++) { muta(kmh / 3.6); wall += 1000; fix(); }
    },
    gol(secunde, dKm) {
      for (let s = 0; s < secunde; s++) { wall += 1000; m.tick(); }
      const pasi = Math.max(1, Math.round(dKm * 1000 / (kmh / 3.6)));
      for (let k = 0; k < pasi; k++) muta(dKm * 1000 / pasi);
      fix();
    },
    get dusM() { return dus; },
    jur(t) { return store.journal.filter(e => e.type === t); }
  };
}

console.log('\n═══ Pe serpentine, puntea e SINGURA care pune golul înapoi ═══');
{
  const w = lumeSerpentine();
  w.mai(1.20);
  const inainte = w.m.M.routeKm;
  w.gol(30, 0.450);                       // 450 m conduși în zigzag, zero fixuri
  const g = w.jur('gps_gaura')[0];
  ok('golul e prins', !!g, JSON.stringify(w.jur('gps_gaura')));
  ok('podeaua liniei drepte NU l-a acoperit — pe serpentine ea nu ajunge',
     g && g.avansatM < 50, JSON.stringify(g));
  ok('deci puntea e cea care adaugă, și adaugă coarda',
     g && g.metriAdaugati > 250 && g.metriAdaugati <= g.coardaM + 1, JSON.stringify(g));
  ok('poziția a crescut cu exact atât',
     Math.abs((w.m.M.routeKm - inainte) * 1000 - g.metriAdaugati) < 2,
     `${((w.m.M.routeKm - inainte) * 1000).toFixed(0)} m vs ${g.metriAdaugati}`);
  ok('coarda e sub drumul real, cum se cuvine unei PODELE (450 m conduși în zigzag)',
     g && g.coardaM < 450 && g.coardaM > 250, `coardă ${g.coardaM} m din 450 conduși`);
  ok('și segmentul de calibrare e marcat poluat',
     w.m.M._calPoluat === 'gaura_gps', String(w.m.M._calPoluat));
  ok('vocea spune cifra o dată', w.said.filter(s => /am completat/.test(s.t)).length === 1,
     JSON.stringify(w.said.filter(s => /am completat/.test(s.t)).map(s => s.t)));
}

console.log('\n═══ …și calibrarea REFUZĂ segmentul cu gol în el ═══');
{
  const w = lume(LUNG, { kmh: 54 });
  w.mai(2.00); w.m.atBox(2);                  // primul segment, curat
  ok('segmentul curat a intrat', w.m.M._calN === 1, String(w.m.M._calN));
  w.mai(1.00);
  w.gol(30, 0.450);
  w.mai(1.55);
  w.m.atBox(3);                               // segmentul 2 → 3, cu golul în el
  ok('calibratorul NU a primit segmentul cu gol', w.m.M._calN === 1, String(w.m.M._calN));
  ok('și refuzul spune de ce, cu motivul nou',
     w.jur('cal_refuzat').some(e => e.motiv === 'gaura_gps'),
     JSON.stringify(w.jur('cal_refuzat')));
  ok('factorul rămâne neatins', w.m.M.calFactor === 1, String(w.m.M.calFactor));
}

console.log('\n═══ Gol în PROBĂ: estimarea și puntea nu se adună ═══');
{
  // În probă, `tick()` avansează poziția pe estimare la viteza-țintă cât timp GPS-ul tace.
  // Dacă puntea ar ADĂUGA coarda peste estimare, proba ar sări cu golul de două ori.
  const w = lume(CU_PROBA, { kmh: 54, viteze: {} });
  w.mai(0.70);
  ok('proba a pornit', w.m.M.state === 'RT_RUN', w.m.M.state);
  const inainte = w.m.M.routeKm;
  // 60 s de gol, mașina face 900 m la 15 m/s. Estimarea din probă avansează pe viteza-țintă.
  w.gol(60, 0.900);
  const crescut = (w.m.M.routeKm - inainte) * 1000;
  ok('poziția a crescut O SINGURĂ dată cu golul, nu de două ori',
     crescut > 850 && crescut < 1000, `${crescut.toFixed(0)} m (dublu ar fi ~1800)`);
  const g = w.jur('gps_gaura')[0];
  ok('jurnalul arată AMBELE surse, ca să se poată verifica cine a câștigat',
     g && g.avansatM > 850 && g.coardaM > 850, JSON.stringify(g));
  ok('și nu s-a adăugat nimic peste ce avansase deja — asta e apărarea de dubla numărare',
     g && g.metriAdaugati === 0 && Math.abs(g.avansatM - g.coardaM) < 5, JSON.stringify(g));
  ok('și spune că golul a fost în probă', g && g.inRt === true, JSON.stringify(g && g.inRt));
  ok('invariantul probei ține: distanța = poziția − linia de start',
     Math.abs(w.m.M.rt.distKm - (w.m.M.routeKm - w.m.M.rt.def.startKm)) < 1e-9);
  // și cazul opus: estimarea a spus MAI MULT decât coarda (mașina a stat în trafic)
  const w2 = lume(CU_PROBA, { kmh: 54 });
  w2.mai(0.70);
  const in2 = w2.m.M.routeKm;
  w2.gol(60, 0.100);                       // 60 s dar doar 100 m făcuți: a stat
  const g2 = w2.jur('gps_gaura')[0];
  ok('când ce avansase deja e mai mult decât coarda, coarda nu trage poziția ÎNAPOI',
     w2.m.M.routeKm >= in2 && g2 && g2.metriAdaugati === 0,
     JSON.stringify({ crescut: ((w2.m.M.routeKm - in2) * 1000).toFixed(0), g: g2 }));
}

console.log('\n═══ Teleport: peste plafon nu se adaugă nimic ═══');
{
  const w = lume(LUNG, { kmh: 54 });
  w.mai(1.00);
  const inainte = w.m.M.routeKm;
  w.gol(30, 6.000);                        // 6 km într-o gaură = fix aberant, nu drum
  ok('puntea NU adaugă nimic peste plafon',
     w.jur('gps_gaura').length === 0, JSON.stringify(w.jur('gps_gaura')));
  ok('dar refuzul NU e tăcut — se scrie separat, cu distanța',
     w.jur('gps_gaura_refuzata').length === 1 &&
     w.jur('gps_gaura_refuzata')[0].distM > 4000,
     JSON.stringify(w.jur('gps_gaura_refuzata')));
  ok('și nu se rostește nicio cifră inventată de punte',
     !w.said.some(s => /am completat/.test(s.t)), JSON.stringify(w.said.map(s => s.t)));
  ok('nici contorul de calibrare nu e completat din teleport',
     w.m.M._calPoluat !== 'gaura_gps', String(w.m.M._calPoluat));
  // Ce se întâmplă cu POZIȚIA la un teleport rămâne ce era înainte de v47: podeaua liniei
  // drepte din `pozitieAbsoluta` decide, și ea își scrie propriul `pozitie_podea`. Puntea
  // nu se amestecă — plafonul ei e chiar refuzul de a valida un salt de kilometri.
  const crescut = (w.m.M.routeKm - inainte) * 1000;
  ok('mișcarea poziției, dacă are loc, vine de la podeaua veche și e jurnalizată ca atare',
     crescut < 10 || w.jur('pozitie_podea').length > 0,
     `crescut ${crescut.toFixed(0)} m · pozitie_podea ${w.jur('pozitie_podea').length}`);
}

console.log('\n═══ Golurile mici și revenirea din fundal ═══');
{
  // Fixurile normale (1 s) nu declanșează nimic: puntea nu are voie să se amestece în
  // mersul obișnuit, altfel ar suprascrie odometrul la fiecare pas.
  const w = lume(LUNG, { kmh: 54 });
  w.mai(2.00);
  ok('mersul normal nu produce nicio punte', w.jur('gps_gaura').length === 0,
     JSON.stringify(w.jur('gps_gaura')));
  // Revenirea din fundal declanșează verificarea chiar dacă golul pare mic: pe Android,
  // fixurile pot veni rar ȘI vechi, deci un „ultimul fix acum 3 s" nu dovedește nimic.
  const w2 = lume(LUNG, { kmh: 54 });
  w2.mai(1.00);
  w2.gol(3, 0.045, { dinFundal: true });
  ok('revenirea din fundal se uită la coardă chiar la 3 secunde',
     w2.jur('gps_gaura').length === 1 && w2.jur('gps_gaura')[0].dinFundal === true,
     JSON.stringify(w2.jur('gps_gaura')));
  ok('dar sub 20 m nu se rostește nimic — acolo e zgomot GPS, nu gaură',
     !w2.said.some(s => /am completat/.test(s.t)) ||
     w2.jur('gps_gaura')[0].metriAdaugati >= 20,
     JSON.stringify({ m: w2.jur('gps_gaura')[0].metriAdaugati,
                      said: w2.said.map(s => s.t).slice(-2) }));
  // steagul se consumă: a doua gaură, fără revenire din fundal, nu-l moștenește
  const w3 = lume(LUNG, { kmh: 54 });
  w3.mai(1.00);
  w3.gol(3, 0.045, { dinFundal: true });
  w3.mai(0.50);
  ok('steagul de revenire se consumă la primul fix, nu rămâne aprins',
     w3.jur('gps_gaura').length === 1, JSON.stringify(w3.jur('gps_gaura').length));
}

console.log('\n═══ Ziua nouă pleacă fără datorii ═══');
{
  const w = lume(LUNG, { kmh: 54 });
  w.mai(1.00);
  w.gol(30, 0.450);
  w.m.start();                            // leg nou / zi nouă
  ok('ancora golului se șterge la START', w.m.M._kmLaUltimulFix === null,
     String(w.m.M._kmLaUltimulFix));
  ok('și steagul de fundal la fel', w.m.M._dinFundal === false);
  ok('iar segmentul de calibrare pleacă curat', w.m.M._calPoluat === null,
     String(w.m.M._calPoluat));
}

// ═════════════════════════════════════════════════════════════════════════════
// SANTINELA AUDIO — prevenția. Ține fila trează, ca golul să nu apară deloc.
// Testată prin mock: tot ce atinge browserul e injectabil, altfel n-ar fi verificabilă
// decât pe telefon. LIMITA, spusă în santinela.js: într-un apel celular Android ia focusul
// audio și poate opri redarea — acolo rămâne doar puntea de mai sus.
console.log('\n═══ Santinela: WAV-ul generat local ═══');
{
  const buf = wavAproapeMut();
  const v = new DataView(buf);
  const txt = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
  ok('e un RIFF/WAVE valid', txt(0, 4) === 'RIFF' && txt(8, 4) === 'WAVE', txt(0, 12));
  ok('PCM, un canal, 8 biți', v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 &&
     v.getUint16(34, true) === 8);
  ok('două secunde la 8 kHz = 16000 mostre',
     v.getUint32(40, true) === 16000, String(v.getUint32(40, true)));
  ok('mostrele sunt la 1 LSB de liniște — inaudibil, dar nu liniște digitală',
     v.getUint8(44) === 128 && v.getUint8(45) === 129,
     `${v.getUint8(44)}, ${v.getUint8(45)}`);
  ok('nu se cere NIMIC de pe rețea — se generează în memorie',
     buf.byteLength === 44 + 16000, String(buf.byteLength));
}

console.log('\n═══ Santinela: pornește și se oprește cu ziua ═══');
{
  const faFals = () => {
    let paused = true;
    return { loop: false, volume: 1, ended: false,
             get paused() { return paused; },
             play() { paused = false; return Promise.resolve(); },
             pause() { paused = true; },
             setAttribute() {} };
  };
  const jurnal = [];
  const media = { playbackState: 'none', metadata: null };
  const s = makeSantinela({ faAudio: faFals, media, log: (t, d) => jurnal.push({ t, d }) });
  ok('nu redă nimic înainte de START', s.stare().redaAcum === false && s.stare().pornit === false);
  return_test(s, media, jurnal);
}
function return_test(s, media, jurnal) {
  const p = s.porneste();
  ok('MediaSession e pusă pe „playing" — semnalul pe care Android îl citește',
     media.playbackState === 'playing', media.playbackState);
  p.then(() => {
    ok('după pornire, chiar redă', s.stare().redaAcum === true && s.stare().aRedat === true,
       JSON.stringify(s.stare()));
    ok('și e în buclă, la volum neglijabil (puse de modul, pe orice element)',
       s.stare().volum === 0.001, String(s.stare().volum));
    ok('pornirea intră în jurnal', jurnal.some(e => e.t === 'santinela' && e.d.stare === 'pornit'),
       JSON.stringify(jurnal));
    s.opreste();
    ok('STOP ZIUA o oprește', s.stare().redaAcum === false && s.stare().pornit === false);
    ok('și MediaSession revine pe „paused"', media.playbackState === 'paused', media.playbackState);
    ok('oprirea intră și ea în jurnal',
       jurnal.some(e => e.t === 'santinela' && e.d.stare === 'oprit'), JSON.stringify(jurnal));
    gataSantinela();
  });
}

function gataSantinela() {
  console.log('\n═══ Santinela: redarea refuzată nu e ascunsă ═══');
  const faRefuz = () => ({ loop: false, volume: 1, paused: true, ended: false,
                           play() { const e = new Error('gestul lipsește'); e.name = 'NotAllowedError'; return Promise.reject(e); },
                           pause() {}, setAttribute() {} });
  const jurnal = [];
  const s = makeSantinela({ faAudio: faRefuz, media: null, log: (t, d) => jurnal.push({ t, d }) });
  s.porneste().then(rezultat => {
    ok('refuzul e raportat, nu înghițit', rezultat === false);
    ok('starea spune că NU redă, deși i s-a cerut',
       s.stare().pornit === true && s.stare().aRedat === false, JSON.stringify(s.stare()));
    ok('eroarea e păstrată pentru verificarea din teren',
       /NotAllowed/.test(s.stare().ultimaEroare || ''), String(s.stare().ultimaEroare));
    ok('și refuzul intră în jurnal',
       jurnal.some(e => e.d.stare === 'refuzat'), JSON.stringify(jurnal));
    ok('fără MediaSession nu crapă', true);
    console.log(`\n──────── ${pass} trecute, ${fail} căzute ────────`);
    process.exit(fail ? 1 : 0);
  });
}
