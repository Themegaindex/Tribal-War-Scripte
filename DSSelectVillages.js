// ==UserScript==
// @name       DSSelectVillages
// @namespace  phisa, suilenroc
// @version    2.0
// @description
// @copyright  Phisa / Philipp Winter 2013
// @license    MIT License - just do anything you want with this script - http://opensource.org/licenses/MIT
// @include    https://de*.die-staemme.de/game.php*screen=map
// @include    https://de*.die-staemme.de/game.php*screen=map*
// ==/UserScript==

var win = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;

// --- Anfang einstellbare Variablen ------
win.filter = false;
win.showWithCoords = false;
win.showWithCounter = false;

win.breakAfter = 5;
win.activationCharCode = 'b';
// --- Ende einstellbare Variablen ------

win.$.ajaxSetup({ cache: true });
win.$.getScript('https://media.innogames.com/com_DS_DE/Scriptdatenbank/userscript_main/90_selectvillages_phisa.js');
