// RALI 2 · main.js — cablajul: leagă modulele, ține meniul parcat, pornește cursa.

import { makeClock } from './time.js';
import { buildTrace } from './geo.js';
import { makeStore, makeMemStore, exportDay, importDay, resumeStateFromJournal } from './store.js';
import { makeVoice, makeEars, secRo } from './voice.js';
import { makeLiveGps, makeSyntheticGps, makeReplayGps } from './gps.js';
import { buildPlan, detectRts, sanitizeBoxes, groupByLeg, verifyRoadbook,
         reconNormalize, reconPentruLeg, reconPune, reconStatus,
         reconRecupereaza, verificaHarta, hartaPentruLeg } from './route.js';
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
// starea recunoașterii pentru leg-ul activ, calculată în rebuildPlan și afișată în
// panoul de pregătire — pilotul trebuie s-o vadă ÎNAINTE de START, nu s-o deducă din
// comportament (04.08.2026: două zile de test fără geometrie, fără ca nimic s-o spună)
let reconStare = null, reconDraftMesaj = null;

// Versiunea build-ului — se ține SINCRON cu CACHE din sw.js la fiecare deploy.
// Vizibilă în antet și scrisă în jurnal la fiecare pornire: „ce versiune rulează
// telefonul?" se citește, nu se ghicește (02.08, seara — nu se putea ști).
const BUILD = 'v32';

async function init() {
  store = await makeStore();
  const av = document.getElementById('app-ver');
  if (av) av.textContent = BUILD;
  try { store.log('app_ver', { v: BUILD }, Date.now()); } catch (e) {}
  clock = makeClock();
  const off = parseFloat(localStorage.getItem('r2_clockoff') || '0');
  clock.setOffsetMs(off * 1000);
  // Mesajele ARUNCATE din coadă intră în jurnal (audit, #9): la debrief se vede și
  // ce nu s-a auzit, nu doar ce s-a spus — altfel „de ce nu mi-a zis de viraj?"
  // rămânea fără răspuns.
  voice = makeVoice({ audio: audioCtx(),
    onDrop: (text, de) => { try { store.log('voce_aruncata', { text, de }, clock.rally()); } catch (e) {} },
    // …și ce a plecat în difuzor, ca „s-a auzit?" să fie o măsurătoare, nu o deducție
    onSpeak: (text, cls) => { try { store.log('voce_rostita', { text, cls }, clock.rally()); } catch (e) {} } });
  ui = makeUi();
  driver = makeDriverModel(await store.get('driver_model') || {});
  startHeaderClock(clock);
  // Modelul șoferului se salvează periodic, nu doar la beforeunload — pe mobil pagina
  // moare adesea înainte ca tranzacția din beforeunload să apuce să se încheie (#26).
  setInterval(() => { try { store.put('driver_model', driver.toJSON()); } catch (e) {} }, 60000);

  // cheia API: o refolosim pe cea a aplicației vechi dacă există (aceeași origine)
  if (!localStorage.getItem('r2_key') && localStorage.getItem('rali_key'))
    localStorage.setItem('r2_key', localStorage.getItem('rali_key'));

  // Sanitizat la ÎNCĂRCARE, nu doar la scanare: planul poate veni și din import
  // (fișier de pe alt telefon = conținut extern) sau dintr-un IndexedDB scris de o
  // versiune veche. Singurul punct prin care trec toate căile. (Audit 02.08.2026, P3.)
  boxesRaw = sanitizeBoxes((await store.get('plan_raw')) || []);
  await recupereazaDraftRecon();      // o înregistrare întreruptă nu se mai pierde
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

// Detectarea ieșirii de pe traseu: PORNITĂ implicit, cum a cerut Andreas. Se poate opri
// din panoul de pregătire — o singură dată, nu la fiecare pornire.
function offRoutePornit() { return localStorage.getItem('r2_offroute') !== '0'; }

async function rebuildPlan() {
  const speeds = (await store.get('rt_speeds')) || {};
  // Planul se construiește pe UN SINGUR leg (audit, #1) — km-ii și numerele de box
  // repornesc la fiecare leg, deci amestecul lor global era un traseu inexistent.
  const grupuri = groupByLeg(boxesRaw);
  let cheia = await store.get('leg_activ');
  if (!grupuri.some(g => g.key === cheia)) cheia = grupuri.length ? grupuri[0].key : null;
  const g = grupuri.find(x => x.key === cheia);
  // Geometria e A LEG-ULUI, nu a zilei (vezi route.js, reconNormalize). Forma veche,
  // dacă mai există pe telefon, se migrează o singură dată și se scrie înapoi.
  const harta = reconNormalize(await store.get('recon'), cheia);
  if (harta._migrat) {
    delete harta._migrat;
    await store.put('recon', harta);
    try { store.log('recon_migrat', { legKey: cheia }, Date.now()); } catch (e) {}
  }
  const rec = reconPentruLeg(harta, cheia);
  reconStare = reconStatus(rec);
  // Se dă mașinii DOAR o geometrie folosibilă: o urmă fără ancore nu poate produce
  // anchorMap, iar mașina ar ignora-o oricum — dar tăcut. Așa, „Geometrie: DA" din
  // panou înseamnă exact „proiecția și paznicul de direcție funcționează".
  // Harta traseului: coordonatele boxurilor leg-ului activ, dacă au fost încărcate.
  // Ordinea de încredere e recon > hartă > firimituri (vezi machine.pctBox) — harta nu
  // înlocuiește geometria înregistrată, dar e singurul reper absolut pe un roadbook nou.
  const hartaTot = (await store.get('harta')) || null;
  const hartaLeg = hartaPentruLeg(hartaTot, cheia);
  plan = buildPlan(g ? g.boxes : [], speeds, reconStare.ok ? rec : null, hartaLeg);
  plan.hartaTot = hartaTot;
  plan.legKey = cheia;
  plan.legGroups = grupuri;
  const idx = grupuri.findIndex(x => x.key === cheia);
  plan.legLabel = g ? g.label : null;
  plan.nextLegKey = idx >= 0 && idx + 1 < grupuri.length ? grupuri[idx + 1].key : null;
  plan.nextLegLabel = plan.nextLegKey ? grupuri[idx + 1].label : null;
  // starea geometriei pe FIECARE leg — la două leg-uri, „am înregistrat" nu spune
  // pentru care dintre ele
  plan.reconLegs = grupuri.map(gr => ({ label: gr.label,
    stare: reconStatus(reconPentruLeg(harta, gr.key)) }));
  machine = makeMachine({ plan, clock, voice, store, ui, driver,
                          opts: { offRoute: offRoutePornit() } });
  // programul TC scanat ieri nu se pierde la repornire — se reîncarcă din stocare
  // Time card-ul e al ZILEI (TC1..TCn în ordine), dar planul e al LEG-ului: fiecare
  // leg consumă din listă atâtea TC-uri câte boxuri TC are. Offset-ul se DERIVĂ din
  // poziția leg-ului activ (suma TC-urilor leg-urilor dinainte) — fără stare, corect
  // și la trecerea normală, și la alegerea manuală a leg-ului. Fără felierea asta,
  // după leg 1 orele TC1/TC2 se lipeau de boxurile leg-ului 2 (găsit 03.08, construind
  // testul cu două leg-uri — la Sibiu ar fi lovit direct).
  const tcs = await store.get('tc_schedule');
  if (tcs && tcs.length) {
    const tcOff = grupuri.slice(0, Math.max(0, idx))
      .reduce((n, gr) => n + gr.boxes.filter(b => b.flag === 'TC').length, 0);
    machine.setTcSchedule(tcs.slice(tcOff));
  }
  renderPrep();
  ui.render(machine.M, plan);
}

function renderPrep() {
  // starea hărții: câte boxuri din leg-ul activ au coordonate, spus înainte de START
  const hEl = $('prep-harta');
  if (hEl) {
    const n = plan.harta ? Object.keys(plan.harta).length : 0;
    const total = plan.boxes.length;
    hEl.textContent = n
      ? `Hartă: DA — ${n} din ${total} boxuri cu coordonate` +
        (n < total ? ' (restul cad pe kilometraj)' : '')
      : 'Hartă: — (fără ea nu știu unde e boxul dacă greșești drumul)';
  }
  $('prep-boxes').textContent = boxesRaw.length
    ? `${plan.boxes.length} boxuri în ${plan.legLabel || 'leg'} · 0–${plan.totalKm.toFixed(2)} km` +
      (plan.legGroups.length > 1 ? ` · ${plan.legGroups.length} leg-uri scanate` : '')
    : 'niciun box scanat';
  // selectorul de leg: apare doar când sunt mai multe
  const lw = $('prep-legs'); lw.textContent = '';
  if (plan.legGroups.length > 1) {
    for (const g of plan.legGroups) {
      const b = document.createElement('button');
      b.className = 'btn sm ' + (g.key === plan.legKey ? 'pri' : 'sec');
      b.textContent = `${g.label} · ${g.boxes.length} boxuri`;
      b.addEventListener('click', async () => {
        await store.put('leg_activ', g.key);
        await rebuildPlan();
      });
      lw.appendChild(b);
    }
  }
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
  // verificatorul: erorile scanării se prind parcat, nu la 40 km/h (propunerea 1)
  const vf = $('prep-verif');
  if (vf) {
    vf.textContent = '';
    if (boxesRaw.length) {
      const v = verifyRoadbook(boxesRaw);
      if (!v.probleme.length) {
        const p = document.createElement('p');
        p.className = 'line'; p.style.color = 'var(--ok)';
        p.textContent = '✓ roadbook coerent: km crescători, numere în serie, probele împerecheate';
        vf.appendChild(p);
      } else {
        for (const txt of v.probleme.slice(0, 12)) {
          const p = document.createElement('p');
          p.className = 'line'; p.style.color = 'var(--warn)';
          p.textContent = '⚠ ' + txt;
          vf.appendChild(p);
        }
        if (v.probleme.length > 12) {
          const p = document.createElement('p');
          p.className = 'line dim';
          p.textContent = `…și încă ${v.probleme.length - 12}`;
          vf.appendChild(p);
        }
      }
    }
  }
  renderRecon();
}

// Rândul de geometrie din panoul de pregătire. Cerut după 04.08.2026: aplicația are
// „traseul ca geometrie" ca idee centrală, paznicul de direcție și proiecția fără drift
// depind de ea — și au lipsit DOUĂ zile de test fără ca nimic pe ecran s-o spună.
// Paznicul care „tace" arată identic cu paznicul care e mulțumit.
function renderRecon() {
  const el = $('prep-recon');
  const s = reconStare;
  if (s && s.ok) {
    const d = s.at ? new Date(s.at) : null;
    const cand = d ? ` · ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ` +
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    el.textContent = `Geometrie: DA — ${s.puncte} puncte · ${s.ancore} ancore · ` +
      `${s.km.toFixed(2)} km${cand}${s.recuperat ? ' (recuperată din înregistrarea întreruptă)' : ''}` +
      // migrarea din forma veche ATRIBUIE geometria leg-ului activ, fiindcă vechea cheie
      // nu ținea minte pentru care leg s-a înregistrat. Poate fi a altui leg — deci se
      // spune, nu se tace.
      (s.dinFormaVeche ? ' · ⚠ migrată din versiunea veche — confirmă că e a acestui leg' : '');
    el.style.color = s.dinFormaVeche ? 'var(--warn)' : 'var(--ok)';
  } else {
    el.textContent = 'Geometrie: NU — paznic de direcție și proiecție fără drift INDISPONIBILE' +
      (s && s.motiv ? ` (${s.motiv})` : '');
    el.style.color = 'var(--bad)';
  }
  const legs = $('prep-recon-legs');
  if (legs) {
    const linii = [];
    if (plan.reconLegs && plan.reconLegs.length > 1)
      linii.push(plan.reconLegs.map(r => `${r.label}: ${r.stare.ok ? 'DA' : 'NU'}`).join(' · '));
    if (reconDraftMesaj) linii.push(reconDraftMesaj);
    legs.textContent = linii.join(' — ');
  }
}

// ── GPS live + cursă ────────────────────────────────────────────────────────
let tickId = null;
function startDay(dinPreluare) {
  if (!plan.boxes.length) { alert('Scanează întâi roadbook-ul.'); return; }
  // „AZI PLECI DE LA…" (propunerea 2, după testul 3 din teren): contractul lui START
  // e „ești fizic la boxul 1 al leg-ului" — dar nimeni nu-i spunea pilotului DE UNDE
  // pleacă, iar ziua a pornit din alt punct și totul a fost decalat. Confirmarea e
  // obligatorie; la preluare (import) nu are sens — acolo poziția vine din jurnal.
  if (!dinPreluare) {
    const b0 = plan.boxes[0];
    const unde = `box ${b0.num}` + (b0.comment ? ` — ${b0.comment.slice(0, 90)}` : '');
    // Rezumatul planului intră în confirmare: „0,35 km · 0 probe" (cum era pe 02.08,
    // cu 4 boxuri dintr-o scanare parțială) trebuie să sară în ochi AICI, nu pe drum.
    if (!confirm(`${plan.legLabel ? plan.legLabel + '\n' : ''}` +
                 `${plan.boxes.length} boxuri · ${plan.totalKm.toFixed(2)} km · ${plan.rts.length} probe\n\n` +
                 `PLECI DE LA: ${unde}\n\n` +
                 `Ești fizic în punctul ăsta, gata de plecare?`)) return;
  }
  stopGps();
  // Pierderea semnalului se anunță ÎNTR-UN SINGUR LOC — mașina de stări, care știe dacă
  // ești în probă și scrie și în jurnal. Înainte vorbeau amândouă: în tura de la 18:00
  // s-a auzit „Atenție, GPS pierdut." (18:03:27) și „GPS pierdut." (18:03:34), la 7
  // secunde una de alta, de două ori în aceeași tură.
  gps = makeLiveGps({
    onFix: f => machine.onFix(f),
    onLost: () => {},
    onBack: () => { try { machine.gpsRevenit(); } catch (e) {} }
  });
  if (!gps.start()) { alert('GPS indisponibil.'); return; }
  machine.start();
  // Bătaia de inimă independentă de GPS (audit, #5): cronometrul probei, avertizările
  // TC și închiderea pe estimare NU mai depind de sosirea fixurilor. `machine` e citit
  // la fiecare bătaie, deci schimbarea de leg (mașină nouă) nu rupe nimic.
  clearInterval(tickId);
  tickId = setInterval(() => { try { machine.tick(); } catch (e) {} }, 1000);
  showScreen('run');
}

function stopGps() {
  if (gps) { gps.stop(); gps = null; }
  clearInterval(tickId); tickId = null;
}

// Leg-ul următor: aceeași zi, kilometraj care repornește de la 0. START curat pe
// mașina nouă — exact contractul lui start() („ești fizic la boxul 1 al leg-ului").
async function legUrmator() {
  if (!plan.nextLegKey) return;
  const numeNou = plan.nextLegLabel;
  await store.put('leg_activ', plan.nextLegKey);
  await rebuildPlan();      // offset-ul TC pe leg se derivă în rebuildPlan
  voice.say(`${numeNou}. Apasă START când ești la boxul 1.`, 2);
  showScreen('prep');
}

// ── recunoașterea: înregistrează urma + ancorele ────────────────────────────
// Înregistrarea se leagă de LEG-UL ACTIV (numerele de box și km-ii repornesc la fiecare
// leg) și se salvează DIN MERS, nu doar la STOP: pe telefon, pagina moare des în plină
// înregistrare (ecran stins, cameră, memorie) — până azi, un drum de recunoaștere de 20
// de minute se pierdea în întregime, fără o urmă în jurnal că a existat vreodată.
function startRecon() {
  if (!plan.boxes.length) {
    alert('Scanează întâi roadbook-ul: recunoașterea se leagă de un leg, iar ancorele sunt boxuri.');
    return;
  }
  stopGps();
  const legKey = plan.legKey, legLabel = plan.legLabel || 'leg';
  reconRec = { raw: [], samples: [], anchors: [], legKey, legLabel };
  let cum = 0, lastPt = null, ultimaSalvare = 0;
  const salveazaDraft = async () => {
    try {
      await store.put('recon_draft', { legKey, raw: reconRec.raw, samples: reconRec.samples,
                                       anchors: reconRec.anchors, at: Date.now() });
    } catch (e) {}
  };
  gps = makeLiveGps({
    onFix: f => {
      reconRec.raw.push({ lat: f.lat, lng: f.lng, tMs: f.tMs, speedMs: f.speedMs, accM: f.accM });
      if (lastPt) {
        const d = Math.hypot((f.lat - lastPt.lat) * 110574, (f.lng - lastPt.lng) * 111320 * Math.cos(f.lat * Math.PI / 180));
        if (d > 3 && d < 500) cum += d;
      }
      lastPt = f;
      if (f.speedMs != null) reconRec.samples.push({ cumM: cum, kmh: f.speedMs * 3.6 });
      // afișarea e ULTIMA grijă: dacă nodul lipsește (index.html vechi din cache),
      // un TypeError aici ar sări peste salvarea ciornei de mai jos — adică exact
      // pierderea de date pe care ciorna o repară
      const rd = $('rec-dist');
      if (rd) rd.textContent = (cum / 1000).toFixed(2) + ' km';
      // ciornă la fiecare 15 s: o tranzacție la 15 s nu încarcă telefonul, dar o
      // închidere neașteptată nu mai costă tot drumul
      if (Date.now() - ultimaSalvare > 15000) { ultimaSalvare = Date.now(); salveazaDraft(); }
    },
    onLost: () => {}, onBack: () => {}
  });
  reconRec.cum = () => cum;
  const pornit = gps.start();
  // Gardă pe fiecare nod nou: un index.html VECHI rămas în cache-ul PWA n-are `rec-leg`,
  // iar un TypeError aici ar cădea DUPĂ pornirea GPS-ului și ÎNAINTE de showScreen —
  // adică înregistrare pornită, fără ecran și fără buton de oprire. (Audit, 04.08.2026.)
  const rl = $('rec-leg');
  if (rl) rl.textContent = pornit
    ? `înregistrez pentru ${legLabel} · ${plan.boxes.length} boxuri`
    : '⚠ GPS INDISPONIBIL — nu se înregistrează nimic';
  const rd = $('rec-dist'); if (rd) rd.textContent = '0.00 km';
  const ra = $('rec-anchors'); if (ra) ra.textContent = '0 ancore';
  try { store.log('recon_start', { legKey, legLabel, boxuri: plan.boxes.length, gps: !!pornit }, Date.now()); } catch (e) {}
  showScreen('recon');
  if (!pornit) { alert('GPS indisponibil — recunoașterea n-ar înregistra nimic.'); return; }
  voice.say('Recunoaștere pornită. Marchează boxurile din mers.', 2);
}

async function reconMark() {
  if (!reconRec) return;
  const inp = $('rec-box');
  const num = parseInt(inp ? inp.value : '', 10);
  if (!isFinite(num)) { alert('Pune numărul boxului.'); return; }
  // boxurile LEG-ULUI înregistrat, nu toate boxurile scanate: cu două leg-uri, „box 4"
  // există de două ori, iar căutarea globală lua mereu km-ul primului leg — ancoră pusă
  // pe kilometrajul altui traseu (04.08.2026)
  const b = plan.boxes.find(x => x.num === num);
  if (!b) { alert(`Boxul ${num} nu e în ${reconRec.legLabel}.`); return; }
  reconRec.anchors.push({ officialKm: b.sumKm, traceM: reconRec.cum() });
  try { store.log('recon_ancora', { legKey: reconRec.legKey, boxNum: num,
                                    officialKm: b.sumKm, traceM: Math.round(reconRec.cum()) }, Date.now()); } catch (e) {}
  voice.tone('tick'); voice.say(`Box ${num} marcat.`, 1);
  if (inp) inp.value = String(num + 1);
  const ra = $('rec-anchors');
  if (ra) ra.textContent = reconRec.anchors.length + ' ancore';
}

async function reconStop() {
  stopGps();
  if (!reconRec) { showScreen('prep'); return; }
  const trace = buildTrace(reconRec.raw);
  const rec = { trace, samples: reconRec.samples, anchors: reconRec.anchors,
                at: Date.now(), legKey: reconRec.legKey };
  const harta = reconPune(await store.get('recon'), reconRec.legKey, rec);
  await store.put('recon', harta);
  await store.del('recon_draft');
  try { store.log('recon_salvat', { legKey: reconRec.legKey, puncte: trace.pts.length,
                                    km: Math.round(trace.totalM) / 1000,
                                    ancore: reconRec.anchors.length }, Date.now()); } catch (e) {}
  const st = reconStatus(rec);
  reconRec = null;
  await rebuildPlan();
  // fără ancore, urma nu se poate lega de kilometrajul roadbook-ului — se spune ACUM,
  // cât mai poți repeta drumul, nu la 40 km/h în cursă
  voice.say(st.ok
    ? `Recunoaștere salvată: ${(trace.totalM / 1000).toFixed(1)} kilometri, ${rec.anchors.length} ancore.`
    : 'Recunoaștere salvată, dar FĂRĂ ancore — nu se poate folosi. Marchează boxuri la următoarea tură.', 2);
  showScreen('prep');
}

// Ciorna rămasă de la o înregistrare întreruptă (aplicație închisă în plin drum).
// Decizia stă în route.js (funcție pură, verificată de teste); aici doar stocarea.
async function recupereazaDraftRecon() {
  let d = null;
  try { d = await store.get('recon_draft'); } catch (e) { return; }
  const r = reconRecupereaza(d, await store.get('recon'));
  if (r.stare === 'gol') return;
  if (r.stare === 'exista_deja') {
    reconDraftMesaj = `ciornă de recunoaștere nefolosită (${r.km.toFixed(2)} km) — leg-ul are deja geometrie`;
    return;
  }
  await store.put('recon', reconPune(await store.get('recon'), r.legKey, r.rec));
  await store.del('recon_draft');
  reconDraftMesaj = `recuperată o înregistrare întreruptă: ${r.km.toFixed(2)} km, ${r.rec.anchors.length} ancore`;
  try { store.log('recon_recuperat', { legKey: r.legKey, puncte: r.rec.trace.pts.length,
                                       km: r.km, ancore: r.rec.anchors.length }, Date.now()); } catch (e) {}
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
  // Și STORE separat, în memorie (audit, #10): repetiția scria day_start/rt_result în
  // jurnalul REAL al zilei, nemarcat — resumeStateFromJournal l-ar fi luat drept cursă,
  // iar sync-ul l-ar fi urcat pe GitHub ca ziua adevărată.
  const mach = makeMachine({ plan, clock, voice, store: makeMemStore(), ui, driver, opts: { ghost: true } });
  const speedPlan = cumM => {
    const km = plan.anchorMap ? plan.anchorMap.officialKm(cumM) : cumM / 1000;
    const rt = plan.rts.find(r => km >= r.startKm - 0.05 && km <= r.finishKm + 0.05);
    return rt ? rt.kmh : 45;
  };
  const gata = async () => {
    voice.say('Repetiție încheiată.', 2);
    stopGps();
    // _rehearsing se stinge și la finalul NATURAL, nu doar la STOP manual (audit, #11):
    // altfel primul STOP al cursei reale intra pe ramura de repetiție și jurnalul
    // zilei nu mai pleca la sfârșit.
    _rehearsing = false;
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

// ── replay-ul zilei, ×20 (propunerea 3) ─────────────────────────────────────
// Jurnalul are de azi coordonate, deci ziua se poate REDA prin aceeași mașină de
// stări: debriefingul de seară devine o măsurătoare, nu o discuție din memorie.
// Rulează pe store în memorie și pe mașină-fantomă — jurnalul real nu se atinge.
async function replayDay() {
  const j = await store.journalAll();
  const poz = j.filter(e => e.type === 'pos' && typeof e.lat === 'number' && typeof e.lng === 'number');
  if (poz.length < 10) { alert('Jurnalul nu are destule poziții cu coordonate — se strâng din prima zi condusă cu versiunea asta.'); return; }
  const min = Math.round((poz[poz.length - 1].t - poz[0].t) / 60000 / 20);
  if (!confirm(`Redau ziua din jurnal: ${poz.length} poziții, la viteză ×20 (~${min} min). Pornim?`)) return;
  stopGps();
  const mach = makeMachine({ plan, clock, voice, store: makeMemStore(), ui, driver, opts: { ghost: true } });
  const fixes = poz.map(e => ({ lat: e.lat, lng: e.lng, tMs: e.t,
    speedMs: e.kmh != null ? e.kmh / 3.6 : null, accM: e.accM != null ? e.accM : 10 }));
  gps = makeReplayGps(fixes, { rate: 20, onFix: f => mach.onFix(f) });
  try {
    gps.start();
    mach.start();
    machine = mach;
    _rehearsing = true;             // STOP ZIUA îl oprește exact ca pe repetiție
    showScreen('run');
    voice.say('Redau ziua, de douăzeci de ori mai repede.', 2);
  } catch (e) {
    stopGps();
    alert('Replay eșuat: ' + (e && e.message ? e.message : e));
    rebuildPlan();
  }
}

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
    // Rezultatul FIECĂREI pagini se ține minte și se arată la final. Pe 02.08, două
    // pagini din trei au căzut, dar eroarea era suprascrisă de „Scanez pagina 3/3…"
    // și finalul arăta „✓ 4 boxuri" — a arătat a succes și s-a condus cu o treime
    // de roadbook. O scanare parțială e un EȘEC, nu un succes mai mic.
    const rezultate = [];
    for (let i = 0; i < imgs.length; i++) {
      st.textContent = `Scanez pagina ${i + 1}/${imgs.length}…`;
      try {
        const boxes = await scanRoadbookPage(key, imgs[i].b64, imgs[i].mime);
        let noi = 0;
        for (const b of boxes) {
          // dedup DOAR în interiorul aceluiași leg: numerele și km-ii repornesc la
          // fiecare leg, deci „box 1 la 0,00" există legitim în toate leg-urile
          const dupe = all.find(x => x.day === b.day && x.leg === b.leg &&
            x.num === b.num && Math.abs(x.sumKm - b.sumKm) < 0.005);
          if (!dupe) { all.push(b); noi++; }
        }
        rezultate.push({ pag: i + 1, ok: true, boxuri: boxes.length, noi });
      } catch (e) {
        // răspunsul brut (începutul lui) merge în jurnal — diagnostic, nu ghicit
        rezultate.push({ pag: i + 1, ok: false, err: e.message,
                         raw: e.raw || null, rawLen: e.rawLen || null,
                         stop: e.stop || null, rawPrima: e.rawPrima || null });
      }
      try { store.log('scan_page', rezultate[rezultate.length - 1], Date.now()); } catch (e) {}
    }
    all.sort((a, b) => a.sumKm - b.sumKm);
    boxesRaw = all;
    await store.put('plan_raw', boxesRaw);
    await rebuildPlan();
    const cazute = rezultate.filter(r => !r.ok);
    const detaliu = rezultate.map(r => r.ok ? `p${r.pag} ✓${r.boxuri}` : `p${r.pag} ✗`).join(' · ');
    if (cazute.length) {
      st.textContent = `⚠ AU CĂZUT ${cazute.length} PAGINI DIN ${imgs.length} — refotografiază-le! ` +
        `${detaliu} · ${cazute.map(c => `p${c.pag}: ${c.err}`).join(' · ')}`;
      st.style.color = 'var(--bad)';
      alert(`Scanarea NU e completă: ${cazute.length} pagini din ${imgs.length} au căzut.\n\n` +
            cazute.map(c => `pagina ${c.pag}: ${c.err}`).join('\n') +
            `\n\nRefotografiază paginile căzute și scanează-le din nou — restul rămân.`);
    } else {
      st.textContent = `✓ ${detaliu} → ${boxesRaw.length} boxuri, ${detectRts(boxesRaw).length} probe`;
      st.style.color = '';
    }
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
      await rebuildPlan();                  // maparea pe leg-ul activ, cu offset derivat
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
        try {
          await importDay(store, dump);
        } catch (e) {
          // Fișierul are mai puține intrări decât jurnalul local: se poate să fie un
          // export vechi sau trunchiat, iar importul ar șterge ziua. Cifrele se pun pe
          // ecran și decide omul. (Audit de securitate, 04.08.2026.)
          if (!e.cerConfirmare) throw e;
          const c = e.cerConfirmare;
          if (!confirm(`ATENȚIE: fișierul are ${c.dinFisier} intrări, jurnalul local are ${c.local}.\n\n` +
                       `Importul ȘTERGE jurnalul local (${c.local} intrări) și pune în loc cele ` +
                       `${c.dinFisier} din fișier. Ce se șterge NU se mai poate recupera.\n\n` +
                       `Sigur înlocuiești?`)) return;
          await importDay(store, dump, { confirmat: true });
        }
        // Sanitizat la ÎNCĂRCARE, nu doar la scanare: planul poate veni și din import
  // (fișier de pe alt telefon = conținut extern) sau dintr-un IndexedDB scris de o
  // versiune veche. Singurul punct prin care trec toate căile. (Audit 02.08.2026, P3.)
  boxesRaw = sanitizeBoxes((await store.get('plan_raw')) || []);
        await rebuildPlan();
        const st = resumeStateFromJournal(await store.journalAll());
        startDay(true);          // preluare: poziția vine din jurnal, nu de la boxul 1
        machine.resume(st);
      } catch (e) { alert('Import eșuat: ' + e.message); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// Încărcarea hărții traseului. Fișierul e CONȚINUT EXTERN: se citește, se verifică față
// de roadbook-ul scanat și se refuză cu motive scrise pe ecran. O hartă greșită e mai rea
// decât niciuna — trimite pilotul cu încredere în direcția greșită.
function incarcaHarta() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { $('prep-harta-st').textContent = 'Fișier prea mare (peste 2 MB).'; return; }
    const r = new FileReader();
    r.onload = async () => {
      const st = $('prep-harta-st');
      let raw;
      try { raw = JSON.parse(String(r.result)); }
      catch (e) { st.textContent = 'Fișierul nu e JSON valid.'; return; }
      const v = verificaHarta(raw, groupByLeg(boxesRaw));
      if (!v.ok) {
        st.textContent = 'REFUZAT: ' + v.probleme.slice(0, 4).join(' · ');
        try { store.log('harta_refuzata', { probleme: v.probleme.slice(0, 6) }, clock.rally()); } catch (e) {}
        return;
      }
      await store.put('harta', v.harta);
      try { store.log('harta_incarcata', { legs: Object.keys(v.harta), boxuri: v.rezumat.boxuri }, clock.rally()); } catch (e) {}
      await rebuildPlan();
      st.textContent = `Încărcată: ${v.rezumat.boxuri} boxuri cu coordonate, ${v.rezumat.legs} leg-uri.`;
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
  $('btn-nextleg')?.addEventListener('click', legUrmator);
  // STOP cu DOUĂ atingeri (audit, #12): butonul stă sub SUNT LA BOX, în mașină în
  // mers — o atingere greșită oprea ziua și închidea proba cu un rezultat fals.
  let stopArmatLa = 0;
  $('btn-stop').addEventListener('click', async () => {
    const acum = Date.now();
    if (acum - stopArmatLa > 3000) {
      stopArmatLa = acum;
      $('btn-stop').textContent = '■ SIGUR? apasă iar pentru STOP';
      setTimeout(() => { $('btn-stop').textContent = '■ STOP ZIUA'; }, 3200);
      return;
    }
    stopArmatLa = 0;
    $('btn-stop').textContent = '■ STOP ZIUA';
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
  const bpInchide = () => {
    bp.classList.add('hidden'); $('bp-confirm').classList.add('hidden');
    // consumă intrarea de istoric pusă la deschidere, ca back-ul să rămână consistent
    if (history.state && history.state.modal) history.back();
  };

  // BACK pe Android închide MODALUL, nu aplicația (testul din 02.08 după-amiaza:
  // back în modal a omorât aplicația în plină probă — PWA standalone fără istoric).
  // Intrare-scut în istoric, pusă O dată: back-ul are mereu ceva de „consumat"
  // înainte să poată închide aplicația.
  try { history.pushState({ guard: true }, ''); } catch (e) {}

  window.addEventListener('popstate', () => {
    if (!bp.classList.contains('hidden')) {
      bp.classList.add('hidden'); $('bp-confirm').classList.add('hidden');
      return;
    }
    // Back ar închide aplicația → întreabă (cerut de Andreas, 02.08, după ce un back
    // accidental a omorât aplicația în plină probă).
    if (confirm('Închizi aplicația RALI?')) {
      // PWA-ul instalat nu se poate închide din cod pe toate telefoanele; unde se
      // poate, window.close() o face acum — unde nu, următorul BACK iese direct,
      // fără altă întrebare (scutul nu se mai pune la loc).
      try { window.close(); } catch (e) {}
      return;
    }
    history.pushState({ guard: true }, '');   // a zis nu: scutul revine
  });

  function bpDeschide() {
    const M = machine.M;
    if (bp.classList.contains('hidden')) history.pushState({ modal: 'boxpick' }, '');
    $('bp-now').textContent = M.routeKm.toFixed(2) + ' km';
    const urm = machine.M.nextBoxIdx;
    const b = plan.boxes[urm];
    $('bp-ctx').textContent = b
      ? `următorul box așteptat: ${b.num}, la ${Math.round((b.sumKm - M.routeKm) * 1000)} m`
      : 'după ultimul box';
    const lista = $('bp-list');
    lista.textContent = '';

    // MODUL MĂNUȘĂ (testul din 02.08, după-amiaza): în mers, lista de 7 rânduri nu se
    // poate nici citi, nici nimeri. Peste 20 km/h se arată UN singur buton uriaș cu
    // boxul cel mai plauzibil, plus „LISTA COMPLETĂ" pentru cazul rar.
    if (M.speedKmh > 20 && !bpDeschide._fortatLista) {
      const cands = machine.boxuriApropiate(7);
      if (cands.length) {
        // Sugestia preferă boxurile MARCATE (TC, probe, viraje, giratorii): pilotul
        // apasă la repere fizice, nu la „reper — drum drept". Pe 02.08 poziția crezută
        // era 5,17 și butonul a sugerat box 11 („reper", 5,07) în loc de TC-ul de
        // final (box 12, 5,35) — unde era mașina de fapt.
        const marcat = c => c.box.flag != null || (c.box.dir && c.box.dir !== 'ÎNAINTE');
        const pool = cands.filter(c => marcat(c) && Math.abs(c.deltaM) < 450);
        const alege = (pool.length ? pool : cands)
          .reduce((a, c) => Math.abs(c.deltaM) < Math.abs(a.deltaM) ? c : a);
        const c = alege;
        const mare = document.createElement('button');
        mare.className = 'btn ok bp-mare';
        mare.textContent = `✓ SUNT LA BOX ${c.box.num}`;
        mare.addEventListener('click', () => bpAlege(c.box.num));
        const alt = document.createElement('button');
        alt.className = 'btn sec';
        alt.textContent = 'LISTA COMPLETĂ…';
        alt.addEventListener('click', () => {
          bpDeschide._fortatLista = true;
          bpDeschide();
          bpDeschide._fortatLista = false;
        });
        lista.append(mare, alt);
        bp.classList.remove('hidden');
        return;
      }
    }
    const apropiate = machine.boxuriApropiate(7);
    if (apropiate.length) {
      let mi = 0;
      apropiate.forEach((c, i) => { if (Math.abs(c.deltaM) < Math.abs(apropiate[mi].deltaM)) mi = i; });
      apropiate[mi].celMaiApropiat = true;
    }
    $('bp-num').value = '';
    for (const c of apropiate) {
      const semn = c.deltaM >= 0 ? '+' : '−';
      const dist = Math.abs(c.deltaM) >= 1000
        ? (Math.abs(c.deltaM) / 1000).toFixed(2) + ' km' : Math.abs(c.deltaM) + ' m';
      // textContent, nu innerHTML: `comment` vine din scanarea Vision a unui roadbook —
      // document EXTERN. Un comentariu cu HTML (ajung 44 de caractere pentru un overlay
      // fullscreen pe style inline, pe care CSP-ul îl permite) s-ar randa fix în modalul
      // de corecție, fix când e deschis în probă. Confirmat la auditul din 02.08.2026, P2.
      const btn = document.createElement('button');
      // Evidențiat = boxul cel mai APROPIAT, nu „următorul așteptat" (audit, #16):
      // butonul se apasă când ești LA un box; dacă poziția a driftat înainte,
      // nextBoxIdx a trecut deja mai departe și recomanda un salt în direcția greșită.
      btn.className = 'btn bp-item' + (c.celMaiApropiat ? ' pri' : ' sec');
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
    if (!r) {
      // box inexistent: feedback pe loc, nu modal mut (audit, #24)
      $('bp-ctx').textContent = `boxul ${num} nu există în leg-ul ăsta`;
      return;
    }
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
  $('bp-go')?.addEventListener('click', () => {
    const n = parseInt($('bp-num').value, 10);
    if (isFinite(n)) bpAlege(n);
  });
  // REPETĂ (propunerea 5): re-rostește ultimul anunț — remediul ieftin pentru
  // „n-am auzit ce-a zis", care la un pilot singur e momentul în care se greșește.
  // ── harta traseului ──────────────────────────────────────────────────────
  $('btn-harta')?.addEventListener('click', incarcaHarta);
  $('btn-harta-clear')?.addEventListener('click', async () => {
    if (!confirm('Ștergi harta traseului?')) return;
    await store.put('harta', null);
    await rebuildPlan();
    $('prep-harta-st').textContent = 'Harta a fost ștearsă.';
  });

  // ── ieșirea de pe traseu ─────────────────────────────────────────────────
  const cbOff = $('set-offroute');
  if (cbOff) {
    cbOff.checked = offRoutePornit();
    cbOff.addEventListener('change', () => {
      localStorage.setItem('r2_offroute', cbOff.checked ? '1' : '0');
      if (machine) machine.setOffRoute(cbOff.checked);
    });
  }
  $('btn-offroute')?.addEventListener('click', () => {
    if (!machine) return;
    if (machine.M.offRoute) machine.offRouteRevenit();
    else machine.offRouteManual();
    ui.render(machine.M, plan);
  });
  $('btn-repeat')?.addEventListener('click', () => {
    if (!voice.repeat()) voice.say('Nimic de repetat încă.', 2);
  });
  $('btn-talk').addEventListener('click', () => {
    const ears = makeEars({ onCommand: c => {
      if (c.cmd === 'at_box') {
        // Pe voce nu se execută corecții mari: recunoașterea vocală greșește un
        // număr mult mai ușor decât un deget greșește un buton dintr-o listă.
        const r = machine.atBox(c.num);
        if (r !== true && r) {
          // corecție mare pe voce: se deschide DIRECT modalul cu bannerul de
          // confirmare pentru boxul cerut — versiunea veche trimitea „confirmă pe
          // ecran" către un ecran care nu conținea boxul (audit, #6, fundătura)
          voice.say(`Boxul ${c.num} te-ar muta ${Math.abs(r.deltaM)} metri. Confirmă pe ecran.`, 3, 'sync');
          bpDeschide();
          bpAlege(c.num);
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
  // Ștergerea roadbook-ului NU mai ia geometria cu ea din reflex. Măsurat în jurnalul
  // din 04.08: la 10:54 s-au scanat 6 pagini și TOATE cele 24 de boxuri au intrat ca
  // „noi", adică depozitul era gol — singurul drum care-l golește e butonul ăsta, care
  // ștergea în aceeași apăsare și `recon`, și `rt_speeds`. O rescanare a roadbook-ului
  // (lucru normal dimineața) arunca deci recunoașterea făcută cu o zi înainte, tăcut.
  $('btn-clear-rb').addEventListener('click', async () => {
    if (!confirm('Ștergi roadbook-ul scanat și vitezele probelor?')) return;
    boxesRaw = []; await store.del('plan_raw'); await store.del('rt_speeds');
    const harta = reconNormalize(await store.get('recon'), plan.legKey);
    const legi = Object.keys(harta.legs || {});
    if (legi.length) {
      const rez = legi.map(k => {
        const s = reconStatus(harta.legs[k]);
        return `${k.replace('|', '/')}: ${s.km.toFixed(2)} km, ${s.ancore} ancore`;
      }).join('\n');
      if (confirm(`Ștergi ȘI recunoașterea?\n\n${rez}\n\nOK = șterg geometria · Anulează = o păstrez`)) {
        await store.del('recon');
        try { store.log('recon_sters', { legi }, Date.now()); } catch (e) {}
      } else {
        try { store.log('recon_pastrat', { legi }, Date.now()); } catch (e) {}
      }
    }
    await rebuildPlan();
  });
  $('btn-recon').addEventListener('click', startRecon);
  $('btn-rec-mark').addEventListener('click', reconMark);
  $('btn-rec-stop').addEventListener('click', reconStop);
  $('btn-rehearse').addEventListener('click', rehearse);
  $('btn-export').addEventListener('click', doExport);
  $('btn-import').addEventListener('click', doImport);
  $('btn-replay')?.addEventListener('click', replayDay);
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
