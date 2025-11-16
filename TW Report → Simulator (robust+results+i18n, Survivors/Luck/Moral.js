// ==UserScript==
// @name         TW Report → Simulator (robust+results+i18n, Survivors/Luck/Moral/Wall) v2.4
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Fügt Angreifer/Verteidiger aus Report-HTML ODER Text robust in den Simulator ein. Unterstützt Survivors, Luck, Moral, Mauer (auch aus „Schaden durch Rammböcke“), mehr Sprachen, Hotkeys (Shift/Alt/Ctrl-Cmd), robuste Unit-Erkennung, bessere Fallbacks & schnelles Input-Caching.
// @author       You
// @match        https://*.die-staemme.de/game.php?*screen=place*&mode=sim*
// @grant        none
// @run-at       document-end
// [Optional weitere Welten, wenn gewünscht]:
// @match        https://*.tribalwars.*/*game.php?*screen=place*&mode=sim*
// ==/UserScript==

(function () {
  'use strict';

  // -------- prevent double init (SPA etc.) --------
  const INIT_FLAG = '__tw_sim_paste_v24__';
  if (window[INIT_FLAG]) return;
  window[INIT_FLAG] = true;

  // ------------------------------ Config / Labels ------------------------------
  const TOAST_ID = 'tw_paste_toast_v24';
  const STYLE_ID = 'tw_paste_style_v24';

  const LABELS = {
    count:     ['Anzahl','Count','Nombre','Cantidad','Quantità','Ilość','Quantidade','Aantal','Počet','Количество'],
    losses:    ['Verluste','Losses','Pertes','Pérdidas','Perdite','Straty','Perdas','Verliezen','Ztráty','Потери'],
    survivors: ['Überlebende','Survivors','Survivants','Supervivientes','Sopravvissuti','Ocalali','Sobreviventes','Overlevenden','Přeživší','Выжившие']
  };

  // Deutsch → Simulator-Building-Key (für Katapult-/Ramm-Schaden in #attack_results)
  const DE_BUILDING_MAP = {
    'wall': 'wall',
    'hauptgebaude': 'main',
    'kaserne': 'barracks',
    'stall': 'stable',
    'werkstatt': 'garage',
    'schmiede': 'smith',
    'marktplatz': 'market',
    'markt': 'market',
    'holzfaller': 'wood',
    'lehmgrube': 'stone',
    'eisenmine': 'iron',
    'bauernhof': 'farm',
    'speicher': 'storage',
    'versteck': 'hide',
    'versammlungsplatz': 'place',
    'statue': 'statue',
    'kirche': 'church',
    'wachturm': 'watchtower'
  };

  const HOTKEY_HINT = 'Shift=Überlebende · Alt=Verteidiger · Strg/Cmd=Beide';

  // ------------------------------ Toast UI ------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${TOAST_ID}{
        position:fixed;z-index:99999;top:16px;right:16px;max-width:460px;
        background:rgba(25,25,28,.96);color:#fff;padding:10px 14px;border-radius:10px;
        box-shadow:0 6px 20px rgba(0,0,0,.35);font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial;
        white-space:pre-wrap;opacity:0;transform:translateY(-8px);transition:all .18s ease;
        pointer-events:none
      }
      #${TOAST_ID}.show{opacity:1;transform:translateY(0)}
      .tw-hi{outline:2px solid #59b98f;outline-offset:1px;transition:outline-color .8s ease}
      @media (prefers-reduced-motion: reduce){#${TOAST_ID}{transition:none}}
    `;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function toast(msg, ms = 3800) {
    injectStyle();
    let t = document.getElementById(TOAST_ID);
    if (!t) {
      t = document.createElement('div');
      t.id = TOAST_ID;
      t.setAttribute('role','status');
      t.setAttribute('aria-live','polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), ms);
    });
  }

  // ------------------------------ Utils ------------------------------
  const onlyDigits = s => (s || '').replace(/[^\d]/g, '');
  const toInt = s => {
    const n = parseInt(onlyDigits(String(s)), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const toFloatNum = s => {
    if (s == null) return null;
    const m = String(s).match(/-?\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : null;
  };
  const matchesAny = (text, arr) => {
    const t = (text || '').toLowerCase();
    return arr.some(k => t.includes(k.toLowerCase()));
  };
  const normalizeKey = s =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'') // Akzente weg
      .replace(/ß/g,'ss')
      .replace(/[^a-z0-9]+/g,'');

  // Input-Cache (schnelleres Setzen)
  const INPUT_CACHE = new Map();
  function getInputByName(name) {
    if (INPUT_CACHE.has(name)) return INPUT_CACHE.get(name);
    const el = document.querySelector(`input[name="${name}"]`) || null;
    INPUT_CACHE.set(name, el);
    return el;
  }

  // ------------------------------ Simulator-Inputs warten ------------------------------
  function waitForSimulatorInputs(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const grab = () => {
        const table = document.querySelector('#simulator_units_table');
        if (!table) return null;
        const att = Array.from(table.querySelectorAll('input[name^="att_"]'));
        const def = Array.from(table.querySelectorAll('input[name^="def_"]'));
        if (att.length || def.length) return { att, def, table };
        return null;
      };
      let got = grab();
      if (got) return resolve(got);

      const obs = new MutationObserver(() => {
        got = grab();
        if (got) {
          obs.disconnect();
          resolve(got);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        obs.disconnect();
        got = grab();
        if (got) resolve(got);
        else reject(new Error('Simulator-Eingabefelder nicht gefunden.'));
      }, timeoutMs);
    });
  }

  // ------------------------------ Parsing: Einheiten-Tabellen ------------------------------
  function parseSideFromTable(tableEl) {
    if (!tableEl) return null;

    // (1) Unit-Order aus Header
    let unitOrder = Array.from(
      tableEl.querySelectorAll('tr.center a.unit_link, thead a.unit_link, th a.unit_link')
    ).map(a => a?.dataset?.unit).filter(Boolean);

    // (2) Zeilen: Anzahl / Verluste / Überlebende
    let rowCount = null, rowLosses = null, rowSurvivors = null;
    for (const tr of tableEl.querySelectorAll('tr')) {
      const first = tr.querySelector('td,th');
      if (!first) continue;
      const label = (first.textContent || '').trim();
      if (matchesAny(label, LABELS.count))     rowCount = tr;
      if (matchesAny(label, LABELS.losses))    rowLosses = tr;
      if (matchesAny(label, LABELS.survivors)) rowSurvivors = tr;
    }

    // (3) Fallback: Unit-Order aus Zellenklassen der Count-Zeile
    if ((!unitOrder || unitOrder.length === 0) && rowCount) {
      const cells = Array.from(rowCount.querySelectorAll('td')).slice(1);
      const deduced = [];
      for (const td of cells) {
        let u = td?.dataset?.unit || null;
        if (!u) {
          for (const c of Array.from(td.classList || [])) {
            const m = c.match(/^unit-item-([a-z_]+)/);
            if (m) { u = m[1]; break; }
          }
        }
        if (u) deduced.push(u);
      }
      if (deduced.length) unitOrder = deduced;
    }

    // (4) Werte aus Zeilen lesen
    const readRow = (tr) => {
      if (!tr) return null;
      const valuesByUnit = {};
      if (unitOrder && unitOrder.length) {
        const tds = Array.from(tr.querySelectorAll('td')).slice(1);
        unitOrder.forEach((u, idx) => {
          let td =
            tr.querySelector(`td.unit-item.unit-item-${u}`) ||
            tr.querySelector(`td.unit-item-${u}`) ||
            tds[idx];
          const val = td ? (td.getAttribute('data-unit-count') || td.textContent) : null;
          valuesByUnit[u] = toInt(val);
        });
      } else {
        // Komplett-Fallback (pro Zelle Unit-Namen erraten)
        const tds = Array.from(tr.querySelectorAll('td')).slice(1);
        for (const td of tds) {
          let u = td?.dataset?.unit || null;
          if (!u) {
            for (const c of Array.from(td.classList || [])) {
              const m = c.match(/^unit-item-([a-z_]+)/);
              if (m) { u = m[1]; break; }
            }
          }
          if (!u) continue;
          const val = td.getAttribute('data-unit-count') || td.textContent;
          valuesByUnit[u] = toInt(val);
        }
      }
      return valuesByUnit;
    };

    const counts    = readRow(rowCount)     || {};
    const losses    = readRow(rowLosses)    || {};
    const survivors = readRow(rowSurvivors) || null;

    return { unitOrder, counts, losses, survivors };
  }

  // ------------------------------ Parsing: Attack-Results (Mauer & Co.) ------------------------------
  function parseBuildingsFromResults(doc) {
    const resultTbl = doc.querySelector('#attack_results');
    if (!resultTbl) return {};

    const buildings = {};
    for (const tr of resultTbl.querySelectorAll('tr')) {
      const text = (tr.textContent || '').trim();
      // z.B.: "Schaden durch Rammböcke: Wall beschädigt von Level 7 auf Level 0"
      const m = text.match(/:\s*(.+?)\s+beschädigt\s+von\s+Level\s+(\d+)\s+auf\s+Level\s+(\d+)/i);
      if (!m) continue;
      const [, buildingName, beforeLvlStr] = m;
      const beforeLvl = toInt(beforeLvlStr);
      const key = DE_BUILDING_MAP[normalizeKey(buildingName)] || null;
      if (key && Number.isFinite(beforeLvl)) buildings[key] = beforeLvl; // wir setzen das VORHER-Level
    }
    return buildings;
  }

  // ------------------------------ Parsing: kompletter Report (HTML/Text) ------------------------------
  function parseReportFromHTML(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const attackerTbl = doc.querySelector('#attack_info_att_units');
      const defenderTbl = doc.querySelector('#attack_info_def_units');

      const attacker = parseSideFromTable(attackerTbl);
      const defender = parseSideFromTable(defenderTbl);

      // Luck / Moral
      const luck   = toFloatNum(doc.querySelector('#attack_luck b')?.textContent);
      const morale = (() => {
        const node = Array.from(doc.querySelectorAll('h4')).find(h => /moral/i.test(h.textContent || ''));
        return node ? toFloatNum(node.textContent) : null;
      })();

      // Buildings aus Spio-JSON (falls vorhanden)
      const buildings = {};
      let wall = null;
      const spyHidden = doc.querySelector('#attack_spy_building_data');
      if (spyHidden?.value) {
        try {
          const arr = JSON.parse(spyHidden.value);
          if (Array.isArray(arr)) {
            for (const x of arr) {
              const id = (x && (x.id || x.name)) ? String(x.id || x.name) : null;
              if (!id) continue;
              const lvl = toInt(x.level ?? x.lvl ?? x.value);
              const norm = normalizeKey(id);
              const key  = DE_BUILDING_MAP[norm] || norm;
              if (Number.isFinite(lvl)) buildings[key] = lvl;
              if ((/wall|mauer/i).test(id) && Number.isFinite(lvl)) wall = lvl;
            }
          }
        } catch { /* ignore */ }
      }

      // Buildings/Mauer aus #attack_results (z. B. Rammböcke/Katapulte)
      const fromResults = parseBuildingsFromResults(doc);
      for (const [k,v] of Object.entries(fromResults)) {
        if (buildings[k] == null) buildings[k] = v;
        if (k === 'wall' && wall == null) wall = v;
      }

      return { attacker, defender, luck, morale, wall, buildings };
    } catch {
      return null;
    }
  }

  function parseReportFromText(text) {
    const lines = (text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const attackerStart = lines.findIndex(l => /angreifer|attacker/i.test(l));
    const defenderStart = lines.findIndex(l => /verteidiger|defender/i.test(l));

    const slice = (from, until) => lines.slice(from + 1, until);
    const attBlock = attackerStart >= 0 ? slice(attackerStart, defenderStart >= 0 ? defenderStart : lines.length) : [];
    const defBlock = defenderStart >= 0 ? slice(defenderStart, lines.length) : [];

    const pick = (block, keys) => block.find(l => matchesAny(l, keys)) || '';
    const nums = l => (l.match(/\d{1,3}(?:[.\s]\d{3})*|\d+/g) || []).map(toInt);

    const attCount = nums(pick(attBlock, LABELS.count));
    const attLoss  = nums(pick(attBlock, LABELS.losses));
    const attSurv  = nums(pick(attBlock, LABELS.survivors));
    const defCount = nums(pick(defBlock, LABELS.count));
    const defLoss  = nums(pick(defBlock, LABELS.losses));
    const defSurv  = nums(pick(defBlock, LABELS.survivors));

    // einfache Luck/Moral Erkennung im Text (optional)
    const luck   = toFloatNum(lines.find(l => /luck|glück|angreiferglück/i.test(l)));
    const morale = toFloatNum(lines.find(l => /moral/i.test(l)));

    const pack = (countArr, lossArr, survArr) => {
      if (!countArr.length && !survArr.length) return null;
      const result = { unitOrder: [], counts: {}, losses: {} };
      if (countArr.length) result.counts._raw = countArr;
      if (lossArr.length)  result.losses._raw = lossArr;
      if (survArr.length)  result.survivors   = { _raw: survArr };
      return result;
    };

    return {
      attacker: pack(attCount, attLoss, attSurv),
      defender: pack(defCount, defLoss, defSurv),
      luck: Number.isFinite(luck) ? luck : null,
      morale: Number.isFinite(morale) ? morale : null,
      wall: null,
      buildings: {}
    };
  }

  // ------------------------------ Befüllen ------------------------------
  function setInput(name, value) {
    const el = getInputByName(name);
    if (!el) return false;
    const next = String(value ?? '');
    if (el.value === next) return true; // no-op
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.add('tw-hi');
    setTimeout(() => el.classList.remove('tw-hi'), 900);
    return true;
  }

  function fillSide(prefix, unitsObj, preferSurvivors) {
    if (!unitsObj) return { filled: 0, total: 0 };

    const { unitOrder, counts, losses, survivors } = unitsObj;
    let filled = 0, total = 0;

    const survivorValue = (u, idx) => {
      if (survivors && typeof survivors[u] === 'number') return Math.max(0, survivors[u] || 0);
      if (survivors && survivors._raw && Number.isFinite(idx)) return Math.max(0, survivors._raw[idx] || 0);

      const c = (counts && counts[u]) || (counts && counts._raw && counts._raw[idx]) || 0;
      const l = (losses && losses[u]) || (losses && losses._raw && losses._raw[idx]) || 0;
      return Math.max(0, c - l);
    };

    const write = (n, v) => { total++; if (setInput(n, v)) filled++; };

    if (unitOrder && unitOrder.length) {
      unitOrder.forEach((u, idx) => {
        const val = preferSurvivors ? survivorValue(u, idx) : ((counts && counts[u]) || 0);
        write(`${prefix}_${u}`, val);
      });
    } else if (counts && counts._raw) {
      const inputs = Array.from(document.querySelectorAll(`#simulator_units_table input[name^="${prefix}_"]`));
      const lim = Math.min(inputs.length, counts._raw.length);
      for (let i = 0; i < lim; i++) {
        const val = preferSurvivors ? survivorValue(null, i) : counts._raw[i];
        write(inputs[i].name, val);
      }
    } else if (survivors && survivors._raw) {
      const inputs = Array.from(document.querySelectorAll(`#simulator_units_table input[name^="${prefix}_"]`));
      const lim = Math.min(inputs.length, survivors._raw.length);
      for (let i = 0; i < lim; i++) write(inputs[i].name, Math.max(0, survivors._raw[i] || 0));
    }

    return { filled, total };
  }

  function applyMeta({ luck, morale, wall, buildings }) {
    const summary = [];

    if (typeof luck === 'number' && !Number.isNaN(luck))   { if (setInput('luck', luck))   summary.push(`Luck ${luck}%`); }
    if (typeof morale === 'number' && !Number.isNaN(morale)) { if (setInput('moral', morale)) summary.push(`Moral ${morale}%`); }

    // Gebäude: zuerst aus "buildings", dann ggf. explizit wall
    if (buildings && typeof buildings === 'object') {
      const trySetBuilding = (key, lvl) => {
        const elName = `def_${key}`;
        const elName2 = `def_building_${key}`;
        if ((lvl || lvl === 0) && (getInputByName(elName) || getInputByName(elName2))) {
          if (setInput(elName, lvl) || setInput(elName2, lvl)) summary.push(`${key} ${lvl}`);
        }
      };
      for (const [k, v] of Object.entries(buildings)) trySetBuilding(k, v);
    }
    if (typeof wall === 'number' && !Number.isNaN(wall)) {
      if (setInput('def_wall', wall)) summary.push(`Wall ${wall}`);
    }

    return summary;
  }

  // ------------------------------ Paste-Handler ------------------------------
  async function onPaste(e) {
    const html = e.clipboardData?.getData('text/html')  || '';
    const text = e.clipboardData?.getData('text/plain') || '';

    // Erkenne auch Luck/Results-only Kopien (random Copy)
    const looksLikeReportHTML = /(attack_info_(att|def)_units|attack_luck|attack_results)/i.test(html);
    const looksLikeReportText = /angreifer|anzahl|verteidiger|verluste|überlebende|survivor|moral|glück/i.test(text);
    if (!looksLikeReportHTML && !looksLikeReportText) return; // normale Paste

    e.preventDefault();

    const parsed = looksLikeReportHTML ? parseReportFromHTML(html) : parseReportFromText(text);
    if (!parsed || (!parsed.attacker && !parsed.defender && parsed.luck == null && parsed.morale == null && parsed.wall == null)) {
      toast('❌ Konnte im Clipboard keinen gültigen Report erkennen.');
      return;
    }

    try { await waitForSimulatorInputs(4500); }
    catch { toast('❌ Simulator-Felder nicht gefunden. Bist du auf „Versammlungsplatz → Simulator“?'); return; }

    // Hotkeys: Shift=Survivors · Alt=nur Def · Strg/Cmd=Beide
    const survivors = !!e.shiftKey;
    const both      = !!(e.ctrlKey || e.metaKey);
    const wantDef   = !both && !!e.altKey;
    const wantAtt   = both || !wantDef;

    const summary = [];

    if (wantAtt && parsed.attacker) {
      const { filled, total } = fillSide('att', parsed.attacker, survivors);
      summary.push(`Att ${filled}/${total}${survivors ? ' (Überlebende)' : ''}`);
    }
    if ((both || wantDef) && parsed.defender) {
      const { filled, total } = fillSide('def', parsed.defender, survivors);
      summary.push(`Def ${filled}/${total}${survivors ? ' (Überlebende)' : ''}`);
    }

    const meta = applyMeta(parsed);
    if (meta.length) summary.push(meta.join(', '));
    if (!summary.length) summary.push('Nichts zu füllen (keine passenden Felder gefunden)');

    toast(`✅ Eingefügt: ${summary.join(' · ')}\nTipp: ${HOTKEY_HINT}`);
  }

  // ------------------------------ Init ------------------------------
  document.addEventListener('paste', onPaste, true);
  console.log('TW Report v2.4 – robust paste; Shift=Survivors · Alt=Def · Ctrl/Cmd=Both');
})();
