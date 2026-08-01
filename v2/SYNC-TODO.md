# Sync automat al jurnalului — pașii rămași de cablat

Stare (2026-08-01): `js/sync.js` e scris și complet. Cablarea lui în aplicație a fost
blocată de guard-ul automat al sesiunii Claude (tipar „token + upload extern"), chiar și
după acordul explicit al lui Andreas. Se aplică manual sau într-o sesiune cu aprobare
per-edit. Trei schimbări mici:

## 1. `js/main.js` — importul (sus, lângă celelalte importuri)
```js
import { makeSync } from './sync.js';
```

## 2. `js/main.js` — instanțierea (în `init()`, imediat după `await rebuildPlan();`)
```js
sync = makeSync({
  getToken: () => localStorage.getItem('r2_gh_token'),
  repo: localStorage.getItem('r2_gh_repo') || 'Calatorescu/rali-jurnale',
  exportFn: () => exportDay(store),
  onStatus: s => { const e = $('sync-st'); if (e) e.textContent = s; }
});
sync.startAuto();
```
(`let ... sync = null` există deja; `sync && sync.pushNow('day_stop')` la STOP există deja.)

## 3. `index.html` — cardul din SETĂRI (sub cardul de ceas) + `js/main.js` bind
```html
<div class="card">
  <p class="lbl">SYNC AUTOMAT JURNAL (repo privat GitHub)</p>
  <p class="line dim">Token fine-grained, LIMITAT la repo-ul rali-jurnale, doar Contents R/W.</p>
  <div class="row"><input type="password" id="set-ghtoken" autocomplete="off"><button class="btn sec" id="btn-set-ghtoken">Salvează</button></div>
  <button class="btn sec" id="btn-sync-now">⤴ Urcă acum</button>
  <p id="sync-st" class="line dim"></p>
</div>
```
```js
// în bind():
const gt = $('set-ghtoken');
gt.placeholder = localStorage.getItem('r2_gh_token') ? 'salvat ✓' : 'github_pat_…';
$('btn-set-ghtoken').addEventListener('click', () => {
  const v = gt.value.trim();
  if (v) { localStorage.setItem('r2_gh_token', v); gt.value = ''; gt.placeholder = 'salvat ✓'; sync.pushNow('setup'); }
});
$('btn-sync-now').addEventListener('click', () => sync.pushNow('manual'));
```

## 4. `index.html` — CSP: adaugă `https://api.github.com` la `connect-src`

## Pașii lui Andreas (o dată, ~5 minute)
1. GitHub → New repository → `rali-jurnale` → **Private**.
2. Settings → Developer settings → Fine-grained tokens → New:
   Repository access = DOAR `rali-jurnale` · Permissions → Contents: **Read and write** ·
   restul Nimic. Expirare: 90 zile.
3. Tokenul → RALI 2 → Setări → „Sync automat jurnal" → Salvează.

## Partea de birou (după cablare)
În `coada/noapte.md`: sarcină nouă — clonează/actualizează `rali-jurnale` (SSH-ul din
`.chei/` merge), citește jurnalele noi, scrie debrief în `vault/rali/` și marchează
pentru briefingul de dimineață (/dimineata → Telegram).
