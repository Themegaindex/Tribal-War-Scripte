// ==UserScript==
// @name         TWscripts → Stämme Schnellleiste Auto‑Importer (DE, UI v1.3.0)
// @namespace    tw-helper.twscripts.quickbar.ui
// @version      1.3.0
// @description  Sammelt Loader von twscripts.dev und fügt sie deutsch benannt, gruppiert, gedrosselt & mit Trennlinien in die Stämme-Schnellleiste ein. Polierte GUI ohne Inline-Styles im Markup, Progress via <progress> (CSP-freundlicher).
// @author       Themegaindex
// @match        https://twscripts.dev/*
// @match        http*://*/game.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      twscripts.dev
// @run-at       document-end
// ==/UserScript==
(function () {
  'use strict';

  /*************** Polyfills ***************/
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector || function(s){var m=(this.document||this.ownerDocument).querySelectorAll(s);var i=0;while(m[i]&&m[i]!==this)i++;return !!m[i];};
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function(s){var el=this;while(el&&el.nodeType===1){if(el.matches(s))return el;el=el.parentElement||el.parentNode}return null;};
  }

  /*************** Diagnose ***************/
  var TWQ = {
    version: '1.3.0',
    log:   function(){try{console.log.apply(console,['%c[TWQ]','color:#0b5;font-weight:700'].concat([].slice.call(arguments)));}catch(e){}},
    warn:  function(){try{console.warn.apply(console,['[TWQ]'].concat([].slice.call(arguments)));}catch(e){}},
    error: function(){try{console.error.apply(console,['[TWQ]'].concat([].slice.call(arguments)));}catch(e){}},
    diag:  function(){
      var out = {
        version: TWQ.version,
        href: location.href,
        readyState: document.readyState,
        panel: !!document.querySelector('.twq--wrap'),
        cacheItems: (getCache() && getCache().items) ? getCache().items.length : 0,
        prefs: loadPrefs()
      };
      TWQ.log('Diagnose', out);
      return out;
    },
    showPanel: function(){ injectPanel(true); },
    hidePanel: function(){ var n=document.querySelector('.twq--wrap'); if(n&&n.parentNode) n.parentNode.removeChild(n); }
  };
  window.TWQ = TWQ;
  window.addEventListener('error', function(e){ TWQ.error('window.error', e && e.message); });
  window.addEventListener('unhandledrejection', function(e){ TWQ.error('unhandledrejection', e && e.reason); });

  /*************** Konstanten & Storage ***************/
  var KEY_CACHE = 'twq_ui_cache_v1';
  var KEY_PREFS = 'twq_ui_prefs_v1';
  var stopFlag  = false;
  var DEFAULT_PREFS = {
    concurrency: 5,
    maxPerRow: 7,
    delayMs: 2500,
    jitterMs: 700,
    backoffMs: 7000,
    maxRetries: 3,
    skipDuplicates: true,
    linebreakPerCategory: true,
    germanize: true,
    theme: 'auto' // auto | light | dark
  };

  function loadPrefs(){ var p=GM_getValue(KEY_PREFS,{})||{}; var out={},k; for(k in DEFAULT_PREFS) out[k]=DEFAULT_PREFS[k]; for(k in p) out[k]=p[k]; return out; }
  function savePrefs(p){ GM_setValue(KEY_PREFS, p); }
  function getCache(){ return GM_getValue(KEY_CACHE, null); }
  function setCache(c){ GM_setValue(KEY_CACHE, c); }
  function clearCache(){ GM_deleteValue(KEY_CACHE); }

  /*************** Utils ***************/
  function sleep(ms){ return new Promise(function(res){ setTimeout(res, ms); }); }
  function jitter(n){ return Math.floor(Math.random() * (n || 0)); }
  function nowISO(){ return new Date().toISOString(); }
  function isTWSite(){ return location.hostname.indexOf('twscripts.dev') !== -1; }
  function isGamePHP(){ return location.href.indexOf('/game.php') !== -1; }
  function isTWHost(){ return /staemme|tribalwars|plemiona|divokekmeny|klanlar|guerratribale|guerretribale|tribos|tribalwars\./i.test(location.hostname); }
  function escapeHtml(s){ s=String(s); return s.replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function canonLoader(href){ var s=(href||'').trim(); if(!s) return s; var t=s.indexOf('javascript:')===0?s.substring(11):s; t=t.replace(/\s+/g,' ').replace(/;\s*$/,'').trim(); return 'javascript:'+t; }
  function normalizeName(n,trim){ if(typeof trim==='undefined') trim=true; n=String(n||'').trim(); if(trim && n.length>32) n=n.slice(0,31)+'…'; return n; }
  function currentVillage(){ var p=new URLSearchParams(location.search); return p.get('village'); }
  function findCSRF(){ var inp=document.querySelector('form[action*="quickbar_edit"] input[name="h"]'); if(inp&&inp.value) return inp.value; var a=document.querySelector('a[href*="&h="]'); if(a){ var m=(a.getAttribute('href')||'').match(/[?&]h=([a-f0-9]+)/i); if(m) return m[1]; } return null; }
  function gmFetchText(url){
    return new Promise(function(resolve,reject){
      GM_xmlhttpRequest({ method:'GET', url:url,
        onload:function(r){ (r.status>=200 && r.status<300) ? resolve(r.responseText) : reject(new Error('HTTP '+r.status)); },
        onerror:reject, ontimeout:function(){reject(new Error('timeout'))}
      });
    });
  }

  /*************** DE‑Mapping ***************/
  var DE = {
    titleMap: {
      'Advanced Report Filters':'Erweiterte Berichtsfilter','Backtimes Planner':'Rücklaufplaner','Barbs Finder with Filters':'Barbarensucher mit Filter',
      'Bonus Finder Evolved':'Bonusfinder (Evolved)','Buildings Upgrade Queue':'Bau-Upgrade-Warteschlange','Cancel Snipe':'Snipe abbrechen',
      'Clear Barbarian Walls':'Barbarenmauer-Clearing','Coin Minting Calculator':'Münzrechner','Command Launch Timer':'Befehlsstart-Timer',
      'Commands Overview':'Befehlsübersicht','Construction Times':'Bauzeiten','Convert Text to Village Note':'Text zu Notiz','Count Incoming PP':'Eingehende PP zählen',
      'Defense Health Check':'Gesundheitscheck','Discord Support Tool':'Discord-Tool','Evolved Fake Train':'Fake-Zug Evolved',
      'Extended Player Info':'Erweiterte Spielerinfos','Extended Tribe Info':'Erweiterte Stammesinfos','Fake Script Client':'Fake-Zug Client',
      'Fake Script Generator':'Fake-Zug Generator','Farm Statistics':'Farmstatistik','Farming Efficiency Calculator':'Farm-Effizienzrechner',
      'Fill Troops in Simulator':'Simulator mit Truppen füllen','Filter Reports':'Berichte filtern','Find Frontline Villages':'Frontdörfer finden',
      'Find Villages in Range':'Dörfer im Umkreis','Friend Request':'Freundschaftsanfrage','Frontline Stacks Planner':'Front-Stapel-Planer',
      'Get Incomings for Player':'Eingehende Übersicht (Spieler)','Graphs in Ranking':'Diagramme im Ranking','Import/Export Dynamic Groups':'Import/Export Gruppen',
      'Incomings Overview':'Eingehende Übersicht','Invite to Tribe':'Einladung zum Stamm','Last Time Attacked':'Letzter Angriff','Last Village Growth':'Letztes Dorfwachstum',
      'localStorage Manager':'localStorage-Manager','Loyalty Calculator':'Treue-Rechner','Map Barbs Only':'Barbs-Only Karte','Map Coords Picker':'Koordinatenwähler',
      'Mass Attack Planner':'Mass-Angriffplaner','Mass Command Timer':'Mass-Befehls-Timer','Mass Scavenging Options Unlocker':'Massen-Sammeloptionen','Mass Snipe':'Massen-Snipe',
      'Mint Helper':'Münzhelfer','Nobles Resources Calculator':'Adels-Ressourcenrechner','Own Home Troops Count':'Eigene Truppen zählen',
      'Own Notes Manager':'Notizmanager','Player Farms Finder':'Spieler-Farmen-Sucher','Player Finder':'Spieler-Finder',
      'RedAlert’s Scripts Pack':'RedAlert Skript-Paket','Redirector':'Weiterleiter','Reports Overview Helper':'Berichtsübersicht-Helfer',
      'Set/Get Village Note':'Setze/Hole Notiz','Single Village Planner':'Einzeldorf-Planer','Single Village Snipe':'Einzeldorf-Snipe',
      'Support Counter Evolved':'Supportzähler (Evolved)','Tribe Players Under Attack (Tribe Leader)':'Stammspieler unter Angriff',
      'Tribe Stats Tools':'Stammstatistik-Tools','Troops Counter (dalesmckay)':'Truppenzähler (dalesmckay)','Troops Template Manager':'Truppen‑Vorlagenmanager',
      'Watchtower Evolved':'Wachturm Erweitert'
    },
    fromRaw: function(raw){
      var set={},i; if(raw){ for(i=0;i<raw.length;i++) set[String(raw[i]).trim()]=true; }
      if (set['Attack']||set['Commands']||set['Fake Generators']) return '⚔️ Angriff & Befehle';
      if (set['Defense']) return '🛡️ Verteidigung';
      if (set['Farming']) return '🌾 Farmen';
      if (set['Scavenging']) return '💰 Sammeln / Plündern';
      if (set['Map']||set['Coord Picker']) return '🗺️ Karte & Koordinaten';
      if (set['Reports']) return '📊 Berichte & Statistiken';
      if (set['Village Notes']) return '🏘️ Notizen & Verwaltung';
      if (set['Tribe Leader']) return '👥 Stamm & Spieler';
      if (set['Troops Counter']) return '👣 Truppen & Zählungen';
      if (set['Misc.']) return '🧩 Verschiedene';
      return '🚀 Sonstiges';
    },
    order: ['🧩 Verschiedene','⚔️ Angriff & Befehle','🛡️ Verteidigung','🌾 Farmen','🗺️ Karte & Koordinaten','📊 Berichte & Statistiken','🏘️ Notizen & Verwaltung','👥 Stamm & Spieler','👣 Truppen & Zählungen','💰 Sammeln / Plündern','🚀 Sonstiges']
  };

  /*************** Styles (ohne inline-Styles im Markup) ***************/
  GM_addStyle(
    [
      /* Layout */
      '.twq--wrap{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:380px;max-height:74vh;overflow:auto;border-radius:12px;border:1px solid var(--twq-bord);box-shadow:0 12px 28px rgba(0,0,0,.22);background:var(--twq-bg);color:var(--twq-fg);font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Helvetica Neue,Arial,Noto Sans}',
      '.twq--head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--twq-sep);position:sticky;top:0;background:var(--twq-bg);z-index:2}',
      '.twq--title{font-weight:700}',
      '.twq--btn{display:inline-flex;align-items:center;gap:8px;border-radius:8px;border:1px solid transparent;padding:8px 12px;font-weight:600;cursor:pointer;background:var(--twq-accent);color:#fff}',
      '.twq--btn.secondary{background:var(--twq-btn);color:var(--twq-fg)}',
      '.twq--btn.warn{background:#c0392b;color:#fff}',
      '.twq--body{padding:10px 12px}',
      '.twq--row{margin:10px 0}',
      '.twq--small{font-size:12px;opacity:.85}',
      '.twq--pill{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid var(--twq-sep)}',
      '.twq--grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.twq--input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--twq-sep);background:var(--twq-in-bg);color:var(--twq-fg)}',
      '.twq--chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.twq--chip{border:1px solid var(--twq-sep);border-radius:999px;padding:3px 8px;cursor:pointer}',
      '.twq--chip.active{background:var(--twq-accent);color:#fff;border-color:transparent}',
      '.twq--log{font-size:12px;white-space:pre-wrap;max-height:34vh;overflow:auto;border:1px solid var(--twq-sep);border-radius:8px;padding:6px 8px;background:var(--twq-in-bg)}',
      '.twq--foot{padding:8px 12px;border-top:1px solid var(--twq-sep);display:flex;align-items:center;justify-content:space-between;position:sticky;bottom:0;background:var(--twq-bg)}',
      /* Progress via <progress> (keine inline-Styles nötig) */
      '.twq--progress{width:100%}',
      'progress{width:100%;height:8px}',
      'progress::-webkit-progress-bar{background:var(--twq-sep);border-radius:999px}',
      'progress::-webkit-progress-value{background:var(--twq-accent);border-radius:999px}',
      'progress::-moz-progress-bar{background:var(--twq-accent);border-radius:999px}',
      /* Tabs/Sections */
      '.twq--section{border:1px solid var(--twq-sep);border-radius:10px;padding:8px 10px}',
      '.twq--sec-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer}',
      '.twq--sec-title{font-weight:600}',
      '.twq--sec-body{margin-top:8px}',
      /* Theme vars */
      '.twq--wrap{--twq-bg:#fff;--twq-fg:#111;--twq-bord:rgba(0,0,0,.15);--twq-sep:rgba(0,0,0,.12);--twq-accent:#0b5;--twq-btn:#e9e9e9;--twq-in-bg:#fff}',
      '.twq--wrap.dark{--twq-bg:#1f1f1f;--twq-fg:#f1f1f1;--twq-bord:rgba(255,255,255,.18);--twq-sep:rgba(255,255,255,.2);--twq-accent:#15a86b;--twq-btn:#333;--twq-in-bg:#2a2a2a}'
    ].join('\n')
  );

  /*************** Panel HTML ***************/
  function themeClass(t){
    if (t==='auto') {
      var dark=false; try{ dark= (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }catch(e){}
      return dark?'dark':'';
    }
    return t==='dark'?'dark':'';
  }
  function summarizeCats(items){
    var map={},i,j;
    for(i=0;i<(items?items.length:0);i++){ var cats=items[i].categories||[]; if(!cats.length) map.Unk=(map.Unk||0)+1; for(j=0;j<cats.length;j++) map[cats[j]]=(map[cats[j]]||0)+1; }
    var arr=[],k; for(k in map) arr.push({name:k,count:map[k]}); arr.sort(function(a,b){return a.name.localeCompare(b.name)}); return arr;
  }

  function sectionSite(cache, prefs){
    var total = cache && cache.items ? cache.items.length : 0;
    var cats = summarizeCats(cache && cache.items ? cache.items : []);
    var chips = cats.map(function(c){ return '<span class="twq--chip">'+escapeHtml(c.name)+' <span class="twq--small">('+(c.count)+')</span></span>'; }).join(' ');
    return [
      '<div class="twq--section" data-sec="site">',
        '<div class="twq--sec-head" data-toggle="site"><div class="twq--sec-title">twscripts.dev – Scanner</div><div>▾</div></div>',
        '<div class="twq--sec-body">',
          '<div class="twq--row"><span class="twq--pill">Auf twscripts.dev erkannt</span></div>',
          '<div class="twq--grid">',
            '<button class="twq--btn" data-act="scan">Alle Scripte scannen & speichern</button>',
            '<button class="twq--btn secondary" data-act="export">Export JSON</button>',
            '<button class="twq--btn warn" data-act="clear">Cache löschen</button>',
            '<span></span>',
          '</div>',
          '<div class="twq--row">',
            '<label class="twq--small">Scan‑Parallelität</label>',
            '<input class="twq--input" type="number" min="1" max="8" step="1" value="'+(prefs.concurrency||5)+'" data-pref="concurrency">',
          '</div>',
          '<div class="twq--row">',
            '<div class="twq--small"><b>'+total+'</b> Loader im Cache.</div>',
            (chips?('<div class="twq--small twq--row">'+chips+'</div>'):''),
          '</div>',
          '<div class="twq--row"><progress id="twq-site-progress" class="twq--progress" max="100" value="0"></progress></div>',
          '<div class="twq--row"><div class="twq--log" id="twq-site-log"></div></div>',
        '</div>',
      '</div>'
    ].join('');
  }

  function sectionGame(cache, prefs){
    var total = cache && cache.items ? cache.items.length : 0;
    var cats = summarizeCats(cache && cache.items ? cache.items : []);
    var chips = cats.map(function(c){ return '<span class="twq--chip" data-cat="'+escapeHtml(c.name)+'">'+escapeHtml(c.name)+' ('+(c.count)+')</span>'; }).join(' ');
    return [
      '<div class="twq--section" data-sec="game">',
        '<div class="twq--sec-head" data-toggle="game"><div class="twq--sec-title">Die Stämme – Schnellleiste</div><div>▾</div></div>',
        '<div class="twq--sec-body">',
          '<div class="twq--small twq--row">Gespeicherte Loader: <b>'+total+'</b></div>',
          '<div class="twq--row"><label class="twq--small">Kategorien (optional – leer = alle)</label><div class="twq--chips" id="twq-chips">'+(chips||'<em>Keine Kategorien im Cache.</em>')+'</div></div>',
          '<div class="twq--grid">',
            '<div class="twq--row"><label class="twq--small">Max. Einträge pro Zeile</label><input class="twq--input" type="number" min="2" max="12" step="1" value="'+(prefs.maxPerRow||7)+'" data-pref="maxPerRow"></div>',
            '<div class="twq--row"><label class="twq--small">Drosselung pro Request (ms)</label><input class="twq--input" type="number" min="800" step="100" value="'+(prefs.delayMs||2500)+'" data-pref="delayMs"></div>',
          '</div>',
          '<div class="twq--grid">',
            '<label class="twq--small"><input type="checkbox" '+(prefs.linebreakPerCategory?'checked':'')+' data-pref="linebreakPerCategory"> Trennlinie vor jeder Kategorie</label>',
            '<label class="twq--small"><input type="checkbox" '+(prefs.skipDuplicates?'checked':'')+' data-pref="skipDuplicates"> Duplikate überspringen</label>',
          '</div>',
          '<div class="twq--grid">',
            '<label class="twq--small"><input type="checkbox" '+(prefs.germanize?'checked':'')+' data-pref="germanize"> Deutsche Namen & Kategorien</label>',
            '<button class="twq--btn secondary" data-act="add-break">Trennlinie jetzt</button>',
          '</div>',
          '<div class="twq--grid twq--row">',
            '<button class="twq--btn" data-act="preview">Vorschau</button>',
            '<button class="twq--btn" data-act="import">Einträge langsam hinzufügen</button>',
          '</div>',
          '<div class="twq--row"><progress id="twq-game-progress" class="twq--progress" max="100" value="0"></progress></div>',
          '<div class="twq--grid">',
            '<button class="twq--btn secondary" data-act="stop">Stop</button>',
            '<button class="twq--btn secondary" data-act="refresh">Seite neu laden</button>',
          '</div>',
          '<div class="twq--row"><div class="twq--log" id="twq-game-log"></div></div>',
        '</div>',
      '</div>'
    ].join('');
  }

  function buildPanelHTML(){
    var prefs = loadPrefs();
    var cache = getCache() || {items:[]};
    var parts = [];
    parts.push('<div class="twq--head"><div class="twq--title">TWscripts ⇢ Schnellleiste</div><div>');
    parts.push('<button class="twq--btn secondary" data-act="theme">Theme</button> ');
    parts.push('<button class="twq--btn secondary" data-act="close">×</button>');
    parts.push('</div></div>');
    parts.push('<div class="twq--body">');
    if (isTWSite()) parts.push(sectionSite(cache, loadPrefs()));
    if (isGamePHP() && isTWHost()) parts.push(sectionGame(cache, loadPrefs()));
    if (!isTWSite() && !(isGamePHP() && isTWHost())) parts.push('<div class="twq--row twq--small">Öffne <b>twscripts.dev/scripts</b> zum Scannen oder die <b>Schnellleisten‑Bearbeitung</b> im Spiel zum Import.</div>');
    parts.push('</div>');
    parts.push('<div class="twq--foot"><div class="twq--small">Stand: <span id="twq-ts">'+nowISO()+'</span></div><div class="twq--small">'+escapeHtml(TWQ.version)+'</div></div>');
    return parts.join('');
  }

  /*************** Injection ***************/
  function injectPanel(force){
    try{
      if (!document || !document.body) return false;
      var ex = document.querySelector('.twq--wrap');
      if (ex && !force) return true;
      if (ex && force) { try{ex.parentNode.removeChild(ex);}catch(e){} }
      var prefs = loadPrefs();
      var html  = '<div class="twq--wrap '+themeClass(prefs.theme)+'">'+buildPanelHTML()+'</div>';
      document.body.insertAdjacentHTML('beforeend', html);
      var panel = document.querySelector('.twq--wrap');
      if (!panel) { TWQ.error('Panel fehlt nach Injection'); return false; }
      bindEvents(panel);
      TWQ.log('Panel injected');
      return true;
    }catch(e){ TWQ.error('injectPanel', e); return false; }
  }
  function refreshPanel(){
    var panel = document.querySelector('.twq--wrap'); if(!panel) return;
    var body  = panel.querySelector('.twq--body'); if(!body) return;
    var cache = getCache() || {items:[]};
    var html  = '';
    if (isTWSite()) html += sectionSite(cache, loadPrefs());
    if (isGamePHP() && isTWHost()) html += sectionGame(cache, loadPrefs());
    if (!isTWSite() && !(isGamePHP() && isTWHost())) html += '<div class="twq--row twq--small">Öffne <b>twscripts.dev/scripts</b> zum Scannen oder die <b>Schnellleisten‑Bearbeitung</b> im Spiel zum Import.</div>';
    body.innerHTML = html;
    var ts = panel.querySelector('#twq-ts'); if(ts) ts.textContent = nowISO();
    bindEvents(panel);
  }

  /*************** UI Events ***************/
  function setProgress(selector, value){
    var el = document.querySelector(selector);
    if (el && el.tagName==='PROGRESS') {
      el.value = Math.max(0, Math.min(100, Number(value)||0));
    }
  }
  function logSite(t){ var el=document.querySelector('#twq-site-log'); if(el) el.textContent += '['+nowISO()+'] '+t+'\n'; TWQ.log('SITE:', t); }
  function logGame(t){ var el=document.querySelector('#twq-game-log'); if(el) el.textContent += '['+nowISO()+'] '+t+'\n'; TWQ.log('GAME:', t); }

  function bindEvents(root){
    // head buttons
    root.addEventListener('click', function(ev){
      var btn = ev.target.closest ? ev.target.closest('[data-act]') : null; if(!btn) return;
      var act = btn.getAttribute('data-act');
      if (act==='close'){ root.parentNode.removeChild(root); return; }
      if (act==='theme'){ cycleTheme(root); return; }
      if (act==='scan'){ scanAll(); return; }
      if (act==='export'){ exportCache(); return; }
      if (act==='clear'){ clearCache(); logSite('Cache gelöscht.'); refreshPanel(); return; }
      if (act==='preview'){ previewImport(); return; }
      if (act==='import'){ runImport(); return; }
      if (act==='stop'){ stopFlag=true; logGame('Stop angefordert – beendet nach aktuellem Request.'); return; }
      if (act==='refresh'){ location.reload(); return; }
      if (act==='add-break'){ addBreakNow(); return; }
    });

    // prefs
    root.addEventListener('change', function(ev){
      var el=ev.target; if(!el || !el.hasAttribute('data-pref')) return;
      var prefs = loadPrefs(); var key = el.getAttribute('data-pref'); var val;
      if (el.type==='checkbox') val = !!el.checked;
      else if (el.type==='number') val = Number(el.value);
      else val = el.value;
      prefs[key] = val; savePrefs(prefs);
      if (key==='concurrency') logSite('Scan-Parallelität auf '+val+' gesetzt.');
    });

    // chips
    var chips = root.querySelector('#twq-chips');
    if (chips) chips.addEventListener('click', function(ev){
      var chip = ev.target.closest ? ev.target.closest('.twq--chip') : null; if(!chip) return;
      chip.classList.toggle('active');
    });

    // collapsible sections
    root.addEventListener('click', function(ev){
      var head = ev.target.closest ? ev.target.closest('[data-toggle]') : null; if(!head) return;
      var sec = head.getAttribute('data-toggle');
      var box = root.querySelector('.twq--section[data-sec="'+sec+'"] .twq--sec-body');
      if (box) box.hidden = !box.hidden;
      // Pfeil toggeln
      var arrow = head.querySelector('div:last-child'); if(arrow) arrow.textContent = box.hidden ? '▸' : '▾';
    });

    // initial ausgeklappt
    var bodies = root.querySelectorAll('.twq--sec-body'); for (var i=0;i<bodies.length;i++) bodies[i].hidden = false;
  }

  function cycleTheme(root){
    var prefs=loadPrefs();
    if (prefs.theme==='auto') prefs.theme='dark';
    else if (prefs.theme==='dark') prefs.theme='light';
    else prefs.theme='auto';
    savePrefs(prefs);
    var w = document.querySelector('.twq--wrap');
    if (w){ w.classList.remove('dark'); if (themeClass(prefs.theme)==='dark') w.classList.add('dark'); }
  }

  /*************** Scan auf twscripts.dev ***************/
  function scanAll(){
    var rows = document.querySelectorAll('#scriptsList tbody tr');
    if (!rows.length) { logSite('Keine Liste (#scriptsList) gefunden. Öffne https://twscripts.dev/scripts/'); return; }
    var prefs = loadPrefs(), links=[], i,j;
    for(i=0;i<rows.length;i++){
      var a=rows[i].querySelector('td.cell-script-name a'); if(!a) continue;
      var catsEls=rows[i].querySelectorAll('td.cell-script-category .script-category'); var cats=[];
      for(j=0;j<catsEls.length;j++) cats.push((catsEls[j].textContent||'').trim());
      links.push({ name:(a.textContent||'').trim()||'Unbekannt', href:a.href, cats:cats });
    }
    logSite('Gefunden: '+links.length+' Scriptseiten. Starte Einsammeln (Parallelität '+prefs.concurrency+') …');

    var items=[], total=links.length, done=0, conc=Math.max(1, Math.min(8, parseInt(prefs.concurrency,10)||5)), idx=0;

    function worker(){
      if (idx>=links.length) return Promise.resolve();
      var it=links[idx++];
      return gmFetchText(it.href).then(function(txt){
        var dom=new DOMParser().parseFromString(txt,'text/html');
        var ta=dom.querySelector('#scriptLoader');
        var loader=ta?((ta.value||ta.textContent||'').trim()):'';
        var tt=dom.querySelector('.script-title'); var title=tt? (tt.textContent||'').trim() : it.name;
        if (loader && /^javascript:/i.test(loader)) items.push({title:title,pageUrl:it.href,categories:it.cats,loader:loader});
        else logSite('⚠️ Kein Loader gefunden: '+title+' ('+it.href+')');
      }).catch(function(e){ logSite('❌ Fehler bei '+it.name+': '+e); })
      .then(function(){ done++; setProgress('#twq-site-progress', Math.round(100*done/total)); return worker(); });
    }
    var ws=[], k; for(k=0;k<conc;k++) ws.push(worker());
    Promise.all(ws).then(function(){
      setCache({ts:Date.now(), items:items});
      logSite('✅ Fertig: '+items.length+' Loader gespeichert.');
      refreshPanel();
    });
  }

  function exportCache(){
    var cache = getCache() || { ts:Date.now(), items:[] };
    var blob = new Blob([JSON.stringify(cache, null, 2)], {type:'application/json'});
    var url = URL.createObjectURL(blob); var a=document.createElement('a');
    a.download='twscripts_cache_'+new Date().toISOString().slice(0,10)+'.json'; a.href=url; a.click(); URL.revokeObjectURL(url);
  }

  /*************** Import in Die Stämme ***************/
  function selectedRawCats(){
    var chips=document.querySelectorAll('#twq-chips .twq--chip.active'); var out=[], i;
    for(i=0;i<chips.length;i++) out.push(chips[i].getAttribute('data-cat'));
    return out;
  }
  function getExistingFromDom(doc){
    var names={}, loaders={}, rows=doc.querySelectorAll('#quickbar tr'), i;
    for(i=0;i<rows.length;i++){
      var nm = rows[i].querySelector('.quickbar_link'); if(nm && nm.textContent) names[normalizeName(nm.textContent,false)] = true;
      var a = rows[i].querySelector('a[href^="javascript:"]'); if(a) loaders[canonLoader(a.getAttribute('href'))] = true;
    }
    return {names:names, loaders:loaders};
  }
  function getExistingQuickbarEntries(){
    var base=getExistingFromDom(document);
    if (Object.keys(base.names).length || Object.keys(base.loaders).length) return Promise.resolve(base);
    var v=currentVillage(); var u=new URL(location.origin+'/game.php');
    u.searchParams.set('village',v||''); u.searchParams.set('screen','settings'); u.searchParams.set('mode','quickbar');
    return fetch(u.toString(), {credentials:'same-origin'}).then(function(r){return r.text();}).then(function(txt){
      var dom=new DOMParser().parseFromString(txt,'text/html'); return getExistingFromDom(dom);
    }).catch(function(){ return {names:{}, loaders:{}}; });
  }
  function applyDE_Title(prefs, title){ return prefs.germanize ? (DE.titleMap[title]||title) : title; }
  function applyDE_Category(prefs, raw){ return prefs.germanize ? DE.fromRaw(raw) : ((raw&&raw[0])?raw[0]:'Misc.'); }
  function orderCats(keys){
    var ord={},i; for(i=0;i<DE.order.length;i++) ord[DE.order[i]]=i;
    keys.sort(function(a,b){ var A=ord.hasOwnProperty(a)?ord[a]:999, B=ord.hasOwnProperty(b)?ord[b]:999; if(A!==B) return A-B; return a.localeCompare(b); });
    return keys;
  }

  function previewImport(){
    var cache=getCache(); if(!cache||!cache.items||!cache.items.length){ logGame('Kein Cache gefunden – zuerst scannen.'); return; }
    var prefs=loadPrefs(); var chosen=selectedRawCats();
    var filtered=[], i;
    for(i=0;i<cache.items.length;i++){
      var it=cache.items[i]; if(!chosen.length) filtered.push(it);
      else if (it.categories && it.categories.length && chosen.indexOf(it.categories[0])!==-1) filtered.push(it);
    }
    getExistingQuickbarEntries().then(function(existing){
      var dup=0, planned=0;
      for(i=0;i<filtered.length;i++){
        var it=filtered[i], name=normalizeName(applyDE_Title(prefs,it.title)), loader=canonLoader(it.loader);
        var isDup = !!existing.names[name] || !!existing.loaders[loader];
        if (prefs.skipDuplicates && isDup) dup++; else planned++;
      }
      logGame('🔎 Vorschau:\n- Roh-Kategorien: '+(chosen.length?chosen.join(', '):'(alle)')+'\n- Kandidaten gesamt: '+filtered.length+'\n- Duplikate (übersprungen): '+dup+'\n- Geplant hinzuzufügen: '+planned+'\n- Max/Zeile: '+prefs.maxPerRow+'; Trennlinie pro Kategorie: '+(prefs.linebreakPerCategory?'ja':'nein'));
    });
  }

  function addBreakNow(){
    var v=currentVillage(), h=findCSRF(); if(!v||!h){ logGame('❌ village oder CSRF (h) fehlen. Seite: Einstellungen → Schnellleiste → Bearbeiten.'); return; }
    var u=new URL(location.origin+'/game.php'); u.searchParams.set('village',v); u.searchParams.set('screen','settings'); u.searchParams.set('mode','quickbar'); u.searchParams.set('action','quickbar_insert_linebreak'); u.searchParams.set('h',h);
    fetch(u.toString(), {method:'GET', credentials:'same-origin'}).then(function(r){ if(r.ok) logGame('— Trennlinie eingefügt.'); else logGame('⚠️ Trennlinie HTTP '+r.status); });
  }

  function withRetry(label, fn, prefs){
    var tries=0;
    function run(){
      tries++;
      return fn().then(function(res){
        if(!res.ok){
          logGame('⚠️ '+label+': HTTP '+res.status);
          if (res.status===429 || res.status>=500) return sleep(prefs.backoffMs + jitter(2000)).then(run);
        }
        return res;
      }).catch(function(e){
        logGame('⚠️ '+label+': '+e);
        if (tries < prefs.maxRetries) return sleep(prefs.backoffMs + jitter(2000)).then(run);
        throw e;
      });
    }
    return run();
  }

  function runImport(){
    stopFlag=false;
    var cache=getCache(); if(!cache||!cache.items||!cache.items.length){ logGame('❌ Kein Cache gefunden – zuerst auf twscripts.dev scannen.'); return; }
    if(!isTWHost() || !isGamePHP()){ logGame('❌ Falsche Seite. Öffne: Einstellungen → Schnellleiste → Bearbeiten.'); return; }
    var v=currentVillage(), h=findCSRF(); if(!v||!h){ logGame('❌ village oder CSRF (h) fehlen.'); return; }
    var prefs=loadPrefs(); var chosen=selectedRawCats();

    getExistingQuickbarEntries().then(function(existing){
      var arr=[], i;
      for(i=0;i<cache.items.length;i++){
        var it=cache.items[i];
        if(chosen.length){ var first=(it.categories&&it.categories[0])?it.categories[0]:''; if(chosen.indexOf(first)===-1) continue; }
        var name=normalizeName(applyDE_Title(prefs,it.title));
        var loader=canonLoader(it.loader);
        var cat=applyDE_Category(prefs,it.categories);
        var isDup = !!existing.names[name] || !!existing.loaders[loader];
        if (prefs.skipDuplicates && isDup) continue;
        arr.push({name:name, loader:loader, cat:cat});
      }
      if(!arr.length){ logGame('ℹ️ Nichts zu tun – alles vorhanden/ausgefiltert.'); return; }

      var groups={},k; for(i=0;i<arr.length;i++){ k=arr[i].cat||'🧩 Verschiedene'; if(!groups[k]) groups[k]=[]; groups[k].push(arr[i]); }
      var cats=orderCats(Object.keys(groups));

      var plannedBreaks = prefs.linebreakPerCategory ? cats.length : 0;
      var maxPerRow = Math.max(1, parseInt(prefs.maxPerRow,10)||7);
      for(i=0;i<cats.length;i++) plannedBreaks += Math.floor((groups[cats[i]].length)/maxPerRow);

      var totalOps = arr.length + plannedBreaks, doneOps=0;
      logGame('🚀 Starte Import: '+arr.length+' Einträge, ~'+plannedBreaks+' Trennlinien, Delay ≈ '+prefs.delayMs+'ms (+Jitter).');

      function setBar(){ setProgress('#twq-game-progress', Math.round(100*doneOps/Math.max(1,totalOps))); }

      function insertBreak(){
        var u=new URL(location.origin+'/game.php'); u.searchParams.set('village',v); u.searchParams.set('screen','settings'); u.searchParams.set('mode','quickbar'); u.searchParams.set('action','quickbar_insert_linebreak'); u.searchParams.set('h',h);
        return withRetry('Trennlinie', function(){ return fetch(u.toString(), {method:'GET', credentials:'same-origin'}); }, prefs).then(function(){
          doneOps++; setBar(); logGame('— Trennlinie eingefügt.'); return sleep(prefs.delayMs + jitter(prefs.jitterMs));
        });
      }
      function addItem(nm, ld){
        var u=new URL(location.origin+'/game.php'); u.searchParams.set('village',v); u.searchParams.set('screen','settings'); u.searchParams.set('mode','quickbar_edit'); u.searchParams.set('action','quickbar_edit');
        var body=new URLSearchParams(); body.set('name',nm); body.set('hovertext','twscripts.dev'); body.set('image_url',''); body.set('href',ld); body.set('hotkey',''); body.set('h',h);
        return withRetry('Eintrag "'+nm+'"', function(){
          return fetch(u.toString(), {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}, body:body});
        }, prefs).then(function(){
          doneOps++; setBar(); logGame('+ Hinzugefügt: '+nm); return sleep(prefs.delayMs + jitter(prefs.jitterMs));
        });
      }

      (function seq(){
        var p=Promise.resolve(), ci, inner, list, countInRow;
        for(ci=0; ci<cats.length; ci++){
          (function(cat){
            p = p.then(function(){ if(stopFlag) return; if(prefs.linebreakPerCategory) return insertBreak(); })
                 .then(function(){
                   if(stopFlag) return;
                   list = groups[cat]; countInRow=0; inner=Promise.resolve();
                   for(var j=0;j<list.length;j++){
                     (function(it){
                       inner = inner.then(function(){
                         if(stopFlag) return; if(countInRow>=maxPerRow){ countInRow=0; return insertBreak(); }
                       }).then(function(){
                         if(stopFlag) return; countInRow++; return addItem(it.name, it.loader);
                       });
                     })(list[j]);
                   }
                   return inner;
                 });
          })(cats[ci]);
        }
        p.then(function(){ logGame(stopFlag?'⏸️ Import gestoppt.':'✅ Import abgeschlossen.'); });
      })();
    });
  }

  /*************** Menü + Start ***************/
  try {
    GM_registerMenuCommand('TWQ – Panel öffnen', function(){ injectPanel(true); });
    GM_registerMenuCommand('TWQ – Diagnose', function(){ console.clear(); TWQ.diag(); });
  } catch(e){ TWQ.warn('MenuCmd', e); }

  (function boot(){
    var tries=0, t=setInterval(function(){
      tries++; if (injectPanel(false)) { clearInterval(t); return; }
      if (tries>6){ clearInterval(t); TWQ.warn('Panel nicht sichtbar – Menü „TWQ – Panel öffnen“ benutzen.'); }
    }, 500);
  })();

})();
