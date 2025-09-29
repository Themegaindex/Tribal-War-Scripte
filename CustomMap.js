// ==UserScript==
// @name        	CustomMap
// @description 	Ergaenzt modifizierte  die Karte
// @author      	suilenroc
// @version     	3.1
// @match     		https://*.die-staemme.de/game.php?*screen=map*
// ==/UserScript==

var win = typeof unsafeWindow != 'undefined' ? unsafeWindow : window;

//Init-Script
	win.ownerCheck = true;
	win.showCustomIcons = true;

// --- Anfang einstellbare Variablen ------
	// bilder nur von https://de<Welt>.die-staemme.de/graphic/ + euer png text
	// Format ['taste', "bild.png", "farbe","Name"]
	// ['l', "", "red","Entfernen"] muss immer enthalten taste kann aber geändert werden
	
	win.options = [
		['o', "unit_map/axe.png", "red", "OFF"],
		['ü', "command/support.png", "blue", "DEFF"],
		['p', "unit_map/sword.png", "blue", "BUNKER"],
		['l', "", "red", "Entfernen"]
	]
 // --- Ende einstellbare Variablen ------

win.$.ajaxSetup({ cache: true });
win.$.getScript('https://media.innogames.com/com_DS_DE/Scriptdatenbank/userscript_main/620_personalisierte_kartenicons_suilenroc.js');
