// RALI 2 · scan.js — ochii: roadbook și time card, prin Claude Vision.
//
// Două documente, două scanări:
//  • paginile de roadbook → boxuri (validate prin route.sanitizeBoxes — granița de
//    încredere: răspunsul modelului e conținut extern);
//  • time card-ul → programul TC al zilei (ore oficiale) — aplicația devine apoi
//    stăpâna orarului, nu un cronometru pe care îl încarci manual.
// Cheia API vine din setări; apelurile au timeout — pe munte „fără semnal" e o stare
// normală de lucru, nu o excepție.

import { sanitizeBoxes } from './route.js';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL_VISION = 'claude-sonnet-4-6';

const ROADBOOK_PROMPT = `Ești copilot de raliu. Extrage TOATE boxurile vizibile pe această pagină de roadbook în format JSON array.
Pagina poate fi fotografiată rotit — rotește-o mental înainte de a citi.
ANTETUL PAGINII (citește-l ÎNTÂI, repetă-l pe fiecare box): ex. „Day 2 - Leg 3" și „Page: 39" → "day":2,"leg":3,"page":39. Numerotarea boxurilor și km REPORNESC la fiecare leg. Antet ilizibil → null, NU ghici.
COLOANE: Număr box | Sum km (bold) | Sum mile (ignoră) | Section km (bold) | Section mile (ignoră) | Diagrama tulip | Dist to target (ignoră) | Comment.
TULIP: "ÎNAINTE","STÂNGA","DREAPTA","STÂNGA-T","DREAPTA-T","GIRATORIU-1".."GIRATORIU-4","STOP-CFR".
ICOANE → "flag": steag+ceas="RT_START_AUTO" | steag+ceas+fulg="RT_START_STANDING" | dreptunghi+steag="RT_FINISH" | ceas+steag mare="TC" | P="PARKING" | fulger="EV" | altfel null.
FLAG-UL SE CITEȘTE DOAR DIN ICOANĂ, niciodată din cuvintele comentariului. „START", „FINISH", „RT", „proba", „tabela roșie" apar des în TEXTE DESPRE probe („pregătește proba", „START · Time Control", „ascultă «Finish… apoi imediat stânga»") — alea sunt indicații pentru pilot, nu simboluri. Dacă boxul are icoană de Time Control, flag-ul e "TC" chiar dacă textul începe cu „START". Fără icoană clară → null.
Ignoră adnotările de mână și transparența de pe verso.
FIECARE rând numerotat din tabel = un box care APARE în răspuns — nu omite niciunul, oricât de neobișnuit i-ar fi comentariul sau simbolurile. Comentariul se transcrie scurtat dacă e lung, dar boxul nu dispare.
REPER (câmpul "reper"): dacă în comentariu apare un loc care poate fi căutat pe hartă — nume de stradă, drum numerotat, giratoriu cu nume, obiectiv („Str. Avram Imbroane", „Calea Ghirodei", „DJ691", „giratoriu Kaufland") — scrie-l normalizat, cu tipul arterei în față („Str. Turda"). Adaugă localitatea DOAR dacă e scrisă pe pagină. Dacă boxul n-are niciun loc căutabil („tabela roșie", „drum drept"), scrie null. NU inventa și NU deduce localitatea.
DOAR JSON array valid:
[{"day":1,"leg":1,"page":2,"num":6,"sumKm":3.10,"sectionKm":0.45,"dir":"ÎNAINTE","comment":"...","reper":"Str. Turda","flag":"RT_START_AUTO"},...]`;

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
