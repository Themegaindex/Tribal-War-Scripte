// ==UserScript==
// @name         Die Stämme AI-Nachrichten-Helper (Auto-Adresse + Context + BB)
// @namespace    http://tampermonkey.net/
// @version      2.7
// @description  Analysiert den gesamten Verlauf, erkennt automatisch die Anredeform (du/ihr/Sie), fokussiert die letzte Nachricht und vermeidet Wiederholungen. Mit verbessertem KI-Prompt.
// @author       Du
// @match        https://*.die-staemme.de/game.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      openrouter.ai
// ==/UserScript==

(function () {
  'use strict';

  if (!location.search.includes('screen=mail')) return;

  // ------------------ Config & Storage ------------------
  const CONFIG = {
    MAX_THREAD_CHARS: 20000,
    REQUEST_DELAY: 80,
    QUOTE_MAX_LENGTH: 600,
    UI_HIGHLIGHT_DURATION: 1000
  };

  const STORAGE = {
    KEY: 'openrouter_key',
    MODEL: 'openrouter_model',
    PREFS: 'ds_ai_prefs_v27',
    MYNAME: 'ds_my_name'
  };

  const DEFAULT_MODEL = 'x-ai/grok-4-fast:free';
  const DEFAULT_MY_NAME = 'Djossi09';

  const DEFAULT_PREFS = {
    defaultMode: 'auto',
    allowBB: true,
    noSignoff: true,
    readAllPages: true,
    attachQuote: true,
    greetName: 'auto',
    addressForm: 'auto'  // 'auto' | 'du' | 'ihr' | 'Sie'
  };

  const STANCE_PRESETS = [
    ['auto', 'Auto (Empfohlen)'],
    ['zustimmen', 'Zustimmen'],
    ['ablehnen', 'Ablehnen'],
    ['gegenangebot', 'Gegenangebot'],
    ['bedenkzeit', 'Bedenkzeit erbitten'],
    ['info', 'Mehr Infos anfordern'],
    ['warnung', 'Warnung / Klarer Standpunkt'],
    ['diplomatisch', 'Diplomatisch halten'],
    ['freundlich', 'Freundlich'],
    ['aggressiv', 'Etwas Druck']
  ];

  // ------------------ Utilities ------------------
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'style') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    });
    for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const getText = (n) => (n?.textContent || '').replace(/\s+/g, ' ').trim();

  const tryParseJSON = (s) => {
    if (!s) return null;
    const clean = s.replace(/```json|```/gi, '').trim();
    try { return JSON.parse(clean); } catch { return null; }
  };

  const getPrefs = () => {
    const saved = GM_getValue(STORAGE.PREFS);
    return saved ? { ...DEFAULT_PREFS, ...saved } : { ...DEFAULT_PREFS };
  };

  // ------------------ Auto-Detect Address Form ------------------
  function detectAddressForm(messages, myName) {
    const otherMessages = messages.filter(m => !m.own && m.text);
    const recentMessages = otherMessages.slice(-5);

    let duScore = 0;
    let ihrScore = 0;
    let sieScore = 0;

    for (const msg of recentMessages) {
      const text = msg.text.toLowerCase();

      // "du"-Form Indikatoren
      const duMatches = (text.match(/\b(du|dich|dir|dein|deine|deinen|deinem|deiner|hast|bist|kannst|willst|sollst|musst)\b/g) || []).length;

      // "ihr"-Form Indikatoren
      const ihrMatches = (text.match(/\b(ihr|euch|euer|eure|euren|eurem|eurer|habt|seid|könnt|wollt|sollt|müsst)\b/g) || []).length;

      // "Sie"-Form Indikatoren (großgeschrieben!)
      const sieMatches = (msg.text.match(/\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|haben|sind|können|wollen|sollen|müssen)\b/g) || []).length;

      duScore += duMatches;
      ihrScore += ihrMatches;
      sieScore += sieMatches;
    }

    if (sieScore > duScore && sieScore > ihrScore) return 'Sie';
    if (ihrScore > duScore && ihrScore > sieScore) return 'ihr';
    if (duScore > 0) return 'du';

    return null;
  }

  // ------------------ Menu ------------------
  const setPrefs = () => {
    const p = getPrefs();
    const defMode = prompt(
      'Standard-Modus (auto/zustimmen/ablehnen/gegenangebot/bedenkzeit/info/warnung/diplomatisch/freundlich/aggressiv):',
      p.defaultMode
    ) || p.defaultMode;

    const allowBB = confirm('BB-Codes erlauben? (OK = Ja, Abbrechen = Nein)');
    const noSignoff = confirm('Keine Grußformel am Ende? (OK = Ja, Abbrechen = Nein)');
    const readAllPages = confirm('Alle Seiten laden (vollständiger Verlauf)? (OK = Ja, Abbrechen = Nein)');
    const attachQuote = confirm('Beim Einfügen automatisch die letzte eingehende Nachricht als [quote] voranstellen? (OK = Ja, Abbrechen = Nein)');

    let greetName = prompt('Namen am Anfang ergänzen? (auto/always/never):', p.greetName || 'auto') || p.greetName || 'auto';
    greetName = (['auto', 'always', 'never'].includes(greetName.toLowerCase()) ? greetName.toLowerCase() : 'auto');

    let addressForm = prompt('Anrede-Form (auto/du/ihr/Sie - auto = automatisch erkennen):', p.addressForm || 'auto') || p.addressForm || 'auto';
    addressForm = (['auto', 'du', 'ihr', 'Sie', 'sie'].includes(addressForm) ? (addressForm === 'sie' ? 'Sie' : addressForm) : 'auto');

    GM_setValue(STORAGE.PREFS, { defaultMode: defMode.toLowerCase(), allowBB, noSignoff, readAllPages, attachQuote, greetName, addressForm });
    alert('Voreinstellungen gespeichert.');
  };

  const setKey = () => {
    const prev = GM_getValue(STORAGE.KEY, '');
    const val = prompt('OpenRouter API-Key (openrouter.ai):', prev || '');
    if (val) GM_setValue(STORAGE.KEY, val.trim());
  };

  const setModel = () => {
    const prev = GM_getValue(STORAGE.MODEL, DEFAULT_MODEL);
    const val = prompt('OpenRouter Modell (z. B. "openrouter/auto" oder "google/gemma-2-9b-it:free"):', prev || DEFAULT_MODEL);
    if (val) GM_setValue(STORAGE.MODEL, val.trim());
  };

  const setMyName = () => {
    const prev = GM_getValue(STORAGE.MYNAME, DEFAULT_MY_NAME);
    const val = prompt('Dein Spielername (ich-Perspektive):', prev || DEFAULT_MY_NAME);
    if (val) GM_setValue(STORAGE.MYNAME, val.trim());
  };

  try {
    GM_registerMenuCommand('API-Key setzen/ändern', setKey);
    GM_registerMenuCommand('Modell wählen', setModel);
    GM_registerMenuCommand('Mein Name (ich)', setMyName);
    GM_registerMenuCommand('Voreinstellungen', setPrefs);
  } catch {}

  GM_addStyle(`
    .ai-toolbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center;
      background:#f4e4bc; border:1px solid #7d510f; padding:6px 8px; margin:6px 0; }
    .ai-toolbar select, .ai-toolbar input[type="text"] {
      font-size:12px; padding:3px 6px; border:1px solid #7d510f; background:#fff8e6; color:#492c0a; }
    .ai-btn { background-image:url(https://dsde.innogamescdn.com/asset/4e165360/graphic/index/bg-menu.jpg);
      background-color:#f4e4bc; border:1px solid #7d510f; color:#492c0a; padding:3px 10px;
      font-size:12px; font-weight:bold; cursor:pointer; transition:.2s; }
    .ai-btn:hover { background-color:#ffe4a1; }
    .ai-status { font-size:12px; color:#7d510f; }
    .ai-panel { background:#fffdf5; border:1px dashed #caa258; padding:6px 8px; margin:4px 0; display:none; white-space:pre-wrap; }
    .ai-chip { padding:1px 6px; border:1px solid #caa258; background:#fff1cf; color:#7d510f; border-radius:3px; font-size:11px; }
  `);

  // ------------------ Thread Parsing ------------------
  function harvestFromDoc(doc) {
    let subject = '';
    const ths = doc.querySelectorAll('table.vis th');
    if (ths && ths.length >= 2) subject = getText(ths[1]);

    let topPlayerName = '';
    const rows = Array.from(doc.querySelectorAll('table.vis tr'));
    const playerRow = rows.find(tr => (tr.children[0] && getText(tr.children[0]).toLowerCase() === 'spieler'));
    if (playerRow) {
      const a = playerRow.querySelector('a[href*="info_player"]');
      if (a) topPlayerName = getText(a);
    }

    const posts = Array.from(doc.querySelectorAll('div.post'));
    const messages = posts.map(p => {
      const id = p.id || '';
      const author = getText(p.querySelector('.author a')) || getText(p.querySelector('.author')) || 'Unbekannt';
      const own = p.classList.contains('own');
      const date = getText(p.querySelector('.date'));
      const textEl = p.querySelector('.text');
      let text = '';
      if (textEl) {
        text = textEl.innerText.replace(/\s+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
      }
      return { id, author, own, date, text };
    });

    return { subject, topPlayerName, messages };
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function unique(arr) { return Array.from(new Set(arr)); }

  async function collectWholeThread() {
    const base = harvestFromDoc(document);
    let subject = base.subject;
    let topPlayerName = base.topPlayerName;
    let allMessages = [...base.messages];

    const prefs = getPrefs();
    if (!prefs.readAllPages) {
      return { subject, topPlayerName, messages: allMessages };
    }

    const pageLinks = Array.from(document.querySelectorAll('a.paged-nav-item'));
    const allLink = pageLinks.find(a => a.href.includes('from=-1'));
    let hrefs = [];

    if (allLink) hrefs = [allLink.href];
    else {
      hrefs = unique(pageLinks.map(a => a.href)).filter(Boolean);
      if (!hrefs.includes(location.href)) hrefs.push(location.href);
    }

    const docs = [];
    for (const h of hrefs) {
      try { docs.push(await fetchDoc(h)); } catch {}
      await sleep(CONFIG.REQUEST_DELAY);
    }

    const harvested = docs.map(harvestFromDoc);
    for (const h of harvested) {
      if (!subject && h.subject) subject = h.subject;
      if (!topPlayerName && h.topPlayerName) topPlayerName = h.topPlayerName;
      allMessages.push(...h.messages);
    }

    const seen = new Set();
    const result = [];
    for (const m of allMessages) {
      const key = m.id || (m.author + '|' + m.date + '|' + (m.text || '').slice(0, 60));
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(m);
    }

    result.sort((a, b) => {
      const ai = parseInt(a.id || '0', 10), bi = parseInt(b.id || '0', 10);
      if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
      return 0;
    });

    return { subject, topPlayerName, messages: result };
  }

  // ------------------ Context Building ------------------
  async function buildContext() {
    const { subject, topPlayerName, messages } = await collectWholeThread();
    const myName = (GM_getValue(STORAGE.MYNAME, DEFAULT_MY_NAME) || DEFAULT_MY_NAME).trim();
    const prefs = getPrefs();

    const msgs = messages.map(m => {
      const ownByName = (m.author && m.author.trim() === myName);
      return { ...m, own: (m.own || ownByName) };
    });

    const lastIncoming = [...msgs].reverse().find(m => !m.own);
    const otherName = lastIncoming?.author || topPlayerName || 'Unbekannter Spieler';
    const lastIncomingExcerpt = lastIncoming?.text ? lastIncoming.text.slice(0, 800) : '';

    // Automatische Anredeform-Erkennung
    let detectedAddressForm = prefs.addressForm;
    if (prefs.addressForm === 'auto') {
      const detected = detectAddressForm(msgs, myName);
      detectedAddressForm = detected || 'du';
    }

    // Tokenbudget: priorisiere neuere Beiträge
    let total = 0;
    const compacted = [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const add = JSON.stringify(m).length;
      if (total + add > CONFIG.MAX_THREAD_CHARS) {
        const t = m.text || '';
        const short = t.length > 220 ? (t.slice(0, 220) + ' …') : t;
        compacted.push({ ...m, text: short });
      } else {
        compacted.push(m);
      }
      total += add;
    }
    compacted.reverse();

    return {
      subject,
      myName,
      otherName,
      messages: compacted,
      lastIncoming: lastIncoming ? { author: lastIncoming.author, date: lastIncoming.date, text: lastIncoming.text } : null,
      lastIncomingExcerpt,
      detectedAddressForm
    };
  }

  // ------------------ Post-Processing ------------------
  function splitSentences(s) {
    return (s || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?…])\s+/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  function dedupeSentences(s) {
    const seen = new Set();
    const out = [];
    for (const sent of splitSentences(s)) {
      const key = sent.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sent);
    }
    return out.join(' ');
  }

  function limitNameMentions(text, name) {
    if (!name) return text;
    let count = 0;
    return text.replace(new RegExp(`\\b${escapeRegExp(name)}\\b[,\\s]*`, 'g'), (m) => {
      count++;
      return (count === 1) ? m : '';
    });
  }

  function maybePrefixName(text, name, mode) {
    if (mode === 'never' || !name) return text;
    const startsWithQuote = /^\s*\[quote(?:=|\])/i.test(text);
    const alreadyHasName = new RegExp(`^\\s*${escapeRegExp(name)}\\b`).test(text);
    if (mode === 'always' && !startsWithQuote && !alreadyHasName) {
      return `${name}, ${text}`;
    }
    if (mode === 'auto' && !startsWithQuote && !alreadyHasName) {
      const looksAddressed = /^[A-Za-zÄÖÜäöüß].{0,20},\s/.test(text);
      if (!looksAddressed) return `${name}, ${text}`;
    }
    return text;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cleanupReply(text, { otherName, greetMode }) {
    let t = (text || '').trim();
    t = t.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    t = dedupeSentences(t);
    t = limitNameMentions(t, otherName);
    t = maybePrefixName(t, otherName, greetMode);
    t = t.replace(/\bVielen Dank nochmals\b\.?/gi, 'Danke');
    return t.trim();
  }

  // ------------------ OpenRouter Call ------------------
  async function generateAIReply({ stance = 'auto', extraInstruction = '' }) {
    const apiKey = (GM_getValue(STORAGE.KEY, '') || '').trim();
    if (!apiKey) {
      alert('❌ Kein OpenRouter API-Key gesetzt. Tampermonkey-Menü → „API-Key setzen/ändern".');
      throw new Error('Kein API-Key');
    }
    const model = GM_getValue(STORAGE.MODEL, DEFAULT_MODEL);
    const prefs = getPrefs();
    const ctx = await buildContext();

    const addressLine =
      ctx.detectedAddressForm === 'du'  ? `Sprich ${ctx.otherName} direkt in der "du"-Form an.` :
      ctx.detectedAddressForm === 'ihr' ? `Sprich ${ctx.otherName} in der "ihr"-Form an.` :
      ctx.detectedAddressForm === 'Sie' ? `Sprich ${ctx.otherName} höflich in der "Sie"-Form an.` :
                                          `Sprich ${ctx.otherName} direkt in der "du"-Form an.`;

    const noSignoffRule = prefs.noSignoff ? 'Keine Grußformel am Ende.' : 'Eine knappe Grußformel ist erlaubt.';

    const system = `Du bist ein erfahrener "Die Stämme" (Tribal Wars) Spieler und antwortest als "${ctx.myName}".

KONTEXT-ANALYSE:
- Lies den gesamten Nachrichtenverlauf sorgfältig durch
- Erkenne die Beziehung: Verbündet/Feind/Neutral/Handelspartner
- Identifiziere das Hauptthema: NAP/Bündnis/Handel/Krieg/AG/AGZ
- Beachte vorherige Vereinbarungen und den aktuellen Konfliktstand

LETZTE NACHRICHT FOKUS:
- Beziehe dich KONKRET auf die letzte Nachricht von ${ctx.otherName}
- Gehe auf deren Hauptpunkte ein (kurzer Bezug reicht)
- Führe die Unterhaltung logisch weiter

HALTUNGS-UMSETZUNG:
- "auto": Wähle die beste Reaktion basierend auf Kontext
- "zustimmen": Stimme zu, aber realistisch bleiben
- "ablehnen": Höflich aber bestimmt ablehnen
- "gegenangebot": Faire Alternative vorschlagen
- "bedenkzeit": Um Zeit zum Überlegen bitten
- "info": Gezielte Nachfragen stellen
- "warnung": Klar und direkt, ohne Aggression
- "diplomatisch": Alle Optionen offen halten
- "freundlich": Warm aber nicht naiv
- "aggressiv": Stärke zeigen, im Rahmen bleiben

ANTWORT-STIL:
- ${addressLine}
- Natürlich und authentisch wie ein echter Spieler
- Begriffe aus dem Verlauf beibehalten (AG/AGZ/Stammes-Tags)
- Klare Entscheidungen treffen (Deadlines, Koordinaten, nächste Schritte)
- Maximal eine gezielte Rückfrage, falls nötig

BB-CODES: ${prefs.allowBB ? 'Verwende BB‑Codes immer passend und wo es Sinn macht (z. B. [b] für Betonung, [coord] für Koordinaten, [player] für Namen, [ally] für Stämme, ggf. [quote=${ctx.otherName}]…[/quote] für Referenzen oder farblich hevorheben). Integriere sie natürlich in jede Antwort, ohne Overuse.' : 'KEINE BB‑Codes verwenden.'}

GRUSSFORMEL: ${noSignoffRule}

OUTPUT: Nur JSON, keine Erklärungen:
{
  "stance": "gewählte_haltung",
  "reply": "deine_antwort",
  "summary": "kurze_situationsanalyse",
  "quote": "relevanter_text_zum_zitieren",
  "confidence": 0.8,
  "tags": ["thema1", "thema2"],
  "bb_used": true/false,
  "addressed_to": "${ctx.otherName}"
}`;

    const userPayload = {
      thread_subject: ctx.subject,
      my_name: ctx.myName,
      other_name: ctx.otherName,
      stance_request: stance || 'auto',
      extra_instruction: extraInstruction || '',
      preferences: {
        language: 'de-DE',
        allow_bb: !!prefs.allowBB,
        no_signoff: !!prefs.noSignoff,
        address_form: ctx.detectedAddressForm
      },
      last_incoming: ctx.lastIncoming || { author: ctx.otherName, date: '', text: ctx.lastIncomingExcerpt },
      messages: ctx.messages
    };

    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(userPayload) }
      ],
      temperature: 0.5,
      top_p: 0.9,
      frequency_penalty: 0.7,
      presence_penalty: 0.2,
      max_tokens: 800
    };

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.href,
        'X-Title': 'Die Stämme AI-Helper'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err?.error?.message) msg += ` — ${err.error.message}`;
      } catch {}

      const errorMsg = res.status === 401 ? '❌ API-Key ungültig oder abgelaufen' :
                       res.status === 429 ? '⏰ Zu viele Anfragen - bitte 1 Min warten' :
                       res.status >= 500 ? '🔧 Server-Problem - später versuchen' :
                       `❓ Unbekannter Fehler: ${msg}`;
      throw new Error(errorMsg);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'API-Fehler');

    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = tryParseJSON(content);
    let out = null;

    if (parsed && typeof parsed.reply === 'string') {
      out = parsed;
    } else {
      out = {
        stance: stance || 'auto',
        reply: (content || '').trim(),
        summary: '',
        quote: '',
        confidence: 0.5,
        tags: [],
        bb_used: /\[(b|i|u|s|color|size|quote|player|ally|coord|village|claim|unit|building|url|report|report_display|spoiler|table)\b/i.test(content),
        addressed_to: ctx.otherName
      };
    }

    const cleaned = cleanupReply(out.reply, { otherName: ctx.otherName, greetMode: getPrefs().greetName });
    out.reply = cleaned;

    return out;
  }

  // ------------------ Textarea / Insertion ------------------
  async function ensureReplyTextarea() {
    let ta = document.querySelector('#message');
    if (ta) return ta;

    const replyLink = document.querySelector('a[href*="IGM.view.beginReply"]') ||
                      Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Antworten'));
    if (replyLink) {
      replyLink.click();
      for (let i = 0; i < 25; i++) {
        await sleep(100);
        ta = document.querySelector('#message');
        if (ta) return ta;
      }
    }
    ta = document.querySelector('#message');
    if (ta) return ta;
    throw new Error('Textarea #message nicht gefunden.');
  }

  function insertIntoTextarea({ reply, attachQuote, fallbackQuoteText, otherName }) {
    const ta = document.querySelector('#message');
    if (!ta) return;

    let finalText = reply.trim();
    const alreadyQuoted = /\[quote(?:=|\])/i.test(finalText);

    if (attachQuote && !alreadyQuoted && fallbackQuoteText) {
      const short = fallbackQuoteText.trim().slice(0, CONFIG.QUOTE_MAX_LENGTH);
      finalText = `[quote=${otherName}]\n${short}\n[/quote]\n\n${finalText}`;
    }

    ta.value = finalText;
    ta.style.backgroundColor = '#e8f5e9';
    setTimeout(() => (ta.style.backgroundColor = ''), CONFIG.UI_HIGHLIGHT_DURATION);
    ta.focus();
  }

  // ------------------ Toolbar UI ------------------
  function makeToolbar({ mountBefore }) {
    const prefs = getPrefs();
    const toolbar = el('div', { className: 'ai-toolbar' });

    const modeSel = el('select', { title: 'Haltung/Stil wählen' },
      ...STANCE_PRESETS.map(([v, label]) => {
        const o = el('option', { value: v }, label);
        if (v === prefs.defaultMode) o.selected = true;
        return o;
      })
    );

    const customInput = el('input', {
      type: 'text',
      placeholder: 'Zusatz (optional), z. B. "kurz & direkt" oder "diplomatisch"',
      style: { minWidth: '220px' },
      title: 'Optionale Zusatzanweisung für die KI'
    });

    const quoteLabel = el('label', { title: 'Letzte Nachricht automatisch als Zitat voranstellen' },
      el('input', { type: 'checkbox', checked: !!prefs.attachQuote }),
      ' Zitat anfügen'
    );

    const genBtn = el('button', {
      className: 'ai-btn',
      textContent: '🤖 Analysieren & Vorschlag',
      title: 'Analysiert den Verlauf und erstellt passende Antwort (10-15 Sekunden)'
    });

    const insertBtn = el('button', {
      className: 'ai-btn',
      textContent: '↪️ Einfügen',
      disabled: true,
      title: 'Fügt die generierte Antwort in das Textfeld ein'
    });

    const status = el('span', { className: 'ai-status' });
    const panel = el('div', { className: 'ai-panel' });

    // Address form chip - wird async aktualisiert
    const addressChip = el('span', { className: 'ai-chip' }, 'Anrede: ...');

    // Aktualisiere Address-Chip async
    buildContext().then(ctx => {
      const form = ctx.detectedAddressForm || 'unbekannt';
      const isAuto = getPrefs().addressForm === 'auto';
      addressChip.textContent = isAuto ? `Anrede: ${form} (auto)` : `Anrede: ${form}`;
    }).catch(() => {
      addressChip.textContent = `Anrede: ${prefs.addressForm}`;
    });

    toolbar.append(
      el('span', { className: 'ai-chip' }, 'Stämme‑Experte v2.7'),
      modeSel,
      customInput,
      el('span', { className: 'ai-chip' }, `Ich: ${GM_getValue(STORAGE.MYNAME, DEFAULT_MY_NAME)}`),
      el('span', { className: 'ai-chip' }, prefs.allowBB ? 'BB: an' : 'BB: aus'),
      addressChip,
      el('span', { className: 'ai-chip' }, `Name: ${prefs.greetName}`),
      quoteLabel,
      genBtn,
      insertBtn,
      status
    );
    toolbar.after(panel);

    let lastResult = null;

    genBtn.onclick = async () => {
      const prefs = getPrefs();
      status.textContent = prefs.readAllPages ? 'Lese Verlauf (alle Seiten)…' : 'Lese Verlauf…';
      insertBtn.disabled = true;
      panel.style.display = 'none';
      genBtn.disabled = true;
      genBtn.textContent = '⏳ Analysiere... (10-15s)';

      try {
        const data = await generateAIReply({
          stance: modeSel.value,
          extraInstruction: customInput.value.trim()
        });

        lastResult = data;

        const ta = document.querySelector('#message');
        if (ta && data.reply) {
          ta.value = data.reply.trim();
          ta.style.backgroundColor = '#ffffcc';
          setTimeout(() => (ta.style.backgroundColor = ''), 800);
        }

        const tags = (data.tags && data.tags.length) ? `Tags: ${data.tags.join(', ')}` : '';
        const conf = (typeof data.confidence === 'number') ? `Confidence: ${(data.confidence * 100).toFixed(0)}%` : '';
        const bb = data.bb_used ? 'BB: genutzt' : 'BB: —';
        const addressed = data.addressed_to ? `An: ${data.addressed_to}` : '';
        panel.textContent =
          (data.summary ? `Analyse: ${data.summary}\n` : '') +
          (tags ? `${tags}\n` : '') +
          (conf ? `${conf}\n` : '') +
          [bb, addressed].filter(Boolean).join(' · ');
        if (panel.textContent) panel.style.display = 'block';

        insertBtn.disabled = !data.reply;
        status.textContent = data.reply ? '✅ Vorschlag bereit.' : '❌ Keine Antwort erhalten.';
      } catch (e) {
        console.error('AI-Helper Fehler:', e);
        alert(e.message || 'Unbekannter Fehler beim Generieren');
        status.textContent = '❌ Fehler.';
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = '🤖 Analysieren & Vorschlag';
      }
    };

    insertBtn.onclick = async () => {
      if (!lastResult?.reply) return;
      insertBtn.disabled = true;
      status.textContent = 'Füge ein…';
      try {
        await ensureReplyTextarea();
        const { otherName, lastIncomingExcerpt } = await buildContext();
        insertIntoTextarea({
          reply: lastResult.reply,
          attachQuote: quoteLabel.querySelector('input').checked,
          fallbackQuoteText: lastIncomingExcerpt,
          otherName
        });
        status.textContent = '✅ Eingefügt.';
      } catch (e) {
        console.error('Insert Error:', e);
        alert('Konnte Textarea nicht finden/öffnen.');
        status.textContent = '❌ Fehler beim Einfügen.';
      } finally {
        insertBtn.disabled = false;
      }
    };

    if (mountBefore && mountBefore.parentNode) {
      mountBefore.parentNode.insertBefore(toolbar, mountBefore);
    } else {
      document.body.insertBefore(toolbar, document.body.firstChild);
    }
  }

  // ------------------ Init on View/Write ------------------
  function initViewPage() {
    const bbBar = document.querySelector('#bb_bar');
    const textarea = document.querySelector('#message');
    const actionRow = document.querySelector('#action_row');
    const fallback = document.querySelector('.vis') || document.body;
    const mount = bbBar || textarea || actionRow || fallback;
    makeToolbar({ mountBefore: mount });
  }

  function initWritePage() {
    const textarea = document.querySelector('#message');
    const fallback = document.querySelector('.vis') || document.body;
    makeToolbar({ mountBefore: textarea || fallback });

    const savedText = localStorage.getItem('ai_generated_text');
    if (savedText && textarea) {
      textarea.value = savedText;
      localStorage.removeItem('ai_generated_text');
      textarea.style.backgroundColor = '#ffffcc';
      setTimeout(() => (textarea.style.backgroundColor = ''), CONFIG.UI_HIGHLIGHT_DURATION);
    }
  }

  try {
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode') || '';
    if (mode.includes('view')) initViewPage();
    else if (mode.includes('write')) initWritePage();
    else if (location.search.includes('mode=view') || location.search.includes('mode=write')) {
      (document.readyState === 'loading')
        ? document.addEventListener('DOMContentLoaded', () => (location.search.includes('mode=view') ? initViewPage() : initWritePage()))
        : (location.search.includes('mode=view') ? initViewPage() : initWritePage());
    }
  } catch (e) {
    console.error('AI-Helper Init-Fehler:', e);
  }
})();
