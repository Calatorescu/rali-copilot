// RALI 2 · main.js — cablajul: leagă modulele, ține meniul parcat, pornește cursa.

import { makeClock } from './time.js';
import { buildTrace } from './geo.js';
import { makeStore, makeMemStore, exportDay, importDay, resumeStateFromJournal } from './store.js';
import { makeVoice, makeEars, secRo } from './voice.js';
import { makeLiveGps, makeSyntheticGps, makeReplayGps } from './gps.js';
import { buildPlan, detectRts, sanitizeBoxes, groupByLeg, verifyRoadbook,
         reconNormalize, reconPentruLeg, reconPune, reconStatus,
         reconRecupereaza, verificaHarta, hartaPentruLeg, coerentaHarta,
         normFlags, areFlag, esteStart, esteFinish, legKey,
         rezumatVerificare, propuneCorecturiProbe, frazaSemneCuratate,
         normVitezaSalvata, imbinaBuletin } from './route.js';
import { makeMachine } from './machine.js';
import { makeDriverModel } from './learn.js';
import { makeUi, startHeaderClock } from './ui.js';
import { scanRoadbookPage, scanTimeCard, scanBulletin, faColectorPoze, MAX_POZE } from './scan.js';
import { makeBleSpeed } from './ble.js';
import { repereBoxuri, faGeocoder, geocodeazaRepere, verificaAncore,
         poartaPlauzibilitate, reperEDoarDrum } from './repere.js';
import { linkuriTraseu, linkNavigare } from './maps.js';
import { makeSync } from './sync.js';
import { efficiencyPoints, efficiencyGap } from './pace.js';
import { makeHartaEcran, testeazaDale } from './harta-ecran.js';

const $ = id => document.getElementById(id);
let store, clock, voice, ui, driver, machine = null, gps = null, plan = null, sync = null;
let boxesRaw = [], reconRec = null;
// starea recunoașterii pentru leg-ul activ, calculată în rebuildPlan și afișată în
// panoul de pregătire — pilotul trebuie s-o vadă ÎNAINTE de START, nu s-o deducă din
// comportament (04.08.2026: două zile de test fără geometrie, fără ca nimic s-o spună)
let reconStare = null, reconDraftMesaj = null;
// motivul pentru care harta stocata a fost respinsa la construirea planului (daca a fost)
let hartaIncoerenta = null;

// Versiunea build-ului — se ține SINCRON cu CACHE din sw.js la fiecare deploy.
// Vizibilă în antet și scrisă în jurnal la fiecare pornire: „ce versiune rulează
// telefonul?" se citește, nu se ghicește (02.08, seara — nu se putea ști).
const BUILD = 'v43';

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
  // STOCARE PERSISTENTĂ (audit, 05.08.2026). Când telefonul rămâne fără spațiu, Chrome
  // nu evacuează selectiv „ce e mai puțin important" — evacuează PE ORIGINE, adică
  // tot ce ține aplicația: dalele de hartă, dar în aceeași mișcare și IndexedDB, adică
  // JURNALUL CURSEI. Cererea asta îi spune browserului că datele nu sunt de unică
  // folosință. Poate fi refuzată, și atunci nu se schimbă nimic — de-aia e tăcută.
  try { navigator.storage && navigator.storage.persist && await navigator.storage.persist(); }
  catch (e) {}
}

let _audioCtx = null;
function audioCtx() { return () => (_audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)()); }

// Detectarea ieșirii de pe traseu: PORNITĂ implicit, cum a cerut Andreas. Se poate opri
// din panoul de pregătire — o singură dată, nu la fiecare pornire.
function offRoutePornit() { return localStorage.getItem('r2_offroute') !== '0'; }

// NIMIC NU SCHIMBĂ MAȘINA SUB O CURSĂ PORNITĂ (găsit la curățenia de după audit,
// 05.08.2026). `rebuildPlan` construiește o mașină de stări NOUĂ — cu poziția 0, fără
// rezultate, fără proba în curs. Iar ea e chemată la capătul unor operații care durează
// ZECI DE SECUNDE și se pot termina oricând: scanarea unei pagini de roadbook (cerere la
// Anthropic), căutarea reperelor pe hartă (o cerere pe secundă, ~20 de repere), citirea
// unui fișier de hartă. Dacă vreuna se încheie după START — sau dacă se apasă din reflex
// un buton din pregătire în timp ce ziua rulează — cursa se șterge în tăcere: kilometraj
// la zero, probe nealergate, ceas pierdut.
// Datele se salvează oricum (sunt deja în depozit); doar mașina nu se înlocuiește, iar
// omul află de ce. `fortat` e pentru locurile care CHIAR trebuie s-o schimbe: trecerea
// la leg-ul următor, întoarcerea de la repetiție și de la redarea jurnalului.
let _amanatRebuild = false;
function cursaRuleaza() { return !!machine && machine.M.state !== 'PREP'; }

async function rebuildPlan(fortat) {
  if (!fortat && cursaRuleaza()) {
    _amanatRebuild = true;
    try { store.log('rebuild_amanat', { state: machine.M.state, routeKm: machine.M.routeKm }, Date.now()); } catch (e) {}
    const st = $('prep-scan-st');
    if (st) {
      st.textContent = '⚠ Cursa e pornită — datele s-au salvat, dar planul se schimbă abia la următorul START.';
      st.style.color = 'var(--warn)';
    }
    return;
  }
  _amanatRebuild = false;
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
  let hartaLeg = hartaPentruLeg(hartaTot, cheia);
  // PLASA DE SIGURANȚĂ: harta stocată se verifică față de kilometrajul roadbook-ului
  // ACTIV, la fiecare construire de plan. Coordonatele stau legate de cheia de leg, iar
  // cheia e aproape mereu „1|1" — o hartă rămasă de la alt eveniment arată perfect
  // valabilă ca formă. Dacă nu se potrivește cu drumul, nu intră în plan deloc.
  if (hartaLeg && g) {
    const c = coerentaHarta(hartaLeg, g.boxes);
    if (!c.ok) {
      try { store.log('harta_incoerenta', { leg: cheia, probleme: c.probleme }, Date.now()); } catch (e) {}
      hartaLeg = null;
      hartaIncoerenta = c.probleme[0] || 'nu se potrivește cu kilometrajul';
    } else hartaIncoerenta = null;
  } else hartaIncoerenta = null;
  // Buletinul Directorului de cursă, dacă a fost fotografiat: el DEFINEȘTE probele
  // (start, medie, schimbări de medie, finiș), iar roadbook-ul nu le conține deloc —
  // boxurile 66, 97 și 104 de la Reșița n-au nici icoană, nici comentariu. Când
  // buletinul produce probe pe legul activ, ele bat semnele citite din icoane.
  const buletin = (await store.get('buletin')) || null;
  plan = buildPlan(g ? g.boxes : [], speeds, reconStare.ok ? rec : null, hartaLeg, buletin);
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
      .reduce((n, gr) => n + gr.boxes.filter(b => areFlag(b, 'TC')).length, 0);
    machine.setTcSchedule(tcs.slice(tcOff));
  }
  // Curățenia semnelor care nu mai decid nimic (v39). Se face DUPĂ ce planul e construit,
  // fiindcă abia atunci se știe de unde vin probele; dacă a schimbat ceva, planul se
  // reconstruiește o singură dată, peste boxurile curate. La a doua trecere n-are ce mai
  // curăța, deci recursia se oprește acolo.
  if (await curataSemneleCareNuDecid()) return rebuildPlan(fortat);
  renderPrep();
  ui.render(machine.M, plan);
}

function renderPrep() {
  // starea hărții: câte boxuri din leg-ul activ au coordonate, spus înainte de START
  const hEl = $('prep-harta');
  if (hEl) {
    const n = plan.harta ? Object.keys(plan.harta).length : 0;
    const total = plan.boxes.length;
    hEl.textContent = hartaIncoerenta
      ? `Hartă: RESPINSĂ — ${hartaIncoerenta}`
      : n
        ? `Hartă: DA — ${n} din ${total} boxuri cu coordonate` +
          (n < total ? ' (restul cad pe kilometraj)' : '')
        : 'Hartă: — (fără ea nu știu unde e boxul dacă greșești drumul)';
  }
  // TRASEUL PE GOOGLE MAPS: linkuri gata făcute, de deschis pe telefon. Aplicația
  // noastră nu rutează nimic — dă punctele și lasă Maps să conducă.
  const mw = $('prep-maps');
  if (mw) {
    mw.textContent = '';
    const ancore = plan.harta
      ? plan.boxes.filter(b => plan.harta[b.num])
          .map(b => ({ num: b.num, sumKm: b.sumKm, flags: b.flags, ...plan.harta[b.num] }))
      : [];
    for (const l of linkuriTraseu(ancore)) {
      const a = document.createElement('a');
      a.className = 'btn sec'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = `📍 ${l.eticheta}`;
      mw.appendChild(a);
    }
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
        await salveazaViteza(rt.key, v);   // păstrează schimbările de medie deja puse
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
      // Avertismentele despre semnele de probă se sting când probele vin din buletin:
      // ele descriu tot niște icoane care nu mai cronometrează nimic, iar un avertisment
      // care nu cere nicio faptă e doar zgomot înainte de start. Restul verificărilor —
      // kilometraj, numerotare, boxuri mute — rămân aprinse.
      const v = verifyRoadbook(boxesRaw, { probeleVinDinBuletin: plan.sursaProbe === 'buletin' });
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
  renderBuletin();
  renderProbe();
  renderRecon();
}

// ── BULETINUL PE ECRAN ──────────────────────────────────────────────────────
// Cifrele, apoi ce NU s-a putut rezolva. Regula, aceeași ca peste tot în aplicație:
// ce nu se poate deduce se SPUNE, nu se ghicește. Un finiș „înainte de boxul 66" e
// cronometrat la kilometrajul boxului 66 fiindcă alt reper nu există — dar dacă asta
// nu scrie pe ecran, Andreas crede că are o precizie pe care n-o are.
const CULOARE_NOTA = { nelegat: 'var(--bad)', aproximare: 'var(--warn)',
                       de_mana: 'var(--warn)', info: '' };

function renderBuletin() {
  const el = $('prep-buletin');
  if (!el) return;
  el.textContent = '';
  const cifre = $('prep-buletin-cifre');
  const b = plan && plan.buletin;
  if (!b) {
    if (cifre) {
      cifre.textContent = 'Buletin: — · probele vin din semnele de start/finiș citite în roadbook';
      cifre.style.color = '';
    }
    return;
  }
  if (cifre) {
    cifre.textContent =
      `Buletin: ${b.total} ${b.total === 1 ? 'probă citită' : 'probe citite'} · ` +
      `${b.inLeg} pe ${plan.legLabel || 'legul activ'} · ${b.legate} legate de boxuri · ` +
      `${b.boxuriPotrivite} din ${b.boxuriCerute} boxuri găsite în roadbook`;
    cifre.style.color = b.legate ? 'var(--ok)' : 'var(--warn)';
  }
  const cine = document.createElement('p');
  cine.className = 'line';
  const dinBuletin = plan.sursaProbe === 'buletin';
  cine.style.color = dinBuletin ? 'var(--ok)' : 'var(--warn)';
  cine.textContent = dinBuletin
    ? `Probele vin din BULETIN (${b.legate}) — el bate semnele de start/finiș citite în roadbook.`
    : 'Buletinul n-a produs nicio probă pe legul ăsta — probele rămân cele din semnele roadbook-ului.';
  el.appendChild(cine);

  if (dinBuletin) for (const rt of plan.rts) el.appendChild(randBuletinProba(rt));

  for (const n of b.note) {
    const p = document.createElement('p');
    p.className = 'line' + (n.tip === 'info' ? ' dim' : '');
    p.style.color = CULOARE_NOTA[n.tip] || '';
    // textContent: nota citează text venit din poza unui document extern
    p.textContent = (n.tip === 'info' ? 'ℹ ' : '⚠ ') + n.text;
    el.appendChild(p);
  }
}

const km2 = v => v.toFixed(2).replace('.', ',');

function randBuletinProba(rt) {
  const rand = document.createElement('div');
  rand.className = 'probe-rand';
  const sb = plan.boxes[rt.startIdx], fb = plan.boxes[rt.finishIdx];
  const cap = document.createElement('p');
  cap.className = 'line';
  const tare = document.createElement('b');
  tare.textContent = `${rt.name} · ${km2(rt.distKm)} km · ` +
    (rt.type === 'standing' ? 'de pe loc' : 'din mers');
  cap.appendChild(tare);
  rand.appendChild(cap);

  const det = document.createElement('p');
  det.className = 'line dim';
  const REL = { at: 'LA', before: 'ÎNAINTE de', after: 'DUPĂ' };
  det.textContent =
    `start boxul ${sb ? sb.num : '?'} (${km2(rt.startKm)} km) → ` +
    `finiș ${REL[rt.finishRel || 'at']} boxul ${fb ? fb.num : '?'} (${km2(rt.finishKm)} km) · ` +
    (rt.kmh != null ? `medie ${String(rt.kmh).replace('.', ',')} km/h` : 'FĂRĂ MEDIE');
  rand.appendChild(det);

  if (rt.segments && rt.segments.length > 1) {
    const seg = document.createElement('p');
    seg.className = 'line';
    seg.style.color = 'var(--ok)';
    seg.textContent = 'schimbări de medie: ' + rt.schimbari
      .map(s => `${String(s.kmh).replace('.', ',')} km/h de la boxul ${s.box} ` +
                `(${km2(s.fromKm)} km de la start)`).join(' · ');
    rand.appendChild(seg);
  }
  return rand;
}

// ── EDITAREA MANUALĂ A PROBELOR ─────────────────────────────────────────────
// De ce există, măsurat pe roadbook-ul REAL de la Reșița (Leg 2, 05.08.2026, 14 pagini):
// scanarea a citit corect toate cele 120 de boxuri și toate kilometrele, dar din patru
// semne de probă a ratat TREI linii de finish (boxurile 64, 66, 97) și a inventat una
// (boxul 108). Aplicația a dedus o singură probă, 62,12 → 71,51 = 9,39 km, în locul celor
// trei din buletin (8,89 · 6,26 · 8,87): TR2 și TR3 dispăreau cu totul, iar TR4 s-ar fi
// cronometrat pe 9,39 km în loc de 8,87 — adică exact partea care dă punctele ar fi
// lucrat cu cifre false.
//
// Promptul s-a întărit (vezi scan.js), modelul de date s-a reparat (un box poate purta
// mai multe semne), dar niciuna din cele două nu garantează nimic pe un roadbook nou.
// Singurul lucru care garantează e ca omul să poată corecta în douăzeci de secunde,
// stând în parcare, cu roadbook-ul de hârtie în mână. Asta face cardul ăsta.
const _probeExtra = new Set();          // boxuri deschise manual, fără semn de probă

function cheieViteza(b) { return `${b.num}_${Math.round(b.sumKm * 100)}`; }

// ── VITEZELE PUSE DE MÂNĂ, cu schimbări de medie ────────────────────────────
// `rt_speeds` ținea, sub cheia probei, UN NUMĂR. Rămâne valabil: telefoanele de până azi
// au forma aia scrisă în depozit și tot aia se scrie mai departe pentru probele cu medie
// constantă. Când proba are o schimbare de medie („de la boxul 97, 20,5 km/h" — cazul
// TR4 din buletinul de la Reșița), sub aceeași cheie se scrie { kmh, schimbari }.
// Citirea trece prin normVitezaSalvata, care înțelege ambele forme.
//
// Scrierile trec toate pe aici dintr-un motiv: până acum fiecare loc scria direct
// `speeds[key] = v`, ceea ce ar fi ȘTERS tăcut schimbarea de medie la prima corectare a
// vitezei de bază.
async function salveazaViteza(key, kmh, schimbari) {
  const speeds = (await store.get('rt_speeds')) || {};
  const cur = normVitezaSalvata(speeds[key]);
  const k = kmh === undefined ? cur.kmh : kmh;
  const s = schimbari === undefined ? cur.schimbari : schimbari;
  if (k == null && !s.length) delete speeds[key];
  else speeds[key] = s.length ? { kmh: k, schimbari: s } : k;
  await store.put('rt_speeds', speeds);
  return speeds[key];
}

async function vitezaSalvata(key) {
  return normVitezaSalvata(((await store.get('rt_speeds')) || {})[key]);
}

async function puneSchimbare(key, box, kmh) {
  const cur = await vitezaSalvata(key);
  const s = cur.schimbari.filter(x => x.box !== box)
                         .concat([{ box, kmh }])
                         .sort((a, b) => a.box - b.box);
  await salveazaViteza(key, undefined, s);
  try { store.log('flag_manual', { ce: 'schimbare_viteza', cheie: key, box, kmh }, Date.now()); } catch (e) {}
  await rebuildPlan();
}

async function scoateSchimbare(key, box) {
  const cur = await vitezaSalvata(key);
  await salveazaViteza(key, undefined, cur.schimbari.filter(x => x.box !== box));
  try { store.log('flag_manual', { ce: 'schimbare_stearsa', cheie: key, box }, Date.now()); } catch (e) {}
  await rebuildPlan();
}

function renderProbe() {
  const wrap = $('prep-probe');
  if (!wrap) return;
  wrap.textContent = '';
  const rez = $('probe-rezumat');
  if (rez) {
    const n = plan.rts.length;
    rez.textContent = n
      ? `${n} ${n === 1 ? 'probă' : 'probe'} ` +
        `(din ${plan.sursaProbe === 'buletin' ? 'BULETIN' : 'semnele roadbook-ului'}): ` +
        plan.rts.map(r => `${r.name} ${r.distKm.toFixed(2)} km` +
                          (r.kmh != null ? ` la ${r.kmh}` : ' FĂRĂ VITEZĂ') +
                          (r.segments && r.segments.length > 1
                            ? ` → ${r.segments.slice(1).map(s => s.kmh).join(' → ')}` : '')).join(' · ')
      : 'Nicio probă detectată — dacă roadbook-ul are, adaug-o mai jos.';
    rez.style.color = n && plan.rts.every(r => r.kmh != null) ? 'var(--ok)' : 'var(--warn)';
  }
  renderPropuneri();
  if (!plan.boxes.length) return;
  // boxurile care CHIAR poartă o probă din planul activ intră în listă chiar dacă n-au
  // nicio icoană: cu probele venite din buletin, startul și finișul sunt boxuri normale
  // în roadbook (66, 97, 104 la Reșița n-au nici icoană, nici comentariu)
  const dinPlan = new Set();
  for (const r of plan.rts) { dinPlan.add(plan.boxes[r.startIdx]); dinPlan.add(plan.boxes[r.finishIdx]); }
  const relevante = plan.boxes.filter(b => esteStart(b) || esteFinish(b) || dinPlan.has(b) ||
                                           (b.num != null && _probeExtra.has(b.num)));
  if (!relevante.length) {
    const p = document.createElement('p');
    p.className = 'line dim';
    p.textContent = 'Niciun box cu semn de probă. Caută boxul după număr, mai jos, ca să-i pui unul.';
    wrap.appendChild(p);
    return;
  }
  for (const b of relevante) wrap.appendChild(randProba(b));
}

// ── PROPUNERILE DE CORECTURĂ ────────────────────────────────────────────────
// Ce vede omul în parcare: cifrele verificării, avertismentul că propunerile sunt
// DEDUSE (nu citite de pe hârtie), apoi un rând pe corectură, cu motivul scris pe
// românește și un buton. Aplicarea trece prin comutaFlag — aceeași cale ca apăsarea
// manuală a unui semn: scrie în plan_raw, lasă urmă în jurnal, reconstruiește planul.
// Niciun ocol, deci nimic nu se poate aplica fără să se vadă seara în jurnal.
const NUME_SEMN = { RT_START_AUTO: 'START din mers', RT_START_STANDING: 'START oprit',
                    RT_FINISH: 'FINISH' };

function renderPropuneri() {
  const wrap = $('probe-propuneri');
  if (!wrap) return;
  wrap.textContent = '';
  if (!plan || !plan.boxes.length) return;

  // ── CAZUL 1: PROBELE VIN DIN BULETIN ──────────────────────────────────────
  // Semnele din roadbook nu decid nimic, deci nu se cere nicio decizie: nici buton, nici
  // galben, nici cifre despre probe deduse din icoane. O propoziție, în limbaj de om,
  // care spune ce s-a curățat singur și de ce n-a fost nimic de hotărât.
  if (plan.sursaProbe === 'buletin') {
    const c = _curatate.get(plan.legKey);
    const p = document.createElement('p');
    p.className = 'line';
    p.style.color = 'var(--ok)';
    p.textContent = c ? frazaSemneCuratate(c)
      : 'Probele vin din buletin. Semnele de start și de finiș din roadbook nu ' +
        'cronometrează nimic, deci n-ai ce hotărî aici.';
    wrap.appendChild(p);
    return;
  }

  // ── CAZUL 2: FĂRĂ BULETIN — SEMNELE CHIAR DECID ───────────────────────────
  // Aici corecturile rămân PROPUNERI cu buton: răspunsul schimbă ce se cronometrează,
  // deci hotărăște omul, cu roadbook-ul de hârtie în mână.
  const rez = rezumatVerificare(plan.boxes);

  const cifre = document.createElement('p');
  cifre.className = 'line';
  // Aceleași cifre ca înainte, spuse în propoziții (v39). Vechea formă — „3 starturi
  // scrise, 5 marcate · 8 finișuri fără probă deschisă" — cerea să știi ce înseamnă
  // „probă deschisă" ca s-o poți citi.
  cifre.textContent =
    `Roadbook-ul scrie ${rez.declarate} ${rez.declarate === 1 ? 'start de probă' : 'starturi de probă'} ` +
    `în text, iar pe boxuri sunt desenate ${rez.marcate}. ` +
    (rez.orfane ? `${rez.orfane} ${rez.orfane === 1 ? 'semn de finiș nu închide' : 'semne de finiș nu închid'} ` +
                  `nicio probă. ` : '') +
    `Așa cum e acum, ies ${rez.probeAcum} ${rez.probeAcum === 1 ? 'probă' : 'probe'}` +
    (rez.propuneri.length ? `; cu corecturile de mai jos ar ieși ${rez.probeDupa}.` : '.');
  cifre.style.color = rez.propuneri.length ? 'var(--warn)' : 'var(--ok)';
  wrap.appendChild(cifre);

  if (!rez.propuneri.length) return;

  const avert = document.createElement('p');
  avert.className = 'line dim';
  avert.textContent = 'Corecturile de mai jos sunt DEDUSE din comentariile scanate, nu ' +
    'citite de pe hârtie. Hotărăște buletinul de la organizator — citește fiecare rând ' +
    'și aplică doar ce se potrivește cu el. Unde se TERMINĂ o probă nu scrie în ' +
    'roadbook, deci aplicația nu propune niciodată un finiș nou: acela se pune de mână.';
  wrap.appendChild(avert);

  for (const p of rez.propuneri) wrap.appendChild(randPropunere(p));

  const jos = document.createElement('div');
  jos.className = 'row';
  const toate = document.createElement('button');
  toate.className = 'btn sm danger';
  toate.textContent = `Aplică toate (${rez.propuneri.length})`;
  toate.addEventListener('click', async () => {
    const n = rez.propuneri.length;
    const scoase = rez.propuneri.filter(p => p.actiune === 'scoate').length;
    if (!confirm(`Aplic toate cele ${n} corecturi?\n\n` +
                 `${scoase} semne scoase, ${n - scoase} adăugate.\n` +
                 `${rez.probeAcum} probe acum → ${rez.probeDupa} după.\n\n` +
                 `Se poate reveni oricând, apăsând semnele box cu box.`)) return;
    toate.disabled = true;
    // secvențial și prin comutaFlag: fiecare corectură se salvează și se jurnalizează
    // separat, ca la debrief să se vadă exact ce s-a schimbat și când
    for (const p of rez.propuneri) await comutaFlag(p.box, p.flag);
  });
  jos.appendChild(toate);
  wrap.appendChild(jos);
}

function randPropunere(p) {
  const rand = document.createElement('div');
  rand.className = 'probe-rand';
  const cap = document.createElement('p');
  cap.className = 'line';
  const tare = document.createElement('b');
  tare.textContent = `box ${p.box.num != null ? p.box.num : '?'} · ` +
    `${p.box.sumKm.toFixed(2)} km · ${p.actiune === 'adauga' ? '+' : '−'} ` +
    `${NUME_SEMN[p.flag] || p.flag}`;
  tare.style.color = p.actiune === 'adauga' ? 'var(--ok)' : 'var(--warn)';
  cap.appendChild(tare);
  rand.appendChild(cap);
  const motiv = document.createElement('p');
  motiv.className = 'line dim';
  // textContent, nu innerHTML: motivul citează comentariul scanat, adică text extern
  motiv.textContent = p.motiv;
  rand.appendChild(motiv);
  const r = document.createElement('div');
  r.className = 'row';
  const btn = document.createElement('button');
  btn.className = 'btn sm ' + (p.actiune === 'adauga' ? 'ok' : 'sec');
  btn.textContent = 'Aplică';
  btn.addEventListener('click', () => comutaFlag(p.box, p.flag));
  r.appendChild(btn);
  rand.appendChild(r);
  return rand;
}

function randProba(b) {
  const rand = document.createElement('div');
  rand.className = 'probe-rand';
  const cap = document.createElement('p');
  cap.className = 'line';
  const tare = document.createElement('b');
  tare.textContent = `box ${b.num != null ? b.num : '?'} · ${b.sumKm.toFixed(2)} km`;
  cap.appendChild(tare);
  // textContent, nu innerHTML: comentariul vine din scanarea unui document EXTERN
  const com = document.createElement('span');
  com.className = 'dim';
  com.textContent = b.comment ? ' · ' + b.comment.slice(0, 46) : '';
  cap.appendChild(com);
  rand.appendChild(cap);

  const butoane = document.createElement('div');
  butoane.className = 'row';
  const SEMNE = [
    { f: 'RT_START_AUTO', txt: '🏁 START din mers' },
    { f: 'RT_START_STANDING', txt: '❄ START oprit' },
    { f: 'RT_FINISH', txt: '🔲 FINISH' }
  ];
  for (const s of SEMNE) {
    const activ = areFlag(b, s.f);
    const btn = document.createElement('button');
    btn.className = 'btn sm ' + (activ ? (s.f === 'RT_FINISH' ? 'danger' : 'ok') : 'sec');
    btn.textContent = (activ ? '✓ ' : '') + s.txt;
    btn.addEventListener('click', () => comutaFlag(b, s.f));
    butoane.appendChild(btn);
  }
  rand.appendChild(butoane);

  // Viteza se cere pe boxurile de START: cele marcate cu icoană ȘI cele pe care
  // buletinul le declară start, chiar dacă în roadbook n-au niciun semn.
  const rt = plan.rts.find(r => plan.boxes[r.startIdx] === b);
  if (esteStart(b) || rt) {
    const r2 = document.createElement('div');
    r2.className = 'row';
    const et = document.createElement('span');
    et.className = 'line dim'; et.textContent = 'viteza probei:';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.placeholder = 'km/h'; inp.min = 5; inp.max = 120; inp.step = 0.1;
    inp.style.maxWidth = '110px';
    if (rt && rt.kmh != null) inp.value = rt.kmh;
    inp.addEventListener('change', async () => {
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (!(isFinite(v) && v >= 5 && v <= 120)) return;
      await salveazaViteza(cheieViteza(b), v);
      try { store.log('flag_manual', { ce: 'viteza', boxNum: b.num, km: b.sumKm, kmh: v }, Date.now()); } catch (e) {}
      await rebuildPlan();
    });
    r2.append(et, inp);
    rand.appendChild(r2);

    // ── SCHIMBAREA DE MEDIE ÎN INTERIORUL PROBEI ──────────────────────────
    // Buletinul de la Reșița o dă în două feluri: legată de un BOX (TR4: 20,5 km/h la
    // boxul 97) sau legată de un LOC (TR6: 45 km/h „la ieșirea din localitatea Văliug").
    // A doua nu se poate transforma singură în kilometraj — omul se uită pe roadbook,
    // vede la ce box e ieșirea din Văliug și o scrie aici. De-asta câmpul cere un BOX.
    const cheie = cheieViteza(b);
    const puse = (rt && rt.schimbari) ? rt.schimbari : [];
    for (const s of puse) {
      const r = document.createElement('div');
      r.className = 'row';
      const t = document.createElement('span');
      t.className = 'line';
      t.style.color = 'var(--ok)';
      t.textContent = `de la boxul ${s.box} (${km2(s.fromKm)} km de la start) → ` +
                      `${String(s.kmh).replace('.', ',')} km/h`;
      const x = document.createElement('button');
      x.className = 'btn danger sm';
      x.textContent = '✕';
      x.addEventListener('click', () => scoateSchimbare(cheie, s.box));
      r.append(t, x);
      rand.appendChild(r);
    }
    const r3 = document.createElement('div');
    r3.className = 'row';
    const et3 = document.createElement('span');
    et3.className = 'line dim'; et3.textContent = 'schimbare de medie: de la boxul';
    const inBox = document.createElement('input');
    inBox.type = 'number'; inBox.placeholder = 'box'; inBox.min = 1; inBox.max = 999;
    inBox.inputMode = 'numeric'; inBox.style.maxWidth = '90px';
    const et4 = document.createElement('span');
    et4.className = 'line dim'; et4.textContent = 'viteza';
    const inKmh = document.createElement('input');
    inKmh.type = 'number'; inKmh.placeholder = 'km/h'; inKmh.min = 5; inKmh.max = 120; inKmh.step = 0.1;
    inKmh.style.maxWidth = '90px';
    const pune = document.createElement('button');
    pune.className = 'btn sm sec';
    pune.textContent = 'PUNE';
    pune.addEventListener('click', async () => {
      const nb = parseInt(String(inBox.value), 10);
      const nv = parseFloat(String(inKmh.value).replace(',', '.'));
      if (!(isFinite(nb) && nb >= 1 && nb <= 999) || !(isFinite(nv) && nv >= 5 && nv <= 120)) {
        alert('Scrie numărul boxului de la care se schimbă media și viteza nouă (km/h).');
        return;
      }
      inBox.value = ''; inKmh.value = '';
      await puneSchimbare(cheie, nb, nv);
    });
    r3.append(et3, inBox, et4, inKmh, pune);
    rand.appendChild(r3);
  }
  return rand;
}

// Comutarea unui semn. Se scrie în boxurile BRUTE (sursa adevărului, cea salvată), se
// jurnalizează cu starea de dinainte și de după, apoi planul se reconstruiește — deci
// verificatorul și lista de probe se recalculează singure.
// `opt.motiv` (v39) — curățenia automată de mai jos trece pe AICI, nu pe lângă: scrie în
// aceleași boxuri, salvează în același depozit și lasă aceeași urmă `flag_manual`, doar
// cu un motiv care spune că n-a apăsat nimeni. `opt.faraRebuild` există ca cele N semne
// să se aplice într-o singură reconstruire de plan, nu în N reconstruiri imbricate.
async function comutaFlag(box, flag, opt = {}) {
  const b = boxesRaw.find(x => x === box) ||
            boxesRaw.find(x => legKey(x) === plan.legKey && x.num === box.num &&
                               Math.abs(x.sumKm - box.sumKm) < 0.005);
  if (!b) return;
  const inainte = normFlags(b);
  const dupa = normFlags({ flags: inainte.includes(flag)
    ? inainte.filter(f => f !== flag) : [...inainte, flag], comment: b.comment });
  b.flags = dupa;
  b.flag = dupa.length ? dupa[0] : null;      // terenul derivat, ținut sincron
  // rândul rămâne pe ecran și după ce l-ai golit — dar numai dacă L-AI GOLIT TU. Semnele
  // curățate automat nu lasă în urmă un rând de editat: n-au cerut nicio decizie.
  if (b.num != null && !opt.motiv) _probeExtra.add(b.num);
  await store.put('plan_raw', boxesRaw);
  try { store.log('flag_manual', { ce: 'semn', boxNum: b.num, km: b.sumKm,
                                   leg: plan.legKey, inainte, dupa,
                                   auto: !!opt.motiv, motiv: opt.motiv || null }, Date.now()); } catch (e) {}
  if (!opt.faraRebuild) await rebuildPlan();
}

// ── CURĂȚENIA TĂCUTĂ, CÂND SEMNELE NU MAI DECID NIMIC (v39) ─────────────────
// 06.08.2026, măsurat pe telefonul lui Andreas, în ziua dinaintea cursei: probele veneau
// din buletin (`plan.sursaProbe === 'buletin'`), deci semnele de start/finiș citite din
// roadbook nu mai cronometrau nimic — ecranul chiar scria asta. Și totuși aplicația îi
// cerea, cu două butoane roșii „Aplică" și un „Aplică toate (2)", să hotărască în parcare
// soarta unor icoane care nu schimbau NIMIC în cursă.
//
// Regula, de-aici încolo: aplicația cere o decizie DOAR când răspunsul chiar schimbă
// rezultatul. Când nu-l schimbă, curăță singură și spune într-o propoziție ce a făcut.
//
// DE CE E PERMIS SĂ SE APLICE SINGUR, deși peste tot altundeva nimic nu se aplică singur:
// pentru că NU SE ATINGE NIMIC DIN CE DECIDE REZULTATUL CURSEI. Probele — start, medie,
// schimbări de medie, finiș — vin din buletin și rămân neatinse; aici se șterg doar niște
// icoane citite greșit dintr-o poză, care nu mai intră în niciun calcul. Regula întreagă
// sună așa: NU SCHIMB SINGUR CE CRONOMETREAZĂ; CURĂȚ LIBER CE NU CRONOMETREAZĂ.
const _curatate = new Map();   // legKey → { scoase, adaugate, boxuri }
let _curatenieInCurs = false;
// Plasa de siguranță: curățenia cheamă rebuildPlan, iar rebuildPlan cheamă curățenia.
// În mod normal se oprește din prima — a doua trecere peste boxurile curate nu mai are
// ce propune (verificat în test-propuneri.mjs, „corectura e stabilă"). Dar un roadbook
// pe care corecturile ar oscila ar îngheța aplicația în parcare, deci runda a treia
// oprește lucrul și lasă urmă în jurnal. Pragul se scrie ÎNAINTE, nu după (legea 8).
const MAX_RUNDE_CURATENIE = 3;
const _rundeCuratenie = new Map();   // legKey → câte runde s-au consumat

// Roadbook nou = curățenie nouă. Fără linia asta, propoziția „am scos 12 semne" ar
// rămâne pe ecran peste un roadbook scanat după ea, iar plafonul de runde consumat pe
// roadbook-ul vechi ar bloca curățenia celui nou. Se cheamă oriunde se schimbă boxesRaw.
function uitaCuratenia() { _curatate.clear(); _rundeCuratenie.clear(); }

async function curataSemneleCareNuDecid() {
  if (_curatenieInCurs) return false;
  if (!plan || plan.sursaProbe !== 'buletin' || !plan.boxes.length) return false;
  const runde = _rundeCuratenie.get(plan.legKey) || 0;
  const props = propuneCorecturiProbe(plan.boxes);
  if (!props.length) return false;
  if (runde >= MAX_RUNDE_CURATENIE) {
    // Am curățat de trei ori și tot mai iese ceva de curățat: nu mai insist, altfel se
    // învârte la nesfârșit. Semnele rămase nu cronometrează nimic oricum. Se scrie o
    // singură dată în jurnal, nu la fiecare reconstruire de plan.
    if (runde === MAX_RUNDE_CURATENIE) {
      _rundeCuratenie.set(plan.legKey, runde + 1);
      try { store.log('curatenie_oprita', { leg: plan.legKey, runde,
        ramase: props.map(p => p.box.num) }, Date.now()); } catch (e) {}
    }
    return false;
  }
  _rundeCuratenie.set(plan.legKey, runde + 1);
  _curatenieInCurs = true;
  try {
    const motiv = 'probele vin din buletin — semnul din roadbook nu cronometrează nimic';
    for (const p of props) await comutaFlag(p.box, p.flag, { motiv, faraRebuild: true });
    const scoase = props.filter(p => p.actiune === 'scoate').length;
    const strans = _curatate.get(plan.legKey) || { scoase: 0, adaugate: 0, boxuri: [] };
    strans.scoase += scoase;
    strans.adaugate += props.length - scoase;
    strans.boxuri = strans.boxuri.concat(props.map(p => p.box.num).filter(n => n != null));
    _curatate.set(plan.legKey, strans);
    try { store.log('semne_curatate_automat',
      { leg: plan.legKey, scoase, adaugate: props.length - scoase,
        boxuri: props.map(p => p.box.num) }, Date.now()); } catch (e) {}
  } finally { _curatenieInCurs = false; }
  return true;
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
async function startDay(dinPreluare) {
  // dacă s-a terminat o scanare/geocodare cât timp rula cursa, planul nou a fost pus
  // deoparte (vezi rebuildPlan) — START-ul e exact momentul în care are voie să intre
  if (_amanatRebuild) await rebuildPlan(true);
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
    // O PROBĂ FĂRĂ VITEZĂ e aproape întotdeauna o eroare de scanare, nu o probă reală:
    // în tura de la 21:48 (04.08.2026) o icoană citită greșit pe boxul 1 a produs o
    // probă-fantomă fără viteză, iar pilotul a auzit „Pornit. 2 probe, 1 fără viteză"
    // și „START probă" chiar la Time Control-ul de plecare. Aplicația spunea adevărul —
    // dar la 21:48:18, în mers, nu la parcare. De-acum întreabă înainte, cu boxul în
    // clar, fiindcă asta se repară în 10 secunde stând pe loc.
    const fara = plan.rts.filter(r => r.kmh == null);
    if (fara.length) {
      const lista = fara.map(r => `${r.name}: boxurile ${plan.boxes[r.startIdx].num}→${plan.boxes[r.finishIdx].num}, ` +
                                  `${r.distKm.toFixed(2)} km`).join('\n');
      if (!confirm(`ATENȚIE: ${fara.length} probă/e FĂRĂ VITEZĂ:\n\n${lista}\n\n` +
                   `O probă fără viteză e de obicei o icoană citită greșit la scanare — ` +
                   `verifică boxurile de mai sus în roadbook.\n\n` +
                   `Aplicația o va SĂRI. Pornim oricum?`)) return;
    }
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
  await rebuildPlan(true);  // offset-ul TC pe leg se derivă în rebuildPlan · fortat: schimbarea de leg E scopul
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
    await rebuildPlan(true); // înapoi la mașina de cursă, curată (fantoma trebuie înlocuită)
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
    rebuildPlan(true);       // mașina-fantomă pe jumătate pornită se înlocuiește oricum
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
    rebuildPlan(true);       // idem: fantoma nu are voie să rămână mașina zilei
  }
}

// ── scanări ─────────────────────────────────────────────────────────────────
// `capture` deschide DIRECT camera din spate. Atenție: atributul IGNORĂ `multiple` —
// o deschidere, o poză. De-aia calea cu cameră are buclă (vezi fotoBucla), iar galeria
// rămâne pentru cazul în care pozele există deja și se aleg toate deodată.
function suportaCamera() {
  return 'capture' in document.createElement('input');
}

// PLAFONUL TĂCUT DE 12, SCOS (05.08.2026). Andreas a fotografiat 14 pagini, a apăsat
// scanare, au intrat 12. Aici era, într-un singur `slice(0, 12)`: două pagini aruncate
// fără o vorbă. La Sibiu, cu un roadbook oficial de zeci de pagini, asta însemna condus
// cu jumătate de traseu, cu convingerea că e tot. E aceeași clasă de defect cu „scanarea
// parțială care trece drept succes", reparată pe 02.08 și comentată la 30 de rânduri mai
// jos — rămăsese o a doua cale prin care conținutul dispare în tăcere.
//
// De ce era acolo, cel mai probabil: `Promise.all` citea TOATE fișierele în base64
// DEODATĂ. 30 de poze de telefon înseamnă peste 100 MB de șiruri în memorie, adică o
// filă omorâtă de Android. Asta era cauza — deci se repară cauza, nu se taie lista:
// `pickImages` întoarce acum FIȘIERE (nimic citit, memorie zero), iar conversia în base64
// se face în bucla de scanare, pentru pagina curentă, și se eliberează după trimitere.
// Nicio limită de număr, nicăieri pe drumul ăsta.
function pickImages(multiple, cb, capture) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  if (capture) inp.capture = 'environment';
  else if (multiple) inp.multiple = true;
  window.addEventListener('focus', () => setTimeout(() => inp.remove(), 1000), { once: true });
  inp.onchange = () => {
    inp.remove();
    cb([...(inp.files || [])]);
  };
  document.body.appendChild(inp); inp.click();
}

// O SINGURĂ poză, citită când îi vine rândul. Șirul base64 trăiește cât ține cererea.
function citestePoza(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res({ b64: String(r.result).split(',')[1], mime: f.type || 'image/jpeg' });
    r.onerror = () => rej(new Error('poza nu s-a putut citi de pe telefon'));
    r.readAsDataURL(f);
  });
}

// ── FOTOGRAFIEREA ROADBOOK-ULUI, în buclă ───────────────────────────────────
// La Sibiu roadbook-ul vine tipărit, cu o oră înainte de start: 25-40 de pagini de pozat
// una câte una. Fără bucla asta, fiecare pagină înseamnă un drum dus-întors prin meniu.
// Scanarea propriu-zisă NU se dublează — pozele adunate intră prin exact același drum
// de cod ca cele alese din galerie (scaneazaPozele).
const colector = faColectorPoze();

function fotoBucla(mesaj) {
  const box = $('foto-bucla'), nr = $('foto-nr');
  if (!box) return;
  box.classList.toggle('hidden', colector.total === 0);
  if (nr) nr.textContent = (mesaj ? mesaj + ' ' : '') +
    (colector.total ? `${colector.total} ${colector.total === 1 ? 'pagină' : 'pagini'} de scanat.` : '');
  const inca = $('btn-foto-inca');
  if (inca) inca.disabled = colector.total >= MAX_POZE;
}

function fotografiazaPagina() {
  // fișiere, nu conținut: pozele stau nedeschise până le vine rândul la scanare
  pickImages(false, fisiere => {
    const r = colector.adauga(fisiere);
    fotoBucla(r.mesaj);
  }, true);
}

async function doScanRoadbook() {
  pickImages(true, fisiere => scaneazaPozele(fisiere));
}

// CÂTE PAGINI SE SCANEAZĂ: se spune ÎNAINTE, cu cifra, și se confirmă. Nu există plafon
// care taie — dar există o confirmare, fiindcă fiecare pagină e o cerere de zeci de
// secunde: 40 de pagini înseamnă vreo 10 minute în care telefonul trebuie lăsat în pace.
// O selecție greșită (tot albumul) se vede aici, în cifre, nu după ce a pornit.
const PRAG_CONFIRMARE_PAGINI = 15;
const SECUNDE_PE_PAGINA = 15;

async function scaneazaPozele(fisiere) {
  const key = localStorage.getItem('r2_key');
  if (!key) { alert('Pune cheia API în Setări.'); return; }
  const imgs = (fisiere || []).filter(Boolean);
  if (!imgs.length) return;
  if (imgs.length >= PRAG_CONFIRMARE_PAGINI) {
    const min = Math.max(1, Math.round(imgs.length * SECUNDE_PE_PAGINA / 60));
    if (!confirm(`${imgs.length} pagini selectate.\n\n` +
                 `Se scanează TOATE, una câte una — durează aproximativ ` +
                 `${min} ${min === 1 ? 'minut' : 'minute'}. ` +
                 `Ține telefonul deschis până la bilanțul final.\n\nÎncepem?`)) return;
  }
  const st = $('prep-scan-st');
  st.style.color = '';
  // numărul selectat, pe ecran, ÎNAINTE de prima cerere: „14 din 14" la final nu
  // înseamnă nimic dacă nu se știe de la ce s-a plecat
  st.textContent = `${imgs.length} ${imgs.length === 1 ? 'pagină selectată' : 'pagini selectate'}. Încep scanarea…`;
  const all = [...boxesRaw];
  // Rezultatul FIECĂREI pagini se ține minte și se arată la final. Pe 02.08, două
  // pagini din trei au căzut, dar eroarea era suprascrisă de „Scanez pagina 3/3…"
  // și finalul arăta „✓ 4 boxuri" — a arătat a succes și s-a condus cu o treime
  // de roadbook. O scanare parțială e un EȘEC, nu un succes mai mic.
  const rezultate = [];
  for (let i = 0; i < imgs.length; i++) {
    st.textContent = `Scanez pagina ${i + 1} din ${imgs.length}…`;
    // poza se citește ABIA ACUM și trăiește doar cât ține cererea: aici era cauza
    // plafonului de 12 (toate în memorie deodată), deci aici se repară
    let poza = null;
    try {
      poza = await citestePoza(imgs[i]);
      const boxes = await scanRoadbookPage(key, poza.b64, poza.mime);
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
    poza = null;       // șirul base64 al paginii se eliberează înainte de următoarea
    try { store.log('scan_page', rezultate[rezultate.length - 1], Date.now()); } catch (e) {}
  }
  all.sort((a, b) => a.sumKm - b.sumKm);
  boxesRaw = all;
  uitaCuratenia();
  await store.put('plan_raw', boxesRaw);
  // ROADBOOK NOU = HARTĂ VECHE, ARUNCATĂ. Coordonatele sunt legate de boxuri prin
  // numărul lor și prin cheia de leg, iar cheia e aproape mereu „1|1": fără linia
  // asta, boxul 4 al evenimentului de azi ar moșteni coordonata boxului 4 de acum
  // două săptămâni și ar hrăni paznicul de direcție și ieșirea de pe traseu — în
  // cursă, cu date de pe alt traseu. Se caută din nou pe hartă, e un buton.
  const hartaVeche = await store.get('harta');
  if (hartaVeche && Object.keys(hartaVeche).length) {
    await store.del('harta');
    try { store.log('harta_stearsa', { legi: Object.keys(hartaVeche), cum: 'scanare nouă' }, Date.now()); } catch (e) {}
  }
  // ȘI BULETINUL, DIN ACELAȘI MOTIV (audit, 05.08.2026, înainte de publicarea v38).
  // Butonul „Ștergi roadbook-ul" ȘTIA deja regula asta și o scria în comentariu — dar
  // calea de scanare o sărea. Buletinul definește probele prin numărul boxului și al
  // paginii, iar amândouă repornesc la fiecare leg. Rămas peste un roadbook nou, ar fi
  // pus proba „TR 2" la 44,8 km/h pe alt drum, și ar fi BĂTUT semnele citite corect din
  // roadbook (`sursaProbe === 'buletin'`) — deci probele adevărate ar fi dispărut. Tăcut,
  // până se uita cineva pe ecran. Se refotografiază, sunt două poze.
  const buletinVechi = await store.get('buletin');
  if (buletinVechi && buletinVechi.length) {
    await store.del('buletin');
    try { store.log('buletin_sters', { probe: buletinVechi.length, cum: 'scanare nouă' }, Date.now()); } catch (e) {}
  }
  await rebuildPlan();
  const cazute = rezultate.filter(r => !r.ok);
  // O ștergere tăcută e tot o pierdere de date. Dacă buletinul a plecat, se SPUNE, în
  // aceeași propoziție cu bilanțul — altfel Andreas pleacă la drum crezând că are probele.
  const notaBuletin = (buletinVechi && buletinVechi.length)
    ? ` · ⚠ buletinul vechi (${buletinVechi.length} probe) a fost șters — refotografiază-l`
    : '';
  const detaliu = rezultate.map(r => r.ok ? `p${r.pag} ✓${r.boxuri}` : `p${r.pag} ✗`).join(' · ');
  if (cazute.length) {
    st.textContent = `⚠ AU CĂZUT ${cazute.length} PAGINI DIN ${imgs.length} — refotografiază-le! ` +
      `${detaliu} · ${cazute.map(c => `p${c.pag}: ${c.err}`).join(' · ')}` + notaBuletin;
    st.style.color = 'var(--bad)';
    alert(`Scanarea NU e completă: ${cazute.length} pagini din ${imgs.length} au căzut.\n\n` +
          cazute.map(c => `pagina ${c.pag}: ${c.err}`).join('\n') +
          `\n\nRefotografiază paginile căzute și scanează-le din nou — restul rămân.` +
          (notaBuletin ? `\n\nBuletinul probelor a fost șters odată cu roadbook-ul vechi — refotografiază-l și pe el.` : ''));
  } else {
    // BILANȚUL, negru pe alb: „14 din 14 pagini scanate". Cifra selectată și cifra
    // scanată trebuie să se poată compara dintr-o privire — asta e verificarea care
    // ar fi prins pe loc plafonul tăcut de 12.
    st.textContent = `✓ ${rezultate.length} din ${imgs.length} pagini scanate · ${detaliu} → ` +
      `${boxesRaw.length} boxuri, ${detectRts(boxesRaw).length} probe` + notaBuletin;
    st.style.color = notaBuletin ? 'var(--warn)' : 'var(--ok)';
  }
  try { store.log('scan_bilant', { selectate: imgs.length, scanate: rezultate.length,
    reusite: rezultate.filter(r => r.ok).length, cazute: cazute.length,
    boxuri: boxesRaw.length }, Date.now()); } catch (e) {}
}

// ── BULETINUL DIRECTORULUI DE CURSĂ, fotografiat ────────────────────────────
// Cale NOUĂ, paralelă cu roadbook-ul. Același colector de poze (același plafon, același
// contor, aceleași mesaje), dar propria lui instanță: o pagină de buletin nu are voie
// să ajungă niciodată în teancul roadbook-ului, nici invers.
// Buletinul e bilingv și are câteva pagini, deci se adună și se citesc la rând, iar
// rezultatele se ÎMBINĂ peste ce e deja citit (vezi imbinaBuletin) — se poate fotografia
// o pagină acum și restul peste zece minute.
const colectorBuletin = faColectorPoze({ max: 8 });

function buletinBucla(mesaj) {
  const box = $('buletin-bucla'), nr = $('buletin-nr');
  if (!box) return;
  box.classList.toggle('hidden', colectorBuletin.total === 0);
  if (nr) nr.textContent = (mesaj ? mesaj + ' ' : '') +
    (colectorBuletin.total ? `${colectorBuletin.total} ${colectorBuletin.total === 1 ? 'pagină' : 'pagini'} de citit.` : '');
}

function fotografiazaBuletin() {
  pickImages(false, fisiere => {
    const r = colectorBuletin.adauga(fisiere);
    buletinBucla(r.mesaj);
  }, true);
}

async function scaneazaBuletin(fisiere) {
  const key = localStorage.getItem('r2_key');
  if (!key) { alert('Pune cheia API în Setări.'); return; }
  const imgs = (fisiere || []).filter(Boolean);
  if (!imgs.length) return;
  const st = $('prep-buletin-st');
  st.style.color = '';
  st.textContent = `${imgs.length} ${imgs.length === 1 ? 'pagină selectată' : 'pagini selectate'}. Citesc buletinul…`;
  let probe = (await store.get('buletin')) || [];
  const rezultate = [], conflicte = [];
  for (let i = 0; i < imgs.length; i++) {
    st.textContent = `Citesc pagina ${i + 1} din ${imgs.length}…`;
    let poza = null;
    try {
      poza = await citestePoza(imgs[i]);
      const noi = await scanBulletin(key, poza.b64, poza.mime);
      const im = imbinaBuletin(probe, noi);
      probe = im.probe;
      conflicte.push(...im.conflicte);
      rezultate.push({ pag: i + 1, ok: true, probe: noi.length, total: probe.length });
    } catch (e) {
      rezultate.push({ pag: i + 1, ok: false, err: e.message,
                       raw: e.raw || null, rawLen: e.rawLen || null, stop: e.stop || null });
    }
    poza = null;
    try { store.log('scan_buletin', rezultate[rezultate.length - 1], Date.now()); } catch (e) {}
  }
  await store.put('buletin', probe);
  await rebuildPlan();
  const cazute = rezultate.filter(r => !r.ok);
  const detaliu = rezultate.map(r => r.ok ? `p${r.pag} ✓${r.probe}` : `p${r.pag} ✗`).join(' · ');
  const nume = probe.map(p => p.name || `box ${p.startBox}`).join(', ');
  if (cazute.length) {
    st.textContent = `⚠ AU CĂZUT ${cazute.length} PAGINI DIN ${imgs.length} — refotografiază-le! ` +
      `${detaliu} · ${cazute.map(c => `p${c.pag}: ${c.err}`).join(' · ')}`;
    st.style.color = 'var(--bad)';
  } else {
    st.textContent = `✓ ${rezultate.length} din ${imgs.length} pagini citite · ${detaliu} → ` +
      `${probe.length} ${probe.length === 1 ? 'probă' : 'probe'} în buletin: ${nume}`;
    st.style.color = 'var(--ok)';
  }
  // contradicțiile dintre română și engleză NU se ascund: câmpul a fost golit, iar
  // omul trebuie să-l pună de mână
  if (conflicte.length) {
    st.textContent += ' · ' + conflicte.join(' · ');
    st.style.color = 'var(--warn)';
  }
  try { store.log('scan_buletin_bilant', { selectate: imgs.length,
    reusite: rezultate.filter(r => r.ok).length, cazute: cazute.length,
    probe: probe.length, conflicte: conflicte.length }, Date.now()); } catch (e) {}
}

async function doScanTimecard(cuCamera) {
  const key = localStorage.getItem('r2_key');
  if (!key) { alert('Pune cheia API în Setări.'); return; }
  pickImages(false, async fisiere => {
    if (!fisiere.length) return;
    const st = $('prep-tc-st'); st.textContent = 'Citesc time card-ul…';
    try {
      const poza = await citestePoza(fisiere[0]);
      const tcs = await scanTimeCard(key, poza.b64, poza.mime);
      await store.put('tc_schedule', tcs);
      await rebuildPlan();                  // maparea pe leg-ul activ, cu offset derivat
      st.textContent = '✓ ' + tcs.map(t => `${t.name} ${t.time}`).join(' · ');
    } catch (e) { st.textContent = '✗ ' + e.message; }
  }, cuCamera);
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
  uitaCuratenia();
        // preluarea de pe alt telefon ÎNLOCUIEȘTE ziua — asta e chiar ce s-a cerut,
        // iar starea reală se pune imediat după, din jurnal (machine.resume)
        await rebuildPlan(true);
        const st = resumeStateFromJournal(await store.journalAll());
        await startDay(true);    // preluare: poziția vine din jurnal, nu de la boxul 1
        machine.resume(st);
      } catch (e) { alert('Import eșuat: ' + e.message); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ── HARTA DIN ROADBOOK: repere → geocodare → ancore ─────────────────────────
// Cererea lui Andreas (04.08.2026): la Sibiu roadbook-ul vine tipărit de la organizator,
// deci nimeni nu ne dă coordonate. Dar comentariile LUI conțin adrese — „Dreapta pe Str.
// Avram Imbroane". Butonul ăsta le caută pe hartă, o dată, acasă, și le leagă de boxuri.
// Poziția de ACUM, o singură dată, pentru poarta de plauzibilitate. Rămâne în telefon:
// nu pleacă spre niciun serviciu (vezi fluxul de date din repere.js — spre Nominatim
// pleacă doar șiruri de adresă). Dacă nu vine în 6 secunde, se merge fără ea.
function pozitiaAcum(timeoutMs = 6000) {
  return new Promise(res => {
    if (!(typeof navigator !== 'undefined' && navigator.geolocation)) return res(null);
    let gata = false;
    const t = setTimeout(() => { if (!gata) { gata = true; res(null); } }, timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
        p => { if (!gata) { gata = true; clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude }); } },
        () => { if (!gata) { gata = true; clearTimeout(t); res(null); } },
        { enableHighAccuracy: false, maximumAge: 300000, timeout: timeoutMs });
    } catch (e) { if (!gata) { gata = true; clearTimeout(t); res(null); } }
  });
}

async function gasesteTraseulPeHarta() {
  const st = $('prep-harta-st');
  const btn = $('btn-geocod');
  if (!plan.boxes.length) { st.textContent = 'Întâi scanează roadbook-ul.'; return; }
  const localitate = ($('set-localitate').value || '').trim();
  if (localitate) localStorage.setItem('r2_localitate', localitate);
  // Localitatea scrisă de om ÎNLOCUIEȘTE ce s-a dedus din text — nu se adaugă peste.
  // Se dă mai departe, în construcția reperelor, tocmai ca nimic dedus să nu apuce să se
  // lipească de ele. (06.08.2026: se lipea, și ieșea „Piața Mică, Zonă Pietonală, Sibiu".)
  const r = repereBoxuri(plan.boxes.map(b => ({ ...b, comment: b.comment })),
                         { localitate });
  const loc = r.localitate;
  // FĂRĂ LOCALITATE NU SE CAUTĂ NIMIC (06.08.2026). Până azi se căuta oricum, cu o notă
  // pe ecran — iar „DJ 691" fără oraș a nimerit în Wisconsin, la 7933 km, pe 11 boxuri
  // deodată. Nota pe ecran n-a oprit nimic, fiindcă nu era o oprire. Acum e.
  if (!loc) {
    st.textContent = 'Scrie întâi localitatea traseului — fără ea caut în toată lumea ' +
                     'și pot nimeri altă țară. (Ultima dată, fără localitate, am nimerit în SUA.)';
    st.style.color = 'var(--warn)';
    try { $('set-localitate').focus(); } catch (e) {}
    return;
  }
  st.style.color = '';
  const repere = r.repere;
  // Reperele care sunt DOAR un număr de drum nu se mai întreabă deloc: „DJ 691" e o linie
  // de zeci de kilometri, nu un punct, iar răspunsul ar cădea identic pe toate boxurile.
  const doarDrum = repere.filter(x => x.reper && reperEDoarDrum(x.reper, loc));
  const deCautat = repere.filter(x => x.reper && !reperEDoarDrum(x.reper, loc));
  const cuReper = deCautat.length;
  if (!cuReper) {
    st.textContent = doarDrum.length
      ? `Niciun box n-are un reper căutabil: toate cele ${doarDrum.length} sunt doar numere ` +
        `de drum (${doarDrum[0].reper}), iar un număr de drum e o linie lungă, nu un punct.`
      : 'Niciun box n-are un reper căutabil în comentariu.';
    return;
  }
  btn.disabled = true;
  // poziția se cere ÎNAINTE de căutare, ca poarta de plauzibilitate s-o aibă la final.
  // Se spune pe ecran de ce apare cererea de locație — altfel pare că aplicația vrea
  // ceva ce n-a cerut niciodată până acum, exact în seara dinaintea cursei.
  st.textContent = 'Îmi cer poziția o clipă, ca să pot verifica dacă punctele găsite ' +
                   'sunt în zona ta (rămâne în telefon, nu pleacă nicăieri)…';
  const fix = await pozitiaAcum();
  st.textContent = `Caut ${cuReper} repere în ${loc}…`;
  const geo = faGeocoder({});
  let rez;
  try {
    rez = await geocodeazaRepere(deCautat, geo, {
      onPas: (i, n) => { st.textContent = `Caut… ${i} din ${n}`; },
      onReincercare: (k, n) => { st.textContent = `Mai încerc o dată, cu numele scurt… ${k} din ${n}`; }
    });
  } catch (e) {
    st.textContent = 'Fără internet — căutarea pe hartă merge doar cu semnal.';
    btn.disabled = false; return;
  }
  // POARTA DE PLAUZIBILITATE, PRIMA. Abia ce trece de ea intră în discuția despre
  // kilometraj — altfel un punct la 7933 km, însoțit de zece copii ale lui, câștigă
  // discuția aia și aruncă ancorele corecte (măsurat, 06.08.2026).
  const kms = plan.boxes.map(b => b.sumKm).filter(Number.isFinite);
  const legKm = kms.length ? Math.max(...kms) - Math.min(...kms) : null;
  const p = poartaPlauzibilitate(rez.ancore, { fix, legKm });
  // ancorele care contrazic kilometrajul se aruncă (o „Str. Turda" din alt oraș)
  const v = verificaAncore(p.bune.map(a => ({ ...a, flags: (plan.boxes.find(b => b.num === a.num) || {}).flags })));
  const harta = {};
  // doar boxurile CU numar: sanitizeBoxes lasa num:null pentru randurile pe care
  // scanarea nu le-a putut numerota, iar toate ar ajunge sub aceeasi cheie „null"
  // incertitudinea ancorei calatoreste cu ea: verificarea geometrica din masina o
  // aduna la prag, ca eroarea unui centru de strada sa nu fie citita ca abatere
  for (const a of v.bune) if (Number.isFinite(a.num))
    harta[a.num] = Number.isFinite(a.incM) ? { lat: a.lat, lng: a.lng, incM: a.incM }
                                           : { lat: a.lat, lng: a.lng };
  const tot = (await store.get('harta')) || {};
  tot[plan.legKey] = harta;
  await store.put('harta', tot);
  try {
    store.log('geocodare', { leg: plan.legKey, localitate: loc || null,
      cerute: cuReper, gasite: rez.ancore.length, pastrate: v.bune.length,
      cuFix: !!fix, legKm: legKm != null ? Math.round(legKm * 100) / 100 : null,
      sarite_drum: doarDrum.map(x => ({ num: x.num, reper: x.reper })).slice(0, 20),
      neplauzibile: p.aruncate.map(a => ({ num: a.num, motiv: a.motiv })).slice(0, 20),
      aruncate: v.aruncate.map(a => ({ num: a.num, motiv: a.motiv })),
      ratate: rez.ratate.slice(0, 20) }, clock.rally());
  } catch (e) {}
  await rebuildPlan();
  btn.disabled = false;
  // CE VEDE ANDREAS. Ancorele căzute nu se mai rezumă la o cifră: dacă harta a rămas
  // goală sau subțire, el trebuie să afle DE CE, în cuvinte, ca să poată decide dacă
  // pleacă fără hartă (stare sigură, deja gestionată) sau mai încearcă o dată.
  const bucati = [`Ancore la ${v.bune.length} din ${plan.boxes.length} boxuri`];
  if (doarDrum.length) bucati.push(`${doarDrum.length} sărite (doar număr de drum — o linie lungă, nu un punct)`);
  if (p.aruncate.length) bucati.push(`${p.aruncate.length} aruncate ca imposibile`);
  if (v.aruncate.length) bucati.push(`${v.aruncate.length} aruncate (nu se potriveau cu kilometrajul)`);
  if (rez.ratate.length) bucati.push(`${rez.ratate.length} fără răspuns`);
  let text = bucati.join(' · ');
  if (p.aruncate.length) text += '\nDe ce: ' + p.aruncate.slice(0, 2).map(a => `boxul ${a.num} — ${a.motiv}`).join(' · ');
  if (!v.bune.length) text += '\nHarta a rămas goală. Poți porni și fără ea: cursa merge normal, ' +
                              'doar că nu-ți pot spune unde e boxul dacă greșești drumul.';
  st.textContent = text;
  st.style.color = v.bune.length ? '' : 'var(--warn)';
  renderPrep();
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

// ── HARTA VIE ───────────────────────────────────────────────────────────────
// Ecranul cu dale, linia traseului și punctul meu. Are bucla LUI de desen (vezi
// harta-ecran.js) — mașina de stări nu-l cheamă niciodată, deci nicio dală lentă nu
// poate întârzia un fix GPS. Se oprește la ieșirea de pe ecran, la stingerea ecranului
// și la începutul oricărei probe.
let harta = null, hartaInfoId = null;

function hartaVie() {
  if (harta) return harta;
  const cv = $('map-canvas');
  if (!cv) return null;
  harta = makeHartaEcran({
    canvas: cv,
    stare: () => ({ M: machine ? machine.M : null, plan }),
    onProba: () => { if (!$('scr-map').classList.contains('hidden')) showScreen('run'); },
    log: (t, d) => { try { store.log(t, d, clock.rally()); } catch (e) {} }
  });
  return harta;
}

// Butonul care predă ghidajul lui Google Maps, pe ecranul de hartă. Ținta o alege
// mașina de stări (are firimiturile și harta) — aici doar se scrie pe buton.
function legaButonMaps(el) {
  const t = machine.tintaMaps ? machine.tintaMaps() : null;
  const link = t ? linkNavigare(t.pct) : null;
  el.classList.toggle('hidden', !link);
  if (!link) return;
  el.href = link;
  el.textContent = (t.deCe === 'offroute' ? '🧭 MAPS ÎNAPOI LA BOXUL ' : '🧭 MAPS PÂNĂ LA BOXUL ') +
                   t.boxNum + (t.aproximativa ? ' (punct aproximativ)' : '');
}

// banda de sus și rândul de sub hartă: ce vezi și CÂT DE BUN e ce vezi
function renderHartaInfo() {
  if (!harta) return;
  const i = harta.info() || {};
  const el = $('map-info');
  if (el) el.textContent = i.text || '';
  const b = $('map-banner');
  if (b) {
    if (i.faraDale) {
      b.textContent = '⚠ fără fundal de hartă (fără semnal sau server refuzat) — ' +
                      'rămân linia traseului, boxurile și poziția ta';
      b.className = 'mapband rau';
    } else if (i.aproximativ) {
      b.textContent = 'traseu APROXIMATIV, din adrese — linia punctată e ordinea boxurilor, ' +
                      'nu drumul dintre ele';
      b.className = 'mapband';
    } else b.className = 'mapband hidden';
  }
  const rb = $('btn-map-rot');
  if (rb) { rb.textContent = harta.rotit ? '🚗' : 'N'; rb.className = 'mbtn' + (harta.rotit ? ' on' : ''); }
  const za = $('btn-map-zauto');
  if (za) za.className = 'mbtn' + (harta.zoomFixat ? '' : ' on');
  const mb = $('btn-map-maps');
  if (mb && machine) legaButonMaps(mb);
  const un = $('map-unde');
  if (un) {
    const u = machine && machine.M.unde;
    if (u) { un.textContent = u.text; un.className = 'undeline'; }
    else un.className = 'undeline hidden';
  }
}

// ── ecrane + legături ───────────────────────────────────────────────────────
function showScreen(name) {
  for (const s of ['prep', 'run', 'map', 'recon', 'set'])
    $('scr-' + s).classList.toggle('hidden', s !== name);
  const h = harta || (name === 'map' ? hartaVie() : null);
  if (h) {
    if (name === 'map') { h.porneste(); renderHartaInfo(); } else h.opreste();
  }
  clearInterval(hartaInfoId); hartaInfoId = null;
  if (name === 'map') hartaInfoId = setInterval(renderHartaInfo, 500);
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
        const marcat = c => normFlags(c.box).length > 0 || (c.box.dir && c.box.dir !== 'ÎNAINTE');
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
  const locInp = $('set-localitate');
  if (locInp) {
    locInp.value = localStorage.getItem('r2_localitate') || '';
    locInp.addEventListener('change', () => localStorage.setItem('r2_localitate', locInp.value.trim()));
  }
  // căutarea unui box care n-are niciun semn de probă: se deschide în editor ca să i se
  // poată PUNE unul (finish-urile ratate n-au niciun semn, deci nu apar singure în listă)
  const cautaProba = () => {
    const inp = $('probe-cauta');
    const n = parseInt(inp ? inp.value : '', 10);
    if (!isFinite(n)) return;
    const b = plan.boxes.find(x => x.num === n);
    if (!b) {
      const rez = $('probe-rezumat');
      if (rez) { rez.textContent = `Boxul ${n} nu există în ${plan.legLabel || 'leg-ul activ'}.`;
                 rez.style.color = 'var(--bad)'; }
      return;
    }
    _probeExtra.add(n);
    if (inp) inp.value = '';
    renderProbe();
  };
  $('btn-probe-cauta')?.addEventListener('click', cautaProba);
  $('probe-cauta')?.addEventListener('keydown', e => { if (e.key === 'Enter') cautaProba(); });
  $('btn-geocod')?.addEventListener('click', gasesteTraseulPeHarta);
  $('btn-harta')?.addEventListener('click', incarcaHarta);
  // ── harta vie: comutarea și comenzile de pe ecran ────────────────────────
  $('btn-harta-vie')?.addEventListener('click', () => {
    if (machine && machine.M.state === 'RT_RUN') {
      voice.say('Ești în probă — harta rămâne închisă până la finish.', 2, null, 'ritm');
      return;
    }
    showScreen('map');
  });
  $('btn-map-inapoi')?.addEventListener('click', () => showScreen('run'));
  // „UNDE SUNT" — același răspuns de pe ambele ecrane, dintr-un singur loc de cod
  const undeSunt = () => { if (machine) machine.undeSunt(); renderHartaInfo(); };
  $('btn-undesunt')?.addEventListener('click', undeSunt);
  $('btn-map-undesunt')?.addEventListener('click', undeSunt);
  $('btn-map-rot')?.addEventListener('click', () => { hartaVie()?.roteste(); renderHartaInfo(); });
  $('btn-map-zin')?.addEventListener('click', () => { hartaVie()?.zoom(+1); renderHartaInfo(); });
  $('btn-map-zout')?.addEventListener('click', () => { hartaVie()?.zoom(-1); renderHartaInfo(); });
  $('btn-map-zauto')?.addEventListener('click', () => { hartaVie()?.zoomAutomat(); renderHartaInfo(); });
  // ── dalele offline ──────────────────────────────────────────────────────
  $('btn-dale-test')?.addEventListener('click', async () => {
    const st = $('prep-dale-st');
    st.textContent = 'Cer o dală de probă…';
    const r = await testeazaDale();
    st.textContent = r.text;
    st.style.color = r.ok ? 'var(--ok)' : 'var(--warn)';
    try { store.log('dale_test', { ok: r.ok, status: r.status, ms: r.ms, octeti: r.octeti || null }, Date.now()); } catch (e) {}
  });

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
  $('btn-scan-tc').addEventListener('click', () => doScanTimecard(false));
  // ── camera foto ──────────────────────────────────────────────────────────
  // Andreas fotografiază mâine roadbook-ul OFICIAL, pe hârtie. Pe Android 13+ selectorul
  // de fișiere e adesea cel de POZE al sistemului, care n-are cameră deloc — deci calea
  // spre cameră trebuie să fie un buton al ei, nu o speranță.
  const camOk = suportaCamera();
  for (const id of ['btn-scan-foto', 'btn-scan-tc-foto', 'btn-buletin-foto']) {
    const b = $(id);
    // un buton care nu poate face nimic (desktop) nu rămâne pe ecran
    if (b && !camOk) b.classList.add('hidden');
  }
  // ── buletinul probelor ───────────────────────────────────────────────────
  $('btn-buletin-foto')?.addEventListener('click', fotografiazaBuletin);
  $('btn-buletin-inca')?.addEventListener('click', fotografiazaBuletin);
  $('btn-buletin-gal')?.addEventListener('click', () => pickImages(true, f => scaneazaBuletin(f)));
  $('btn-buletin-gata')?.addEventListener('click', () => {
    const poze = colectorBuletin.poze;
    colectorBuletin.goleste();
    buletinBucla();
    scaneazaBuletin(poze);         // același drum ca pozele alese din galerie
  });
  $('btn-buletin-renunt')?.addEventListener('click', () => {
    if (!confirm(`Arunci cele ${colectorBuletin.total} poze nescanate?`)) return;
    colectorBuletin.goleste();
    buletinBucla();
  });
  $('btn-buletin-clear')?.addEventListener('click', async () => {
    if (!confirm('Ștergi buletinul citit? Probele revin la semnele din roadbook.')) return;
    await store.del('buletin');
    try { store.log('buletin_sters', {}, Date.now()); } catch (e) {}
    const st = $('prep-buletin-st');
    if (st) { st.textContent = 'Buletin șters.'; st.style.color = ''; }
    await rebuildPlan();
  });
  $('btn-scan-foto')?.addEventListener('click', fotografiazaPagina);
  $('btn-scan-tc-foto')?.addEventListener('click', () => doScanTimecard(true));
  $('btn-foto-inca')?.addEventListener('click', fotografiazaPagina);
  $('btn-foto-gata')?.addEventListener('click', () => {
    const poze = colector.poze;
    colector.goleste();
    fotoBucla();
    scaneazaPozele(poze);          // exact același drum ca pozele alese din galerie
  });
  $('btn-foto-renunt')?.addEventListener('click', () => {
    if (!confirm(`Arunci cele ${colector.total} poze nescanate?`)) return;
    colector.goleste();
    fotoBucla();
  });
  // Ștergerea roadbook-ului NU mai ia geometria cu ea din reflex. Măsurat în jurnalul
  // din 04.08: la 10:54 s-au scanat 6 pagini și TOATE cele 24 de boxuri au intrat ca
  // „noi", adică depozitul era gol — singurul drum care-l golește e butonul ăsta, care
  // ștergea în aceeași apăsare și `recon`, și `rt_speeds`. O rescanare a roadbook-ului
  // (lucru normal dimineața) arunca deci recunoașterea făcută cu o zi înainte, tăcut.
  $('btn-clear-rb').addEventListener('click', async () => {
    // Buletinul pleacă odată cu roadbook-ul: el definește probele PE BOXURILE acestui
    // roadbook. Rămas peste unul nou, ar defini probe pe boxuri cu același număr și cu
    // alt drum sub ele — aceeași clasă de defect ca harta rămasă de la alt eveniment.
    if (!confirm('Ștergi roadbook-ul scanat, buletinul probelor și vitezele?')) return;
    boxesRaw = []; uitaCuratenia();
    await store.del('plan_raw'); await store.del('rt_speeds');
    await store.del('buletin');
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
    // HARTA (coordonatele boxurilor) se întreabă la fel de explicit ca recunoașterea.
    // Cheia de leg e aproape mereu „1|1", deci o hartă rămasă de la alt eveniment s-ar
    // lipi pe boxurile roadbook-ului următor și ar hrăni paznicul de direcție și
    // ieșirea de pe traseu, ÎN CURSĂ, cu coordonate de acum două săptămâni.
    const hartaVeche = (await store.get('harta')) || {};
    const legiH = Object.keys(hartaVeche);
    if (legiH.length) {
      const rezH = legiH.map(k => `${k.replace('|', '/')}: ${Object.keys(hartaVeche[k] || {}).length} boxuri cu coordonate`).join('\n');
      if (confirm(`Ștergi ȘI harta traseului?\n\n${rezH}\n\nOK = șterg coordonatele · Anulează = le păstrez`)) {
        await store.del('harta');
        try { store.log('harta_stearsa', { legi: legiH, cum: 'la ștergerea roadbook-ului' }, Date.now()); } catch (e) {}
      } else {
        try { store.log('harta_pastrata', { legi: legiH }, Date.now()); } catch (e) {}
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
