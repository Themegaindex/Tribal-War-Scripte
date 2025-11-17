// ==UserScript==
// @name         Die-Staemme - Praezises Umbenennen von Angriffen und Support (stabil & ohne Doppel-Umbenennungen)
// @namespace    http://tampermonkey.net/
// @version      2.3.1
// @description  Automatisches und praeziseres Umbenennen von eingehenden Angriffen und Unterstuetzungen; merkt bereits umbenannte Eintraege und ueberspringt sie.
// @author       TheMegaindex
// @include      https://*/game.php*mode=incomings*
// @include      http://*/game.php*mode=incomings*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /***** Konfiguration, Uebersetzungen, Defaults *****/
    const STORAGE_KEY = 'dsRenameHistory_v1';
    const STORAGE_TTL_DAYS = 14;

    const config = {
        translations: {
            de: {
                tomorrow: 'morgen',
                today: 'heute',
                at: 'um',
                noble: 'Adelsgeschlecht',
                spy: 'Spaeher',
                attack: 'Angriff',
                support: 'Unterstuetzung',
                ok: ['OK', 'Speichern', 'Bestaetigen']
            }
        },
        unitDisplayNames: {
            spear: 'Speertraeger',
            sword: 'Schwertkaempfer',
            axe: 'Axtkaempfer',
            archer: 'Bogenschuetze',
            spy: 'Spaeher',
            light: 'Leichte Kavallerie',
            marcher: 'Berittener Bogenschuetze',
            heavy: 'Schwere Kavallerie',
            ram: 'Rammbock',
            catapult: 'Katapult',
            knight: 'Paladin',
            snob: 'Adelsgeschlecht'
        }
    };

    // Einheitengeschwindigkeiten (Minuten pro Feld) - Fallback, falls keine Auto-Erkennung moeglich
    const unitSpeedsFallback = {
        snob: 35,
        ram: 30,
        catapult: 30,
        sword: 22,
        heavy: 11,
        spy: 9,
        light: 10,
        marcher: 10,
        axe: 18,
        spear: 18,
        archer: 18,
        knight: 10
    };

    const lang = 'de';
    const t = config.translations[lang];

    let WorldSpeed = 1; // wird versucht, automatisch zu erkennen
    let UnitSpeed = 1;  // wird versucht, automatisch zu erkennen

    let unitSpeed = {};
    let unitsSortedBySpeed = [];

    // Prioritaetsliste fuer Einheiten
    const unitPriority = {
        attack: ['axe', 'light', 'ram', 'catapult', 'sword', 'spear', 'archer', 'spy', 'heavy', 'snob'],
        support: ['spear', 'sword', 'archer', 'heavy', 'ram', 'catapult', 'knight', 'axe', 'light', 'spy']
    };

    /***** Utilities: Storage *****/
    function nowMs() { return Date.now(); }

    function loadHistory() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            const cutoff = nowMs() - STORAGE_TTL_DAYS * 24 * 3600 * 1000;
            let changed = false;
            for (const [k, v] of Object.entries(parsed)) {
                if (!v || typeof v !== 'object' || !v.ts || v.ts < cutoff) {
                    delete parsed[k];
                    changed = true;
                }
            }
            if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            return parsed;
        } catch (e) {
            console.warn('[DS-Rename] Konnte Verlauf nicht laden, initialisiere neu.', e);
            localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
            return {};
        }
    }

    function saveHistory(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (e) {
            console.error('[DS-Rename] Konnte Verlauf nicht speichern.', e);
        }
    }

    function hasRenamed(key, store) {
        return !!(store && store[key]);
    }

    function markRenamed(key, newName, arrivalMs, store) {
        store[key] = { name: newName, arrivalMs: arrivalMs || null, ts: nowMs() };
        saveHistory(store);
    }

    function clearHistory() {
        localStorage.removeItem(STORAGE_KEY);
        console.log('[DS-Rename] Verlauf geloescht.');
    }

    /***** Utilities: DOM & Helpers *****/
    function textOrEmpty(el) {
        return (el && el.textContent != null) ? el.textContent.trim() : '';
    }

    function querySafe(root, sel) {
        try { return root.querySelector(sel); } catch (_) { return null; }
    }

    function queryAllSafe(root, sel) {
        try { return root.querySelectorAll(sel); } catch (_) { return []; }
    }

    function waitForElement(root, selector, timeoutMs = 2000) {
        return new Promise(resolve => {
            const found = root.querySelector(selector);
            if (found) return resolve(found);
            const obs = new MutationObserver(() => {
                const el = root.querySelector(selector);
                if (el) { obs.disconnect(); resolve(el); }
            });
            obs.observe(root, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
        });
    }

    function dispatchInputEvents(input) {
        try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) { /* noop */ }
    }

    /***** Geschwindigkeiten laden *****/
    function autoDetectSpeeds() {
        try {
            const gd = window.game_data || (window.TW && window.TW.game_data) || null;
            if (gd) {
                if (gd.worldSpeed || gd.speed) WorldSpeed = parseFloat(gd.worldSpeed || gd.speed) || 1;
                if (gd.unitSpeed) UnitSpeed = parseFloat(gd.unitSpeed) || 1;
            }
        } catch (e) {
            // ignoriere, nutze Fallbacks
        }
    }

    function loadSpeeds() {
        autoDetectSpeeds();
        unitSpeed = Object.assign({}, unitSpeedsFallback);
        // langsamste zuerst (groesste Minuten pro Feld)
        unitsSortedBySpeed = Object.entries(unitSpeed).sort((a, b) => b[1] - a[1]);
        console.log('[DS-Rename] Einheitengeschwindigkeiten:', unitSpeed);
        console.log('[DS-Rename] Einheiten sortiert:', unitsSortedBySpeed);
        console.log('[DS-Rename] WorldSpeed:', WorldSpeed, 'UnitSpeed:', UnitSpeed);
    }

    /***** Berechnungen *****/
    function calculateDistance(attacker, defender) {
        const dx = (attacker[0] || 0) - (defender[0] || 0);
        const dy = (attacker[1] || 0) - (defender[1] || 0);
        return Math.hypot(dx, dy);
    }

    function getTravelTimeSeconds(distance, baseUnitSpeedMinPerField) {
        return (distance * baseUnitSpeedMinPerField * 60) / (WorldSpeed * UnitSpeed);
    }

    function formatDt(dt) {
        try {
            return dt.toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        } catch (_) {
            const pad = n => String(n).padStart(2, '0');
            return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
        }
    }

    /***** Parser: Tabellenwerte *****/
    function getSender(row) {
        let txt = textOrEmpty(querySafe(row, 'td:nth-child(4)'));
        if (txt) return txt;
        const playerLink = querySafe(row, 'a[href*="screen=info_player"]');
        if (playerLink) return textOrEmpty(playerLink);
        return 'Unbekannt';
    }

    function extractCoordsFromCell(cell) {
        if (!cell) return [0, 0];
        const link = cell.querySelector('a');
        const text = (link ? link.textContent : cell.textContent || '').trim();
        const m = text.match(/\((\d+)\|(\d+)\)/);
        return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
    }

    function getDefenderCoordinates(row) {
        const cell = querySafe(row, 'td:nth-child(2)');
        return extractCoordsFromCell(cell);
    }

    function getAttackerCoordinates(row) {
        const cell = querySafe(row, 'td:nth-child(3)');
        return extractCoordsFromCell(cell);
    }

    function parseImpactTime(row) {
        const impactCell = querySafe(row, 'td:nth-child(6)');
        let impactString = (impactCell ? impactCell.textContent : '').replace(/\s+/g, ' ').trim();
        if (!impactString) return null;

        let dt = null;
        try {
            if (impactString.includes(t.tomorrow)) {
                const timePart = impactString.split(t.at)[1].trim();
                const parts = timePart.split(':').map(Number);
                const [h, m, s, ms] = [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] || 0];
                const today = new Date();
                dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, h, m, s, ms);
            } else if (impactString.includes(t.today)) {
                const timePart = impactString.split(t.at)[1].trim();
                const parts = timePart.split(':').map(Number);
                const [h, m, s, ms] = [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] || 0];
                const today = new Date();
                dt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, s, ms);
            } else {
                const m = impactString.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+um\s+(\d{1,2}):(\d{2})(?::(\d{2})(?::(\d{1,3}))?)?/i);
                if (m) {
                    const day = parseInt(m[1], 10);
                    const mon = parseInt(m[2], 10);
                    const year = m[3] ? parseInt(m[3], 10) : (new Date()).getFullYear();
                    const h = parseInt(m[4], 10) || 0;
                    const min = parseInt(m[5], 10) || 0;
                    const s = parseInt(m[6], 10) || 0;
                    const ms = parseInt(m[7], 10) || 0;
                    dt = new Date(year, mon - 1, day, h, min, s, ms);
                }
            }
        } catch (e) {
            dt = null;
        }
        return dt;
    }

    function detectAttackType(row) {
        const img = querySafe(row, 'td:first-child img');
        if (!img) return 'Unbekannt';
        let attackType = (img.alt || '').trim();
        if (!attackType) attackType = (img.title || '').trim();
        if (!attackType) {
            const src = img.getAttribute('src') || '';
            if (src.includes('attack')) attackType = t.attack;
            else if (src.includes('support')) attackType = t.support;
            else attackType = 'Unbekannt';
        }
        return attackType;
    }

    function getNameLabelNode(row) {
        return querySafe(row, '.quickedit .quickedit-label') ||
               querySafe(row, '.quickedit-label') ||
               querySafe(row, 'td:nth-child(5)');
    }

    function getCurrentName(row) {
        const label = getNameLabelNode(row);
        return label ? textOrEmpty(label) : '';
    }

    function getCommandKey(row, impactTime, attacker, defender) {
        const cmdLink = querySafe(row, 'a[href*="screen=info_command"], a[href*="info_command"]');
        if (cmdLink) {
            const href = cmdLink.getAttribute('href') || '';
            const m = href.match(/[?&]id=(\d+)/) || href.match(/command_id=(\d+)/);
            if (m) return `cmd:${m[1]}`;
            return `href:${href}`;
        }
        const chk = querySafe(row, 'input[type="checkbox"][value], input[id*="select_"]');
        if (chk && chk.value) return `chk:${chk.value}`;

        const att = (attacker || [0, 0]).join('|');
        const def = (defender || [0, 0]).join('|');
        const ms = impactTime instanceof Date ? impactTime.getTime() : 0;
        return `fp:${att}->${def}@${ms}`;
    }

    /***** Umbenennen *****/
    function chooseUnitHeuristic(distance, impactTime, attackType) {
        let selectedUnit = 'unknown';
        let smallestDifference = Infinity;
        const now = new Date();

        for (const [unit, baseSpeed] of unitsSortedBySpeed) {
            const travelSec = getTravelTimeSeconds(distance, baseSpeed);
            const sentTime = new Date(impactTime.getTime() - travelSec * 1000);
            const diff = Math.abs(sentTime - now);
            if (diff < smallestDifference) {
                smallestDifference = diff;
                selectedUnit = unit;
            } else if (diff === smallestDifference) {
                const list = attackType.includes(t.attack) ? unitPriority.attack : unitPriority.support;
                const prNew = list.indexOf(unit);
                const prCur = list.indexOf(selectedUnit);
                if (prNew !== -1 && (prCur === -1 || prNew < prCur)) selectedUnit = unit;
            }
        }
        return selectedUnit;
    }

    async function renameAttack(row, attackType, store) {
        const attacker = getAttackerCoordinates(row);
        const defender = getDefenderCoordinates(row);
        const distance = calculateDistance(attacker, defender);
        const impactTime = parseImpactTime(row);

        if (!impactTime || isNaN(impactTime.getTime())) {
            console.warn('[DS-Rename] Ungueltige Ankunftszeit - ueberspringe Zeile.');
            return;
        }

        const cmdKey = getCommandKey(row, impactTime, attacker, defender);

        if (hasRenamed(cmdKey, store)) {
            row.setAttribute('data-ds-renamed', '1');
            console.log(`[DS-Rename] Ueberspringe (bereits umbenannt): ${cmdKey}`);
            return;
        }

        const attackTypeStr = String(attackType || '');
        const unit = chooseUnitHeuristic(distance, impactTime, attackTypeStr);
        const unitDisplayName = config.unitDisplayNames[unit] || (unit === 'unknown' ? 'Unbekannte Einheit' : unit);

        const sender = getSender(row);
        const impactStr = formatDt(impactTime);

        let newName = `${unitDisplayName} von ${sender}`;
        if (unit !== 'unknown') {
            const baseSpeed = unitSpeed[unit];
            const travelSec = getTravelTimeSeconds(distance, baseSpeed);
            const sentTime = new Date(impactTime.getTime() - travelSec * 1000);
            const sentStr = formatDt(sentTime);
            newName += ` | Gesendet: ${sentStr}`;

            if (attackTypeStr.includes(t.attack)) {
                const backTime = new Date(impactTime.getTime() + travelSec * 1000);
                const backStr = formatDt(backTime);
                newName += ` | Rueckkehr: ${backStr}`;
            }
        }
        newName += ` | Ankunft: ${impactStr}`;

        const currentName = getCurrentName(row);
        if (currentName && currentName.trim() === newName) {
            markRenamed(cmdKey, newName, impactTime.getTime(), store);
            row.setAttribute('data-ds-renamed', '1');
            console.log(`[DS-Rename] Name bereits korrekt - markiert: ${cmdKey}`);
            return;
        }

        const renameButton = querySafe(row, 'a.rename-icon, a[class*="rename"]');
        if (!renameButton) {
            console.error('[DS-Rename] Rename-Button nicht gefunden - ueberspringe.');
            return;
        }

        console.groupCollapsed(`[DS-Rename] Umbenennen: ${cmdKey}`);
        console.log('Angreifer:', attacker, 'Verteidiger:', defender, 'Distanz:', distance.toFixed(2));
        console.log('Ankunft:', impactTime, '| Neuer Name:', newName);

        renameButton.click();

        const input = await waitForElement(row, '.quickedit-edit input[type="text"], .quickedit-edit input[name="rename"]', 2500);
        if (!input) {
            console.error('[DS-Rename] Eingabefeld nicht gefunden - abbrechen.');
            console.groupEnd();
            return;
        }

        input.value = newName;
        dispatchInputEvents(input);

        let submitBtn = null;
        for (const label of t.ok) {
            submitBtn = querySafe(row, `.quickedit-edit input[type="button"][value="${label}"]`);
            if (submitBtn) break;
        }
        if (!submitBtn) {
            submitBtn = querySafe(row, '.quickedit-edit input.btn') ||
                                  querySafe(row, '.quickedit-edit input[type="button"], .quickedit-edit button, .quickedit-edit a.btn-confirm');
        }

        if (submitBtn) {
            submitBtn.click();
            markRenamed(cmdKey, newName, impactTime.getTime(), store);
            row.setAttribute('data-ds-renamed', '1');
            console.log('[DS-Rename] Umbenannt zu:', newName);
        } else {
            console.error('[DS-Rename] Bestaetigungsbutton nicht gefunden - abbrechen.');
        }
        console.groupEnd();
    }

    /***** Verarbeitung aller eingehenden Zeilen *****/
    async function processAttacks() {
        const store = loadHistory();
        const rows = queryAllSafe(document, '#incomings_table tr.nowrap');
        console.log(`[DS-Rename] Gefundene Zeilen: ${rows.length}`);

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try {
                if (row.getAttribute('data-ds-renamed') === '1') {
                    continue;
                }
                const img = querySafe(row, 'td:first-child img');
                if (!img) continue;

                let attackType = detectAttackType(row);
                if (attackType.includes(t.attack) || attackType.includes(t.support)) {
                    await renameAttack(row, attackType, store);
                }
            } catch (e) {
                console.error('[DS-Rename] Fehler in Zeile', i + 1, e);
            }
        }
    }

    /***** UI *****/
    function addButtons() {
        const form = document.getElementById('incomings_form');
        let container = null;
        let existingRenameButton = null;

        if (form) {
            existingRenameButton = form.querySelector('input[type="submit"][name="label"], input[type="submit"][value="Umbenennen"]');
            container = existingRenameButton ? existingRenameButton.parentNode : form;
        } else {
            console.log('[DS-Rename] Kein incomings_form gefunden, verwende Fallback auf Tabelle.');
            const table = document.getElementById('incomings_table');
            if (table) {
                container = table.parentNode;
            }
        }

        if (!container) {
            console.log('[DS-Rename] Konnte keinen sinnvollen Container fuer Buttons finden.');
            return;
        }

        if (!document.getElementById('auto_rename_button')) {
            const renameButton = document.createElement('input');
            renameButton.type = 'button';
            renameButton.id = 'auto_rename_button';
            renameButton.value = 'Automatisch umbenennen';
            renameButton.className = 'btn';
            renameButton.style.marginLeft = '5px';

            renameButton.addEventListener('click', async (e) => {
                e.preventDefault();
                console.log('[DS-Rename] Starte automatische Umbenennung ...');
                await processAttacks();
            });

            if (existingRenameButton) {
                existingRenameButton.insertAdjacentElement('afterend', renameButton);
            } else {
                container.appendChild(renameButton);
            }
        }

        if (!document.getElementById('clear_history_button')) {
            const clearBtn = document.createElement('input');
            clearBtn.type = 'button';
            clearBtn.id = 'clear_history_button';
            clearBtn.value = 'Verlauf loeschen';
            clearBtn.className = 'btn';
            clearBtn.style.marginLeft = '5px';

            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Gespeicherte "bereits umbenannt"-Eintraege wirklich loeschen?')) {
                    clearHistory();
                    queryAllSafe(document, '#incomings_table tr.nowrap[data-ds-renamed="1"]').forEach(tr => tr.removeAttribute('data-ds-renamed'));
                }
            });

            const autoBtn = document.getElementById('auto_rename_button');
            if (autoBtn) {
                autoBtn.insertAdjacentElement('afterend', clearBtn);
            } else if (container) {
                container.appendChild(clearBtn);
            }
        }
    }

    /***** Hauptablauf *****/
    function main() {
        try {
            loadSpeeds();
            addButtons();
            console.log('[DS-Rename] Script geladen.');
        } catch (error) {
            console.error('[DS-Rename] Initialisierungsfehler:', error);
        }
    }

    window.addEventListener('load', main);
})();
