// ==UserScript==
// @name         Die Stämme Berichte Exportierer
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Exportiert ausgewählte Berichte als BB-Code-Spoiler mit kurzem, informativem Titel.
// @author       Ozzytastic from Neckar
// @match        https://*.die-staemme.de/game.php?*screen=report*
// @grant        GM_xmlhttpRequest
// @connect      self
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Fügt den "Spoiler Exportieren" Button zur Benutzeroberfläche hinzu.
     * Wartet, bis das Ziel-Element im DOM verfügbar ist.
     */
    function addButton() {
        const checkInterval = setInterval(() => {
            const targetCell = document.querySelector('table.vis tr:first-child td:last-child a[href*="mode=groups"]');

            if (targetCell) {
                clearInterval(checkInterval);

                if (document.getElementById('spoiler-export-btn')) {
                    return;
                }

                const exportButton = createButton();
                targetCell.parentElement.appendChild(exportButton);
            }
        }, 300);
    }

    /**
     * Erstellt das Button-Element mit modernem Design.
     * @returns {HTMLAnchorElement} Das erstellte Button-Element.
     */
    function createButton() {
        const exportButton = document.createElement('a');
        exportButton.href = '#';
        exportButton.className = 'btn';
        exportButton.id = 'spoiler-export-btn';
        exportButton.innerText = 'Spoiler Exportieren';

        Object.assign(exportButton.style, {
            marginLeft: '10px',
            background: 'linear-gradient(to bottom, #fdf5e6 0%, #f4e4bc 100%)',
            border: '1px solid #c89d54',
            borderRadius: '3px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.4)',
            color: '#5e4121',
            fontWeight: 'bold',
            textShadow: '0 1px 0 rgba(255, 255, 255, 0.5)',
            padding: '4px 8px',
            lineHeight: 'normal'
        });

        const originalBg = exportButton.style.background;
        exportButton.addEventListener('mouseover', () => {
            exportButton.style.background = 'linear-gradient(to bottom, #fff8ed 0%, #f8eecd 100%)';
        });
        exportButton.addEventListener('mouseout', () => {
            exportButton.style.background = originalBg;
        });

        exportButton.addEventListener('click', handleExportClick);
        return exportButton;
    }

    /**
     * Behandelt den Klick auf den Export-Button.
     * @param {Event} e - Das Klick-Event.
     */
    async function handleExportClick(e) {
        e.preventDefault();
        const button = e.target;
        button.innerText = 'Starte Export...';
        button.classList.add('btn-disabled');

        const selectedReports = document.querySelectorAll('input[type="checkbox"][name^="id_"]:checked');
        if (selectedReports.length === 0) {
            alert('Bitte wähle zuerst Berichte zum Exportieren aus.');
            resetButton(button);
            return;
        }

        const reportIds = Array.from(selectedReports).map(checkbox => checkbox.name.split('_')[1]);

        try {
            const allReportData = await processReportsInBatches(reportIds, button);
            const output = formatResults(allReportData.filter(Boolean));
            displayResults(output);
        } catch (error) {
            console.error("Ein Fehler ist während des Exports aufgetreten:", error);
            alert("Ein Fehler ist während des Exports aufgetreten. Details finden Sie in der Konsole.");
        } finally {
            resetButton(button);
        }
    }

    /**
     * Setzt den Button in seinen ursprünglichen Zustand zurück.
     * @param {HTMLElement} button - Der Button, der zurückgesetzt werden soll.
     */
    function resetButton(button) {
        button.innerText = 'Spoiler Exportieren';
        button.classList.remove('btn-disabled');
    }

    /**
     * Verarbeitet die Berichte in kleinen Stapeln.
     * @param {string[]} reportIds - Array mit den IDs der zu verarbeitenden Berichte.
     * @param {HTMLElement} button - Der Export-Button, um den Fortschritt anzuzeigen.
     * @returns {Promise<string[]>} Ein Promise, das mit einem Array der formatierten Spoiler-Strings aufgelöst wird.
     */
    async function processReportsInBatches(reportIds, button) {
        const allReportData = [];
        const batchSize = 5;
        for (let i = 0; i < reportIds.length; i += batchSize) {
            button.innerText = `Exportiere... (${i}/${reportIds.length})`;
            const batchIds = reportIds.slice(i, i + batchSize);
            const reportDataPromises = batchIds.map(id => fetchReportData(id));
            const batchData = await Promise.all(reportDataPromises);
            allReportData.push(...batchData);
        }
        return allReportData;
    }

    /**
     * Ruft die Daten eines einzelnen Berichts ab und formatiert den Spoiler.
     * @param {string} reportId - Die ID des Berichts.
     * @returns {Promise<string|null>} Ein Promise, das mit dem formatierten Spoiler-String oder null bei einem Fehler aufgelöst wird.
     */
    function fetchReportData(reportId) {
        const reportUrl = `/game.php?screen=report&view=${reportId}`;
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: reportUrl,
                onload: function(response) {
                    if (response.status !== 200) {
                        console.error(`Fehler beim Abrufen von Bericht ${reportId}: Status ${response.status}`);
                        resolve(null);
                        return;
                    }
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');

                    let newTitle;
                    try {
                        const attackerElement = doc.querySelector('#attack_info_att a[href*="screen=info_village"]');
                        const defenderElement = doc.querySelector('#attack_info_def a[href*="screen=info_village"]');

                        let kampfzeit = '';
                        const labels = Array.from(doc.querySelectorAll('td, th'));
                        const kampfzeitLabel = labels.find(el => el.innerText.trim() === 'Kampfzeit');
                        if (kampfzeitLabel) {
                            kampfzeit = kampfzeitLabel.nextElementSibling.innerText.trim();
                        }

                        if (attackerElement && defenderElement && kampfzeit) {
                            const attackerVillage = attackerElement.innerText.trim().replace(/ K\d+$/, '');
                            const defenderVillage = defenderElement.innerText.trim().replace(/ K\d+$/, '');
                            newTitle = `${attackerVillage} -> ${defenderVillage} | ${kampfzeit}`;
                        } else {
                            const titleElement = doc.querySelector('.quickedit-label');
                            const fullTitle = titleElement ? titleElement.innerText.trim() : `Bericht ${reportId}`;
                            newTitle = fullTitle.substring(0, 70) + (fullTitle.length > 70 ? '...' : '');
                        }
                    } catch (e) {
                        console.error("Fehler beim Formatieren des Titels:", e);
                        const titleElement = doc.querySelector('.quickedit-label');
                        newTitle = titleElement ? titleElement.innerText.trim() : `Bericht ${reportId}`;
                    }

                    newTitle = newTitle.replace(/\[/g, '【').replace(/\]/g, '】');

                    const exportElement = doc.querySelector('#report_export_code');
                    const exportCode = exportElement ? exportElement.value : `[spoiler]Export-Code für Bericht ${reportId} nicht gefunden.[/spoiler]`;

                    const formattedExport = exportCode.replace(/\[spoiler\]/, `[spoiler=${newTitle}]`);
                    resolve(formattedExport);
                },
                onerror: function(error) {
                    console.error(`Fehler beim Abrufen von Bericht ${reportId}:`, error);
                    resolve(null);
                }
            });
        });
    }

    /**
     * Formatiert die gesammelten Daten zu einem finalen Textblock.
     * @param {string[]} data - Array der formatierten Spoiler-Strings.
     * @returns {string} Der finale Textblock für die Ausgabe.
     */
    function formatResults(data) {
        const now = new Date();
        const timestamp = `${now.toLocaleDateString('de-DE')} ${now.toLocaleTimeString('de-DE')}`;
        let resultString = `Exportiert am: ${timestamp}\n\n`;
        resultString += data.join('\n\n');
        return resultString;
    }

    /**
     * Zeigt die Ergebnisse in einem modalen Fenster an.
     * @param {string} output - Der anzuzeigende Text.
     */
    function displayResults(output) {
        let resultContainer = document.getElementById('spoiler-export-result-container');
        if (resultContainer) resultContainer.remove();

        resultContainer = document.createElement('div');
        resultContainer.id = 'spoiler-export-result-container';
        Object.assign(resultContainer.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: '10001', backgroundColor: '#f4e4bc', border: '2px solid #804000',
            padding: '20px', width: '80%', maxWidth: '800px', boxShadow: '0 0 20px rgba(0,0,0,0.5)'
        });

        const header = document.createElement('h3');
        header.innerText = 'Exportierte Berichte';
        resultContainer.appendChild(header);

        const textarea = document.createElement('textarea');
        textarea.style.width = '100%';
        textarea.style.height = '400px';
        textarea.style.marginTop = '10px';
        textarea.value = output;
        textarea.readOnly = true;
        resultContainer.appendChild(textarea);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.marginTop = '10px';
        buttonContainer.style.textAlign = 'right';

        const copyButton = document.createElement('button');
        copyButton.className = 'btn';
        copyButton.innerText = 'Kopieren';
        copyButton.onclick = () => {
            textarea.select();
            document.execCommand('copy');
            copyButton.innerText = 'Kopiert!';
            setTimeout(() => { copyButton.innerText = 'Kopieren'; }, 2000);
        };
        buttonContainer.appendChild(copyButton);

        const closeButton = document.createElement('button');
        closeButton.className = 'btn';
        closeButton.innerText = 'Schließen';
        closeButton.style.marginLeft = '10px';
        closeButton.onclick = () => resultContainer.remove();
        buttonContainer.appendChild(closeButton);

        resultContainer.appendChild(buttonContainer);
        document.body.appendChild(resultContainer);
        textarea.focus();
        textarea.select();
    }

    // Initialisierung des Skripts
    addButton();

})();
