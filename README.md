# Die Stämme: Userscript-Sammlung

Willkommen zu dieser Sammlung von Userskripten für das beliebte Browsergame **Die Stämme** (auch bekannt als *Tribal Wars*). Diese Skripte wurden entwickelt, um das Spielerlebnis durch Automatisierung, verbesserte Benutzeroberflächen und fortschrittliche Analysefunktionen zu verbessern.

Jedes Skript ist darauf ausgelegt, spezifische Aufgaben zu vereinfachen – von der Verwaltung von Angriffen und dem Sammeln von Ressourcen bis hin zur intelligenten Analyse von Forenbeiträgen und Nachrichten.

## 🚀 Installation

Um diese Skripte zu verwenden, benötigst du eine Browser-Erweiterung, die Userskripte verwalten kann. Die beliebteste Option ist **Tampermonkey**.

1.  **Tampermonkey installieren**:
    *   [Für Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
    *   [Für Firefox](https://addons.mozilla.org/de/firefox/addon/tampermonkey/)
    *   [Für Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2.  **Skript installieren**:
    *   Navigiere zu der `.js`-Datei des Skripts, das du installieren möchtest.
    *   Klicke auf den **"Raw"**-Button, um den Quellcode zu öffnen.
    *   Tampermonkey erkennt das Skript automatisch und öffnet einen neuen Tab, in dem du die Installation bestätigen kannst.

---

## 🛠️ Konfiguration

Einige Skripte, insbesondere die KI-gestützten, erfordern eine einmalige Konfiguration, um voll funktionsfähig zu sein.

### OpenRouter API-Key (für KI-Skripte)

Die Skripte `Die Stämme Forum Crawler` und `AI-Nachricht` nutzen die **OpenRouter-API**, um auf leistungsstarke KI-Modelle zuzugreifen. Damit kannst du Analysen und Antworten direkt im Spiel generieren lassen.

1.  **API-Key erstellen**:
    *   Besuche [OpenRouter.ai](https://openrouter.ai/) und erstelle einen kostenlosen Account.
    *   Navigiere zu deinem Profil und erstelle einen neuen API-Key.

2.  **Key im Skript hinterlegen**:
    *   Nach der Installation des Skripts findest du im **Tampermonkey-Menü** (neben der Adressleiste deines Browsers) neue Einträge.
    *   Wähle die Option **"API-Key setzen/ändern"** und füge deinen OpenRouter-Key ein.
    *   Du kannst auch das KI-Modell anpassen (z. B. auf kostenlose Modelle wie `x-ai/grok-4-mini:free`).

---

## 📜 Skript-Übersicht

Hier ist eine detaillierte Beschreibung der in diesem Repository enthaltenen Skripte.

### 🤖 Die Stämme Forum Crawler – AI Dashboard

Dieses fortschrittliche Skript crawlt und analysiert Forenbeiträge, um dir einen strategischen Vorteil zu verschaffen. Es fasst die wichtigsten Informationen in einem übersichtlichen Dashboard zusammen und nutzt KI, um die Lage laienfreundlich zu erklären.

**Funktionen**:
-   **Automatisches Crawling**: Sammelt neue Beiträge aus den Foren.
-   **Lokale Analyse**: Erkennt automatisch Themen wie Angriffe, Unterstützung oder Handel.
-   **KI-Dashboard**:
    -   **Laienfreundliche Zusammenfassung**: Erklärt die aktuelle Situation im Stamm einfach und verständlich.
    -   **Highlights & Handlungsempfehlungen**: Listet die wichtigsten Ereignisse und schlägt konkrete nächste Schritte vor.
    -   **Bedrohungsanalyse**: Identifiziert potenzielle Gefahren und deren Dringlichkeit.
-   **Auto-KI-Modus**: Hält dich automatisch auf dem Laufenden, indem es das Forum in regelmäßigen Abständen analysiert.

### ✍️ AI-Nachricht

Dieses Skript integriert eine KI direkt in das Nachrichtensystem von Die Stämme. Es hilft dir, Nachrichten schneller zu verstehen und passende Antworten zu formulieren.

**Funktionen**:
-   **Kontextanalyse**: Liest den gesamten Nachrichtenverlauf und erkennt das Thema (z. B. Bündnis, Handel, Krieg).
-   **Automatische Anrede**: Erkennt, ob dein Gegenüber dich mit "du", "ihr" oder "Sie" anspricht, und passt die Antwort entsprechend an.
-   **KI-gestützte Antworten**: Generiert Antwortvorschläge basierend auf einer gewählten Haltung (z. B. zustimmend, ablehnend, diplomatisch).
-   **BB-Code-Integration**: Verwendet automatisch BB-Codes für Koordinaten, Spielernamen oder zur Betonung.
-   **Anpassbare Voreinstellungen**: Konfiguriere deinen Spielernamen, die Standardsprache und vieles mehr.

### 🎯 Die-Staemme - Präzises Umbenennen von Angriffen und Support

Dieses Skript automatisiert das Umbenennen von eingehenden Angriffen und Unterstützungen. Es berechnet die langsamste mögliche Einheit und benennt den Befehl entsprechend, um dir eine bessere Einschätzung der Lage zu ermöglichen.

**Funktionen**:
-   **Automatische Umbenennung**: Fügt einen Button hinzu, der alle eingehenden Befehle analysiert.
-   **Einheiten-Erkennung**: Berechnet anhand der Laufzeit die wahrscheinlichste Einheit (z. B. Axtkämpfer, AG, Späher).
-   **Detaillierte Informationen**: Benennt den Befehl mit Einheit, Absender, Sendezeit und Ankunftszeit.
-   **Anpassbare Welt- und Einheiten-Geschwindigkeiten**.

### 🗺️ CustomMap

Personalisiere deine Kartenansicht mit benutzerdefinierten Icons. Dieses Skript ermöglicht es dir, Dörfer auf der Karte mit eigenen Symbolen zu markieren, um Offensiv-, Defensiv- oder andere strategisch wichtige Dörfer schnell zu identifizieren.

**Funktionen**:
-   **Benutzerdefinierte Icons**: Weise verschiedenen Tasten Farbcodes und Icons zu.
-   **Einfache Bedienung**: Markiere Dörfer direkt auf der Karte mit einem Tastendruck.
-   **Vorkonfigurierte Optionen**: Enthält bereits Beispiele für OFF-, DEFF- und Bunker-Dörfer.

### ⛏️ Raubzug

Optimiere deine Raubzüge (Scavenging) mit diesem Skript. Es sorgt dafür, dass deine Truppen so effizient wie möglich auf die verfügbaren Slots aufgeteilt werden, um den maximalen Ressourcengewinn zu erzielen.

**Funktionen**:
-   **Optimierungs-Modi**:
    -   **Rohstoffe/Stunde**: Maximiert den langfristigen Gewinn.
    -   **Pro Lauf**: Maximiert den Gewinn pro einzelnem Raubzug.
    -   **Gleiche Dauer**: Passt die Laufzeiten der Slots aneinander an.
-   **Mindesttruppen-Regel**: Stellt sicher, dass eine Mindestanzahl von Einheiten pro Slot gesendet wird.
-   **Intuitive Benutzeroberfläche**: Fügt eine neue Leiste mit allen Optionen direkt über der Truppenauswahl hinzu.

### 📝 Auto notes from report

Automatisiere das Erstellen von Notizen aus Kampfberichten. Dieses Skript analysiert einen Bericht und fügt automatisch eine formatierte Notiz mit den wichtigsten Informationen zum Dorf des Gegners hinzu.

**Funktionen**:
-   **Automatische Analyse**: Erkennt Truppen (offensiv/defensiv), Gebäude (Mauer, Wachturm) und überlebende Einheiten.
-   **Klassifizierung**: Schätzt ein, ob ein Dorf wahrscheinlich offensiv oder defensiv ist.
-   **Formatierte Notiz**: Erstellt eine übersichtliche Notiz mit BB-Codes, Farben und dem Berichts-Link.
-   **Mehrsprachig**: Unterstützt mehrere Sprachen, darunter Deutsch.

### 👁️ Show total incoming troops in village info

Dieses Skript zeigt dir die Gesamtzahl der eingehenden Truppen (sowohl Angriffe als auch Unterstützungen) direkt in der Dorfinfo an, sofern die Befehle geteilt wurden.

**Funktionen**:
-   **Zusammenfassung**: Addiert alle Truppen aus geteilten Befehlen.
-   **Getrennte Ansicht**: Zeigt separate Tabellen für Angriffs- und Unterstützungstruppen.
-   **Übersichtlich**: Stellt die Truppen mit den bekannten Einheitensymbolen dar.

### ✅ DSSelectVillages

Ein kleines, aber nützliches Skript, das dir hilft, mehrere Dörfer auf der Karte auszuwählen und deren Koordinaten oder IDs zu kopieren.

**Funktionen**:
-   **Massen-Auswahl**: Wähle Dörfer durch Klicken auf der Karte aus.
-   **Daten-Export**: Kopiere die gesammelten Informationen (Koordinaten, IDs) in die Zwischenablage.
-   **Anpassbare Aktivierungstaste**.