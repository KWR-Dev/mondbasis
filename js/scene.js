/*
  scene.js – Mondbasis und Rakete
  Animationen starten nur bei einem Zustandswechsel, nicht bei jedem Datenpaket.
  Ablauf Rakete: rampe -> countdown -> zuendung -> flug -> oben -> landung -> rampe
*/
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const reduziert = window.matchMedia('(prefers-reduced-motion: reduce)');

  const TEXTE = {
    rampe: 'Es ist hell. Die Rakete wartet auf der Startrampe.',
    countdown: 'Es wird dunkel! Der Countdown läuft …',
    zuendung: 'Zündung! Die Triebwerke brennen. 🔥',
    flug: 'Start! Die Rakete fliegt zu den Sternen. 🚀',
    oben: 'Die Rakete ist im All unterwegs. In der Mondbasis brennt Licht.',
    landung: 'Es wird hell – die Rakete kommt zurück und landet ganz sanft.',
  };

  let svg, rakete, rauch, countdown, textEl;
  let fenster = [], schein = [];
  let letzter = null;          // zuletzt angezeigter Zustand
  let phase = 'rampe';
  let lauf = 0;                // Zähler, um alte Abläufe abzubrechen
  let rauchTimer = null;
  let fenster2Timer = null;
  let onAlien = null;          // Rückmeldung: Alien-Störung an/aus

  function init(svgEl, textElement, alienCallback) {
    svg = svgEl;
    textEl = textElement;
    onAlien = alienCallback || null;
    rakete = svg.querySelector('#rakete');
    rauch = svg.querySelector('#rauch');
    countdown = svg.querySelector('#countdown');
    fenster = [svg.querySelector('#fenster1'), svg.querySelector('#fenster2')];
    schein = [svg.querySelector('#schein1'), svg.querySelector('#schein2')];
    sterneErzeugen();
  }

  // Zufällige Sterne mit unterschiedlichem Funkeln
  function sterneErzeugen() {
    const gruppe = svg.querySelector('#sterne');
    for (let i = 0; i < 90; i++) {
      const s = document.createElementNS(NS, 'circle');
      s.setAttribute('cx', (Math.random() * 800).toFixed(1));
      s.setAttribute('cy', (Math.random() * 320).toFixed(1));
      s.setAttribute('r', (0.6 + Math.random() * 1.4).toFixed(2));
      s.setAttribute('class', 'stern');
      s.style.setProperty('--d', (2 + Math.random() * 3).toFixed(2) + 's');
      s.style.setProperty('--v', (-Math.random() * 4).toFixed(2) + 's');
      gruppe.appendChild(s);
    }
  }

  // Neuer Zustand von Sensor oder Simulation
  function setZustand(d) {
    if (!svg) return;
    const erstes = letzter === null;
    const alt = letzter || { dunkel: false, led1: false, led2: false };

    if (erstes || d.dunkel !== alt.dunkel) {
      svg.classList.toggle('dunkel', d.dunkel);
      if (d.dunkel) dunkelGeworden();
      else if (!erstes) hellGeworden();
    }
    if (erstes || d.led1 !== alt.led1) fensterSetzen(0, d.led1);
    if (erstes || d.led2 !== alt.led2) {
      clearTimeout(fenster2Timer);
      // Fenster gehen nacheinander an
      if (d.led2 && d.led1 && !erstes && !reduziert.matches) {
        fenster2Timer = setTimeout(() => fensterSetzen(1, true), 600);
      } else {
        fensterSetzen(1, d.led2);
      }
    }
    letzter = { dunkel: d.dunkel, led1: d.led1, led2: d.led2 };
  }

  function fensterSetzen(i, an) {
    fenster[i].classList.toggle('an', an);
    schein[i].classList.toggle('an', an);
  }

  // ---------- Raketen-Ablauf ----------

  function setPhase(p) {
    phase = p;
    svg.dataset.phase = p;
    if (textEl) textEl.textContent = TEXTE[p];
  }

  // Wartet ms Millisekunden; liefert false, wenn der Ablauf inzwischen abgebrochen wurde
  function warte(ms, id) {
    return new Promise((r) => setTimeout(r, ms)).then(() => id === lauf);
  }

  function dunkelGeworden() {
    if (phase === 'rampe') countdownStarten(++lauf);
    else if (phase === 'landung') fliegen(++lauf);      // während der Landung wieder hoch
  }

  function hellGeworden() {
    if (phase === 'countdown' || phase === 'zuendung') {
      ++lauf;
      zahlZeigen('');
      rauchStopp();
      setPhase('rampe');
    } else if (phase === 'flug' || phase === 'oben') {
      landen(++lauf);
    }
    aliensVerscheuchen();   // nach der Rakete, damit der Alien-Text sichtbar bleibt
  }

  async function countdownStarten(id) {
    setPhase('countdown');
    // kurz warten, damit erst die Fenster angehen
    if (!await warte(reduziert.matches ? 200 : 1200, id)) return;
    for (const zahl of ['3', '2', '1']) {
      zahlZeigen(zahl);
      if (!await warte(950, id)) return;
    }
    zahlZeigen('Start!');
    setPhase('zuendung');
    rauchStart();
    if (!await warte(reduziert.matches ? 400 : 1400, id)) return;
    fliegen(id);
  }

  async function fliegen(id) {
    setPhase('flug');
    rakete.classList.remove('landet');
    rakete.classList.add('oben');
    if (!await warte(1500, id)) return;
    rauchStopp();
    zahlZeigen('');
    if (!await warte(reduziert.matches ? 50 : 2100, id)) return;
    setPhase('oben');
  }

  async function landen(id) {
    rauchStopp();
    setPhase('landung');
    rakete.classList.add('landet');
    rakete.classList.remove('oben');
    if (!await warte(reduziert.matches ? 50 : 4200, id)) return;
    rakete.classList.remove('landet');
    setPhase('rampe');
    staubwolke();
  }

  function zahlZeigen(text) {
    countdown.textContent = text;
    countdown.classList.remove('zeigen');
    if (text) {
      void countdown.getBBox();       // Animation neu starten
      countdown.classList.add('zeigen');
    }
  }

  // ---------- Rauch ----------

  function rauchTeil(x, y, dx, dy) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', 7 + Math.random() * 5);
    c.setAttribute('class', 'rauch-teil');
    c.style.setProperty('--dx', dx + 'px');
    c.style.setProperty('--dy', dy + 'px');
    c.addEventListener('animationend', () => c.remove());
    rauch.appendChild(c);
    setTimeout(() => c.remove(), 2500);   // Sicherheitsnetz
  }

  function rauchStart() {
    if (reduziert.matches || rauchTimer) return;
    rauchTimer = setInterval(() => {
      const seite = Math.random() < 0.5 ? -1 : 1;
      rauchTeil(600 + seite * Math.random() * 8, 338, seite * (20 + Math.random() * 60), -5 - Math.random() * 25);
    }, 70);
  }

  function rauchStopp() {
    clearInterval(rauchTimer);
    rauchTimer = null;
  }

  function staubwolke() {
    if (reduziert.matches) return;
    for (let i = 0; i < 10; i++) {
      const seite = i % 2 ? -1 : 1;
      rauchTeil(600, 338, seite * (15 + Math.random() * 45), -3 - Math.random() * 12);
    }
  }

  // ---------- Alien-Besuch (nur nachts) ----------
  // Ablauf: da -> runter -> winkt -> hoch -> weg

  let alienPhase = '';
  let alienLauf = 0;
  let alienStoerung = false;

  const ALIEN_TEXTE = {
    da: 'Was ist das? Ein UFO! 🛸',
    runter: 'Das UFO beamt einen Besucher auf den Mond …',
    winkt: 'Ein Alien! Es winkt dir zu. 👽',
    hoch: 'Tschüss! Das Alien beamt sich zurück ins UFO.',
  };

  function alienSetzen(p) {
    alienPhase = p;
    if (p) svg.dataset.aliens = p;
    else delete svg.dataset.aliens;
    if (textEl) textEl.textContent = ALIEN_TEXTE[p] || TEXTE[phase];

    // Solange das UFO da ist, flackert LED 2 (Fenster 2)
    const stoerung = p !== '' && p !== 'weg';
    if (stoerung !== alienStoerung) {
      alienStoerung = stoerung;
      svg.classList.toggle('alien-stoerung', stoerung);
      if (onAlien) onAlien(stoerung);
    }
  }

  function alienWarte(ms, id) {
    return warteAuf(reduziert.matches ? Math.min(ms, 500) : ms).then(() => id === alienLauf);
  }

  function warteAuf(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Liefert 'ok', 'hell' (tagsüber kommen keine Aliens) oder 'laeuft'
  function aliensRufen() {
    if (alienPhase) return 'laeuft';
    if (!letzter || !letzter.dunkel) return 'hell';
    alienBesuch(++alienLauf);
    return 'ok';
  }

  async function alienBesuch(id) {
    alienSetzen('da');
    if (!await alienWarte(2700, id)) return;
    alienSetzen('runter');
    if (!await alienWarte(1800, id)) return;
    alienSetzen('winkt');
    if (!await alienWarte(3800, id)) return;
    alienAbflug(id);
  }

  async function alienAbflug(id) {
    alienSetzen('hoch');
    if (!await alienWarte(1700, id)) return;
    alienSetzen('weg');
    if (!await alienWarte(1700, id)) return;
    // ohne Übergang zurück an den Start (links außerhalb)
    const ufo = svg.querySelector('#ufo');
    ufo.style.transition = 'none';
    alienSetzen('');
    void ufo.getBBox();
    await warteAuf(50);
    ufo.style.transition = '';
  }

  // Wird es hell, fliegen die Aliens schnell weg
  function aliensVerscheuchen() {
    if (alienPhase === 'da' || alienPhase === 'runter' || alienPhase === 'winkt') {
      alienAbflug(++alienLauf);
      if (textEl) textEl.textContent = 'Huch, es wird hell! Die Aliens fliegen schnell nach Hause.';
    }
  }

  window.MB = window.MB || {};
  window.MB.Szene = { init, setZustand, aliensRufen };
})();
