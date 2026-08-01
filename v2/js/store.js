// RALI 2 · store.js — jurnalul zilei + stocarea, pe IndexedDB.
//
// JURNALUL e conceptul central: fiecare eveniment (start, box, fix, rezultat, sync,
// avertisment) se scrie append-only, cu ora raliului. Ziua devine o poveste completă:
//  • re-jucabilă în simulator (orice problemă de teren se reproduce pe birou);
//  • exportabilă → al doilea telefon o importă și PREIA cursa din aceeași secundă;
//  • citibilă la debrief.
// localStorage rămâne doar pentru preferințe mărunte (temă, cheie) — urmele GPS nu
// încap acolo.

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
  const [journal, plan, speeds, recon] = await Promise.all([
    store.journalAll(), store.get('plan_raw'), store.get('rt_speeds'), store.get('recon')
  ]);
  return { _app: 'RALI2', _ver: 1, at: Date.now(), journal, plan_raw: plan || null,
           rt_speeds: speeds || null, recon: recon || null };
}

export async function importDay(store, dump) {
  if (!dump || dump._app !== 'RALI2') throw new Error('Nu e un export RALI 2');
  await store.journalClear();
  for (const e of dump.journal || []) {
    const { id, t, type, ...rest } = e;
    await store.log(type, rest, t);
  }
  if (dump.plan_raw) await store.put('plan_raw', dump.plan_raw);
  if (dump.rt_speeds) await store.put('rt_speeds', dump.rt_speeds);
  if (dump.recon) await store.put('recon', dump.recon);
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
