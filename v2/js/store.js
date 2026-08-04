// RALI 2 · store.js — jurnalul zilei + stocarea, pe IndexedDB.
//
// JURNALUL e conceptul central: fiecare eveniment (start, box, fix, rezultat, sync,
// avertisment) se scrie append-only, cu ora raliului. Ziua devine o poveste completă:
//  • re-jucabilă în simulator (orice problemă de teren se reproduce pe birou);
//  • exportabilă → al doilea telefon o importă și PREIA cursa din aceeași secundă;
//  • citibilă la debrief.
// localStorage rămâne doar pentru preferințe mărunte (temă, cheie) — urmele GPS nu
// încap acolo.

import { reconStatus, reconRecupereaza } from './route.js';

const DB = 'rali2', VER = 1;

function openDb() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('journal'))
        db.createObjectStore('journal', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv'))
        db.createObjectStore('kv');
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

export async function makeStore() {
  const db = await openDb();
  const tx = (name, mode) => db.transaction(name, mode).objectStore(name);
  const done = t => new Promise((res, rej) => {
    t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });

  return {
    // ── jurnal ──
    async log(type, data, rallyMs) {
      const st = tx('journal', 'readwrite');
      st.add({ t: rallyMs, type, ...data });
      return done(st.transaction).catch(() => {});   // jurnalul nu are voie să oprească cursa
    },
    async journalAll() {
      return new Promise((res, rej) => {
        const rq = tx('journal', 'readonly').getAll();
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    },
    async journalClear() {
      const st = tx('journal', 'readwrite'); st.clear();
      return done(st.transaction);
    },
    // ── kv (plan, urme, setări mari) ──
    async put(key, val) {
      const st = tx('kv', 'readwrite'); st.put(val, key);
      return done(st.transaction);
    },
    async get(key) {
      return new Promise((res, rej) => {
        const rq = tx('kv', 'readonly').get(key);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    },
    async del(key) {
      const st = tx('kv', 'readwrite'); st.delete(key);
      return done(st.transaction);
    }
  };
}

// Store sintetic pentru teste și pentru simulator — aceeași interfață, în memorie.
export function makeMemStore() {
  const journal = []; const kv = new Map(); let id = 0;
  return {
    journal, kv,
    async log(type, data, rallyMs) { journal.push({ id: ++id, t: rallyMs, type, ...data }); },
    async journalAll() { return [...journal]; },
    async journalClear() { journal.length = 0; },
    async put(k, v) { kv.set(k, v); },
    async get(k) { return kv.get(k); },
    async del(k) { kv.delete(k); }
  };
}

// ── export / preluare ──────────────────────────────────────────────────────
export async function exportDay(store) {
  // `recon_draft` intră și el în export: o recunoaștere întreruptă (telefon închis în
  // plin drum) e o măsurătoare făcută, iar exportul e singurul loc din care se poate
  // afla de pe birou că a existat. Vezi main.js, recupereazaDraftRecon.
  const [journal, plan, speeds, recon, tcs, draft, harta] = await Promise.all([
    store.journalAll(), store.get('plan_raw'), store.get('rt_speeds'),
    store.get('recon'), store.get('tc_schedule'), store.get('recon_draft'),
    store.get('harta')
  ]);
  return { _app: 'RALI2', _ver: 1, at: Date.now(), journal, plan_raw: plan || null,
           rt_speeds: speeds || null, recon: recon || null, tc_schedule: tcs || null,
           recon_draft: draft || null, harta: harta || null };
}

// Importul ȘTERGE jurnalul local. Până acum ștergea ÎNAINTE de orice verificare — aceeași
// clasă de defect ca incidentul deja documentat („o scriere goală poate șterge o zi de
// date"): un fișier trunchiat, un export pornit greșit sau un JSON fără `journal` lăsa în
// urmă o zi de cursă goală, ireversibil. De-acum: fără jurnal valid nu se atinge nimic,
// iar dacă fișierul are MAI PUȚINE intrări decât jurnalul local, importul se OPREȘTE și
// cere confirmare explicită, cu ambele cifre pe ecran. (Audit de securitate, 04.08.2026.)
export async function importDay(store, dump, { confirmat = false } = {}) {
  if (!dump || dump._app !== 'RALI2') throw new Error('Nu e un export RALI 2');
  if (!Array.isArray(dump.journal))
    throw new Error('Exportul n-are jurnal — nu se importă nimic');
  const local = await store.journalAll();
  if (!confirmat && dump.journal.length < local.length) {
    const e = new Error(`Fișierul are ${dump.journal.length} intrări, jurnalul local are ${local.length}`);
    e.cerConfirmare = { dinFisier: dump.journal.length, local: local.length };
    throw e;
  }
  await store.journalClear();
  for (const e of dump.journal) {
    const { id, t, type, ...rest } = e;
    await store.log(type, rest, t);
  }
  if (dump.plan_raw) await store.put('plan_raw', dump.plan_raw);   // sanitizat la încărcare
  if (dump.rt_speeds) await store.put('rt_speeds', dump.rt_speeds);
  if (dump.tc_schedule) await store.put('tc_schedule', dump.tc_schedule);
  // Geometria vine dintr-un FIȘIER, adică din conținut extern: se scrie doar ce are forma
  // pe care o citește aplicația — aceeași verificare pe care o face și panoul de pregătire.
  if (dump.recon && typeof dump.recon === 'object') {
    if (dump.recon._v === 2 && dump.recon.legs && typeof dump.recon.legs === 'object') {
      const bune = {};
      for (const [k, rec] of Object.entries(dump.recon.legs))
        if (reconStatus(rec).puncte >= 2) bune[k] = rec;
      if (Object.keys(bune).length) await store.put('recon', { _v: 2, legs: bune });
    } else if (reconStatus(dump.recon).puncte >= 2) {
      // forma veche, validă: se scrie ca atare și se migrează la încărcare, marcată
      await store.put('recon', dump.recon);
    }
  }
  if (reconRecupereaza(dump.recon_draft, null).stare !== 'gol')
    await store.put('recon_draft', dump.recon_draft);
  // Harta traseului (coordonatele boxurilor) intră ca restul, dar NU se crede pe cuvânt:
  // se scriu doar leg-urile cu forma corecta — { legKey: { num: {lat,lng} } }, numere
  // finite, in plaja Pamantului. Validarea completa, fata de roadbook, se face la
  // incarcarea in plan (route.verificaHarta); aici e granita de forma.
  if (dump.harta && typeof dump.harta === 'object' && !Array.isArray(dump.harta)) {
    const bune = {};
    for (const [k, pts] of Object.entries(dump.harta)) {
      if (!/^\d+\|\d+$/.test(k) || !pts || typeof pts !== 'object') continue;
      const ok = {};
      for (const [num, p] of Object.entries(pts)) {
        if (!/^\d{1,3}$/.test(num) || !p || typeof p !== 'object') continue;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue;
        ok[num] = Number.isFinite(p.incM) && p.incM > 0 && p.incM < 5000
          ? { lat: p.lat, lng: p.lng, incM: p.incM } : { lat: p.lat, lng: p.lng };
      }
      if (Object.keys(ok).length >= 2) bune[k] = ok;
    }
    if (Object.keys(bune).length) await store.put('harta', bune);
  }
}

// Starea de cursă reconstruită din jurnal — inima preluării pe alt telefon:
// ultimul eveniment de fiecare fel spune unde era mașina de stări.
export function resumeStateFromJournal(journal) {
  let out = { state: 'LIAISON', routeKm: 0, rtIdx: 0, rtStartRally: null, done: {} };
  for (const e of journal) {
    if (e.type === 'pos') { out.routeKm = e.routeKm; }
    else if (e.type === 'rt_start') { out.state = 'RT_RUN'; out.rtStartRally = e.t; out.rtIdx = e.rtIdx; }
    else if (e.type === 'rt_result') { out.state = 'LIAISON'; out.done[e.name] = e.pts; out.rtIdx = e.rtIdx + 1; out.rtStartRally = null; }
    else if (e.type === 'day_end') { out.state = 'DAY_END'; }
  }
  return out;
}
