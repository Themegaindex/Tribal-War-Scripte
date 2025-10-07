// Test-Skript für die Anrede-Erkennung in AI-Nachricht.js

/**
 * URSPRÜNGLICHE, FEHLERHAFTE FUNKTION
 * Erkennt Verben am Satzanfang fälschlicherweise als "Sie"-Anrede.
 */
function detectAddressForm_buggy(messages, myName) {
  const otherMessages = messages.filter(m => !m.own && m.text);
  const recentMessages = otherMessages.slice(-5);
  let duScore = 0, ihrScore = 0, sieScore = 0;
  for (const msg of recentMessages) {
    const text = msg.text.toLowerCase();
    const duMatches = (text.match(/\b(du|dich|dir|dein|deine|deinen|deinem|deiner|hast|bist|kannst|willst|sollst|musst)\b/g) || []).length;
    const ihrMatches = (text.match(/\b(ihr|euch|euer|eure|euren|eurem|eurer|habt|seid|könnt|wollt|sollt|müsst)\b/g) || []).length;
    // Fehlerhafte Regex:
    const sieMatches = (msg.text.match(/\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer|haben|sind|können|wollen|sollen|müssen)\b/g) || []).length;
    duScore += duMatches;
    ihrScore += ihrMatches;
    sieScore += sieMatches;
  }
  if (sieScore > duScore && sieScore > ihrScore) return 'Sie';
  if (ihrScore > duScore && ihrScore > sieScore) return 'ihr';
  if (duScore > 0) return 'du';
  return null;
}

/**
 * KORRIGIERTE FUNKTION
 * Die Regex ignoriert mehrdeutige Verben.
 */
function detectAddressForm_fixed(messages, myName) {
  const otherMessages = messages.filter(m => !m.own && m.text);
  const recentMessages = otherMessages.slice(-5);
  let duScore = 0, ihrScore = 0, sieScore = 0;
  for (const msg of recentMessages) {
    const text = msg.text.toLowerCase();
    const duMatches = (text.match(/\b(du|dich|dir|dein|deine|deinen|deinem|deiner|hast|bist|kannst|willst|sollst|musst)\b/g) || []).length;
    const ihrMatches = (text.match(/\b(ihr|euch|euer|eure|euren|eurem|eurer|habt|seid|könnt|wollt|sollt|müsst)\b/g) || []).length;
    // Korrigierte Regex:
    const sieMatches = (msg.text.match(/\b(Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihrer)\b/g) || []).length;
    duScore += duMatches;
    ihrScore += ihrMatches;
    sieScore += sieMatches;
  }
  if (sieScore > duScore && sieScore > ihrScore) return 'Sie';
  if (ihrScore > duScore && ihrScore > sieScore) return 'ihr';
  if (duScore > 0) return 'du';
  return null;
}

// --- Test-Framework ---
let testsPassed = 0;
let testsFailed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`✅ PASS: ${description}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${description}`);
    testsFailed++;
  }
}

function runTests() {
  const myName = 'TestUser';

  console.log('--- Starte Tests für Anrede-Erkennung ---');

  // Test 1: Fehlerfall mit "Haben" am Satzanfang
  const buggyMessages1 = [{ own: false, text: 'Haben Sie die Nachricht erhalten?' }]; // Eindeutig "Sie"
  const buggyMessages2 = [{ own: false, text: 'Haben wir ein Problem?' }]; // Mehrdeutig, kein "Sie"

  assert('[BUGGY] Sollte "Sie" bei "Haben Sie..." erkennen', detectAddressForm_buggy(buggyMessages1, myName) === 'Sie');
  assert('[BUGGY] Sollte "Sie" bei "Haben wir..." fälschlicherweise erkennen', detectAddressForm_buggy(buggyMessages2, myName) === 'Sie');
  assert('[FIXED] Sollte "Sie" bei "Haben Sie..." korrekt erkennen', detectAddressForm_fixed(buggyMessages1, myName) === 'Sie');
  assert('[FIXED] Sollte bei "Haben wir..." NICHT "Sie" erkennen (fällt auf null zurück)', detectAddressForm_fixed(buggyMessages2, myName) === null);

  console.log('');

  // Test 2: Fehlerfall mit "Sind" am Satzanfang
  const buggyMessages3 = [{ own: false, text: 'Sind die Truppen bereit?' }];
  assert('[BUGGY] Sollte "Sie" bei "Sind die Truppen..." fälschlicherweise erkennen', detectAddressForm_buggy(buggyMessages3, myName) === 'Sie');
  assert('[FIXED] Sollte bei "Sind die Truppen..." NICHT "Sie" erkennen', detectAddressForm_fixed(buggyMessages3, myName) === null);

  console.log('');

  // Test 3: Eindeutige "du"-Anrede
  const duMessages = [{ own: false, text: 'Hast du die Rohstoffe geschickt?' }];
  assert('[FIXED] Sollte "du" korrekt erkennen', detectAddressForm_fixed(duMessages, myName) === 'du');

  console.log('');

  // Test 4: Eindeutige "ihr"-Anrede
  const ihrMessages = [{ own: false, text: 'Habt ihr das Dorf angegriffen?' }];
  assert('[FIXED] Sollte "ihr" korrekt erkennen', detectAddressForm_fixed(ihrMessages, myName) === 'ihr');

  console.log('');

  // Test 5: Eindeutige "Sie"-Anrede ohne Verb
  const sieMessages = [{ own: false, text: 'Ich danke Ihnen für Ihre Hilfe.' }];
  assert('[FIXED] Sollte "Sie" (durch "Ihnen/Ihre") korrekt erkennen', detectAddressForm_fixed(sieMessages, myName) === 'Sie');

  console.log('\n--- Test-Zusammenfassung ---');
  console.log(`Bestanden: ${testsPassed}`);
  console.log(`Fehlgeschlagen: ${testsFailed}`);

  if (testsFailed > 0) {
    console.error('\nMindestens ein Test ist fehlgeschlagen.');
    // In einer CI-Umgebung würde man hier einen Fehlercode zurückgeben
    // process.exit(1);
  } else {
    console.log('\nAlle Tests erfolgreich bestanden!');
  }
}

// Tests ausführen
runTests();