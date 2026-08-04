// RALI 2 · voice.js — vocea ca dialog: tonuri + cuvinte puține + urechi.
//
// Regula învățată pe teren: fiecare cuvânt în plus ține coada ocupată, iar un mesaj
// rostit târziu e un mesaj fals. De aceea:
//  • EARCONS — tonuri de o jumătate de secundă pentru starea continuă (deviere,
//    box trecut): urcător = ești în avans (încetinește), coborâtor = în urmă
//    (accelerează), tic scurt = box confirmat. Nu ocupă coada de cuvinte.
//  • CUVINTE — doar manevre și cifre; coada are TTL (stătut = aruncat) și categorie
//    (nou înlocuiește vechi din aceeași categorie).
//  • URECHI — push-to-talk: „sunt la box 12", „cât am", „viteza".
// Tot modulul e injectabil: testele îi dau un difuzor fals și citesc ce s-ar fi spus.

// Treptele de prioritate (audit 02.08, #9):
//   1-2 = context (debrief, sfaturi) · 3 = important (TC, pacing, desync)
//   4 = IMEDIAT: manevre „acum", rezultatul probei — întrerupe orice și nu expiră
//       repede. Înainte, totul important era 3, iar mesajele de 3 se ucideau între
//       ele: un „dreapta acum" pus în spatele unui anunț lung de TC era ARUNCAT.
export function makeVoice({ tts = null, audio = null, now = () => Date.now(),
                            onDrop = null, onSpeak = null } = {}) {
  const q = [];
  let cur = null, curAt = 0, last = null;

  const T = tts || defaultTts();
  const A = audio;   // AudioContext factory — null în teste

  const drop = (m, de) => { if (onDrop) try { onDrop(m.text, de); } catch (e) {} };
  // Ce a plecat CHIAR în difuzor. Jurnalul ținea minte doar ce s-a aruncat, deci la
  // întrebarea „s-a auzit sau nu?" răspunsul se DEDUCEA din absența unei aruncări —
  // adică se ghicea (04.08.2026, analiza turei Tresor). Acum se citește.
  const spus = m => { if (onSpeak) try { onSpeak(m.text, m.cls || null, m.prio); } catch (e) {} };

  function ttl(m) {
    if (m.prio >= 4) return 12000;          // manevrele imediate nu se aruncă ușor
    if (m.cat === 'turn') return 8000;      // un viraj „stătut" tot e mai bun decât tăcerea
    return m.prio >= 3 ? 3500 : 5000;
  }

  // CLASELE DE ANUNȚ (cerute de Andreas, 03.08.2026): „să aibă prioritate anunțul de
  // schimbare a direcției, în fața anunțurilor de viteze/timp din probă, măcar primul
  // și ultimul anunț de viraj". Prioritatea numerică nu era de ajuns: „Finish. 42 în
  // avans. Nu opri lângă tabelă." e prio 4 și tăia un „150 de metri — dreapta" de prio 3.
  // Acum manevra bate ritmul indiferent de cifră: ritmul așteaptă, iar dacă între timp
  // se învechește, se aruncă — un ritm vechi e o cifră falsă oricum.
  // Clasele: 'manevra' (unde se virează) și 'ritm' (secunde, viteze, bancă). Orice
  // altceva (null) se poartă ca ritmul — nu e o decizie de volan.
  const MANEVRA = 'manevra';

  // CINE TAIE PE CINE, în difuzor. Un mesaj tăiat la mijloc de cuvânt nu e „mai puțin
  // mesaj", e zgomot: pilotul aude „150 de metri — dre—" și nu mai știe nici distanța,
  // nici direcția. Măsurat în tura Tresor (04.08.2026): 5 fraze de manevră aruncate cu
  // motivul „intrerupt", toate în aceeași secundă cu un alt anunț al aceleiași manevre.
  // Trei reguli, în ordinea asta:
  //  1. RITMUL nu taie niciodată MANEVRA (regula claselor, 03.08) — secundele de deviere
  //     nu sunt la 2 secunde de volan, virajul da.
  //  2. MANEVRA nu taie altă MANEVRĂ. Dacă amândouă sunt despre unde se virează, se
  //     așteaptă: fraza care se rostește are 1-2 secunde, iar cea nouă pleacă imediat
  //     după. Din coadă, oricum manevrele ies primele, iar duplicatele din aceeași
  //     categorie se înlocuiesc înainte să apuce să vorbească.
  //  3. MANEVRA taie RITMUL și la prioritate EGALĂ. Cazul real: „stânga acum" (prio 4)
  //     a stat în coadă în spatele lui „Finish. 33 virgulă 8 în urmă. Nu opri lângă
  //     tabelă." (tot prio 4) — patru secunde de vorbă, exact peste virajul de la 55 m
  //     după linia de finish, pe care pilotul l-a ratat.
  const poateIntrerupe = (clsNou, prioNou, curent) => {
    if (!curent) return false;
    if (clsNou !== MANEVRA && curent.cls === MANEVRA) return false;
    if (clsNou === MANEVRA && curent.cls === MANEVRA) return false;
    if (clsNou === MANEVRA && curent.cls !== MANEVRA) return prioNou >= curent.prio;
    return prioNou > curent.prio;
  };

  function pump() {
    if (cur || !q.length) return;
    const nowMs = now();
    for (let i = q.length - 1; i >= 0; i--) {
      if (nowMs - q[i].at > ttl(q[i])) drop(q.splice(i, 1)[0], 'expirat');
    }
    if (!q.length) return;
    // întâi clasa (manevra înaintea ritmului), apoi prioritatea
    const rang = m => (m.cls === MANEVRA ? 1 : 0);
    let idx = 0;
    for (let i = 1; i < q.length; i++) {
      const a = q[i], b = q[idx];
      if (rang(a) > rang(b) || (rang(a) === rang(b) && a.prio > b.prio)) idx = i;
    }
    cur = q.splice(idx, 1)[0];
    curAt = nowMs;
    last = { text: cur.text, at: nowMs };    // pentru butonul REPETĂ
    spus(cur);
    T.speak(cur.text, () => { cur = null; pump(); });
  }

  // Watchdog: pe Android, onend poate să nu vină. Iar `speechSynthesis.speaking`
  // poate rămâne true LA NESFÂRȘIT (bug cunoscut) — condiția veche `!T.busy()`
  // însemna că un TTS agățat amuțea vocea pe tot restul zilei (audit, #17).
  // După 2× durata estimată se taie forțat, indiferent ce pretinde difuzorul.
  const wdId = setInterval(() => {
    if (!cur) { T.keepAlive && T.keepAlive(); return; }
    const estMs = Math.max(6000, cur.text.length * 90);
    const varsta = now() - curAt;
    if (varsta > estMs && !T.busy()) { cur = null; pump(); }
    else if (varsta > estMs * 2) { T.cancel(); cur = null; pump(); }
    T.keepAlive && T.keepAlive();
  }, 2000);

  return {
    say(text, prio = 2, cat = null, cls = null) {
      if (!text) return;
      if (cat) for (let i = q.length - 1; i >= 0; i--)
        if (q[i].cat === cat) drop(q.splice(i, 1)[0], 'inlocuit');
      if (poateIntrerupe(cls, prio, cur)) {
        T.cancel(); drop(cur, 'intrerupt'); cur = null;
      }
      q.push({ text, prio, cat, cls, at: now() });
      pump();
    },
    // ultimul mesaj rostit — butonul REPETĂ de pe cockpit (propunerea 5)
    repeat() {
      if (!last) return false;
      q.push({ text: last.text, prio: 4, cat: null, at: now() });
      pump();
      return true;
    },
    flush() { q.length = 0; cur = null; T.cancel(); },
    // tonuri — starea continuă, fără cuvinte
    tone(kind) {
      if (!A) return;
      try {
        const ctx = A();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        g.gain.value = 0.28;
        const t = ctx.currentTime;
        if (kind === 'ahead')       { o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(760, t + 0.28); }
        else if (kind === 'behind') { o.frequency.setValueAtTime(760, t); o.frequency.linearRampToValueAtTime(520, t + 0.28); }
        else if (kind === 'ok')     { o.frequency.setValueAtTime(640, t); }
        else if (kind === 'tick')   { o.frequency.setValueAtTime(1100, t); }
        else if (kind === 'alarm')  { o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(660, t + 0.15); o.frequency.setValueAtTime(880, t + 0.3); }
        o.start(t);
        o.stop(t + (kind === 'tick' ? 0.08 : kind === 'alarm' ? 0.45 : 0.3));
      } catch (e) {}
    },
    dispose() { clearInterval(wdId); T.cancel(); },
    _q: q   // pentru teste
  };
}

function defaultTts() {
  const S = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  return {
    speak(text, onEnd) {
      if (!S) { onEnd(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ro-RO'; u.rate = 1.12;
      u.onend = u.onerror = () => onEnd();
      setTimeout(() => S.speak(u), 50);
    },
    cancel() { S && S.cancel(); },
    busy() { return S ? S.speaking : false; },
    keepAlive() { if (S && S.paused) S.resume(); }
  };
}

// secunde rostite cu zecime: „3 virgulă 4" (Sibiu cronometrează la 0,1 s)
export function secRo(x) {
  const v = Math.round(Math.abs(x) * 10) / 10;
  const i = Math.floor(v), z = Math.round((v - i) * 10);
  return z === 0 ? `${i}` : `${i} virgulă ${z}`;
}

export function distRo(m) {
  // (audit, #22): „1 kilometri" era agramat, iar sub 950 m se rostea doar cifra goală
  // („Time Control în 20") — de-acum toate distanțele au unitate.
  if (m >= 950) {
    const km = Math.round(m / 100) / 10;
    const txt = String(km).replace('.', ' virgulă ');
    return km === 1 ? 'un kilometru' : `${txt} kilometri`;
  }
  const r = m >= 400 ? Math.round(m / 50) * 50 : Math.round(m / 10) * 10;
  return r < 20 ? `${r} metri` : `${r} de metri`;   // „10 metri", dar „20 DE metri"
}

// ── comenzile vocale (push-to-talk) ─────────────────────────────────────────
// Gramatică mică, robustă: „box 12" / „sunt la box 12", „cât am", „viteza", „start", „stop".
export function parseCommand(txt) {
  const t = String(txt).toLowerCase();
  let m = t.match(/box(?:ul)?\s+(\d{1,3})/);
  if (m) return { cmd: 'at_box', num: +m[1] };
  if (/c[âa]t am|cum stau|devier/.test(t)) return { cmd: 'status' };
  if (/vitez/.test(t)) return { cmd: 'speed' };
  if (/\bstart\b|porne/.test(t)) return { cmd: 'start' };
  if (/\bstop\b|opre/.test(t)) return { cmd: 'stop' };
  return { cmd: 'unknown', raw: txt };
}

export function makeEars({ onCommand }) {
  const SR = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  let listening = false;
  return {
    supported: !!SR,
    listen() {
      if (!SR || listening) return false;
      const rec = new SR();
      rec.lang = 'ro-RO'; rec.interimResults = false; rec.maxAlternatives = 1;
      listening = true;
      rec.onresult = e => onCommand(parseCommand(e.results[0][0].transcript));
      rec.onend = rec.onerror = () => { listening = false; };
      try { rec.start(); return true; } catch (e) { listening = false; return false; }
    },
    get listening() { return listening; }
  };
}
