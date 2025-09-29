// ==UserScript==
// @name         TW Raubzug Optimal (by Ozzytastic)
// @namespace    tw-raubzug-opt
// @version      1.4.0
// @description  Optimiert Raubzug (pro Stunde / pro Lauf / gleiche Dauer). Erzwingt Mindestanzahl Einheiten pro Slot, triggert change-Events, respektiert maxTroops.
// @match        https://*.die-staemme.de/game.php*screen=place*mode=scavenge*
// @match        https://*.tribalwars.net/game.php*screen=place*mode=scavenge*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){
  'use strict';
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

  // ---- Konfiguration ----
  const MIN_UNITS_PER_SLOT = 10;      // <— hier Minimum je Stufe setzen
  const EQUAL_WEIGHTS = [7.5,3,1.5,1];// gleiche-Dauer-Heuristik wie im Beispiel
  const CARRY = { spear:25, sword:15, axe:10, archer:10, light:80, marcher:50, heavy:50, knight:100 };
  const LOOT = {1:0.10, 2:0.25, 3:0.50, 4:0.75};

  function when(sel,cb,tries=80){ const el=$(sel); if(el) return cb(el); if(tries<=0) return; setTimeout(()=>when(sel,cb,tries-1),250); }

  // UI
  function injectUI(){
    if ($('#twopt-bar')) return;
    const host = $('#scavenge_screen .candidate-squad-container');
    if (!host) return;
    const bar=document.createElement('div');
    bar.id='twopt-bar';
    bar.style.cssText='margin:8px 0 12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;';
    // Moduswahl
    const modes=[{id:'hour',label:'Rohstoffe/Stunde'},{id:'run',label:'pro Lauf'},{id:'equal',label:'gleiche Dauer'}];
    const wrap=document.createElement('div'); wrap.style.cssText='display:flex;gap:8px;align-items:center;';
    const lbl=document.createElement('span'); lbl.textContent='Modus:'; lbl.style.fontWeight='600'; wrap.appendChild(lbl);
    modes.forEach(m=>{ const lab=document.createElement('label'); lab.style.cssText='display:flex;gap:4px;align-items:center;';
      const rb=document.createElement('input'); rb.type='radio'; rb.name='twopt-mode'; rb.value=m.id; if(m.id==='hour') rb.checked=true;
      lab.appendChild(rb); lab.appendChild(document.createTextNode(m.label)); wrap.appendChild(lab); });
    const btn=document.createElement('button'); btn.className='btn'; btn.textContent='Raubzug schicken (optimal)';
    const small=document.createElement('span'); small.style.cssText='opacity:.75;font-size:12px'; small.textContent='setzt Mindest-Einheiten je Slot durch';
    bar.appendChild(wrap); bar.appendChild(btn); bar.appendChild(small);
    host.prepend(bar);
    btn.addEventListener('click', async ()=>{
      const mode = (document.querySelector('input[name="twopt-mode"]:checked')?.value)||'hour';
      await run(mode);
    });
  }

  function maxTroopsCapFor(unit){
    const capInput = $('.candidate-squad-container .maxTroops');
    if (!capInput) return Infinity;
    const v = parseInt(capInput.value||capInput.getAttribute('value')||'0',10);
    if (!Number.isFinite(v) || v<=0) return Infinity;
    return v;
  }

  function readAvailable(){
    // nimmt die (xx)-Links
    const out = {};
    $$('.candidate-squad-widget thead .unit_link').forEach(a=>{
      const u=a.getAttribute('data-unit'); if(u) out[u]=0;
    });
    $$('.candidate-squad-widget tbody tr:nth-child(2) td').forEach(td=>{
      const inp=$('input.unitsInput', td), link=$('a.units-entry-all', td);
      if (!inp || !link) return;
      const u=inp.name;
      const m=link.textContent.match(/\((\d+)\)/);
      let val = m ? parseInt(m[1],10) : 0;
      // Respektiere per-Unit-Kappe (falls gesetzt)
      val = Math.min(val, maxTroopsCapFor(u));
      out[u]=val;
    });
    // nur angehakte Einheiten berücksichtigen
    $$('.candidate-squad-widget .checkboxTroops').forEach(cb=>{
      const u = cb.getAttribute('unit') || cb.closest('th')?.querySelector('.unit_link')?.dataset.unit;
      if (u && cb.checked===false) out[u]=0;
    });
    return out;
  }

  function enabledCats(){
    const list=[];
    $$('#scavenge_screen .scavenge-option').forEach((el,i)=>{
      const unlocked = el.querySelector('.inactive-view') && !el.querySelector('.locked-view');
      list.push({ id:i+1, r:LOOT[i+1], unlocked });
    });
    return list.filter(c=>c.unlocked);
  }

  // Formeln
  function durSec(C, r, exponent=0.45, base=1800, df=1){
    if (C<=0 || r<=0) return 0;
    const inner = Math.pow(C*C*100*r*r, exponent);
    return (inner + base) * df;
  }
  function rph(C, r, exponent, base, df){
    const t=durSec(C,r,exponent,base,df);
    return t>0 ? 3600*((C*r)/t) : 0;
  }

  // Optimierer (wie zuvor) – hier knapp gehalten
  function optimizeSplit(totalCarry, cats, {exponent,base,df}, mode='hour'){
    const n=cats.length; if(n===0||totalCarry<=0) return Array(n).fill(0);
    let a=Array(n).fill(1/n);
    const score=(v)=>v.reduce((s,ai,i)=> s + (mode==='hour' ? rph(totalCarry*ai,cats[i].r,exponent,base,df) : (totalCarry*ai*cats[i].r)), 0);
    let best=a.slice(), bestVal=score(best), step=0.25, MIN=1/2048;
    while(step>=MIN){
      let improved=false;
      for(let i=0;i<n-1;i++){
        for(const dir of [+1,-1]){
          const trial=best.slice(); const from=(dir>0)?i:i+1, to=(dir>0)?i+1:i;
          const move=Math.min(step, trial[from]); if(move<=0) continue;
          trial[from]-=move/2; trial[to]+=move/2;
          const val=score(trial);
          if (val>bestVal+1e-9){ best=trial; bestVal=val; improved=true; }
        }
      }
      if(!improved) step/=2;
    }
    const s=best.reduce((x,y)=>x+y,0);
    return s>0 ? best.map(x=>x/s) : Array(n).fill(0);
  }

  // Equalize-Modus mit festen Gewichten (wie im Hebel/Osse-Skript)
  function equalizeWeights(activeCount){
    // schneide auf aktive Stufen zu, normalisiere
    const w = EQUAL_WEIGHTS.slice(0, activeCount);
    const sum = w.reduce((a,b)=>a+b,0);
    return w.map(x=>x/sum);
  }

  function totalCap(avail){
    return Object.entries(avail).reduce((S,[u,c])=>S + (CARRY[u]||0)*c, 0);
  }

  function assignUnitsToTargets(avail, targetShareByCat){
    // verwandelt Kapazitäts-Anteile in Stückzahlen je Stufe, mit Mindest-Einheiten-Logik
    const cats = targetShareByCat.map((share,idx)=>({ idx, share }));
    const units = Object.keys(avail).filter(u=>avail[u]>0).sort((a,b)=>(CARRY[b]||0)-(CARRY[a]||0)); // große Tragkraft zuerst
    const pool = Object.fromEntries(Object.entries(avail));
    const total = totalCap(avail);
    const targetCap = cats.map(c => c.share * total);
    const out = cats.map(()=> ({}));

    // 1) Grob in Richtung Zieltragkraft
    for (const c of cats.sort((a,b)=>b.share-a.share)) {
      let need = targetCap[c.idx];
      for (const u of units) {
        if (pool[u]<=0 || need<=0) continue;
        const cap=CARRY[u]||0;
        const take = Math.min(pool[u], Math.floor(need/cap));
        if (take>0) {
          out[c.idx][u]=(out[c.idx][u]||0)+take;
          pool[u]-=take; need-=take*cap;
        }
      }
    }

    // 2) Mindest-Einheiten je Slot sichern (MIN_UNITS_PER_SLOT)
    for (let i=0;i<out.length;i++){
      let sumUnits = Object.values(out[i]).reduce((s,x)=>s+x,0);
      while (sumUnits < MIN_UNITS_PER_SLOT) {
        // nimm die beste verfügbare Einheit aus dem Pool
        const u = units.find(x => pool[x]>0);
        if (!u) break; // kein Nachschub mehr -> so gut es geht
        out[i][u] = (out[i][u]||0) + 1;
        pool[u] -= 1;
        sumUnits += 1;
      }
    }

    // 3) Rest (falls noch im Pool) einfach der höchsten Stufe zuschlagen
    const topIdx = cats.length>0 ? cats[0].idx : 0;
    for (const u of units){
      const left = pool[u]||0;
      if (left>0){
        out[topIdx][u]=(out[topIdx][u]||0)+left;
        pool[u]=0;
      }
    }
    return out;
  }

  function writeInputsFor(map){
    // leeren
    $$('.candidate-squad-widget input.unitsInput').forEach(inp=>{ inp.value=''; });
    // setzen + change-Event
    for (const [u,n] of Object.entries(map||{})){
      const inp = $(`.candidate-squad-widget input.unitsInput[name="${u}"]`);
      if (inp){
        inp.value = String(n);
        const ev = new Event('change', {bubbles:true});
        inp.dispatchEvent(ev);
      }
    }
  }

  function clickStart(catId){
    const btn = $(`#scavenge_screen .scavenge-option:nth-of-type(${catId}) .inactive-view .action-container .free_send_button`);
    if (!btn) return false;
    btn.click();
    return true;
  }

  async function worldParams(){
    // hole df aus get_config (fallback), exponent/base konstant wie live (0.45 / 1800)
    try{
      const res = await fetch('/interface.php?func=get_config', { credentials:'same-origin' });
      const txt = await res.text();
      const m = txt.match(/<speed>([^<]+)<\/speed>/);
      const speed = m ? parseFloat(m[1]) : 1;
      return { exponent:0.45, base:1800, df: Math.pow(speed, -0.55) };
    }catch{ return { exponent:0.45, base:1800, df:1 }; }
  }

  async function run(mode){
    try{
      const catsAll = enabledCats();
      const cats = catsAll.filter(c=>c.unlocked);
      if (cats.length===0){ alert('Keine freie Raubzug-Stufe.'); return; }

      const avail = readAvailable();
      const tcap = totalCap(avail);
      if (tcap<=0){ alert('Keine geeigneten Einheiten verfügbar.'); return; }

      const wp = await worldParams();

      // Zielverteilung (Anteile)
      let shares;
      if (mode==='equal'){
        shares = equalizeWeights(cats.length);
      } else {
        // Optimierung nach Modus
        shares = optimizeSplit(tcap, cats.map(c=>({r:c.r})), wp, mode==='run'?'run':'hour');
      }

      // Auf DOM-Reihenfolge mappen (1..4, nur unlocked)
      const sharesByCatId = {};
      cats.forEach((c,i)=>{ sharesByCatId[c.id]=shares[i]; });
      const orderedShares = catsAll.map(c=>c.unlocked ? (sharesByCatId[c.id]||0) : 0).filter((v,i)=>catsAll[i].unlocked);

      // Stückzahlen je Stufe bestimmen (mit Mindest-Einheiten)
      const plans = assignUnitsToTargets(avail, orderedShares);

      // Start in Reihenfolge 4→1
      const order = cats.slice().sort((a,b)=>b.r-a.r);
      for (const c of order){
        if (!$(`#scavenge_screen .scavenge-option:nth-of-type(${c.id}) .inactive-view`)) continue;
        // passendes plan-Index (unter den aktiven)
        const activeIndex = cats.findIndex(x=>x.id===c.id);
        writeInputsFor(plans[activeIndex]);
        await sleep(200);
        clickStart(c.id);
        await sleep(380);
      }
    }catch(e){
      console.error('TW Raubzug Optimal (fix) Fehler:', e);
      alert('Fehler beim automatischen Raubzug (Konsole prüfen).');
    }
  }

  // Init
  when('#scavenge_screen', ()=>{
    injectUI();
    const mo = new MutationObserver(()=>injectUI());
    mo.observe($('#scavenge_screen'), {childList:true, subtree:true});
  });
})();

///////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////

(function () {
  'use strict';
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

  function when(sel, cb, tries=80){ const el=$(sel); if(el) return cb(el); if(tries<=0)return; setTimeout(()=>when(sel,cb,tries-1),250); }

  // ---------- Styles (dezent, TW-konform) ----------
  function injectCSS(){
    if ($('#twui-style')) return;
    const css = document.createElement('style');
    css.id = 'twui-style';
    css.textContent = `
    :root {
      --twui-bg: rgba(0,0,0,.03);
      --twui-border: rgba(0,0,0,.15);
      --twui-accent: #b88a3a; /* gold-akzent, angelehnt an TW */
      --twui-accent-2: #d0b06a;
      --twui-text-muted: rgba(0,0,0,.65);
      --twui-success: #1f8b4c;
      --twui-error: #b3261e;
    }
    .twui-card {
      display:flex; flex-wrap:wrap; gap:10px; align-items:center;
      padding:10px 12px; border:1px solid var(--twui-border);
      background: var(--twui-bg); border-radius:10px;
    }
    .twui-title { font-weight:700; margin-right:8px; }
    .twui-segment {
      display:inline-flex; border:1px solid var(--twui-border); border-radius:999px; overflow:hidden;
    }
    .twui-segment button {
      border:0; padding:6px 10px; background:transparent; cursor:pointer; font-weight:600;
    }
    .twui-segment button.twui-active {
      background:linear-gradient(180deg, var(--twui-accent-2), var(--twui-accent));
      color:#fff;
    }
    .twui-segment button:not(.twui-active):hover { background: rgba(0,0,0,.06); }
    .twui-spacer { flex: 1 1 auto; }
    .twui-btn-primary.btn { font-weight:700; }
    .twui-muted { font-size:12px; color: var(--twui-text-muted); }
    .twui-link { text-decoration:underline; cursor:pointer; }
    .twui-chip {
      display:inline-block; padding:2px 8px; border:1px solid var(--twui-border);
      border-radius:999px; font-size:12px; margin-right:6px; background:#fff8f0;
    }
    .twui-pop {
      position:absolute; z-index:9999; min-width:260px; max-width:360px;
      background:#fff; border:1px solid var(--twui-border); border-radius:8px;
      box-shadow:0 4px 16px rgba(0,0,0,.15); padding:10px;
    }
    .twui-pop h4 { margin:0 0 6px; font-size:14px; }
    .twui-pop .twui-row { display:flex; justify-content:space-between; gap:8px; padding:4px 0; border-bottom:1px dashed rgba(0,0,0,.08); }
    .twui-pop .twui-row:last-child { border-bottom:0; }
    .twui-toast {
      position:fixed; left:50%; transform:translateX(-50%);
      bottom:24px; background:#fff; border:1px solid var(--twui-border); border-left:4px solid var(--twui-accent);
      border-radius:8px; padding:10px 12px; box-shadow:0 4px 12px rgba(0,0,0,.18);
      z-index: 99999; font-weight:600;
    }
    .twui-toast.ok { border-left-color: var(--twui-success); }
    .twui-toast.err { border-left-color: var(--twui-error); }
    `;
    document.head.appendChild(css);
  }

  // ---------- UI bauen ----------
  function buildBar(){
    // Entferne alte Modernisierungen (falls neu gerendert)
    const old = $('#twui-bar'); if (old) old.remove();

    // Finde Host (oberhalb der Kandidaten-Tabelle)
    const host = $('#scavenge_screen .candidate-squad-container');
    if (!host) return;

    // Nutze vorhandene twopt-Leiste, falls da -> wir ersetzen nur die Oberfläche, Logik bleibt
    const existing = $('#twopt-bar');

    const bar = document.createElement('div');
    bar.id = 'twui-bar';
    bar.className = 'twui-card';
    // Titel
    const title = document.createElement('span');
    title.className = 'twui-title';
    title.textContent = 'Raubzug Optimierer';
    bar.appendChild(title);

    // Segment (Modus)
    const seg = document.createElement('div');
    seg.className = 'twui-segment';
    const modes = [
      {id:'hour', label:'R/Stunde', title:'Maximiert Ressourcen pro Stunde'},
      {id:'run', label:'pro Lauf', title:'Maximiert Ressourcen je Durchgang'},
      {id:'equal', label:'Gleich lang', title:'Stufen auf ähnliche Laufzeit angleichen'}
    ];
    modes.forEach(m=>{
      const b=document.createElement('button');
      b.type='button'; b.dataset.mode=m.id; b.textContent=m.label; b.title=m.title;
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    // Spacer
    const spacer = document.createElement('div'); spacer.className='twui-spacer'; bar.appendChild(spacer);

    // Vorschau
    const previewBtn = document.createElement('button');
    previewBtn.type='button';
    previewBtn.className='btn';
    previewBtn.textContent='Vorschau';
    previewBtn.title='Zeigt geplante Aufteilung & geschätzte Zeiten';
    bar.appendChild(previewBtn);

    // Start
    const startBtn = document.createElement('button');
    startBtn.type='button';
    startBtn.className='btn twui-btn-primary';
    startBtn.textContent='Start';
    startBtn.title='Startet die freien Stufen (4→1) im gewählten Modus';
    bar.appendChild(startBtn);

    // Hinweis
    const hint = document.createElement('span');
    hint.className='twui-muted';
    hint.textContent = ' Tipp: Mindest-Einheiten/Slot wird automatisch eingehalten.';
    bar.appendChild(hint);

    // Einfügen: wenn twopt-bar vorhanden ist, ersetzen wir sie optisch (wir hängen uns davor)
    if (existing && existing.parentElement){
      existing.style.display = 'none'; // wir verstecken die alte Leiste
      existing.insertAdjacentElement('beforebegin', bar);
    } else {
      host.prepend(bar);
    }

    // --- Interaktion ---
    // lese & schreibe Modus -> nutzt, falls vorhanden, deinen Optimierer (#twopt-bar) via Radio-Buttons; sonst merken wir es lokal.
    const externalRadios = $$('input[name="twopt-mode"]');
    let currentMode = (externalRadios.find(r=>r.checked)?.value) || 'hour';
    activateSegment(seg, currentMode);

    seg.addEventListener('click', (ev)=>{
      const btn = ev.target.closest('button[data-mode]'); if(!btn) return;
      currentMode = btn.dataset.mode;
      activateSegment(seg, currentMode);
      if (externalRadios.length){
        const r = externalRadios.find(x=>x.value===currentMode); if (r) r.checked = true;
      }
      toast('Modus: '+btn.textContent, 'ok');
    });

    previewBtn.addEventListener('click', async ()=>{
      try {
        const data = await computePreview(currentMode); // genaue Vorschau (mit df)
        showPreview(previewBtn, data);
      } catch(e){
        // console.debug(e);
        toast('Vorschau nicht möglich (unvollständige Daten).', 'err');
      }
    });

    startBtn.addEventListener('click', async ()=>{
      // Falls externer Optimierer vorhanden: trigger dort den Start-Flow (klickt den vorhandenen Start-Button)
      const extStart = $('#twopt-bar .btn');
      if (externalRadios.length && extStart){
        extStart.click();
        toast('Gestartet (externer Optimierer).', 'ok');
      } else {
        // Minimal-Start (fallback): wir klicken die Standard-Buttons (keine Berechnung)
        const free = $$('#scavenge_screen .scavenge-option .inactive-view .free_send_button');
        if (!free.length){ toast('Keine freie Stufe.', 'err'); return; }
        // 4→1
        for (let i=free.length-1; i>=0; i--){
          free[i].click();
          await sleep(300);
        }
        toast('Gestartet (Fallback).', 'ok');
      }
    });

    // --- Verifikation dieser Änderung ---
    // (leise) rebuild, falls Host neu rendert
    return bar;
  }

  function activateSegment(seg, mode){
    seg.querySelectorAll('button').forEach(b=>b.classList.toggle('twui-active', b.dataset.mode===mode));
  }

  // ---------- Vorschau (mit echtem df & Mini-Optimierer) ----------
  const CARRY = { spear:25, sword:15, axe:10, archer:10, light:80, marcher:50, heavy:50, knight:100 };
  const LOOT = {1:0.10, 2:0.25, 3:0.50, 4:0.75};

  function readAvailable(){
    const out = {};
    $$('.candidate-squad-widget thead .unit_link').forEach(a=>{
      const u=a.getAttribute('data-unit'); if(u) out[u]=0;
    });
    $$('.candidate-squad-widget tbody tr:nth-child(2) td').forEach(td=>{
      const inp=td.querySelector('input.unitsInput');
      const a = td.querySelector('a.units-entry-all');
      if (!inp || !a) return;
      const u = inp.name;
      const m = a.textContent.match(/\((\d+)\)/);
      out[u] = m ? parseInt(m[1],10) : 0;
    });
    // Checkbox-Filter
    $$('.candidate-squad-widget .checkboxTroops').forEach(cb=>{
      const u = cb.getAttribute('unit') || cb.closest('th')?.querySelector('.unit_link')?.dataset.unit;
      if (u && cb.checked===false) out[u]=0;
    });
    return out;
  }
  function enabledCats(){
    const arr=[];
    $$('#scavenge_screen .scavenge-option').forEach((n,i)=>{
      const free = n.querySelector('.inactive-view') && !n.querySelector('.locked-view');
      if (free) arr.push(i+1);
    });
    return arr;
  }
  function totalCarry(avail){
    return Object.entries(avail).reduce((S,[u,c])=>S+(CARRY[u]||0)*c,0);
  }
  function durSec(C, r, exponent=0.45, base=1800, df=1){
    if (C<=0 || r<=0) return 0;
    const inner = Math.pow(C*C*100*r*r, exponent);
    return (inner + base) * (df||1);
  }

  // df aus get_config mit Cache (10 Min) & Fallback
  let DF_CACHE = { value: null, ts: 0 };
  async function getDfAccurate() {
    const now = Date.now();
    if (DF_CACHE.value !== null && (now - DF_CACHE.ts) < 10*60*1000) {
      return DF_CACHE.value;
    }
    try {
      const res = await fetch('/interface.php?func=get_config', { credentials: 'same-origin' });
      const txt = await res.text();
      const m = txt.match(/<speed>([^<]+)<\/speed>/);
      const speed = m ? parseFloat(m[1]) : 1;
      const df = Math.pow(speed, -0.55);
      DF_CACHE = { value: df, ts: now };
      return df;
    } catch (e) {
      // Fallback: vorerst 1 verwenden, beim nächsten Aufruf erneut versuchen
      DF_CACHE = { value: 1, ts: now - 10*60*1000 }; // sofort wieder neu versuchen dürfen
      return 1;
    }
  }

  // Mini-Optimierer für Vorschau (Nachbar-Verschiebung)
  function optimizeSplitPreview(totalCarry, catLoot, {exponent, base, df}, mode) {
    const n = catLoot.length;
    if (!n || totalCarry <= 0) return Array(n).fill(0);
    let a = Array(n).fill(1/n);
    const dur = (C,r)=>((Math.pow(C*C*100*r*r, exponent) + base) * df);
    const score = (vec) => vec.reduce((s,ai,i)=>{
      const C = totalCarry * ai, r = catLoot[i];
      return s + (mode==='hour' ? (3600*((C*r)/dur(C,r))) : (C*r));
    }, 0);
    let best = a.slice(), bestVal = score(best), step = 0.25, MIN = 1/2048;
    while (step >= MIN) {
      let imp = false;
      for (let i=0;i<n-1;i++) {
        for (const dir of [+1,-1]) {
          const t=best.slice(), from=(dir>0)?i:i+1, to=(dir>0)?i+1:i;
          const mv=Math.min(step, t[from]); if (mv<=0) continue;
          t[from]-=mv/2; t[to]+=mv/2;
          const val=score(t);
          if (val > bestVal + 1e-9) { best=t; bestVal=val; imp=true; }
        }
      }
      if (!imp) step/=2;
    }
    const s = best.reduce((x,y)=>x+y,0);
    return s ? best.map(x=>x/s) : Array(n).fill(0);
  }

  async function computePreview(mode){
    const avail = readAvailable();
    const active = enabledCats();       // z. B. [1,2,3]
    if (!active.length) throw new Error('Keine freie Stufe.');
    const cap = totalCarry(avail);
    if (!cap) throw new Error('Keine Kapazität.');

    const df = await getDfAccurate();
    const params = { exponent: 0.45, base: 1800, df };

    // Verteilungsanteile bestimmen
    let shares;
    if (mode === 'equal') {
      const w = [7.5,3,1.5,1].slice(0, active.length);
      const s = w.reduce((a,b)=>a+b,0);
      shares = w.map(x=>x/s);
    } else {
      const loot = active.map(id => LOOT[id]);
      shares = optimizeSplitPreview(cap, loot, params, mode);
    }

    const rows = active.map((id, i)=>{
      const r = LOOT[id];
      const C = cap * shares[i];
      const T = durSec(C, r, params.exponent, params.base, params.df);
      const runTotal = C * r;                  // gesamt pro Lauf (alle 3 Ressourcen)
      const perRes = Math.floor(runTotal / 3); // pro Holz/Lehm/Eisen (Spiel zeigt das einzeln)
      const perHour = 3600 * (runTotal / T);
      return {
        id,
        C: Math.floor(C),
        T,
        runTotal: Math.floor(runTotal),
        perRes,
        rph: Math.floor(perHour)
      };
    });

    const sumRun = rows.reduce((s,r)=>s+r.runTotal,0);
    const sumRPH = rows.reduce((s,r)=>s+r.rph,0);
    const minT = Math.min(...rows.map(r=>r.T));
    const maxT = Math.max(...rows.map(r=>r.T));
    return { rows, sumRun, sumRPH, span:`${fmtTime(minT)} – ${fmtTime(maxT)}` };
  }

  function fmtTime(sec){
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    const pad = (n)=>String(n).padStart(2,'0');
    return (h>0? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
  }

  // ---------- Popover + Toast ----------
  function showPreview(anchor, data){
    closePreview();
    const pop = document.createElement('div');
    pop.className='twui-pop';
    pop.id='twui-pop';
    pop.innerHTML = `<h4>Vorschau</h4>
      <div class="twui-row"><span>Aktive Stufen</span><strong>${data.rows.map(r=>r.id).join(', ')}</strong></div>
      <div class="twui-row"><span>Geschätzte Laufzeiten</span><strong>${data.span}</strong></div>
      <div class="twui-row"><span>∑ Ressourcen/Run</span><strong>${data.sumRun.toLocaleString()}</strong></div>
      <div class="twui-row"><span>∑ Ressourcen/Stunde</span><strong>${data.sumRPH.toLocaleString()}</strong></div>
      <div style="margin-top:6px" class="twui-muted">Hinweis: Vorschau ist Näherung; exakte Verteilung setzt der Optimierer beim Start.</div>`;
    // Liste je Stufe (≈/Ress + Dauer)
    const list = document.createElement('div');
    list.style.marginTop = '6px';
    list.innerHTML = data.rows.map(r =>
      `<div class="twui-row"><span>Stufe ${r.id} (≈/Ress):</span><strong>${r.perRes} | ${r.perRes} | ${r.perRes}</strong> <span class="twui-muted">(${fmtTime(r.T)})</span></div>`
    ).join('');
    pop.appendChild(list);

    document.body.appendChild(pop);
    // Position
    const rect = anchor.getBoundingClientRect();
    const top = window.scrollY + rect.bottom + 8;
    const left = Math.min(window.scrollX + rect.left, window.scrollX + window.innerWidth - 380);
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    // Klick außerhalb schließt
    const closer = (ev)=>{ if (!pop.contains(ev.target)) { closePreview(); document.removeEventListener('mousedown', closer); } };
    document.addEventListener('mousedown', closer);
  }
  function closePreview(){ const p=$('#twui-pop'); if(p) p.remove(); }

  let toastTimer;
  function toast(msg, kind='ok'){
    clearTimeout(toastTimer);
    let t = $('#twui-toast'); if (t) t.remove();
    t = document.createElement('div');
    t.id='twui-toast'; t.className=`twui-toast ${kind==='err'?'err':'ok'}`;
    t.textContent = msg;
    document.body.appendChild(t);
    toastTimer = setTimeout(()=>{ t.remove(); }, 2200);
  }

  // ---------- Init & Checks ----------
  function verify(){
    // Funktional: Segment-Klick, Vorschau, Start → visuell & technisch
    const okSeg = !!$('#twui-bar .twui-segment');
    const okBtns = !!$('#twui-bar .btn');
    const okHost = !!$('#scavenge_screen .candidate-squad-container');
    if (!okSeg || !okBtns || !okHost) {
      // leiser Rebuild
      const b = buildBar();
      return !!b;
    }
    return true;
  }

  when('#scavenge_screen', ()=>{
    injectCSS();
    buildBar();
    verify();

    // Re-Render robust
    const mo = new MutationObserver(()=>{
      // falls alte Leiste zurückkommt oder Host neu rendert → erneut modernisieren
      if (!$('#twui-bar')) { buildBar(); verify(); }
    });
    mo.observe($('#scavenge_screen'), {childList:true, subtree:true});
  });
})();
