// ==UserScript==
// @name         Stammlose Spieler in der Nähe
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Zeigt stammlose Spieler in deiner Nähe mit einstellbarem Radius
// @author       Djossi09 Custom aka themegaindex
// @match        https://*.die-staemme.de/game.php*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Nur auf der Übersichtsseite oder Karte ausführen
    if (game_data.screen !== 'overview' && game_data.screen !== 'map') {
        return;
    }

    // Cache-Konfiguration (24 Stunden = 86400000 ms)
    const CACHE_DURATION = 24 * 60 * 60 * 1000;
    const DB_NAME = 'TribelessPlayersDB';
    const DB_VERSION = 1;

    // Aktuelle Dorf-Koordinaten
    const currentVillage = {
        x: game_data.village.x,
        y: game_data.village.y
    };

    // Haupt-Funktion
    async function init() {
        // Prüfe ob Spieler in einem Stamm ist
        if (!parseInt(game_data.player.ally)) {
            UI.ErrorMessage('Du musst in einem Stamm sein um Spieler einzuladen!');
            return;
        }

        try {
            // Prüfe ob Daten gecached sind
            const cachedData = await getCachedData();

            let playerData, villageData;

            if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
                // Benutze gecachte Daten
                console.log('📦 Benutze gecachte Daten');
                playerData = cachedData.players;
                villageData = cachedData.villages;
            } else {
                // Lade Daten frisch
                console.log('🔄 Lade frische Daten...');
                playerData = await fetchPlayerData();
                villageData = await fetchVillageData();

                // Cache die Daten
                await cacheData(playerData, villageData);
            }

            // Verarbeite Daten
            const tribelessPlayers = processTribelessPlayers(playerData, villageData);

            // Zeige UI
            buildUI(tribelessPlayers);

        } catch (error) {
            console.error('❌ Fehler:', error);
            UI.ErrorMessage('Fehler beim Laden der Daten!');
        }
    }

    // Lade Spieler-Daten
    async function fetchPlayerData() {
        const response = await fetch(`https://${game_data.world}.die-staemme.de/map/player.txt`);
        const text = await response.text();

        return text.trim().split('\n').map(line => {
            const parts = line.split(',');
            return {
                id: parseInt(parts[0]),
                name: decodeURIComponent(parts[1]),
                tribeId: parseInt(parts[2]),
                villages: parseInt(parts[3]),
                points: parseInt(parts[4]),
                rank: parseInt(parts[5])
            };
        });
    }

    // Lade Dorf-Daten
    async function fetchVillageData() {
        const response = await fetch(`https://${game_data.world}.die-staemme.de/map/village.txt`);
        const text = await response.text();

        return text.trim().split('\n').map(line => {
            const parts = line.split(',');
            return {
                id: parseInt(parts[0]),
                name: decodeURIComponent(parts[1]),
                x: parseInt(parts[2]),
                y: parseInt(parts[3]),
                playerId: parseInt(parts[4]),
                points: parseInt(parts[5])
            };
        });
    }

    // Cache Daten in IndexedDB
    function cacheData(players, villages) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('cache')) {
                    db.createObjectStore('cache');
                }
            };

            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['cache'], 'readwrite');
                const store = transaction.objectStore('cache');

                const data = {
                    timestamp: Date.now(),
                    players: players,
                    villages: villages
                };

                store.put(data, 'gameData');

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            };
        });
    }

    // Hole gecachte Daten
    function getCachedData() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => resolve(null);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('cache')) {
                    db.createObjectStore('cache');
                }
            };

            request.onsuccess = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('cache')) {
                    resolve(null);
                    return;
                }

                const transaction = db.transaction(['cache'], 'readonly');
                const store = transaction.objectStore('cache');
                const getRequest = store.get('gameData');

                getRequest.onsuccess = () => resolve(getRequest.result || null);
                getRequest.onerror = () => resolve(null);
            };
        });
    }

    // Berechne Entfernung zwischen zwei Koordinaten
    function calculateDistance(x1, y1, x2, y2) {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    }

    // Verarbeite stammlose Spieler
    function processTribelessPlayers(players, villages) {
        // Nur stammlose Spieler (tribeId = 0)
        const tribelessPlayers = players.filter(p => p.tribeId === 0 && p.villages > 0);

        // Füge Dorf-Info hinzu
        const playersWithVillages = tribelessPlayers.map(player => {
            const playerVillages = villages.filter(v => v.playerId === player.id);

            // Berechne minimale Entfernung zu einem der Dörfer des Spielers
            let minDistance = Infinity;
            let closestVillage = null;

            playerVillages.forEach(village => {
                const distance = calculateDistance(
                    currentVillage.x, currentVillage.y,
                    village.x, village.y
                );
                if (distance < minDistance) {
                    minDistance = distance;
                    closestVillage = village;
                }
            });

            return {
                ...player,
                minDistance: Math.round(minDistance * 10) / 10,
                closestVillage: closestVillage,
                allVillages: playerVillages
            };
        });

        // Sortiere nach Entfernung
        return playersWithVillages.sort((a, b) => a.minDistance - b.minDistance);
    }

    // Erstelle UI
    function buildUI(players) {
        const containerId = 'tribelessPlayersWidget';

        // Entferne altes Widget falls vorhanden
        const oldWidget = document.getElementById(containerId);
        if (oldWidget) {
            oldWidget.remove();
        }

        // Erstelle Widget
        const widget = document.createElement('div');
        widget.id = containerId;
        widget.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            width: 650px;
            max-height: 600px;
            background: #f4e4bc;
            border: 2px solid #7d510f;
            border-radius: 5px;
            z-index: 10000;
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
        `;

        const content = `
            <div style="background: #c1a264; padding: 10px; border-bottom: 1px solid #7d510f; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: #fff;">🎯 Stammlose Spieler</h3>
                <button onclick="document.getElementById('${containerId}').remove()" style="background: #7d510f; color: #fff; border: none; padding: 5px 10px; cursor: pointer; border-radius: 3px;">✖</button>
            </div>
            <div style="padding: 15px;">
                <div style="margin-bottom: 15px;">
                    <label style="font-weight: bold;">Max. Entfernung (Felder):</label>
                    <input type="number" id="maxDistanceInput" value="50" min="10" max="200" step="10"
                           style="width: 80px; padding: 5px; margin-left: 10px;">
                    <button id="filterButton" style="margin-left: 10px; padding: 5px 15px; background: #7d510f; color: #fff; border: none; cursor: pointer; border-radius: 3px;">Filter</button>
                    <button id="refreshButton" style="margin-left: 5px; padding: 5px 15px; background: #c1a264; color: #fff; border: none; cursor: pointer; border-radius: 3px;">🔄 Neu laden</button>
                </div>
                <div id="playersCount" style="margin-bottom: 10px; font-weight: bold;"></div>
                <div id="playersList" style="max-height: 450px; overflow-y: auto; background: #fff; border: 1px solid #7d510f; border-radius: 3px;">
                </div>
            </div>
        `;

        widget.innerHTML = content;
        document.body.appendChild(widget);

        // Filter Funktion
        function filterPlayers() {
            const maxDistance = parseFloat(document.getElementById('maxDistanceInput').value);
            const filteredPlayers = players.filter(p => p.minDistance <= maxDistance);
            displayPlayers(filteredPlayers);
        }

        // Zeige Spieler
        function displayPlayers(playersToShow) {
            const playersList = document.getElementById('playersList');
            const playersCount = document.getElementById('playersCount');

            playersCount.textContent = `${playersToShow.length} Spieler gefunden`;

            if (playersToShow.length === 0) {
                playersList.innerHTML = '<p style="padding: 15px; text-align: center;">Keine Spieler gefunden</p>';
                return;
            }

            let html = '<table style="width: 100%; border-collapse: collapse; table-layout: fixed;">';
            html += '<thead><tr style="background: #c1a264; color: #fff;">';
            html += '<th style="padding: 8px; border: 1px solid #7d510f; width: 25%;">Spieler</th>';
            html += '<th style="padding: 8px; border: 1px solid #7d510f; width: 12%;">Punkte</th>';
            html += '<th style="padding: 8px; border: 1px solid #7d510f; width: 10%;">Dörfer</th>';
            html += '<th style="padding: 8px; border: 1px solid #7d510f; width: 12%;">Feld</th>';
            html += '<th style="padding: 8px; border: 1px solid #7d510f; width: 15%;">Dorf</th>';
            html += '<th style="padding: 8px; border: 1px solid #7d510f; width: 20%;">Aktion</th>';
            html += '</tr></thead><tbody>';

            playersToShow.forEach((player, index) => {
                const bgColor = index % 2 === 0 ? '#f4e4bc' : '#fff';
                const village = player.closestVillage;

                // Formatiere Punkte (k für Tausend)
                let pointsFormatted;
                if (player.points >= 1000) {
                    pointsFormatted = (player.points / 1000).toFixed(1) + 'k';
                } else {
                    pointsFormatted = player.points.toString();
                }

                html += `<tr style="background: ${bgColor};">`;
                html += `<td style="padding: 6px 8px; border: 1px solid #ddd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <a href="/game.php?screen=info_player&id=${player.id}" target="_blank" style="color: #7d510f; text-decoration: none; font-weight: bold;">
                        ${player.name}
                    </a>
                </td>`;
                html += `<td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">${pointsFormatted}</td>`;
                html += `<td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">${player.villages}</td>`;
                html += `<td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">${player.minDistance}</td>`;
                html += `<td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">
                    <a href="/game.php?screen=info_village&id=${village.id}" target="_blank" style="color: #7d510f; text-decoration: none;">
                        ${village.x}|${village.y}
                    </a>
                </td>`;
                html += `<td style="padding: 6px 8px; border: 1px solid #ddd; text-align: center;">
                    <button class="btn-invite-player" data-player-id="${player.id}" data-player-name="${player.name}" style="padding: 4px 12px; background: #7d510f; color: #fff; border: none; cursor: pointer; border-radius: 3px; font-size: 12px; width: 100%;">
                        Einladen
                    </button>
                </td>`;
                html += '</tr>';
            });

            html += '</tbody></table>';
            playersList.innerHTML = html;

            // Event Listener für Einladen-Buttons (wie im Original-Script)
            document.querySelectorAll('.btn-invite-player').forEach(button => {
                button.addEventListener('click', function() {
                    const playerId = this.getAttribute('data-player-id');
                    const playerName = this.getAttribute('data-player-name');
                    const hash = game_data.csrf;
                    const inviteUrl = `/game.php?screen=ally&mode=invite&action=invite_id&id=${playerId}&h=${hash}`;

                    // Button deaktivieren während Request läuft
                    this.disabled = true;
                    this.style.opacity = '0.6';
                    this.style.cursor = 'not-allowed';
                    const originalText = this.textContent;
                    this.textContent = 'Lädt...';

                    // Alle Buttons kurz deaktivieren (200ms Verzögerung wie im Original)
                    const allButtons = document.querySelectorAll('.btn-invite-player');
                    allButtons.forEach(btn => btn.disabled = true);

                    setTimeout(() => {
                        allButtons.forEach(btn => {
                            if (btn !== this) btn.disabled = false;
                        });
                    }, 200);

                    // Sende Einladung (wie im Original mit jQuery.get)
                    jQuery.get(inviteUrl)
                        .done(() => {
                            this.textContent = '✓ Eingeladen';
                            this.style.background = '#28a745';
                            this.style.opacity = '1';
                            UI.SuccessMessage(`${playerName} wurde eingeladen!`);
                            setTimeout(() => {
                                this.disabled = false;
                                this.textContent = originalText;
                                this.style.background = '#7d510f';
                                this.style.cursor = 'pointer';
                            }, 3000);
                        })
                        .fail(() => {
                            this.textContent = '✗ Fehler';
                            this.style.background = '#dc3545';
                            this.style.opacity = '1';
                            UI.ErrorMessage('Einladung fehlgeschlagen!');
                            setTimeout(() => {
                                this.disabled = false;
                                this.textContent = originalText;
                                this.style.background = '#7d510f';
                                this.style.cursor = 'pointer';
                            }, 3000);
                        });
                });
            });
        }

        // Event Listeners
        document.getElementById('filterButton').addEventListener('click', filterPlayers);
        document.getElementById('refreshButton').addEventListener('click', async () => {
            // Lösche Cache
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => {
                UI.SuccessMessage('Cache gelöscht! Seite wird neu geladen...');
                setTimeout(() => location.reload(), 1000);
            };
        });

        // Initial Filter
        filterPlayers();
    }

    // Button zum Öffnen hinzufügen
    function addOpenButton() {
        const button = document.createElement('button');
        button.textContent = '🎯 Stammlose Spieler';
        button.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            z-index: 9999;
            padding: 10px 15px;
            background: #7d510f;
            color: #fff;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        `;
        button.addEventListener('click', init);
        document.body.appendChild(button);
    }

    // Starte Script
    addOpenButton();

    console.log('✅ Stammlose Spieler Script geladen!');
})();
