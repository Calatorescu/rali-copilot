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
Ignoră adnotările de mână și transparența de pe verso.
DOAR JSON array valid:
[{"day":1,"leg":1,"page":2,"num":6,"sumKm":3.10,"sectionKm":0.45,"dir":"ÎNAINTE","comment":"...","flag":"RT_START_AUTO"},...]`;

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
  const m = String(raw).match(/\[[\s\S]*/);
  if (!m) throw new Error('Format neașteptat la scanare');
  let txt = m[0];
  try { return JSON.parse(txt.match(/\[[\s\S]*\]/) ? txt.match(/\[[\s\S]*\]/)[0] : txt); }
  catch (e) {}
  const cut = txt.lastIndexOf('}');
  if (cut === -1) throw new Error('Format neașteptat la scanare');
  try {
    const rep = JSON.parse(txt.slice(0, cut + 1) + ']');
    if (Array.isArray(rep) && rep.length) return rep;
  } catch (e) {}
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
  const r = await callVision(apiKey, b64, mime, ROADBOOK_PROMPT, 4000);
  const boxes = sanitizeBoxes(parseBoxesJson(r.text));
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
