// RALI 2 · harta-ecran.js — desenatorul. Ia geometria pură din harta-vie.js și o pune
// pe un canvas: dale OSM, linia traseului, markerele boxurilor, punctul meu cu con de
// direcție.
//
// TREI REGULI DE CARE ATÂRNĂ CRONOMETRAREA (partea care dă punctele):
//  1. Randarea NU stă niciodată în drumul unui fix GPS. Ecranul are bucla lui, pe
//     requestAnimationFrame, și citește starea mașinii — mașina nu-l cheamă niciodată.
//     Așa, o dală care se decodează lent nu poate întârzia proiecția pe traseu.
//  2. În probă harta se închide singură și se revine la cockpit (vezi onProba): acolo
//     contează cifra de deviere, nu drumul, iar bateria și procesorul sunt ale probei.
//  3. Când ecranul e ascuns (aplicație în fundal, telefon în buzunar), bucla se oprește
//     de tot. Harta pornită tot timpul e cel mai lacom lucru din aplicație.
//
// Ce NU face: nu rutează, nu descarcă nimic singur în cursă, nu cere nicio credențială.

import { lumePx, metriPePixel, daleVizibile, parinteDala, zoomAuto, ecranDinLume,
         traseuDinPlan, pozitiiBoxuri, urlDala, DALA_PX } from './harta-vie.js';

const CULORI = {
  fundal: '#12131a', drum: '#ff7a00', drumAprox: '#ff7a00',
  eu: '#0a84ff', con: '#0a84ff55',
  tc: '#ffd60a', start: '#30d158', finish: '#ff453a', viraj: '#ff7a00',
  reper: '#8e8e96', parcare: '#0a84ff', incarcare: '#30d158',
  urmator: '#ffffff', tinta: '#ff453a'
};

// Câte imagini de dală ținem în memoria paginii. 160 × ~60 kB decodat ≈ 10 MB — cât
// două ecrane pline la orice zoom, deci derularea nu recere nimic.
const DALE_MEM = 160;

export function makeHartaEcran({ canvas, stare, onProba = null, log = null,
                                 sablon = undefined } = {}) {
  const memo = new Map();                 // url → { img, st: 'ok'|'load'|'err' }
  let rafId = null, activa = false, ultimDesen = 0;
  let zManual = null, zCurent = 15;
  let rotit = localStorage.getItem('r2_map_nord') !== '1';   // implicit: rotită după mașină
  let daleReusite = 0, daleEsuate = 0, anuntatFaraDale = false;
  const info = {};                        // ultimul rezumat, pentru bara de sub hartă

  // ── dalele ────────────────────────────────────────────────────────────────
  // REFERRER: pagina are `meta referrer=no-referrer` (bine pentru orice altceva), dar
  // politica OSM cere ca aplicațiile să se poată identifica. `origin` trimite DOAR
  // originea (adresa publică a aplicației) — fără cale, fără parametri, deci fără nimic
  // despre cursă — și ne scoate din categoria „client anonim în masă". Dacă serverul
  // refuză oricum, ecranul trece singur pe hartă schematică (vezi `fundal`).
  function dala(url) {
    let e = memo.get(url);
    if (e) { memo.delete(url); memo.set(url, e); return e; }   // reîmprospătare LRU
    e = { img: new Image(), st: 'load' };
    e.img.referrerPolicy = 'origin';
    e.img.decoding = 'async';
    e.img.onload = () => { e.st = 'ok'; daleReusite++; };
    e.img.onerror = () => {
      // ultima încercare, pentru cazul în care service worker-ul nu controlează încă
      // pagina (prima deschidere după instalare): dala descărcată stă în Cache API și
      // se poate citi direct de aici
      dinCache(url).then(u => {
        if (!u) { e.st = 'err'; daleEsuate++; return; }
        const i2 = new Image();
        i2.onload = () => { e.img = i2; e.st = 'ok'; daleReusite++; };
        i2.onerror = () => { e.st = 'err'; daleEsuate++; };
        i2.src = u;
      });
    };
    e.img.src = url;
    memo.set(url, e);
    while (memo.size > DALE_MEM) memo.delete(memo.keys().next().value);
    return e;
  }

  async function dinCache(url) {
    try {
      if (typeof caches === 'undefined') return null;
      const c = await caches.open('rali2-dale');
      const r = await c.match(url);
      if (!r) return null;
      return URL.createObjectURL(await r.blob());
    } catch (e) { return null; }
  }

  // dala gata de desenat: ea însăși, sau un sfert din părintele ei (harta rămâne
  // corectă, doar mai neclară — vezi parinteDala)
  function gataDeDesen(d) {
    const e = dala(urlDala(d.x, d.y, d.z, sablon));
    if (e.st === 'ok') return { img: e.img, sx: 0, sy: 0, sm: DALA_PX };
    for (let n = 1; n <= 3; n++) {
      const p = parinteDala(d.x, d.y, d.z, n);
      if (!p) break;
      const pe = memo.get(urlDala(p.x, p.y, p.z, sablon));
      if (pe && pe.st === 'ok') return { img: pe.img, sx: p.sx, sy: p.sy, sm: p.marime };
    }
    return null;
  }

  // ── desenul ───────────────────────────────────────────────────────────────
  function deseneaza() {
    const s = stare() || {};
    const M = s.M, plan = s.plan;
    const W = canvas.clientWidth || 360, H = canvas.clientHeight || 480;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = CULORI.fundal;
    ctx.fillRect(0, 0, W, H);

    const poz = M && M._lastPos;
    if (!poz || !plan) {
      ctx.fillStyle = '#8e8e96'; ctx.font = '600 15px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(poz ? 'Nu e niciun traseu încărcat.' : 'Aștept primul semnal GPS…', W / 2, H / 2);
      info.text = poz ? 'fără traseu' : 'aștept GPS';
      return;
    }

    // ZOOM: automat din viteză, mai apropiat lângă manevră; atingerea manuală îl îngheață
    const bUrm = plan.boxes && plan.boxes[M.nextBoxIdx];
    const distManevraM = bUrm ? Math.max(0, (bUrm.sumKm - M.routeKm) * 1000) : null;
    const z = zManual != null ? zManual
      : zoomAuto({ kmh: M.speedKmh, distManevraM, zAnterior: zCurent });
    zCurent = z;

    const centru = lumePx(poz.lat, poz.lng, z);
    const rotRad = rotit && M._hdg != null ? -M._hdg * Math.PI / 180 : 0;
    const ancoraY = rotit ? H * 0.62 : H * 0.5;
    // origine locală: la z17 coordonatele de lume trec de 30 de milioane, iar canvas-ul
    // le poate rotunji vizibil. Desenăm relativ la un punct întreg de lângă mașină.
    const O = { x: Math.floor(centru.x), y: Math.floor(centru.y) };
    const V = { cx: centru.x, cy: centru.y, latimePx: W, inaltimePx: H, ancoraY, rotRad };
    const pe = (lat, lng) => {
      const p = lumePx(lat, lng, z);
      return ecranDinLume(p.x, p.y, V);
    };

    ctx.save();
    ctx.translate(W / 2, ancoraY);
    if (rotRad) ctx.rotate(rotRad);
    ctx.translate(-(centru.x - O.x), -(centru.y - O.y));

    // 1. DALELE
    const { dale } = daleVizibile({ lat: poz.lat, lng: poz.lng, z,
                                    latimePx: W, inaltimePx: H, rotit: !!rotRad, marjaPx: 64 });
    let desenate = 0;
    for (const d of dale) {
      const g = gataDeDesen(d);
      if (!g) continue;
      desenate++;
      try {
        ctx.drawImage(g.img, g.sx, g.sy, g.sm, g.sm,
                      d.x * DALA_PX - O.x, d.y * DALA_PX - O.y, DALA_PX, DALA_PX);
      } catch (e) { /* imagine încă nedecodată — se desenează la cadrul următor */ }
    }

    // 2. LINIA TRASEULUI. Punctată când vine din ancore geocodate: între două adrese nu
    //    știm drumul, iar o linie plină ar minți exact ca o hartă rutieră adevărată.
    const tr = traseuDinPlan(plan);
    if (tr.pts.length >= 2) {
      const mpp = metriPePixel(poz.lat, z);
      ctx.lineWidth = Math.max(4, 26 / mpp);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = CULORI.drum;
      ctx.globalAlpha = tr.aproximativ ? 0.75 : 0.9;
      if (tr.aproximativ) ctx.setLineDash([Math.max(8, 40 / mpp), Math.max(6, 30 / mpp)]);
      ctx.beginPath();
      let inceput = false;
      for (const p of tr.pts) {
        const q = lumePx(p.lat, p.lng, z);
        const x = q.x - O.x, y = q.y - O.y;
        // se desenează doar ce e prin preajmă: un traseu de 265 km are zeci de mii de
        // puncte, iar restul ar costa cadre degeaba
        if (Math.abs(x - (centru.x - O.x)) > W * 2 || Math.abs(y - (centru.y - O.y)) > H * 2) {
          inceput = false; continue;
        }
        if (!inceput) { ctx.moveTo(x, y); inceput = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 3. MARKERELE BOXURILOR — desenate DUPĂ restore, ca cifrele să rămână drepte
    //    când harta e rotită. Un număr de box întors cu susul în jos nu e informație.
    const boxuri = pozitiiBoxuri(plan);
    const urmNum = bUrm ? bUrm.num : null;
    for (const b of boxuri) {
      const q = pe(b.lat, b.lng);
      if (q.x < -40 || q.x > W + 40 || q.y < -40 || q.y > H + 40) continue;
      const esteUrm = b.num != null && b.num === urmNum;
      const trecut = b.sumKm < M.routeKm - 0.02;
      simbolBox(ctx, q.x, q.y, b, { esteUrm, trecut, z });
    }

    // 4. ȚINTA de întoarcere, când ești pe dinafară
    if (M.offRoute && M.offRoute.pct) {
      const q = pe(M.offRoute.pct.lat, M.offRoute.pct.lng);
      ctx.strokeStyle = CULORI.tinta; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(q.x, q.y, 16, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2, ancoraY); ctx.lineTo(q.x, q.y);
      ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]);
    }

    // 5. EU — punctul și conul de direcție. Conul arată încotro e botul mașinii; cu
    //    harta rotită e mereu în sus, cu nordul sus se învârte el.
    deseneazaEu(ctx, W / 2, ancoraY, rotit ? 0 : (M._hdg != null ? M._hdg : null));

    // 6. HUD: scara și starea dalelor, scrise mărunt, în colț
    const mpp = metriPePixel(poz.lat, z);
    scara(ctx, W, H, mpp);
    info.text = (tr.sursa === 'recon' ? 'traseu din recunoaștere'
              : tr.sursa === 'ancore' ? 'traseu aproximativ, din adrese'
              : 'fără linie de traseu — doar poziția și boxurile') +
      ` · z${z}` + (zManual != null ? ' (fixat)' : '') +
      ` · ${rotit ? 'după mașină' : 'nord sus'}`;
    info.dale = { cerute: dale.length, desenate, esuate: daleEsuate, reusite: daleReusite };
    info.aproximativ = tr.aproximativ;
    info.faraDale = daleReusite === 0 && daleEsuate >= 3;
    if (info.faraDale && !anuntatFaraDale) {
      anuntatFaraDale = true;
      if (log) log('harta_fara_dale', { esuate: daleEsuate });
    }
  }

  function simbolBox(ctx, x, y, b, { esteUrm, trecut, z }) {
    const r = esteUrm ? 11 : (b.tip === 'reper' ? 4 : 7);
    ctx.globalAlpha = trecut && !esteUrm ? 0.4 : 1;
    ctx.fillStyle = CULORI[b.tip] || CULORI.reper;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    if (b.tip === 'tc' || b.tip === 'finish') {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    } else if (b.tip === 'start') {
      ctx.beginPath(); ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    }
    if (esteUrm) {
      ctx.strokeStyle = CULORI.urmator; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 7); ctx.stroke();
    }
    // numărul boxului: doar unde chiar e loc și doar pentru punctele care contează
    if (b.num != null && b.tip !== 'reper' && (z >= 14 || esteUrm)) {
      ctx.font = esteUrm ? '800 15px sans-serif' : '700 12px sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000c';
      ctx.strokeText(String(b.num), x + r + 4, y);
      ctx.fillStyle = esteUrm ? CULORI.urmator : '#e8e8ee';
      ctx.fillText(String(b.num), x + r + 4, y);
    }
    ctx.globalAlpha = 1;
  }

  function deseneazaEu(ctx, x, y, hdgDeg) {
    ctx.save();
    ctx.translate(x, y);
    if (hdgDeg != null) ctx.rotate(hdgDeg * Math.PI / 180);
    // conul de direcție — spune încotro e botul, nu doar unde ești
    const g = ctx.createLinearGradient(0, 0, 0, -70);
    g.addColorStop(0, CULORI.con); g.addColorStop(1, '#0a84ff00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-30, -70); ctx.lineTo(30, -70);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = CULORI.eu; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 9); ctx.lineTo(0, 4); ctx.lineTo(-9, 9);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function scara(ctx, W, H, mpp) {
    const tinta = 90 * mpp;                                  // ~90 px de bară
    const trepte = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const m = trepte.find(t => t >= tinta) || 5000;
    const px = m / mpp;
    const x0 = 12, y0 = H - 16;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0);
    ctx.lineTo(x0 + px, y0 - 5); ctx.stroke();
    ctx.font = '700 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#fff';
    ctx.fillText(m >= 1000 ? (m / 1000) + ' km' : m + ' m', x0 + 3, y0 - 4);
    ctx.globalAlpha = 1;
  }

  // ── bucla ─────────────────────────────────────────────────────────────────
  // Maximum 5 cadre pe secundă: harta nu e un joc, iar fiecare cadru în plus e baterie
  // luată dintr-o zi de 265 km. Se oprește singură când ecranul nu se vede.
  function bucla() {
    rafId = null;
    if (!activa) return;
    if (document.visibilityState === 'visible') {
      const acum = performance.now();
      if (acum - ultimDesen >= 200) { ultimDesen = acum; try { deseneaza(); } catch (e) {} }
    }
    // proba are prioritate absolută: harta se închide singură și se revine la cockpit
    const s = stare() || {};
    if (s.M && s.M.state === 'RT_RUN' && onProba) { onProba(); return; }
    rafId = requestAnimationFrame(bucla);
  }

  return {
    porneste() {
      if (activa) return;
      activa = true; ultimDesen = 0;
      if (!rafId) rafId = requestAnimationFrame(bucla);
    },
    opreste() {
      activa = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    },
    get activa() { return activa; },
    info() { return info; },
    // comenzile de pe ecran
    roteste(v) {
      rotit = v != null ? !!v : !rotit;
      localStorage.setItem('r2_map_nord', rotit ? '0' : '1');
      ultimDesen = 0;
      return rotit;
    },
    get rotit() { return rotit; },
    zoom(delta) {
      zManual = Math.max(12, Math.min(18, (zManual != null ? zManual : zCurent) + delta));
      ultimDesen = 0;
      return zManual;
    },
    zoomAutomat() { zManual = null; ultimDesen = 0; },
    get zoomFixat() { return zManual != null; },
    get zoomCurent() { return zManual != null ? zManual : zCurent; }
  };
}

// ── DESCĂRCAREA CORIDORULUI, cu limitele ei ─────────────────────────────────
// Politica OSM interzice descărcarea în masă. Limitele de mai jos NU sunt decor:
//  • rază strânsă (±400 m — un coridor de drum, nu o regiune);
//  • plafon de dale pe rulare, dat de apelant (implicit 800);
//  • 4 cereri pe secundă, una câte una, niciodată în paralel;
//  • buton de oprire, respectat între cereri;
//  • la 429 (prea multe cereri) sau 403 (refuz) se oprește TOT, imediat, cu explicație.
// Ce e deja în cache nu se recere: a doua rulare continuă de unde s-a tăiat prima.
export async function descarcaDale(dale, { onPas = null, opritDe = () => false,
                                           pauzaMs = 250, cache = 'rali2-dale' } = {}) {
  const rez = { cerute: dale.length, aduse: 0, dinCache: 0, esuate: 0,
                oprit: false, motiv: null };
  if (typeof caches === 'undefined')
    return { ...rez, oprit: true, motiv: 'Browserul nu are cache offline.' };
  const c = await caches.open(cache);
  for (let i = 0; i < dale.length; i++) {
    if (opritDe()) { rez.oprit = true; rez.motiv = 'oprit de tine'; break; }
    const url = urlDala(dale[i].x, dale[i].y, dale[i].z);
    try {
      if (await c.match(url)) { rez.dinCache++; if (onPas) onPas(i + 1, rez); continue; }
      const r = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'origin' });
      if (r.status === 429 || r.status === 403) {
        rez.oprit = true;
        rez.motiv = r.status === 429
          ? 'Serverul de hărți cere pauză (prea multe cereri). M-am oprit — încearcă peste câteva minute.'
          : 'Serverul de hărți a refuzat descărcarea (403). M-am oprit.';
        break;
      }
      if (!r.ok) { rez.esuate++; }
      else { await c.put(url, r.clone()); rez.aduse++; }
    } catch (e) {
      rez.esuate++;
      // patru căderi la rând înseamnă „fără internet" sau „blocat", nu ghinion
      if (rez.esuate >= 4 && rez.aduse === 0) {
        rez.oprit = true;
        rez.motiv = 'Nu ajung la serverul de hărți (fără internet sau blocat). M-am oprit.';
        break;
      }
    }
    if (onPas) onPas(i + 1, rez);
    await new Promise(r => setTimeout(r, pauzaMs));
  }
  return rez;
}

// O SINGURĂ dală, ca test: „merg dalele de pe telefonul ăsta, de pe rețeaua asta?".
// Întrebarea nu se poate răspunde de pe alt calculator — contează browserul, adresa de
// pe care rulează aplicația și rețeaua din mașină. De-aia testul e un buton, nu o
// presupunere scrisă în cod.
export async function testeazaDale({ z = 15, x = 17600, y = 11900 } = {}) {
  const url = urlDala(x, y, z);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'origin' });
    const ms = Date.now() - t0;
    if (r.ok) {
      const b = await r.blob();
      return { ok: true, status: r.status, ms, octeti: b.size,
               text: `Dalele merg: ${r.status}, ${Math.round(b.size / 1024)} kB în ${ms} ms.` };
    }
    return { ok: false, status: r.status, ms,
             text: `Serverul de hărți a răspuns ${r.status}. Harta va merge schematic (fără fundal).` };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - t0,
             text: 'Nu ajung la serverul de hărți (fără internet, blocat de rețea sau CORS). ' +
                   'Harta va merge schematic: linia traseului, boxurile și poziția, pe fundal gol.' };
  }
}
