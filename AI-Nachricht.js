// ==UserScript==
// @name         Die Stämme AI-Nachrichten-Helper v3.3 (Free-Optimized)
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Kontext-Analyse, Caching, Queue + Token-Bucket, Retry-After, Free-Fallback-Modelle, Vorschau, Varianten, Shortcuts, Kurznotiz-Intents
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

  // ==================== CONSTANTS ====================
  const CONSTANTS = {
    DELAYS: {
      REQUEST: 80,
      UI_HIGHLIGHT: 1000,
      RETRY_BASE: 1000,
      TEXTAREA_CHECK: 100,
      RATE_MAX_WAIT: 60000
    },
    LIMITS: {
      THREAD_CHARS: 20000,
      QUOTE_LENGTH: 600,
      CACHE_SIZE: 10,
      CACHE_TTL: 300000, // 5 min
      MAX_RETRIES: 3
    },
    REGEX: {
      BB_CODE: /\[(b|i|u|s|color|size|quote|player|ally|coord|village|claim|unit|building|url|report|spoiler|table)\b/i,
      QUOTE_START: /^\s*\[quote(?:=|\])/i
    }
  };

  // === OpenRouter Free-Limits & Helpers ===
  const OPENROUTER = {
    SAFETY_RPM: 18,
    MODELS_TTL: 6 * 60 * 60 * 1000,
    MODELS_STORE: 'or_free_models_cache'
  };

  const STORAGE = {
    KEY: 'openrouter_key',
    MODEL: 'openrouter_model',
    PREFS: 'ds_ai_prefs_v30',
    MYNAME: 'ds_my_name'
  };

  const THREAD_META_PREFIX = 'ds_ai_thread_meta:';

  const DEFAULT_MODEL = 'moonshotai/kimi-k2:free';
  const DEFAULT_MY_NAME = 'Djossi09';

  const DEFAULT_PREFS = {
    defaultMode: 'auto',
    allowBB: true,
    noSignoff: true,
    readAllPages: true,
    attachQuote: true,
    greetName: 'auto',
    addressForm: 'auto',
    length: 'auto',      // auto | short | medium | long
    tone: 'auto',        // auto | soft | neutral | hard
    language: 'auto',    // auto | de | en
    quoteMode: 'last'    // last | none | manual
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
    ['direkt', 'Direkt & Klar']
  ];

  const STANCE_EXPLANATIONS = {
    'auto': 'Wähle die beste Reaktion basierend auf Kontext',
    'zustimmen': 'Stimme zu, aber realistisch bleiben',
    'ablehnen': 'Höflich aber bestimmt ablehnen',
    'gegenangebot': 'Faire Alternative vorschlagen',
    'bedenkzeit': 'Um Zeit zum Überlegen bitten',
    'info': 'Gezielte Nachfragen stellen',
    'warnung': 'Klar und direkt, ohne Aggression',
    'diplomatisch': 'Alle Optionen offen halten',
    'freundlich': 'Warm aber nicht naiv',
    'direkt': 'Klar auf den Punkt, keine Umschweife'
  };

  const LENGTH_PRESETS = [
    ['auto', 'Länge: Auto'],
    ['short', 'Länge: Kurz'],
    ['medium', 'Länge: Mittel'],
    ['long', 'Länge: Ausführlich']
  ];

  const TONE_PRESETS = [
    ['auto', 'Ton: Auto'],
    ['soft', 'Ton: Weich'],
    ['neutral', 'Ton: Neutral'],
    ['hard', 'Ton: Direkt/Hart']
  ];

  const LANGUAGE_PRESETS = [
    ['auto', 'Sprache: Auto'],
    ['de', 'Sprache: Deutsch'],
    ['en', 'Sprache: Englisch']
  ];

  const SITUATION_PRESETS = [
    ['none', 'Situation: Allgemein'],
    ['support', 'Unterstützung'],
    ['tribe_join', 'Stammeswechsel/Bewerbung'],
    ['coord_attack', 'AG/Angriffskoordination'],
    ['diplomatic', 'Diplomatie (NAP/BND)']
  ];

  const SITUATION_HINTS = {
    support: 'Situation: Es geht um Unterstützung (Deff/Off, Truppenbewegungen, Unterstützungserwartungen).',
    tribe_join: 'Situation: Spieler möchte den Stamm wechseln oder sich bewerben. Achte auf Loyalität, Aktivität und Stammesregeln.',
    coord_attack: 'Situation: Angriffs- oder AG-Koordination. Achte auf klare Zeiten, Koordination und Verbindlichkeit.',
    diplomatic: 'Situation: Diplomatische Anfrage (NAP/BND/Krieg). Achte auf höflichen, aber klaren Ton.'
  };

  const ERROR_MESSAGES = {
    401: 'API-Key ungültig. Bitte neuen Key setzen (Menü → "API-Key setzen").',
    429: 'Rate Limit erreicht. Warte kurz und versuche es erneut.',
    500: 'Server-Fehler. In Kürze erneut versuchen.',
    503: 'Service temporär nicht verfügbar.',
    timeout: 'Zeitüberschreitung. Verbindung prüfen.',
    no_key: 'Kein API-Key gesetzt. Menü → "API-Key setzen/ändern".',
    invalid_key: 'API-Key-Format wirkt ungewöhnlich. Prüfe, ob der Key korrekt kopiert wurde.',
    rate_limit_wait_timeout: 'Wartezeit für Rate-Limit-Slot überschritten. Später erneut probieren.'
  };

  class AIError extends Error {
    constructor(code) {
      super(ERROR_MESSAGES[code] || code);
      this.name = 'AIError';
      this.code = code;
    }
  }

  function getThreadMetaKey(subject) {
    return THREAD_META_PREFIX + (subject || 'unknown');
  }

  // ==================== DOM CACHE ====================
  const DOM_CACHE = {
    _cache: {},
    get(selector) {
      if (!this._cache[selector]) {
        this._cache[selector] = document.querySelector(selector);
      }
      return this._cache[selector];
    },
    invalidate() {
      this._cache = {};
    },
    get textarea() { return this.get('#message'); },
    get bbBar() { return this.get('#bb_bar'); },
    get actionRow() { return this.get('#action_row'); }
  };

  // ==================== TOKEN-BUCKET RATE LIMITER ====================
  const RATE_LIMITER = (() => {
    let tokens = OPENROUTER.SAFETY_RPM;
    let lastRefill = Date.now();
    function refill() {
      const now = Date.now();
      const mins = (now - lastRefill) / 60000;
      if (mins > 0) {
        tokens = Math.min(OPENROUTER.SAFETY_RPM, tokens + mins * OPENROUTER.SAFETY_RPM);
        lastRefill = now;
      }
    }
    return {
      async waitForSlot() {
        const start = Date.now();
        for (;;) {
          refill();
          if (tokens >= 1) {
            tokens -= 1;
            return;
          }
          if (Date.now() - start > CONSTANTS.DELAYS.RATE_MAX_WAIT) {
            throw new AIError('rate_limit_wait_timeout');
          }
          const wait = Math.max(250, Math.ceil((1 - tokens) / OPENROUTER.SAFETY_RPM * 60000));
          await sleep(wait);
        }
      }
    };
  })();

  // ==================== SINGLE-CONCURRENCY REQUEST QUEUE ====================
  const REQUEST_QUEUE = (() => {
    const q = [];
    let active = false;
    async function run() {
      if (active) return;
      active = true;
      while (q.length) {
        const job = q.shift();
        try { job.resolve(await job.fn()); }
        catch (e) { job.reject(e); }
      }
      active = false;
    }
    return {
      push(fn) { return new Promise((resolve, reject) => { q.push({ fn, resolve, reject }); run(); }); },
      size() { return q.length; }
    };
  })();

  // ==================== RESPONSE CACHE ====================
  const RESPONSE_CACHE = {
    cache: new Map(),
    key(ctx, opts) {
      const { stance, extraInstruction, length, tone, language, situation } = opts;
      const msgs = ctx.messages.slice(-3).map(m => m.text?.slice(0, 100)).join('|');
      return [stance, extraInstruction, length, tone, language, situation, msgs].join(':');
    },
    get(ctx, opts) {
      const k = this.key(ctx, opts);
      const cached = this.cache.get(k);
      if (cached && Date.now() - cached.time < CONSTANTS.LIMITS.CACHE_TTL) {
        console.log('[DS-AI] Cache hit');
        return cached.data;
      }
      return null;
    },
    set(ctx, opts, data) {
      this.cache.set(this.key(ctx, opts), { data, time: Date.now() });
      if (this.cache.size > CONSTANTS.LIMITS.CACHE_SIZE) {
        const first = this.cache.keys().next().value;
        this.cache.delete(first);
      }
    },
    clear() {
      this.cache.clear();
    }
  };

  // ==================== CONTEXT CACHE ====================
  let CTX_CACHE = null;
  let CTX_CACHE_TIME = 0;
  const CTX_TTL = 30000; // 30s

  async function getContextCached(progressCallback) {
    const now = Date.now();
    if (CTX_CACHE && now - CTX_CACHE_TIME < CTX_TTL && !progressCallback) {
      return CTX_CACHE;
    }
    const ctx = await buildContext(progressCallback);
    CTX_CACHE = ctx;
    CTX_CACHE_TIME = now;
    return ctx;
  }

  // ==================== UTILITIES ====================
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'style') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'onclick') node.addEventListener('click', v);
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
    let clean = s.replace(/```json|```/gi, '').trim();

    const candidates = [];
    const braceRegex = /\{[\s\S]*?\}/g;
    let m;
    while ((m = braceRegex.exec(clean)) !== null) {
      candidates.push(m[0]);
    }
    if (!candidates.length) candidates.push(clean);

    // zuerst nach Objekt mit "reply" suchen
    for (const cand of candidates) {
      try {
        const obj = JSON.parse(cand);
        if (obj && typeof obj === 'object' && typeof obj.reply === 'string') return obj;
      } catch (_) {}
    }
    // dann erster gültiger JSON-Block
    for (const cand of candidates) {
      try {
        const obj = JSON.parse(cand);
        if (obj && typeof obj === 'object') return obj;
      } catch (_) {}
    }
    console.warn('[DS-AI] JSON Parse failed, returning null. Input:', clean.slice(0, 200));
    return null;
  };

  const getPrefs = () => {
    const saved = GM_getValue(STORAGE.PREFS);
    return saved ? { ...DEFAULT_PREFS, ...saved } : { ...DEFAULT_PREFS };
  };

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function validateApiKey(key) {
    return !!key && key.startsWith('sk-or-v1-') && key.length > 40;
  }

  // ==================== INLINE USER INTENT (TEXTAREA SHORTCUT) ====================
  function analyzeDraftHintFromTextarea() {
    const ta = DOM_CACHE.textarea;
    if (!ta) return { hint: null, overrides: {} };
    const raw = (ta.value || '').trim();
    if (!raw) return { hint: null, overrides: {} };

    // Nur wirklich kurze Stichworte als Intent benutzen
    if (raw.length > 200 || raw.includes('\n') || CONSTANTS.REGEX.BB_CODE.test(raw)) {
      return { hint: null, overrides: {} };
    }

    const t = raw.toLowerCase();
    const overrides = {};

    // Haltung (stance)
    if (/(ablehn|kein[e ]zeit|keine zeit|nein[,! ]|schaff[e]? ich nicht|kann ich nicht|kann nicht|unmöglich)/.test(t)) {
      overrides.stance = 'ablehnen';
    }
    if (!overrides.stance && /(einverstanden|einverstande|okay|ok\b|passt|zustimm|klingt gut|mach ich|bin dabei)/.test(t)) {
      overrides.stance = 'zustimmen';
    }
    if (!overrides.stance && /(gegenangebot|alternativ|anderes angebot|andere lösung|kompromiss|vorschlag)/.test(t)) {
      overrides.stance = 'gegenangebot';
    }
    if (!overrides.stance && /(bedenkzeit|überlegen|später entscheiden|melde mich|nachdenken|zeit zum überlegen)/.test(t)) {
      overrides.stance = 'bedenkzeit';
    }
    if (!overrides.stance && /(frage|fragen|infos|information|näher erklären|genauer|detail)/.test(t)) {
      overrides.stance = 'info';
    }
    if (!overrides.stance && /(warnung|warnen|droh|konsequenz|letzte chance|ernst meinen)/.test(t)) {
      overrides.stance = 'warnung';
    }

    // Ton
    if (/(freundlich|nett|höflich|soft)/.test(t)) {
      overrides.tone = 'soft';
    } else if (/(neutral)/.test(t)) {
      overrides.tone = 'neutral';
    } else if (/(direkt|hart|knallhart|sehr klar)/.test(t)) {
      overrides.tone = 'hard';
    }

    // Länge
    if (/(kurz|knapp|1-2 sätze|eine zeile|kurze antwort)/.test(t)) {
      overrides.length = 'short';
    } else if (/(ausführlich|lang|detailliert|lange antwort)/.test(t)) {
      overrides.length = 'long';
    }

    // Sprache
    if (/(englisch|english|auf englisch)/.test(t)) {
      overrides.language = 'en';
    } else if (/(deutsch|auf deutsch)/.test(t)) {
      overrides.language = 'de';
    }

    if (!Object.keys(overrides).length) {
      return { hint: null, overrides: {} };
    }

    return { hint: raw, overrides };
  }

  // ==================== IMPROVED ADDRESS DETECTION ====================
  function detectAddressForm(messages, myName) {
    const recentMessages = messages.filter(m => !m.own && m.text).slice(-5);
    if (recentMessages.length === 0) return 'du';

    const patterns = {
      du: /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|hast|bist|kannst|willst|sollst|musst)\b/gi,
      ihr: /\b(ihr|euch|euer|eure|euren|eurem|eurer|habt|seid|könnt|wollt|sollt|müsst)\b/gi,
      Sie: /\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/g
    };

    const scores = { du: 0, ihr: 0, Sie: 0 };

    for (const msg of recentMessages) {
      scores.du += (msg.text.match(patterns.du) || []).length;
      scores.ihr += (msg.text.match(patterns.ihr) || []).length;
      scores.Sie += (msg.text.match(patterns.Sie) || []).length;
    }

    const winner = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
    return scores[winner] > 0 ? winner : 'du';
  }

  // ==================== ERROR HANDLING ====================
  function showError(code, options = {}) {
    const { retry = false, autoRetry = false } = options;
    const msg = ERROR_MESSAGES[code] || `Fehler ${code}`;

    if (autoRetry) return true;

    if (retry && confirm(`${msg}\n\nErneut versuchen?`)) return true;

    alert(msg);
    return false;
  }

  function parseRetryAfter(msOrDate) {
    if (!msOrDate) return 0;
    const n = Number(msOrDate);
    if (!Number.isNaN(n)) return Math.max(1000, n * 1000);
    const dt = new Date(msOrDate).getTime();
    return isFinite(dt) ? Math.max(1000, dt - Date.now()) : 0;
  }

  async function fetchWithRetry(url, options, maxRetries = CONSTANTS.LIMITS.MAX_RETRIES) {
    let lastErr = null;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;

        if (res.status === 429) {
          const ra = res.headers.get('retry-after');
          const xr = res.headers.get('x-ratelimit-reset') || res.headers.get('x-ratelimit-reset-requests');
          const wait = parseRetryAfter(ra) || parseRetryAfter(xr) || Math.pow(2, i) * CONSTANTS.DELAYS.RETRY_BASE;
          console.warn('[DS-AI] 429 – warte', wait, 'ms');
          await sleep(wait);
          continue;
        }

        if (res.status >= 500 && i < maxRetries - 1) {
          const wait = Math.pow(2, i) * CONSTANTS.DELAYS.RETRY_BASE;
          console.warn('[DS-AI] Serverfehler', res.status, '– retry in', wait, 'ms');
          await sleep(wait);
          continue;
        }

        return res;
      } catch (e) {
        lastErr = e;
        if (i === maxRetries - 1) throw e;
        await sleep(Math.pow(2, i) * CONSTANTS.DELAYS.RETRY_BASE);
      }
    }
    throw lastErr || new Error('Max retries reached');
  }

  // Dynamische Free-Fallback-Liste (aus /api/v1/models), gecached
  async function getFreeFallbackModels() {
    const cache = GM_getValue(OPENROUTER.MODELS_STORE);
    if (cache && Date.now() - cache.time < OPENROUTER.MODELS_TTL) {
      return cache.list || [];
    }
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      const json = await res.json();
      const ids = (json?.data || [])
        .filter(m => typeof m?.id === 'string' && m.id.endsWith(':free'))
        .map(m => m.id);
      const uniq = Array.from(new Set(ids));
      GM_setValue(OPENROUTER.MODELS_STORE, { time: Date.now(), list: uniq });
      return uniq;
    } catch {
      return [
        'deepseek/deepseek-chat:free',
        'google/gemma-2-9b-it:free',
        'meta-llama/llama-3.1-8b-instruct:free',
        'z-ai/glm-4.6:free'
      ];
    }
  }

  // ==================== MENU ====================>
  const setPrefs = () => {
    const p = getPrefs();
    const defMode = (prompt(
      'Standard-Modus:\n' + STANCE_PRESETS.map(([v, l]) => `${v} = ${l}`).join('\n'),
      p.defaultMode
    ) || p.defaultMode).toLowerCase();

    const allowBB = confirm('BB-Codes erlauben? (OK = Ja, Abbrechen = Nein)');
    const noSignoff = confirm('Keine Grußformel am Ende? (OK = Ja, Abbrechen = Nein)');
    const readAllPages = confirm('Alle Seiten laden (vollständiger Verlauf)? (OK = Ja, Abbrechen = Nein)');

    let greetName = prompt('Namen am Anfang ergänzen? (auto/always/never):', p.greetName || 'auto') || p.greetName || 'auto';
    greetName = (['auto', 'always', 'never'].includes(greetName.toLowerCase()) ? greetName.toLowerCase() : 'auto');

    let addressForm = prompt('Anrede-Form (auto/du/ihr/Sie):', p.addressForm || 'auto') || p.addressForm || 'auto';
    addressForm = (['auto', 'du', 'ihr', 'Sie'].includes(addressForm) ? addressForm : 'auto');

    let length = prompt('Standard-Antwortlänge (auto/short/medium/long):', p.length || 'auto') || p.length || 'auto';
    length = ['auto', 'short', 'medium', 'long'].includes(length) ? length : 'auto';

    let tone = prompt('Standard-Ton (auto/soft/neutral/hard):', p.tone || 'auto') || p.tone || 'auto';
    tone = ['auto', 'soft', 'neutral', 'hard'].includes(tone) ? tone : 'auto';

    let language = prompt('Antwortsprache (auto/de/en):', p.language || 'auto') || p.language || 'auto';
    language = ['auto', 'de', 'en'].includes(language) ? language : 'auto';

    let quoteMode = prompt('Standard-Zitatmodus (last/none/manual):', p.quoteMode || (p.attachQuote ? 'last' : 'none')) || p.quoteMode || (p.attachQuote ? 'last' : 'none');
    quoteMode = ['last', 'none', 'manual'].includes(quoteMode) ? quoteMode : 'last';

    const attachQuote = quoteMode === 'last';

    GM_setValue(STORAGE.PREFS, {
      defaultMode: defMode,
      allowBB,
      noSignoff,
      readAllPages,
      attachQuote,
      greetName,
      addressForm,
      length,
      tone,
      language,
      quoteMode
    });
    alert('Voreinstellungen gespeichert.');
  };

  const setKey = () => {
    const prev = GM_getValue(STORAGE.KEY, '');
    const val = prompt('OpenRouter API-Key (beginnt mit sk-or-v1-):', prev || '');
    if (val) {
      if (!validateApiKey(val)) {
        alert('Key-Format wirkt ungewöhnlich. Keys beginnen typischerweise mit "sk-or-v1-" und sind länger als 40 Zeichen.');
      }
      GM_setValue(STORAGE.KEY, val.trim());
      alert('API-Key gespeichert.');
    }
  };

  const setModel = () => {
    const prev = GM_getValue(STORAGE.MODEL, DEFAULT_MODEL);
    const val = prompt('OpenRouter Modell:', prev || DEFAULT_MODEL);
    if (val) GM_setValue(STORAGE.MODEL, val.trim());
  };

  const setMyName = () => {
    const prev = GM_getValue(STORAGE.MYNAME, DEFAULT_MY_NAME);
    const val = prompt('Dein Spielername (ich-Perspektive):', prev || DEFAULT_MY_NAME);
    if (val) GM_setValue(STORAGE.MYNAME, val.trim());
  };

  const clearCache = () => {
    RESPONSE_CACHE.clear();
    CTX_CACHE = null;
    CTX_CACHE_TIME = 0;
    alert('Cache geleert.');
  };

  try {
    GM_registerMenuCommand('API-Key setzen/ändern', setKey);
    GM_registerMenuCommand('Modell wählen', setModel);
    GM_registerMenuCommand('Mein Name (ich)', setMyName);
    GM_registerMenuCommand('Voreinstellungen', setPrefs);
    GM_registerMenuCommand('Cache leeren', clearCache);
  } catch (e) {
    console.warn('[DS-AI] Menu-Befehle nicht verfügbar:', e);
  }

  GM_addStyle(`
    .ai-toolbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center;
      background:#f4e4bc; border:1px solid #7d510f; padding:6px 8px; margin:6px 0; border-radius:4px; }
    .ai-toolbar select, .ai-toolbar input[type="text"] {
      font-size:12px; padding:3px 6px; border:1px solid #7d510f; background:#fff8e6; color:#492c0a; }
    .ai-btn { background-image:url(https://dsde.innogamescdn.com/asset/4e165360/graphic/index/bg-menu.jpg);
      background-color:#f4e4bc; border:1px solid #7d510f; color:#492c0a; padding:4px 12px;
      font-size:12px; font-weight:bold; cursor:pointer; transition:.2s; border-radius:3px; }
    .ai-btn:hover { background-color:#ffe4a1; transform:translateY(-1px); }
    .ai-btn:disabled { opacity:0.5; cursor:not-allowed; transform:none; }
    .ai-status { font-size:12px; color:#7d510f; font-weight:500; }
    .ai-panel { background:#fffdf5; border:1px dashed #caa258; padding:8px; margin:4px 0;
      display:none; white-space:pre-wrap; border-radius:3px; font-size:12px; }
    .ai-chip { padding:2px 8px; border:1px solid #caa258; background:#fff1cf; color:#7d510f;
      border-radius:3px; font-size:11px; font-weight:500; }
    .ai-modal { position:fixed; top:50%; left:50%; transform:translate(-50%, -50%);
      background:#fff; padding:20px; border:2px solid #7d510f; z-index:99999;
      max-width:700px; max-height:80vh; overflow:auto; border-radius:6px; box-shadow:0 4px 20px rgba(0,0,0,0.3); }
    .ai-modal h3 { margin:0 0 15px 0; color:#492c0a; border-bottom:2px solid #caa258; padding-bottom:8px; }
    .ai-modal-close { position:absolute; top:10px; right:10px; background:#e74c3c; color:#fff;
      border:none; padding:5px 10px; cursor:pointer; border-radius:3px; font-weight:bold; }
    .ai-modal-close:hover { background:#c0392b; }
    .ai-variant-item { border:1px solid #caa258; padding:12px; margin:10px 0; background:#fffef8;
      border-radius:4px; cursor:pointer; transition:.2s; }
    .ai-variant-item:hover { background:#fff8e6; border-color:#7d510f; transform:translateY(-2px);
      box-shadow:0 2px 8px rgba(125,81,15,0.2); }
    .ai-variant-header { font-weight:bold; color:#7d510f; margin-bottom:8px;
      display:flex; justify-content:space-between; align-items:center; }
    .ai-variant-text { color:#492c0a; line-height:1.5; max-height:150px; overflow-y:auto;
      white-space:pre-wrap; word-wrap:break-word; }
    .ai-preview-content { background:#f9f9f9; padding:15px; border:1px solid #ddd;
      border-radius:4px; margin:15px 0; line-height:1.6; }
    .ai-loading { display:inline-block; width:16px; height:16px; border:2px solid #7d510f;
      border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
  `);

  // ==================== THREAD PARSING ====================
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

  async function collectWholeThread(progressCallback) {
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
    for (let i = 0; i < hrefs.length; i++) {
      if (progressCallback) progressCallback(i + 1, hrefs.length);
      try { docs.push(await fetchDoc(hrefs[i])); } catch (e) { console.warn('[DS-AI] Fetch failed:', e); }
      await sleep(CONSTANTS.DELAYS.REQUEST);
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

  // ==================== CONTEXT BUILDING ====================
  async function buildContext(progressCallback) {
    const { subject, topPlayerName, messages } = await collectWholeThread(progressCallback);
    const myName = (GM_getValue(STORAGE.MYNAME, DEFAULT_MY_NAME) || DEFAULT_MY_NAME).trim();
    const prefs = getPrefs();

    const msgs = messages.map(m => {
      const ownByName = (m.author && m.author.trim() === myName);
      return { ...m, own: (m.own || ownByName) };
    });

    const lastIncoming = [...msgs].reverse().find(m => !m.own);
    const otherName = lastIncoming?.author || topPlayerName || 'Unbekannter Spieler';
    const lastIncomingExcerpt = lastIncoming?.text ? lastIncoming.text.slice(0, 800) : '';

    let detectedAddressForm = prefs.addressForm;
    if (prefs.addressForm === 'auto') {
      const detected = detectAddressForm(msgs, myName);
      detectedAddressForm = detected || 'du';
    }

    // Kontext begrenzen, ältere Nachrichten in Kurzfassung packen
    const maxChars = CONSTANTS.LIMITS.THREAD_CHARS;
    const keptReverse = [];
    const overflow = [];
    let total = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const size = JSON.stringify(m).length;
      if (total + size > maxChars) {
        overflow.push(m);
      } else {
        keptReverse.push(m);
        total += size;
      }
    }
    const kept = keptReverse.reverse();

    if (overflow.length) {
      const summaryLines = overflow.slice(-10).map(m => {
        const t = (m.text || '').replace(/\s+/g, ' ');
        const short = t.length > 120 ? t.slice(0, 120) + '…' : t;
        return `• ${m.author}: ${short}`;
      }).join('\n');
      kept.unshift({
        id: 'summary',
        author: 'Verlauf',
        own: false,
        date: '',
        text: `Kurzfassung älterer Nachrichten (automatisch):\n${summaryLines}`
      });
    }

    return {
      subject,
      myName,
      otherName,
      messages: kept,
      lastIncoming: lastIncoming ? { author: lastIncoming.author, date: lastIncoming.date, text: lastIncoming.text } : null,
      lastIncomingExcerpt,
      detectedAddressForm
    };
  }

  // ==================== POST-PROCESSING ====================
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
    const startsWithQuote = CONSTANTS.REGEX.QUOTE_START.test(text);
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

  function cleanupReply(text, { otherName, greetMode }) {
    let t = (text || '').trim();
    t = t.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    t = dedupeSentences(t);
    t = limitNameMentions(t, otherName);
    t = maybePrefixName(t, otherName, greetMode);
    t = t.replace(/\bVielen Dank nochmals\b\.?/gi, 'Danke');
    return t.trim();
  }

  // ==================== AI CALL ====================
  async function generateAIReply({
    stance = 'auto',
    extraInstruction = '',
    useCache = true,
    progressCallback,
    length = 'auto',
    tone = 'auto',
    language = 'auto',
    situation = 'none',
    allowBBOverride = null,
    noSignoffOverride = null
  }) {
    const apiKey = (GM_getValue(STORAGE.KEY, '') || '').trim();
    if (!apiKey) throw new AIError('no_key');
    if (!validateApiKey(apiKey)) throw new AIError('invalid_key');

    const baseModel = GM_getValue(STORAGE.MODEL, DEFAULT_MODEL);
    const prefs = getPrefs();
    const ctx = await getContextCached(progressCallback);

    const cacheOpts = { stance, extraInstruction, length, tone, language, situation };
    if (useCache) {
      const cached = RESPONSE_CACHE.get(ctx, cacheOpts);
      if (cached) return cached;
    }

    const allowBB = (typeof allowBBOverride === 'boolean') ? allowBBOverride : !!prefs.allowBB;
    const noSignoff = (typeof noSignoffOverride === 'boolean') ? noSignoffOverride : !!prefs.noSignoff;

    const addressLine =
      ctx.detectedAddressForm === 'du' ? `Sprich ${ctx.otherName} direkt in der "du"-Form an.` :
      ctx.detectedAddressForm === 'ihr' ? `Sprich ${ctx.otherName} in der "ihr"-Form an.` :
      ctx.detectedAddressForm === 'Sie' ? `Sprich ${ctx.otherName} höflich in der "Sie"-Form an.` :
      `Sprich ${ctx.otherName} direkt in der "du"-Form an.`;

    const noSignoffRule = noSignoff ? 'Keine Grußformel am Ende.' : 'Eine knappe Grußformel ist erlaubt.';

    const lengthRule =
      length === 'short' ? 'Halte die Antwort sehr kurz (maximal 3 Sätze).' :
      length === 'medium' ? 'Normale Länge, fokussiert und ohne Ausschweifungen.' :
      length === 'long' ? 'Du darfst ausführlicher begründen, bleibe aber präzise.' :
      'Passe die Länge an die Situation an.';

    const toneRule =
      tone === 'soft' ? 'Ton: freundlich, weich, konfliktentschärfend.' :
      tone === 'neutral' ? 'Ton: neutral, sachlich.' :
      tone === 'hard' ? 'Ton: direkt, klar, eher streng aber nicht beleidigend.' :
      'Ton: zur Situation passend, weder übertrieben freundlich noch aggressiv.';

    const languageRule =
      language === 'de' ? 'Antworte vollständig auf Deutsch.' :
      language === 'en' ? 'Reply fully in English.' :
      'Nutze die Sprache des bisherigen Verlaufs (meist Deutsch).';

    const situationHint = SITUATION_HINTS[situation] || 'Allgemeine Gesprächssituation ohne Spezialfall.';

    const system = `Du bist "${ctx.myName}" - erfahrener Die Stämme Spieler.

AUFGABE: Antworte auf die letzte Nachricht von ${ctx.otherName}.

KONTEXT-ANALYSE:
1. Lies den gesamten Verlauf → erkenne Beziehung, Thema, bisherige Vereinbarungen.
2. Fokus auf die letzte Nachricht → gehe konkret auf Hauptpunkte ein.
3. Haltung "${stance}": ${STANCE_EXPLANATIONS[stance] || 'Auto-Detect.'}
4. Situation: ${situationHint}

ANTWORT-STIL:
- ${addressLine}
- ${noSignoffRule}
- ${lengthRule}
- ${toneRule}
- ${languageRule}
- Authentisch, knapp, entscheidungsfähig.
- Begriffe aus dem Verlauf beibehalten (AG/AGZ/Stammes-Tags).
- Maximal eine Rückfrage, nur wenn absolut nötig.
- BB-Codes: ${allowBB ? '[b], [coord], [player], [quote] natürlich nutzen, aber nicht übertreiben.' : 'Keine BB-Codes verwenden.'}

EXTRA WUNSCH: ${extraInstruction || 'Keiner.'}

OUTPUT (nur JSON):
{
  "reply": "deine_antwort",
  "summary": "1-Satz-Situationsanalyse",
  "tags": ["thema1", "thema2"],
  "confidence": 0.8
}`;

    const userPayload = {
      thread_subject: ctx.subject,
      my_name: ctx.myName,
      other_name: ctx.otherName,
      stance_request: stance || 'auto',
      extra_instruction: extraInstruction || '',
      preferences: {
        language,
        allow_bb: !!allowBB,
        no_signoff: !!noSignoff,
        address_form: ctx.detectedAddressForm,
        length,
        tone,
        situation
      },
      last_incoming: ctx.lastIncoming || { author: ctx.otherName, date: '', text: ctx.lastIncomingExcerpt },
      messages: ctx.messages
    };

    const freePool = await getFreeFallbackModels();
    const fallbacks = freePool.filter(id => id !== baseModel).slice(0, 2);

    const body = {
      model: baseModel,
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

    if (fallbacks.length) body.models = fallbacks;

    const res = await REQUEST_QUEUE.push(async () => {
      await RATE_LIMITER.waitForSlot();
      return fetchWithRetry('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': location.href,
          'X-Title': 'Die Stämme AI-Helper v3.3'
        },
        body: JSON.stringify(body)
      });
    });

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err?.error?.message) msg += ` — ${err.error.message}`;
      } catch {}
      if (res.status === 401) throw new AIError('401');
      if (res.status === 429) throw new AIError('429');
      if (res.status >= 500) throw new AIError('500');
      throw new Error(`Fehler: ${msg}`);
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'API-Fehler');
    const content = data?.choices?.[0]?.message?.content || '';
    if (!content || content.trim() === '') throw new Error('Leere Antwort von der API erhalten');

    const parsed = tryParseJSON(content);
    let out = null;

    if (parsed && typeof parsed.reply === 'string') {
      out = parsed;
    } else {
      console.warn('[DS-AI] Kein valides JSON, verwende Rohtext als Antwort');
      out = {
        stance: stance || 'auto',
        reply: (content || '').trim(),
        summary: 'Keine strukturierte Antwort',
        quote: '',
        confidence: 0.5,
        tags: [],
        bb_used: CONSTANTS.REGEX.BB_CODE.test(content),
        addressed_to: ctx.otherName
      };
    }

    const cleaned = cleanupReply(out.reply, { otherName: ctx.otherName, greetMode: prefs.greetName });
    out.reply = cleaned;
    out.bb_used = CONSTANTS.REGEX.BB_CODE.test(cleaned);
    out.addressed_to = ctx.otherName;

    const usedModel = data.model || data.choices?.[0]?.model || baseModel;
    const usage = data.usage || null;
    out.modelUsed = usedModel;
    out.usage = usage;

    const metaKey = getThreadMetaKey(ctx.subject);
    try {
      GM_setValue(metaKey, {
        lastTags: out.tags || [],
        lastSummary: out.summary || '',
        lastStance: stance,
        lastUpdated: Date.now(),
        model: usedModel
      });
    } catch (e) {
      console.warn('[DS-AI] Konnte Thread-Metadaten nicht speichern:', e);
    }

    if (useCache) {
      RESPONSE_CACHE.set(ctx, cacheOpts, out);
    }

    return out;
  }

  // ==================== TEXTAREA HANDLING ====================
  async function ensureReplyTextarea() {
    let ta = DOM_CACHE.textarea;
    if (ta) return ta;

    const replyLink = document.querySelector('a[href*="IGM.view.beginReply"]') ||
                      Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Antworten'));
    if (replyLink) {
      replyLink.click();
      for (let i = 0; i < 25; i++) {
        await sleep(CONSTANTS.DELAYS.TEXTAREA_CHECK);
        DOM_CACHE.invalidate();
        ta = DOM_CACHE.textarea;
        if (ta) return ta;
      }
    }

    DOM_CACHE.invalidate();
    ta = DOM_CACHE.textarea;
    if (ta) return ta;
    throw new Error('Textarea #message nicht gefunden.');
  }

  function insertIntoTextarea({ reply, quoteMode, fallbackQuoteText, otherName }) {
    const ta = DOM_CACHE.textarea;
    if (!ta) return;

    let finalText = reply.trim();
    const alreadyQuoted = CONSTANTS.REGEX.QUOTE_START.test(finalText);

    if (quoteMode === 'last' && !alreadyQuoted && fallbackQuoteText) {
      const short = fallbackQuoteText.trim().slice(0, CONSTANTS.LIMITS.QUOTE_LENGTH);
      finalText = `[quote=${otherName}]\n${short}\n[/quote]\n\n${finalText}`;
    }

    ta.value = finalText;
    ta.style.backgroundColor = '#e8f5e9';
    setTimeout(() => (ta.style.backgroundColor = ''), CONSTANTS.DELAYS.UI_HIGHLIGHT);
    ta.focus();
  }

  // ==================== PREVIEW MODAL ====================
  function showPreview(reply) {
    const modal = el('div', { className: 'ai-modal' },
      el('button', { className: 'ai-modal-close', onclick: () => modal.remove() }, '✕'),
      el('h3', {}, 'Vorschau'),
      el('div', { className: 'ai-preview-content' }, reply),
      el('button', {
        className: 'ai-btn',
        style: { marginTop: '15px' },
        onclick: () => modal.remove()
      }, 'Schließen')
    );
    document.body.appendChild(modal);
  }

  // ==================== MULTI-VARIANT MODAL ====================
  async function showVariantSelector(variants, insertCallback) {
    const modal = el('div', { className: 'ai-modal' },
      el('button', { className: 'ai-modal-close', onclick: () => modal.remove() }, '✕'),
      el('h3', {}, 'Variante wählen'),
      ...variants.map((v, i) => {
        const stanceLabel = STANCE_PRESETS.find(([val]) => val === v.stance)?.[1] || v.stance || 'Unbekannt';
        return el('div', {
          className: 'ai-variant-item',
          onclick: () => {
            insertCallback(v);
            modal.remove();
          }
        },
          el('div', { className: 'ai-variant-header' },
            el('span', {}, `Variante ${i + 1}: ${stanceLabel}`),
            el('span', { className: 'ai-chip' }, `${(v.confidence * 100).toFixed(0)}%`)
          ),
          el('div', { className: 'ai-variant-text' }, v.reply || 'Keine Antwort')
        );
      })
    );
    document.body.appendChild(modal);
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  function initKeyboardShortcuts(genBtn, insertBtn) {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        if (!genBtn.disabled) genBtn.click();
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        if (!insertBtn.disabled) insertBtn.click();
      }
    });
  }

  // ==================== TOOLBAR UI ====================
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

    const lengthSel = el('select', { title: 'Antwortlänge' },
      ...LENGTH_PRESETS.map(([v, label]) => {
        const o = el('option', { value: v }, label);
        if (v === prefs.length) o.selected = true;
        return o;
      })
    );

    const toneSel = el('select', { title: 'Tonstärke' },
      ...TONE_PRESETS.map(([v, label]) => {
        const o = el('option', { value: v }, label);
        if (v === prefs.tone) o.selected = true;
        return o;
      })
    );

    const langSel = el('select', { title: 'Antwortsprache' },
      ...LANGUAGE_PRESETS.map(([v, label]) => {
        const o = el('option', { value: v }, label);
        if (v === prefs.language) o.selected = true;
        return o;
      })
    );

    const situationSel = el('select', { title: 'Situations-Typ' },
      ...SITUATION_PRESETS.map(([v, label]) => el('option', { value: v }, label))
    );

    const customInput = el('input', {
      type: 'text',
      placeholder: 'Zusatz (optional), z. B. "kurz & direkt"',
      style: { minWidth: '220px' },
      title: 'Optionale Zusatzanweisung für die KI'
    });

    const quoteSel = el('select', { title: 'Zitierverhalten' },
      el('option', { value: 'last' }, 'Zitat: letzte Nachricht'),
      el('option', { value: 'none' }, 'Zitat: keines'),
      el('option', { value: 'manual' }, 'Zitat: manuell')
    );
    const initialQuoteMode = prefs.quoteMode || (prefs.attachQuote ? 'last' : 'none');
    quoteSel.value = initialQuoteMode;

    let bbAllowed = !!prefs.allowBB;
    const bbChip = el('span', {
      className: 'ai-chip',
      title: 'Klick: BB-Codes erlauben oder unterdrücken (nur diese Seite)',
      onclick: () => {
        bbAllowed = !bbAllowed;
        bbChip.textContent = bbAllowed ? 'BB: Auto' : 'BB: Aus';
      }
    }, bbAllowed ? 'BB: Auto' : 'BB: Aus');

    let noSignoff = !!prefs.noSignoff;
    const signoffChip = el('span', {
      className: 'ai-chip',
      title: 'Klick: Grußformel erlauben oder entfernen (nur diese Seite)',
      onclick: () => {
        noSignoff = !noSignoff;
        signoffChip.textContent = noSignoff ? 'Gruß: Aus' : 'Gruß: Kurz';
      }
    }, noSignoff ? 'Gruß: Aus' : 'Gruß: Kurz');

    const genBtn = el('button', {
      className: 'ai-btn',
      textContent: 'Analysieren & Vorschlag',
      title: 'Analysiert den Verlauf und erstellt eine passende Antwort (Strg+Shift+G)'
    });

    const regenBtn = el('button', {
      className: 'ai-btn',
      textContent: 'Neu',
      disabled: true,
      title: 'Antwort mit gleichen Einstellungen neu generieren (ohne Cache)'
    });

    const multiBtn = el('button', {
      className: 'ai-btn',
      textContent: '3 Varianten',
      title: 'Generiert 3 unterschiedliche Antworten zur Auswahl'
    });

    const manualQuoteBtn = el('button', {
      className: 'ai-btn',
      textContent: '[quote]',
      title: 'Letzte eingehende Nachricht als [quote]-Block ins Textfeld einfügen'
    });

    const insertBtn = el('button', {
      className: 'ai-btn',
      textContent: 'Einfügen',
      disabled: true,
      title: 'Fügt die generierte Antwort in das Textfeld ein (Strg+Shift+I)'
    });

    const previewBtn = el('button', {
      className: 'ai-btn',
      textContent: 'Vorschau',
      disabled: true,
      title: 'Zeigt die Antwort in einer Vorschau'
    });

    const status = el('span', { className: 'ai-status' });
    const panel = el('div', { className: 'ai-panel' });
    const progressChip = el('span', { className: 'ai-chip', style: { display: 'none' } });

    const addressChip = el('span', { className: 'ai-chip' }, 'Anrede: ...');
    const metaChip = el('span', { className: 'ai-chip', style: { display: 'none' } });
    const hintChip = el('span', {
      className: 'ai-chip',
      style: { display: 'none' },
      title: 'Kurz-Notiz im Antwortfeld, die als Intent für die KI verwendet wird'
    }, '');

    buildContext().then(ctx => {
      const form = ctx.detectedAddressForm || 'unbekannt';
      const isAuto = getPrefs().addressForm === 'auto';
      addressChip.textContent = isAuto ? `Anrede: ${form} (auto)` : `Anrede: ${form}`;
      try {
        const metaKey = getThreadMetaKey(ctx.subject);
        const meta = GM_getValue(metaKey, null);
        if (meta) {
          const tags = (meta.lastTags || []).slice(0, 3).join(', ') || '–';
          metaChip.textContent = `Letzte Tags: ${tags}`;
          metaChip.style.display = 'inline-block';
        }
      } catch (e) {
        console.warn('[DS-AI] Konnte Thread-Metadaten nicht lesen:', e);
      }
    }).catch(() => {
      addressChip.textContent = `Anrede: ${prefs.addressForm}`;
    });

    toolbar.append(
      el('span', { className: 'ai-chip' }, 'Stämme-KI v3.3'),
      modeSel,
      lengthSel,
      toneSel,
      langSel,
      situationSel,
      customInput,
      el('span', { className: 'ai-chip' }, `Ich: ${GM_getValue(STORAGE.MYNAME, DEFAULT_MY_NAME)}`),
      bbChip,
      signoffChip,
      addressChip,
      el('span', { className: 'ai-chip' }, `Name: ${prefs.greetName}`),
      metaChip,
      hintChip,
      progressChip,
      quoteSel,
      manualQuoteBtn,
      genBtn,
      regenBtn,
      multiBtn,
      previewBtn,
      insertBtn,
      status
    );
    toolbar.after(panel);

    let lastResult = null;
    let forceNoCacheNext = false;

    // ==================== GENERATE HANDLER ====================
    genBtn.onclick = async () => {
      const prefsNow = getPrefs();

      // Kurz-Notiz im Antwortfeld als Intent auswerten
      const { hint: draftHint, overrides } = analyzeDraftHintFromTextarea();
      if (draftHint) {
        if (overrides.stance) modeSel.value = overrides.stance;
        if (overrides.length) lengthSel.value = overrides.length;
        if (overrides.tone) toneSel.value = overrides.tone;
        if (overrides.language) langSel.value = overrides.language;
        hintChip.style.display = 'inline-block';
        hintChip.textContent = `Notiz: "${draftHint.slice(0, 30)}${draftHint.length > 30 ? '…' : ''}"`;
      } else {
        hintChip.style.display = 'none';
      }

      const stanceValue = overrides.stance || modeSel.value;
      const lengthValue = overrides.length || lengthSel.value;
      const toneValue = overrides.tone || toneSel.value;
      const languageValue = overrides.language || langSel.value;

      const extraParts = [];
      const manualExtra = customInput.value.trim();
      if (manualExtra) extraParts.push(manualExtra);
      if (draftHint) {
        extraParts.push(`Berücksichtige meine kurze Notiz/Stichworte aus dem Antwortfeld: "${draftHint}". Interpretiere das als groben Wunsch für Inhalt, Haltung und Ton (z.B. "nein, ablehnung, keine zeit" = freundlich aber klar ablehnen wegen Zeitmangel) und formuliere daraus eine vollständige, kontextbezogene Antwort.`);
      }
      const extraInstructionCombined = extraParts.join(' | ');

      status.textContent = prefsNow.readAllPages ? 'Lese Verlauf (alle Seiten)...' : 'Lese Verlauf...';
      insertBtn.disabled = true;
      previewBtn.disabled = true;
      regenBtn.disabled = true;
      panel.style.display = 'none';
      genBtn.disabled = true;
      multiBtn.disabled = true;
      genBtn.innerHTML = '<span class="ai-loading"></span> Analysiere...';
      progressChip.style.display = 'inline-block';

      try {
        const data = await generateAIReply({
          stance: stanceValue,
          extraInstruction: extraInstructionCombined,
          length: lengthValue,
          tone: toneValue,
          language: languageValue,
          situation: situationSel.value,
          allowBBOverride: bbAllowed,
          noSignoffOverride: noSignoff,
          useCache: !forceNoCacheNext,
          progressCallback: (current, total) => {
            progressChip.textContent = `Seiten: ${current}/${total}`;
          }
        });
        forceNoCacheNext = false;

        lastResult = data;

        const ta = DOM_CACHE.textarea;
        if (ta && data.reply) {
          ta.value = data.reply.trim();
          ta.style.backgroundColor = '#ffffcc';
          setTimeout(() => (ta.style.backgroundColor = ''), CONSTANTS.DELAYS.UI_HIGHLIGHT);
        }

        const tags = (data.tags && data.tags.length) ? `Tags: ${data.tags.join(', ')}` : '';
        const conf = (typeof data.confidence === 'number') ? `Sicherheit: ${(data.confidence * 100).toFixed(0)}%` : '';
        const bb = data.bb_used ? 'BB genutzt' : 'BB nicht genutzt';
        const addressed = data.addressed_to ? `An: ${data.addressed_to}` : '';
        const modelInfo = data.modelUsed ? `Modell: ${data.modelUsed}` : '';
        const tokenInfo = data.usage && (data.usage.total_tokens || data.usage.prompt_tokens)
          ? `Tokens: ${data.usage.total_tokens || (data.usage.prompt_tokens + (data.usage.completion_tokens || 0))}`
          : '';

        panel.textContent =
          (data.summary ? `Kurzfassung: ${data.summary}\n` : '') +
          [tags, conf, bb, addressed, modelInfo, tokenInfo].filter(Boolean).join(' · ');

        if (panel.textContent) panel.style.display = 'block';

        insertBtn.disabled = !data.reply;
        previewBtn.disabled = !data.reply;
        regenBtn.disabled = !data.reply;
        status.textContent = data.reply ? 'Vorschlag bereit.' : 'Keine Antwort erhalten.';
      } catch (e) {
        console.error('[DS-AI] AI-Helper Fehler:', e);
        const code = e.code || e.message;
        if (code === 'no_key' || code === 'invalid_key') {
          showError(code);
        } else if (['401', '429', '500', 'timeout', 'rate_limit_wait_timeout'].includes(String(code))) {
          showError(code, { retry: false });
        } else {
          alert(`Fehler: ${e.message || 'Unbekannter Fehler'}`);
        }
        status.textContent = 'Fehler.';
      } finally {
        genBtn.disabled = false;
        multiBtn.disabled = false;
        genBtn.textContent = 'Analysieren & Vorschlag';
        progressChip.style.display = 'none';
        progressChip.textContent = '';
      }
    };

    // ==================== REGENERATE HANDLER ====================
    regenBtn.onclick = () => {
      if (!lastResult) return;
      forceNoCacheNext = true;
      genBtn.click();
    };

    // ==================== MULTI-VARIANT HANDLER ====================
    multiBtn.onclick = async () => {
      // Kurz-Notiz im Antwortfeld als Intent auswerten
      const { hint: draftHint, overrides } = analyzeDraftHintFromTextarea();
      if (draftHint) {
        if (overrides.stance) modeSel.value = overrides.stance;
        if (overrides.length) lengthSel.value = overrides.length;
        if (overrides.tone) toneSel.value = overrides.tone;
        if (overrides.language) langSel.value = overrides.language;
        hintChip.style.display = 'inline-block';
        hintChip.textContent = `Notiz: "${draftHint.slice(0, 30)}${draftHint.length > 30 ? '…' : ''}"`;
      } else {
        hintChip.style.display = 'none';
      }

      const lengthValue = overrides.length || lengthSel.value;
      const toneValue = overrides.tone || toneSel.value;
      const languageValue = overrides.language || langSel.value;
      const baseStance = overrides.stance || modeSel.value;

      const extraParts = [];
      const manualExtra = customInput.value.trim();
      if (manualExtra) extraParts.push(manualExtra);
      if (draftHint) {
        extraParts.push(`Berücksichtige meine kurze Notiz/Stichworte aus dem Antwortfeld: "${draftHint}". Verwende sie als groben Rahmen für die Varianten (z.B. ablehnen wegen fehlender Zeit, aber je nach Variante leicht anders formuliert).`);
      }
      const extraInstructionCombined = extraParts.join(' | ');

      status.textContent = 'Generiere 3 Varianten...';
      multiBtn.disabled = true;
      genBtn.disabled = true;
      insertBtn.disabled = true;
      previewBtn.disabled = true;
      regenBtn.disabled = true;
      multiBtn.innerHTML = '<span class="ai-loading"></span> Generiere...';
      progressChip.style.display = 'inline-block';

      try {
        const stances = ['diplomatisch', baseStance === 'auto' ? 'freundlich' : baseStance, 'direkt'];
        const variants = [];

        const sharedOpts = {
          extraInstruction: extraInstructionCombined,
          length: lengthValue,
          tone: toneValue,
          language: languageValue,
          situation: situationSel.value,
          allowBBOverride: bbAllowed,
          noSignoffOverride: noSignoff
        };

        for (let i = 0; i < stances.length; i++) {
          try {
            progressChip.textContent = `Variante ${i + 1}/${stances.length}`;
            status.textContent = `Variante ${i + 1}/${stances.length} (${STANCE_PRESETS.find(([v]) => v === stances[i])?.[1] || stances[i]})...`;

            const variant = await generateAIReply({
              stance: stances[i],
              useCache: false,
              progressCallback: null,
              ...sharedOpts
            });

            variant.stance = stances[i];
            variant.stanceLabel = STANCE_PRESETS.find(([v]) => v === stances[i])?.[1] || stances[i];

            variants.push(variant);

            if (i < stances.length - 1) await sleep(1500);
          } catch (e) {
            console.warn('[DS-AI] Variante fehlgeschlagen:', e);
            variants.push({
              stance: stances[i],
              stanceLabel: STANCE_PRESETS.find(([v]) => v === stances[i])?.[1] || stances[i],
              reply: `[Fehler beim Generieren dieser Variante: ${e.message}]`,
              summary: 'Fehler',
              confidence: 0,
              tags: [],
              bb_used: false,
              addressed_to: ''
            });
          }
        }

        const validVariants = variants.filter(v => !v.reply.startsWith('[Fehler'));
        if (!validVariants.length) throw new Error('Keine gültigen Varianten generiert.');

        await showVariantSelector(validVariants, (selectedVariant) => {
          const ta = DOM_CACHE.textarea;
          if (ta) {
            ta.value = selectedVariant.reply;
            ta.style.backgroundColor = '#e8f5e9';
            setTimeout(() => (ta.style.backgroundColor = ''), CONSTANTS.DELAYS.UI_HIGHLIGHT);
          }
          lastResult = selectedVariant;
          insertBtn.disabled = false;
          previewBtn.disabled = false;
          regenBtn.disabled = false;
          status.textContent = 'Variante ausgewählt.';
        });

      } catch (e) {
        console.error('[DS-AI] Multi-Variant Error:', e);
        alert(`Fehler beim Generieren der Varianten: ${e.message || 'Unbekannt'}`);
        status.textContent = 'Fehler.';
      } finally {
        multiBtn.disabled = false;
        genBtn.disabled = false;
        multiBtn.textContent = '3 Varianten';
        progressChip.style.display = 'none';
        progressChip.textContent = '';
      }
    };

    // ==================== MANUAL QUOTE HANDLER ====================
    manualQuoteBtn.onclick = async () => {
      manualQuoteBtn.disabled = true;
      try {
        const ctx = await getContextCached();
        const ta = await ensureReplyTextarea();
        const sourceText = ctx.lastIncomingExcerpt;
        if (!sourceText) return;
        const short = sourceText.trim().slice(0, CONSTANTS.LIMITS.QUOTE_LENGTH);
        const block = `[quote=${ctx.otherName}]\n${short}\n[/quote]\n\n`;
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? ta.value.length;
        ta.value = ta.value.slice(0, start) + block + ta.value.slice(end);
        ta.focus();
      } catch (e) {
        console.error('[DS-AI] Manual quote error:', e);
        alert('Konnte letztes Zitat nicht einfügen.');
      } finally {
        manualQuoteBtn.disabled = false;
      }
    };

    // ==================== PREVIEW HANDLER ====================
    previewBtn.onclick = () => {
      if (!lastResult?.reply) return;
      showPreview(lastResult.reply);
    };

    // ==================== INSERT HANDLER ====================
    insertBtn.onclick = async () => {
      if (!lastResult?.reply) return;
      insertBtn.disabled = true;
      status.textContent = 'Füge ein...';
      try {
        await ensureReplyTextarea();
        const ctx = await getContextCached();
        insertIntoTextarea({
          reply: lastResult.reply,
          quoteMode: quoteSel.value,
          fallbackQuoteText: ctx.lastIncomingExcerpt,
          otherName: ctx.otherName
        });
        status.textContent = 'Eingefügt.';
      } catch (e) {
        console.error('[DS-AI] Insert Error:', e);
        alert('Konnte Textarea nicht finden/öffnen.');
        status.textContent = 'Fehler beim Einfügen.';
      } finally {
        insertBtn.disabled = false;
      }
    };

    initKeyboardShortcuts(genBtn, insertBtn);

    if (mountBefore && mountBefore.parentNode) {
      mountBefore.parentNode.insertBefore(toolbar, mountBefore);
    } else {
      document.body.insertBefore(toolbar, document.body.firstChild);
    }
  }

  // ==================== INIT HELPERS ====================
  function mountToolbar({ withDraftLoad }) {
    const textarea = DOM_CACHE.textarea;
    const bbBar = DOM_CACHE.bbBar;
    const actionRow = DOM_CACHE.actionRow;
    const fallback = document.querySelector('.vis') || document.body;
    const mount = bbBar || textarea || actionRow || fallback;

    makeToolbar({ mountBefore: mount });

    if (withDraftLoad && textarea) {
      const savedText = localStorage.getItem('ai_generated_text');
      if (savedText) {
        textarea.value = savedText;
        textarea.style.backgroundColor = '#ffffcc';
        setTimeout(() => (textarea.style.backgroundColor = ''), CONSTANTS.DELAYS.UI_HIGHLIGHT);
      }
      textarea.addEventListener('input', () => {
        try {
          localStorage.setItem('ai_generated_text', textarea.value || '');
        } catch (e) {
          console.warn('[DS-AI] Konnte Draft nicht speichern:', e);
        }
      });
    }
  }

  function initViewPage() {
    mountToolbar({ withDraftLoad: false });
  }

  function initWritePage() {
    mountToolbar({ withDraftLoad: true });
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
    console.log('[DS-AI] Die Stämme AI-Helper v3.3 geladen');
  } catch (e) {
    console.error('[DS-AI] Init-Fehler:', e);
  }
})();
