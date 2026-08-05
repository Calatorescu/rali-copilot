// RALI 2 · scan.js — ochii: roadbook și time card, prin Claude Vision.
//
// Două documente, două scanări:
//  • paginile de roadbook → boxuri (validate prin route.sanitizeBoxes — granița de
//    încredere: răspunsul modelului e conținut extern);
//  • time card-ul → programul TC al zilei (ore oficiale) — aplicația devine apoi
//    stăpâna orarului, nu un cronometru pe care îl încarci manual.
// Cheia API vine din setări; apelurile au timeout — pe munte „fără semnal" e o stare
// normală de lucru, nu o excepție.

import { sanitizeBoxes, sanitizeBuletin } from './route.js';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL_VISION = 'claude-sonnet-4-6';

const ROADBOOK_PROMPT = `Ești copilot de raliu. Extrage TOATE boxurile vizibile pe această pagină de roadbook în format JSON array.
Pagina poate fi fotografiată rotit — rotește-o mental înainte de a citi.
ANTETUL PAGINII (citește-l ÎNTÂI, repetă-l pe fiecare box): ex. „Day 2 - Leg 3" și „Page: 39" → "day":2,"leg":3,"page":39. Numerotarea boxurilor și km REPORNESC la fiecare leg. Antet ilizibil → null, NU ghici.
COLOANE: Număr box | Sum km (bold) | Sum mile (ignoră) | Section km (bold) | Section mile (ignoră) | Diagrama tulip | Dist to target (ignoră) | Comment.
TULIP: "ÎNAINTE","STÂNGA","DREAPTA","STÂNGA-T","DREAPTA-T","GIRATORIU-1".."GIRATORIU-4","STOP-CFR".
ICOANE → "flags" (LISTĂ): steag+ceas="RT_START_AUTO" | steag+ceas+fulg="RT_START_STANDING" | dreptunghi/tabelă="RT_FINISH" | ceas+steag mare="TC" | P="PARKING" | fulger="EV". Fără icoană → [].
UN BOX POATE AVEA MAI MULTE ICOANE, iar "flags" le conține pe TOATE. Cazul cel mai important, foarte frecvent: boxul unde se TERMINĂ o probă și ÎNCEPE imediat următoarea are DOUĂ icoane, una lângă alta → "flags":["RT_FINISH","RT_START_AUTO"]. Nu alege una dintre ele, nu le contopi: pune-le pe amândouă, în ordinea în care apar pe pagină.
CAUTĂ EXPLICIT LINIILE DE FINISH. Ele sunt cel mai ușor de ratat, fiindcă icoana e mică și de multe ori comentariul e GOL sau vorbește despre altceva („To Brebu Nou", „Exit Văliug"). Pentru fiecare START de probă de pe pagină întreabă-te unde e finishul lui. Un finish ratat strică cronometrarea la fel de rău ca un start ratat.
FLAG-UL SE CITEȘTE DOAR DIN ICOANĂ, niciodată din cuvintele comentariului. Asta merge în AMBELE sensuri: nu pune un semn fiindcă textul spune „Start RT 3" sau „Exit ..." și nu omite un semn fiindcă textul nu spune nimic. „START", „FINISH", „RT", „proba", „tabela roșie" apar des în TEXTE DESPRE probe („pregătește proba", „START · Time Control", „ascultă «Finish… apoi imediat stânga»") — alea sunt indicații pentru pilot, nu simboluri. Dacă boxul are icoană de Time Control, semnul e "TC" chiar dacă textul începe cu „START". Dacă un box n-are NICIO icoană, "flags" e [] chiar dacă în comentariu scrie „Start" sau „Exit".
Ignoră adnotările de mână și transparența de pe verso.
FIECARE rând numerotat din tabel = un box care APARE în răspuns — nu omite niciunul, oricât de neobișnuit i-ar fi comentariul sau simbolurile. Comentariul se transcrie scurtat dacă e lung, dar boxul nu dispare.
REPER (câmpul "reper"): dacă în comentariu apare un loc care poate fi căutat pe hartă — nume de stradă, drum numerotat, giratoriu cu nume, obiectiv („Str. Avram Imbroane", „Calea Ghirodei", „DJ691", „giratoriu Kaufland") — scrie-l normalizat, cu tipul arterei în față („Str. Turda"). Adaugă localitatea DOAR dacă e scrisă pe pagină. Dacă boxul n-are niciun loc căutabil („tabela roșie", „drum drept"), scrie null. NU inventa și NU deduce localitatea.
DOAR JSON array valid:
[{"day":1,"leg":1,"page":2,"num":6,"sumKm":3.10,"sectionKm":0.45,"dir":"ÎNAINTE","comment":"...","reper":"Str. Turda","flags":["RT_START_AUTO"]},{"day":1,"leg":1,"page":25,"num":64,"sumKm":47.69,"sectionKm":0.74,"dir":"ÎNAINTE","comment":"...","reper":null,"flags":["RT_FINISH","RT_START_AUTO"]},...]`;

// ── BULETINUL DIRECTORULUI DE CURSĂ ─────────────────────────────────────────
// Roadbook-ul NU conține probele de regularitate. Verificat pe paginile fotografiate de
// la Reșița (05.08.2026): boxurile 66, 97 și 104 — finișul lui TR3, schimbarea de viteză
// din TR4 și finișul lui TR4 — n-au nici icoană, nici comentariu. Probele sunt definite
// într-un document separat, în TEXT: „Buletinul Directorului de cursă".
//
// Documentul e BILINGV: fiecare probă apare o dată în română și încă o dată, identic, în
// engleză. De aici cele două instrucțiuni care contează cel mai mult mai jos: fiecare
// probă O SINGURĂ DATĂ, iar la contradicție între cele două limbi — `null`, nu alegere.
// Un model care „alege" acolo unde documentul se contrazice ne dă o cifră inventată exact
// în locul în care documentul e nesigur.
//
// Promptul e separat de ROADBOOK_PROMPT și nu-l atinge: sunt două documente diferite,
// două căi paralele.
const BULLETIN_PROMPT = `Ești copilot de raliu. Pe fotografie e BULETINUL DIRECTORULUI DE CURSĂ (Bulletin / Clerk of the Course) — documentul care definește PROBELE DE REGULARITATE (TR / RT). Extrage toate probele vizibile, ca JSON array.
Pagina poate fi fotografiată rotit — rotește-o mental înainte de a citi.
DOCUMENTUL E BILINGV: fiecare probă apare O DATĂ în română și încă o dată, identic, în engleză („Start"/"Start", „Viteza medie"/"Average speed", „Finis"/"Finish", „Schimbare de viteza"/"Speed change", „Pornire de pe loc"/"Standing start", „Start lansat"/"Flying start"). Scoate FIECARE PROBĂ O SINGURĂ DATĂ, nu de două ori.
DACĂ ROMÂNA ȘI ENGLEZA SE CONTRAZIC LA O CIFRĂ, pune "null" acolo. NU alege una dintre ele și NU face media. Restul câmpurilor probei rămân completate.
Pentru fiecare probă:
- "name": eticheta ei exact cum apare ("TR 2", "TR 3", "RT 4"...).
- "startBox" + "startPage": numărul boxului și pagina de roadbook de la care PORNEȘTE proba.
- "startType": "standing" dacă e pornire de pe loc / standing start / cu oprire; "auto" dacă e start lansat / flying / din mers. Necunoscut → null.
- "startAfterTc": dacă startul e definit ca decalaj față de un control orar („la 77 minute dupa inceperea TC 3"), pune {"tc":"TC 3","minutes":77}. Altfel null.
- "kmh": viteza medie impusă, în km/h, ca număr (44,8 → 44.8).
- "speedChanges": LISTĂ cu schimbările de medie din interiorul probei. Fiecare: {"kmh":<viteza nouă>,"box":<numărul boxului>,"page":<pagina>,"place":null}. DACĂ schimbarea e legată de un LOC, nu de un box („la iesirea din localitatea Valiug"), atunci "box":null, "page":null și "place":"<textul exact din buletin>". Fără schimbări → [].
- "finishBox" + "finishPage": boxul și pagina la care se TERMINĂ proba.
- "finishRel": "at" dacă scrie „La Box N" / „At Box N"; "before" dacă scrie „Inainte de Box N" / „Before Box N"; "after" dacă scrie „Dupa Box N" / „After Box N". Calificativul CONTEAZĂ — nu-l ignora și nu-l colapsa la "at".
Ce nu se citește clar → null. NU ghici, NU completa din alte probe.
DOAR JSON array valid, fără alt text:
[{"name":"TR 2","startBox":57,"startPage":24,"startType":"standing","startAfterTc":{"tc":"TC 3","minutes":77},"kmh":44.8,"speedChanges":[],"finishBox":64,"finishPage":25,"finishRel":"at"},{"name":"TR 4","startBox":79,"startPage":26,"startType":"standing","startAfterTc":{"tc":"TC 3","minutes":149},"kmh":24.3,"speedChanges":[{"kmh":20.5,"box":97,"page":28,"place":null}],"finishBox":104,"finishPage":29,"finishRel":"after"}]`;

const TIMECARD_PROMPT = `Ești copilot de raliu. Pe fotografie e un TIME CARD / carnet de bord cu ore oficiale.
Extrage toate controalele orare vizibile, în ordine, ca JSON array:
[{"name":"TC 1","time":"12:01"},{"name":"TC 2","time":"13:34"},...]
- name: eticheta controlului exact cum apare (TC 1, CH 2, Start etc.)
- time: ora alocată HH:MM (24h). Fără secunde dacă nu apar.
Dacă un rând n-are oră lizibilă, omite-l. DOAR JSON array valid, fără alt text.`;

// Parsarea răspunsului, separată ca să fie testabilă. Repară și un array TRUNCHIAT
// (răspuns tăiat de max_tokens sau de rețea): taie la ultimul obiect complet și
// închide array-ul. Pe 02.08 o pagină trunchiată arunca „Unexpected end of JSON",
// pagina era sărită TĂCUT, iar Andreas a condus cu 4 boxuri din 12.
export function parseBoxesJson(raw) {
  // Scanner ECHILIBRAT, nu regex lacom (02.08, seara): regexul se întindea până la
  // ULTIMA paranteză din tot răspunsul — dacă modelul adăuga după array o notă care
  // conținea paranteze („[SUNT LA BOX]", exemple cu {}), extragerea înghițea și nota
  // și parsarea murea, iar pagina se pierdea. Scannerul numără parantezele conștient
  // de stringuri/escape: găsește PRIMUL array complet, exact; la răspuns trunchiat
  // salvează obiectele complete de la nivelul array-ului.
  const s = String(raw);
  const start = s.indexOf('[');
  if (start === -1) throw new Error('Format neașteptat la scanare');
  let depth = 0, inStr = false, esc = false, end = -1, lastObjEnd = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      if (c === '}' && depth === 2) lastObjEnd = i;   // obiect încheiat la nivelul array-ului
      depth--;
      if (c === ']' && depth === 0) { end = i; break; }
    }
  }
  const txt = end !== -1 ? s.slice(start, end + 1)
    : lastObjEnd !== -1 ? s.slice(start, lastObjEnd + 1) + ']' : null;
  if (txt) {
    try {
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) return arr;
    } catch (e) {}
  }
  throw new Error('Format neașteptat la scanare');
}

async function callVision(apiKey, b64, mime, prompt, maxTokens) {
  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      signal: AbortSignal.timeout(90000),
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL_VISION, max_tokens: maxTokens,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text: prompt }
        ] }]
      })
    });
  } catch (e) {
    throw new Error(e && (e.name === 'TimeoutError' || e.name === 'AbortError')
      ? 'A expirat — semnal slab? Reîncearcă.' : 'Fără conexiune.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `HTTP ${res.status}`);
  }
  const j = await res.json();
  return { text: j.content[0].text.trim(), stopReason: j.stop_reason };
}

export async function scanRoadbookPage(apiKey, b64, mime) {
  // 4000, nu 1200: comentariile lungi din roadbook depășeau limita, JSON-ul ieșea
  // trunchiat și toată pagina se pierdea (02.08 — 2 pagini din 3, tăcut).
  let r = await callVision(apiKey, b64, mime, ROADBOOK_PROMPT, 4000);
  let parsed = null, primaEroare = null;
  try { parsed = parseBoxesJson(r.text); }
  catch (e) {
    primaEroare = { err: e.message, raw: String(r.text).slice(0, 200) };
    // O reîncercare, cu instrucțiune mai apăsată: uneori modelul răspunde cu proză
    // („nu disting clar...") în loc de array — a doua întrebare, mai strictă, trece des.
    r = await callVision(apiKey, b64, mime,
      ROADBOOK_PROMPT + '\nRăspunde EXCLUSIV cu array-ul JSON. Fără nicio propoziție. ' +
      'Dacă pagina e greu de citit, scoate boxurile pe care LE VEZI, nu explica.', 4000);
    try { parsed = parseBoxesJson(r.text); }
    catch (e2) {
      // Diagnostic, nu ghicit (02.08): eroarea cară cu ea răspunsul brut (mai mult de
      // data asta — 200 de caractere n-au ajuns să vadă CE urma după array), lungimea
      // totală și stop_reason — jurnalul arată exact ce a spus modelul.
      const err = new Error(e2.message);
      err.raw = String(r.text).slice(0, 600);
      err.rawLen = String(r.text).length;
      err.stop = r.stopReason;
      err.rawPrima = primaEroare;
      throw err;
    }
  }
  const boxes = sanitizeBoxes(parsed);
  if (!boxes.length) throw new Error('Niciun box cu kilometraj — refotografiază pagina');
  if (r.stopReason === 'max_tokens')
    throw new Error(`Pagina e prea densă — au intrat doar ${boxes.length} boxuri, refotografiaz-o pe bucăți`);
  return boxes;
}

// Scanarea buletinului — același tipar ca scanarea roadbook-ului: aceeași `callVision`,
// aceeași reparare de JSON trunchiat (`parseBoxesJson`), aceeași reîncercare mai strictă
// când modelul răspunde cu proză. Diferă doar promptul, sita și mesajele.
export async function scanBulletin(apiKey, b64, mime) {
  let r = await callVision(apiKey, b64, mime, BULLETIN_PROMPT, 3000);
  let parsed = null, primaEroare = null;
  try { parsed = parseBoxesJson(r.text); }
  catch (e) {
    primaEroare = { err: e.message, raw: String(r.text).slice(0, 200) };
    r = await callVision(apiKey, b64, mime,
      BULLETIN_PROMPT + '\nRăspunde EXCLUSIV cu array-ul JSON. Fără nicio propoziție. ' +
      'Dacă pagina e greu de citit, scoate probele pe care LE VEZI, nu explica.', 3000);
    try { parsed = parseBoxesJson(r.text); }
    catch (e2) {
      const err = new Error(e2.message);
      err.raw = String(r.text).slice(0, 600);
      err.rawLen = String(r.text).length;
      err.stop = r.stopReason;
      err.rawPrima = primaEroare;
      throw err;
    }
  }
  // GRANIȚA DE ÎNCREDERE: nimic din răspunsul modelului nu trece mai departe nefiltrat.
  const probe = sanitizeBuletin(parsed);
  if (!probe.length) throw new Error('Nicio probă citită din buletin — refotografiază pagina');
  if (r.stopReason === 'max_tokens')
    throw new Error(`Pagina e prea densă — au intrat doar ${probe.length} probe, refotografiaz-o pe bucăți`);
  return probe;
}

export async function scanTimeCard(apiKey, b64, mime) {
  const r = await callVision(apiKey, b64, mime, TIMECARD_PROMPT, 800);
  const m = r.text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Format neașteptat la time card');
  const arr = JSON.parse(m[0]);
  // granița de încredere: doar name-șir scurt + oră validă
  return (Array.isArray(arr) ? arr : [])
    .filter(x => x && typeof x.name === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(x.time)))
    .map(x => ({ name: x.name.slice(0, 24), time: String(x.time) }));
}

// întrebare liberă către copilot (context injectat de apelant)
export async function askCopilot(apiKey, model, system, question) {
  let res;
  try {
    res = await fetch(API, {
      method: 'POST', signal: AbortSignal.timeout(45000),
      headers: {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model, max_tokens: 280, system,
        messages: [{ role: 'user', content: question }] })
    });
  } catch (e) { throw new Error('Fără conexiune.'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error?.message || `HTTP ${res.status}`); }
  const j = await res.json();
  return j.content[0].text.trim();
}

// ── COLECTORUL DE POZE ──────────────────────────────────────────────────────
// Cererea lui Andreas, 05.08.2026: mâine fotografiază roadbook-ul OFICIAL, pe hârtie,
// la Sibiu. Butonul de până acum deschidea un selector de fișiere cu `accept="image/*"`
// — teoretic Android oferă și camera acolo, dar pe Android 13+ Chrome deschide de multe
// ori selectorul de POZE al sistemului, care n-are cameră deloc. Adică: ieși din
// aplicație, pozezi, revii, alegi. De 25 de ori.
//
// Bucata de aici e partea care se poate greși în tăcere și deci se testează: adunarea
// pozelor în listă, contorul și plafonul. Camera, galeria și cererea la Vision rămân
// afară — ele se văd.
//
// Plafonul: un roadbook de zi are 25-40 de pagini. 40 e generos și pune o limită
// superioară pe memorie (o poză de telefon în base64 are câțiva MB, iar aplicația le
// ține pe toate până la scanare).
export const MAX_POZE = 40;

export function faColectorPoze({ max = MAX_POZE } = {}) {
  let poze = [];
  return {
    // `noi` = ce a întors selectorul (poate fi gol: omul a apăsat „înapoi").
    // Elementele sunt FIȘIERE nedeschise — conținutul se citește abia în bucla de
    // scanare, pagină cu pagină. De-aia validitatea se judecă după mărime, nu după
    // conținut: 30 de poze citite deodată în base64 omoară fila pe telefon, iar
    // exact aia era cauza plafonului tăcut de 12 pagini (05.08.2026).
    adauga(noi) {
      const lista = (Array.isArray(noi) ? noi : [])
        .filter(p => p && (typeof p.size === 'number' ? p.size > 0 : typeof p.b64 === 'string' && !!p.b64));
      const loc = Math.max(0, max - poze.length);
      const intrate = lista.slice(0, loc);
      poze = poze.concat(intrate);
      return {
        adaugate: intrate.length,
        respinse: lista.length - intrate.length,   // peste plafon
        total: poze.length,
        plin: poze.length >= max,
        anulat: lista.length === 0,
        // ce scrie pe ecran între două poze — la volanul unui teanc de hârtii,
        // singura întrebare e „câte am și mai pun una?"
        mesaj: lista.length === 0
          ? (poze.length ? `${poze.length} ${poze.length === 1 ? 'pagină adunată' : 'pagini adunate'} — nicio poză nouă.`
                         : 'Nicio poză.')
          : intrate.length === 1 && lista.length === 1
            ? `Pagina ${poze.length} adăugată.`
            : `${intrate.length} pagini adăugate — ${poze.length} în total.`
      };
    },
    get poze() { return poze.slice(); },
    get total() { return poze.length; },
    goleste() { poze = []; }
  };
}
