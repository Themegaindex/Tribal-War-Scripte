// ==UserScript==
// @name         Die-Staemme - Präzises Umbenennen von Angriffen und Support
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  Automatisches und präziseres Umbenennen von eingehenden Angriffen und Unterstützungen
// @author
// @include      https://*/*mode=incomings*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Konfiguration und Übersetzungen
    const config = {
        translations: {
            "de": {
                tomorrow: "morgen",
                today: "heute",
                at: "um",
                noble: "Adelsgeschlecht",
                spy: "Späher",
                attack: "Angriff",
                support: "Unterstützung"
            }
        },
        unitDisplayNames: {
            spear: 'Speerträger',
            sword: 'Schwertkämpfer',
            axe: 'Axtkämpfer',
            archer: 'Bogenschütze',
            spy: 'Späher',
            light: 'Leichte Kavallerie',
            marcher: 'Berittener Bogenschütze',
            heavy: 'Schwere Kavallerie',
            ram: 'Rammbock',
            catapult: 'Katapult',
            knight: 'Paladin',
            snob: 'Adelsgeschlecht'
        }
    };

    // Einheitengeschwindigkeiten entsprechend deiner Spielwelt (Minuten pro Feld)
    const unitSpeeds = {
        "snob": 35,
        "ram": 30,
        "catapult": 30,
        "sword": 22,
        "heavy": 11,
        "spy": 9,
        "light": 10,
        "marcher": 10,
        "axe": 18,
        "spear": 18,
        "archer": 18,
        "knight": 10
    };

    const lang = "de";
    const t = config.translations[lang];

    let WorldSpeed = 1; // Deine Weltgeschwindigkeit
    let UnitSpeed = 1;  // Deine Einheitengeschwindigkeit

    let unitSpeed = {};
    let unitsSortedBySpeed = [];

    // Prioritätsliste für Einheiten
    const unitPriority = {
        attack: ['axe', 'light', 'ram', 'catapult', 'sword', 'spear', 'archer', 'spy', 'heavy', 'snob'],
        support: ['spear', 'sword', 'archer', 'heavy', 'ram', 'catapult', 'knight', 'axe', 'light', 'spy']
    };

    function loadSpeeds() {
        // Manuelle Einstellung der Einheitengeschwindigkeiten
        unitSpeed = unitSpeeds;
        unitsSortedBySpeed = Object.entries(unitSpeed).sort((a, b) => b[1] - a[1]);
        console.log('Einheitengeschwindigkeiten manuell gesetzt:', unitSpeed);
        console.log('Einheiten sortiert nach Geschwindigkeit:', unitsSortedBySpeed);
        console.log(`WorldSpeed: ${WorldSpeed}, UnitSpeed: ${UnitSpeed}`);
    }

    // Hilfsfunktionen zum Berechnen von Zeiten und Entfernungen

    function getTimeLeftInSeconds(row) {
        const timeString = row.querySelector('td:nth-child(7)').innerText.trim();
        console.log(`Verbleibende Zeit String: ${timeString}`);
        const [hours, minutes, seconds] = timeString.split(':').map(Number);
        return hours * 3600 + minutes * 60 + seconds;
    }

    function getSender(row) {
        return row.querySelector('td:nth-child(4)').innerText.trim();
    }

    function getDefenderCoordinates(row) {
        const defenderCell = row.querySelector('td:nth-child(2)');
        const defenderLink = defenderCell.querySelector('a');
        if (!defenderLink) {
            console.error('Verteidiger-Link nicht gefunden.');
            return [0, 0];
        }
        const textContent = defenderLink.textContent.trim();
        console.log(`Verteidiger-Link Text: ${textContent}`);
        const match = textContent.match(/\((\d+)\|(\d+)\)/);
        if (match) {
            console.log(`Gefundene Verteidigerkoordinaten: ${match[1]},${match[2]}`);
            return [parseInt(match[1], 10), parseInt(match[2], 10)];
        } else {
            console.error('Konnte Verteidigerkoordinaten nicht ermitteln.');
            return [0, 0];
        }
    }

    function getAttackerCoordinates(row) {
        const attackerCell = row.querySelector('td:nth-child(3)');
        const attackerLink = attackerCell.querySelector('a');
        if (!attackerLink) {
            console.error('Angreifer-Link nicht gefunden.');
            return [0, 0];
        }
        const textContent = attackerLink.textContent.trim();
        console.log(`Angreifer-Link Text: ${textContent}`);
        const match = textContent.match(/\((\d+)\|(\d+)\)/);
        if (match) {
            console.log(`Gefundene Angreiferkoordinaten: ${match[1]},${match[2]}`);
            return [parseInt(match[1], 10), parseInt(match[2], 10)];
        } else {
            console.error('Konnte Angreiferkoordinaten nicht ermitteln.');
            return [0, 0];
        }
    }

    function calculateDistance(attacker, defender) {
        const dx = attacker[0] - defender[0];
        const dy = attacker[1] - defender[1];
        return Math.hypot(dx, dy);
    }

    function getTravelTime(distance, baseUnitSpeed) {
        return (distance * baseUnitSpeed * 60) / (WorldSpeed * UnitSpeed);
    }

    function getImpactTime(row) {
        const impactCell = row.querySelector('td:nth-child(6)');
        let impactString = impactCell ? impactCell.textContent.trim() : '';
        console.log(`Impact String: ${impactString}`);

        // Entferne alle Zeilenumbrüche und zusätzliche Leerzeichen
        impactString = impactString.replace(/\s+/g, ' ').trim();

        let impactDateTime;

        if (impactString.includes(t.tomorrow)) {
            // "morgen um HH:MM:SS:ms"
            const timePart = impactString.split('um')[1].trim();
            const [hours, minutes, seconds, milliseconds] = timePart.split(':').map(Number);
            const today = new Date();
            impactDateTime = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, hours, minutes, seconds, milliseconds || 0);
        } else if (impactString.includes(t.today)) {
            // "heute um HH:MM:SS:ms"
            const timePart = impactString.split('um')[1].trim();
            const [hours, minutes, seconds, milliseconds] = timePart.split(':').map(Number);
            const today = new Date();
            impactDateTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, seconds, milliseconds || 0);
        } else {
            // Annahme: volles Datum und Zeit
            const [datePart, timePart] = impactString.split(' um ');
            const [day, month, year] = datePart.split('.').map(Number);
            const [hours, minutes, seconds, milliseconds] = timePart.split(':').map(Number);
            impactDateTime = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds || 0);
        }

        console.log(`Berechnete Ankunftszeit: ${impactDateTime}`);
        return impactDateTime;
    }

    function renameAttack(row, attackType) {
        console.log('Beginne mit Umbenennen eines Angriffs.');
        const attacker = getAttackerCoordinates(row);
        const defender = getDefenderCoordinates(row);
        console.log(`Angreiferkoordinaten: ${attacker}`);
        console.log(`Verteidigerkoordinaten: ${defender}`);

        if (attacker[0] === 0 || defender[0] === 0) {
            console.error('Konnte Koordinaten nicht ermitteln.');
            return;
        }

        const distance = calculateDistance(attacker, defender);
        console.log(`Berechnete Entfernung: ${distance}`);
        const impactTime = getImpactTime(row);
        console.log(`Ankunftszeit: ${impactTime}`);
        const currentTime = new Date();
        console.log(`Aktuelle Zeit: ${currentTime}`);

        let selectedUnit = 'unknown';
        let smallestDifference = Infinity;

        for (const [unit, baseSpeed] of unitsSortedBySpeed) {
            const travelTime = getTravelTime(distance, baseSpeed) * 1000; // in Millisekunden
            const sentTime = new Date(impactTime.getTime() - travelTime);
            const timeDifference = Math.abs(sentTime - currentTime);
            console.log(`Einheit: ${unit}, Reisezeit: ${travelTime / 1000}s, Abgeschickt um: ${sentTime}, Zeitdifferenz zur aktuellen Zeit: ${timeDifference}ms`);

            if (timeDifference < smallestDifference) {
                smallestDifference = timeDifference;
                selectedUnit = unit;
            } else if (timeDifference === smallestDifference) {
                // Bei gleicher Zeitdifferenz Priorität berücksichtigen
                const priorityList = attackType.includes(t.attack) ? unitPriority.attack : unitPriority.support;
                const currentUnitPriority = priorityList.indexOf(selectedUnit);
                const newUnitPriority = priorityList.indexOf(unit);

                if (newUnitPriority < currentUnitPriority) {
                    selectedUnit = unit;
                }
            }
        }

        console.log(`Ausgewählte Einheit: ${selectedUnit}`);

        const unitDisplayName = config.unitDisplayNames[selectedUnit] || (selectedUnit === 'unknown' ? 'Unbekannte Einheit' : selectedUnit);

        let newName = `${unitDisplayName} von ${getSender(row)}`;
        let sentTimeStr = '';
        let backTimeStr = '';

        if (selectedUnit !== 'unknown') {
            const baseUnitSpeed = unitSpeed[selectedUnit];
            const travelTimeSeconds = getTravelTime(distance, baseUnitSpeed);

            // Zeiten formatieren
            const sentTime = new Date(impactTime.getTime() - travelTimeSeconds * 1000);
            sentTimeStr = sentTime.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

            if (attackType.includes(t.attack)) {
                const backTime = new Date(impactTime.getTime() + travelTimeSeconds * 1000);
                backTimeStr = backTime.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                newName += ` | Rückkehr: ${backTimeStr}`;
            }

            newName += ` | Gesendet: ${sentTimeStr}`;
        }

        const impactTimeStr = impactTime.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        newName += ` | Ankunft: ${impactTimeStr}`;

        const renameButton = row.querySelector('a.rename-icon');
        if (renameButton) {
            renameButton.click();

            setTimeout(() => {
                const inputField = row.querySelector('.quickedit-edit input[type="text"]');
                if (inputField) {
                    inputField.value = newName;
                    const submitButton = row.querySelector('.quickedit-edit input[type="button"]');
                    if (submitButton) {
                        submitButton.click();
                        console.log(`Angriff/Support von ${getSender(row)} umbenannt zu: ${newName}`);
                    } else {
                        console.error('Submit-Button nicht gefunden.');
                    }
                } else {
                    console.error('Eingabefeld nicht gefunden.');
                }
            }, 1000);
        } else {
            console.error('Rename-Button nicht gefunden.');
        }
    }

    function processAttacks() {
        const attackRows = document.querySelectorAll('#incomings_table tr.nowrap');
        console.log(`Anzahl gefundener Angriffszeilen: ${attackRows.length}`);
        attackRows.forEach((row, index) => {
            console.log(`Verarbeite Zeile ${index + 1}`);
            const attackTypeImg = row.querySelector('td:first-child img');
            if (attackTypeImg) {
                let attackType = attackTypeImg.alt;
                console.log(`Alt-Attribut: ${attackType}`);
                if (!attackType || attackType.trim() === '') {
                    attackType = attackTypeImg.title;
                    console.log(`Alt-Attribut leer, verwende Title-Attribut: ${attackType}`);
                }
                if (!attackType || attackType.trim() === '') {
                    const src = attackTypeImg.getAttribute('src');
                    console.log(`Alt und Title leer, verwende src: ${src}`);
                    if (src.includes('attack')) {
                        attackType = t.attack;
                    } else if (src.includes('support')) {
                        attackType = t.support;
                    } else {
                        attackType = 'Unbekannt';
                    }
                }
                console.log(`Angriffstyp: ${attackType}`);
                if (attackType.includes(t.attack) || attackType.includes(t.support)) {
                    // Übergabe von attackType an renameAttack
                    renameAttack(row, attackType);
                } else {
                    console.log(`Zeile ${index + 1}: Kein Angriff oder Unterstützung.`);
                }
            } else {
                console.log(`Zeile ${index + 1}: Kein Angriffssymbol gefunden.`);
            }
        });
    }

    function addRenameButton() {
        const existingRenameButton = document.querySelector('#incomings_form input[type="submit"][value="Umbenennen"]');
        if (existingRenameButton) {
            if (document.querySelector('#auto_rename_button')) return;

            const renameButton = document.createElement('button');
            renameButton.id = 'auto_rename_button';
            renameButton.innerHTML = 'Automatisch umbenennen';
            renameButton.style.marginLeft = '10px';
            renameButton.style.padding = '5px 10px';
            renameButton.style.backgroundColor = '#4CAF50';
            renameButton.style.color = 'white';
            renameButton.style.border = 'none';
            renameButton.style.cursor = 'pointer';

            renameButton.addEventListener('click', function(event) {
                event.preventDefault();
                console.log("Rename-Button wurde geklickt.");
                processAttacks();
            });

            existingRenameButton.parentNode.insertBefore(renameButton, existingRenameButton.nextSibling);
            console.log("Rename-Button hinzugefügt.");
        } else {
            console.log("Button-Container nicht gefunden.");
        }
    }

    function main() {
        try {
            loadSpeeds();
            addRenameButton();
            console.log("Userscript erfolgreich geladen.");
        } catch (error) {
            console.error(error);
        }
    }

    window.addEventListener('load', main);

})();
