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
  return j.content[0].text.trim();
}

export async function scanRoadbookPage(apiKey, b64, mime) {
  const raw = await callVision(apiKey, b64, mime, ROADBOOK_PROMPT, 1200);
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Format neașteptat la scanare');
  const boxes = sanitizeBoxes(JSON.parse(m[0]));
  if (!boxes.length) throw new Error('Niciun box cu kilometraj — refotografiază pagina');
  return boxes;
}

export async function scanTimeCard(apiKey, b64, mime) {
  const raw = await callVision(apiKey, b64, mime, TIMECARD_PROMPT, 500);
  const m = raw.match(/\[[\s\S]*\]/);
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
