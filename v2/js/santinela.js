// RALI 2 · santinela.js — ține fila TREAZĂ cât rulează ziua (v47).
//
// PROBLEMA, raportată de Andreas pe 08.08.2026: într-un apel telefonic sau cu altă
// aplicație în față, kilometrii nu se mai contorizează, iar la revenire poziția e în urmă
// cu tot golul. În jurnalul zilei se vede urma: `gps_stale {deS:16}`.
//
// CAUZA nu e în codul nostru. Chrome deprioritizează filele ascunse — cronometre, rețea,
// callback-uri — iar `watchPosition` intră în aceeași încetinire. Măsurat în vault
// (2026-07-28, altă unealtă, același browser): filă ascunsă fără sunet 158 s per operație,
// aceeași filă cu sunet 17 s. Adică sunetul o face la fel de rapidă ca una de pe ecran.
// Chrome exceptează de la încetinire filele care REDAU MEDIA.
//
// SOLUȚIA: un element `<audio>` cu un WAV generat local, aproape mut, în buclă, pornit la
// START ZIUA și oprit la STOP ZIUA. Nu se aude nimic și nu cere nicio permisiune nouă.
//
// DE CE element `<audio>` și nu un oscilator WebAudio la câștig mic: elementul de media e
// cel care marchează fila drept „redă audio" pentru regimul de fundal și e cel pe care
// MediaSession îl poate ține viu. Un `AudioContext` fără element de media poate fi
// SUSPENDAT de browser exact când pagina trece în fundal — adică exact când avem nevoie
// de el. (Nu am putut verifica asta pe Android; vezi LIMITE.)
//
// LIMITE, spuse pe față:
//  • Într-un APEL CELULAR, Android ia focusul audio. Sunetul nostru poate fi pus pe pauză
//    de sistem, iar atunci santinela nu mai apără nimic — acolo lucrează doar PUNTEA din
//    machine.js, care reconstruiește golul din coardă. Santinela e prevenție, nu garanție.
//  • Redarea poate fi refuzată fără un gest de utilizator. Se reîncearcă la primul tap,
//    iar START ZIUA e chiar un tap — deci în practică pornește de acolo.
//  • Nu am putut măsura efectul pe Samsung Galaxy S25 Ultra: n-am telefonul. Se verifică în
//    teren cu `stare()`, care spune dacă redarea chiar merge.
//
// CSP: WAV-ul se face în memorie și se dă ca `blob:`, acoperit de `default-src 'self' blob:`
// din index.html. Nu se cere nimic de pe rețea, deci politica NU se lărgește.

const RATA = 8000, SECUNDE = 2;

// WAV de 2 s, PCM 8-bit, un singur canal. Nu e liniște digitală perfectă: alternează
// 128/129, adică un bit cel mai puțin semnificativ. Motivul e practic — unele stive audio
// tratează liniștea absolută ca „nu se redă nimic" și opresc pista. La 1 LSB și volum
// 0,001 nu se aude nimic nici cu casca pe ureche.
export function wavAproapeMut() {
  const n = SECUNDE * RATA;
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const scrie = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  scrie(0, 'RIFF');  v.setUint32(4, 36 + n, true);  scrie(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATA, true); v.setUint32(28, RATA, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  scrie(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, i % 2 ? 129 : 128);
  return buf;
}

// `deps` există ca tot ce atinge browserul să fie înlocuibil în teste: fără el, santinela
// n-ar fi verificabilă decât pe un telefon. Aceeași regulă ca la `voice.js` (tts injectabil).
export function makeSantinela({ faAudio = null, media = null, log = null } = {}) {
  const facAudio = faAudio || (() => {
    const a = new Audio(URL.createObjectURL(new Blob([wavAproapeMut()], { type: 'audio/wav' })));
    a.setAttribute('aria-hidden', 'true');
    return a;
  });
  // Bucla și volumul se pun AICI, nu în fabrică: așa sunt garantate pe orice element —
  // și pe cel injectat în teste, și pe unul reutilizat după o pauză de sistem.
  const configureaza = a => { try { a.loop = true; a.volume = 0.001; } catch (e) {} };
  // Numele ȘI mesajul erorii: pe telefon, „NotAllowedError" și „NotSupportedError" cer
  // remedii diferite, iar un „Error" singur nu spune care dintre ele e.
  const numeEroare = e => String((e && e.name) || 'eroare') +
                          (e && e.message && e.message !== e.name ? ': ' + e.message : '');
  const ms = media !== null ? media
    : (typeof navigator !== 'undefined' && navigator.mediaSession ? navigator.mediaSession : null);

  let el = null, pornit = false, aRedat = false, ultimaEroare = null, laClick = null;
  const scrie = (t, d) => { if (log) try { log(t, d); } catch (e) {} };

  // Reîncercarea la primul tap: browserul refuză redarea fără gest de utilizator, iar
  // pilotul atinge oricum ecranul. Se leagă o singură dată și se dezleagă după.
  function reincearcaLaGest() {
    if (laClick || typeof document === 'undefined') return;
    laClick = () => {
      document.removeEventListener('click', laClick);
      laClick = null;
      if (pornit) porneste();
    };
    document.addEventListener('click', laClick, { once: true });
  }

  function porneste() {
    pornit = true;
    if (!el) el = facAudio();
    configureaza(el);
    let p;
    try { p = el.play(); } catch (e) { ultimaEroare = numeEroare(e); reincearcaLaGest();
                                      scrie('santinela', { stare: 'refuzat', eroare: ultimaEroare });
                                      return Promise.resolve(false); }
    // MediaSession spune sistemului „pagina asta redă ceva" — pe Android e ce ține fila
    // în viață la schimbarea de aplicație. Fără metadate n-ar apărea nicăieri.
    if (ms) {
      try {
        if (typeof MediaMetadata !== 'undefined')
          ms.metadata = new MediaMetadata({ title: 'RALI 2 — cursă în desfășurare',
                                            artist: 'copilot activ' });
        ms.playbackState = 'playing';
      } catch (e) {}
    }
    const gata = ok => {
      aRedat = ok;
      if (!ok) reincearcaLaGest();
      scrie('santinela', { stare: ok ? 'pornit' : 'refuzat', eroare: ok ? null : ultimaEroare });
      return ok;
    };
    return Promise.resolve(p).then(() => gata(true),
                                   e => { ultimaEroare = numeEroare(e); return gata(false); });
  }

  function opreste() {
    pornit = false; aRedat = false;
    if (el) { try { el.pause(); } catch (e) {} }
    if (ms) { try { ms.playbackState = 'paused'; } catch (e) {} }
    if (laClick && typeof document !== 'undefined') {
      document.removeEventListener('click', laClick); laClick = null;
    }
    scrie('santinela', { stare: 'oprit' });
    return true;
  }

  return {
    porneste, opreste,
    // Verificarea din teren: „chiar redă?". `pornit` e ce am cerut, `redaAcum` e ce se
    // întâmplă — iar diferența dintre ele e exact cazul „Android a luat focusul audio".
    stare() {
      return { pornit, aRedat, ultimaEroare,
               redaAcum: !!(el && !el.paused && !el.ended),
               volum: el ? el.volume : null };
    }
  };
}

// Câte tacte prinde un cronometru de 200 ms în 2 secunde: 10 = filă rapidă, sub 5 =
// încetinită. Unealta de diagnostic din vault, adusă în aplicație ca să se poată măsura pe
// telefonul REAL dacă santinela își face treaba — nu ca să se presupună.
export function testTacte(sleep, setI, clearI) {
  const S = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const SI = setI || setInterval, CI = clearI || clearInterval;
  let n = 0;
  const id = SI(() => { n++; }, 200);
  return S(2000).then(() => { CI(id); return { tacte: n, din: 10, verdict: n >= 8 ? 'rapid' : 'încetinit' }; });
}
