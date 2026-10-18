/*
  main.js – Zustand, Simulation und Bedienung
  Die Simulation baut die Logik der Firmware nach (Glättung + Hysterese + Modi),
  damit sich die Seite ohne Hardware genauso verhält.
*/
(function () {
  'use strict';

  // Gleiche Werte wie in firmware/mondbasis/mondbasis.ino!
  const CONFIG = {
    SCHWELLE_DUNKEL: 1200,   // darunter -> dunkel
    SCHWELLE_HELL: 1600,     // darüber -> hell
    ADC_MAX: 4095,
    MESS_INTERVALL: 100,     // ms
    SENDE_INTERVALL: 200,    // ms
    ANZAHL_MESSUNGEN: 10,
    START_HELLIGKEIT: 2600,
  };
  MB.CONFIG = CONFIG;

  const NAECHSTER_MODUS = { auto: 'on', on: 'off', off: 'auto' };

  // Hysterese wie in der Firmware
  function hysterese(istDunkel, wert) {
    if (!istDunkel && wert < CONFIG.SCHWELLE_DUNKEL) return true;
    if (istDunkel && wert > CONFIG.SCHWELLE_HELL) return false;
    return istDunkel;
  }

  function ledsFuer(modus, dunkel) {
    if (modus === 'on') return true;
    if (modus === 'off') return false;
    return dunkel;
  }

  // ---------- Simulation ----------

  class Simulation {
    constructor(onDaten) {
      this.onDaten = onDaten;
      this.helligkeit = CONFIG.START_HELLIGKEIT;
      this.modus = 'auto';
      this.schalter = false;
      this.timer = null;
      this.zuruecksetzen();
    }

    zuruecksetzen() {
      this.werte = new Array(CONFIG.ANZAHL_MESSUNGEN).fill(this.helligkeit);
      this.index = 0;
      this.ldr = this.helligkeit;
      this.dunkel = this.ldr < CONFIG.SCHWELLE_DUNKEL;
      this.takt = 0;
    }

    start() {
      if (this.timer) return;
      this.zuruecksetzen();
      this.timer = setInterval(() => this.messen(), CONFIG.MESS_INTERVALL);
      this.senden();
    }

    stop() {
      clearInterval(this.timer);
      this.timer = null;
    }

    messen() {
      // kleines Rauschen wie bei einem echten Sensor
      const roh = Math.round(Math.min(CONFIG.ADC_MAX, Math.max(0, this.helligkeit + (Math.random() - 0.5) * 30)));
      this.werte[this.index] = roh;
      this.index = (this.index + 1) % CONFIG.ANZAHL_MESSUNGEN;
      this.ldr = Math.round(this.werte.reduce((a, b) => a + b, 0) / CONFIG.ANZAHL_MESSUNGEN);
      this.dunkel = hysterese(this.dunkel, this.ldr);
      this.takt++;
      if (this.takt % (CONFIG.SENDE_INTERVALL / CONFIG.MESS_INTERVALL) === 0) this.senden();
    }

    senden() {
      const an = ledsFuer(this.modus, this.dunkel);
      this.onDaten({ ldr: this.ldr, dunkel: this.dunkel, led1: an, led2: an, schalter: this.schalter, modus: this.modus });
    }

    setModus(m) {
      this.modus = m;
      this.senden();
    }

    // Wie der Kippschalter: jedes Umlegen wechselt den Modus
    schalterUmlegen() {
      this.schalter = !this.schalter;
      this.modus = NAECHSTER_MODUS[this.modus];
      this.senden();
    }
  }

  // ---------- Oberfläche ----------

  const $ = (id) => document.getElementById(id);
  const ui = {
    status: $('status'), verbinden: $('btnVerbinden'), trennen: $('btnTrennen'), meldung: $('meldung'),
    ldrWert: $('ldrWert'), balken: $('balken'), fuellung: $('balkenFuellung'),
    markeDunkel: $('markeDunkel'), markeHell: $('markeHell'),
    regler: $('helligkeit'), reglerBox: $('reglerBox'), reglerHinweis: $('reglerHinweis'),
    modusKnoepfe: document.querySelectorAll('.modus-knopf'), zustand: $('zustandText'),
    tabs: [$('tabMond'), $('tabBau')],
  };

  let quelle = 'sim';      // 'sim' oder 'esp'
  let meldungTimer = null;

  const sim = new Simulation((d) => { if (quelle === 'sim') aktualisieren(d); });
  const serial = new MB.SerialVerbindung({
    onDaten: (d) => { if (quelle === 'esp') aktualisieren(d); },
    onStatus: statusGeaendert,
  });

  function aktualisieren(d) {
    const prozent = (d.ldr / CONFIG.ADC_MAX) * 100;
    ui.fuellung.style.setProperty('--wert', prozent.toFixed(1) + '%');
    ui.ldrWert.textContent = d.ldr;
    ui.balken.setAttribute('aria-valuenow', d.ldr);

    ui.modusKnoepfe.forEach((k) => k.setAttribute('aria-pressed', String(k.dataset.modus === d.modus)));

    if (d.modus === 'on') ui.zustand.textContent = 'Dauer-an: Die LEDs leuchten immer, egal wie hell es ist.';
    else if (d.modus === 'off') ui.zustand.textContent = 'Dauer-aus: Die LEDs bleiben aus, auch wenn es dunkel ist.';
    else ui.zustand.textContent = d.dunkel ? 'Es ist dunkel 🌙 – darum sind die LEDs an.' : 'Es ist hell ☀️ – darum sind die LEDs aus.';

    MB.Szene.setZustand(d);
    MB.Bauplan.setZustand(d);
    $('btnAliens').classList.toggle('tag', !d.dunkel);
  }

  function meldungZeigen(text, art) {
    clearTimeout(meldungTimer);
    if (!text) { ui.meldung.hidden = true; return; }
    ui.meldung.textContent = text;
    ui.meldung.className = 'meldung ' + (art || 'info');
    ui.meldung.hidden = false;
    // Erfolgs- und Info-Meldungen verschwinden von selbst
    if (art === 'ok' || art === 'info') meldungTimer = setTimeout(() => { ui.meldung.hidden = true; }, 6000);
  }

  function statusGeaendert(status, meldung, art) {
    const anzeige = {
      verbunden: ['Verbunden', 'status-verbunden'],
      verbinde: ['Verbinde …', 'status-verbinde'],
      getrennt: ['Getrennt', 'status-getrennt'],
    }[status] || ['Simulation', 'status-sim'];
    ui.status.textContent = anzeige[0];
    ui.status.className = 'status ' + anzeige[1];

    const verbunden = status === 'verbunden';
    ui.verbinden.hidden = verbunden;
    ui.verbinden.disabled = status === 'verbinde';
    ui.trennen.hidden = !verbunden;

    if (verbunden && quelle !== 'esp') {
      quelle = 'esp';
      sim.stop();
    } else if (!verbunden && status !== 'verbinde' && quelle !== 'sim') {
      quelle = 'sim';
      sim.start();
    }

    ui.regler.disabled = quelle === 'esp';
    ui.reglerBox.classList.toggle('aus', quelle === 'esp');
    ui.reglerHinweis.hidden = quelle !== 'esp';
    meldungZeigen(meldung, art);
  }

  // Tabs mit Maus und Pfeiltasten
  function tabWaehlen(tab, fokus) {
    ui.tabs.forEach((t) => {
      const aktiv = t === tab;
      t.setAttribute('aria-selected', String(aktiv));
      t.tabIndex = aktiv ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !aktiv;
    });
    if (fokus) tab.focus();
    history.replaceState(null, '', tab.id === 'tabBau' ? '#bauplan' : '#mondbasis');
  }

  function init() {
    // Schwellwert-Markierungen am Balken
    ui.markeDunkel.style.left = (CONFIG.SCHWELLE_DUNKEL / CONFIG.ADC_MAX * 100) + '%';
    ui.markeHell.style.left = (CONFIG.SCHWELLE_HELL / CONFIG.ADC_MAX * 100) + '%';
    $('txtDunkel').textContent = CONFIG.SCHWELLE_DUNKEL;
    $('txtHell').textContent = CONFIG.SCHWELLE_HELL;

    // Alien-Besuch: Bauplan-LED flackern lassen und dem ESP32 Bescheid geben
    MB.Szene.init($('szene'), $('szenenText'), (aktiv) => {
      MB.Bauplan.setAlien(aktiv);
      if (quelle === 'esp') serial.senden(aktiv ? 'ALIEN:on\n' : 'ALIEN:off\n');
    });

    let alienHinweisTimer = null;
    $('btnAliens').addEventListener('click', () => {
      const ergebnis = MB.Szene.aliensRufen();
      const hinweis = $('alienHinweis');
      clearTimeout(alienHinweisTimer);
      if (ergebnis === 'hell') {
        hinweis.textContent = 'Aliens sind schüchtern – sie kommen nur in der Nacht. Mach es dunkel! 🌙';
        hinweis.hidden = false;
        alienHinweisTimer = setTimeout(() => { hinweis.hidden = true; }, 5000);
      } else {
        hinweis.hidden = true;
      }
    });
    MB.Bauplan.init({
      container: $('bauplan'),
      infoTitel: $('infoTitel'),
      infoText: $('infoText'),
      tour: { start: $('btnTour'), box: $('tourBox'), titel: $('tourTitel'), text: $('tourText'), weiter: $('btnTourWeiter'), ende: $('btnTourEnde') },
      istSimulation: () => quelle === 'sim',
      onSchalter: () => sim.schalterUmlegen(),
    });

    ui.regler.value = CONFIG.START_HELLIGKEIT;
    ui.regler.addEventListener('input', () => { sim.helligkeit = Number(ui.regler.value); });

    ui.modusKnoepfe.forEach((k) => k.addEventListener('click', () => {
      const m = k.dataset.modus;
      if (quelle === 'esp') serial.senden('MODE:' + m + '\n');
      else sim.setModus(m);
    }));

    ui.verbinden.addEventListener('click', () => serial.verbinden());
    ui.trennen.addEventListener('click', () => serial.trennen());

    ui.tabs.forEach((t, i) => {
      t.addEventListener('click', () => tabWaehlen(t));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          tabWaehlen(ui.tabs[(i + 1) % ui.tabs.length], true);
        }
      });
    });
    if (location.hash === '#bauplan') tabWaehlen(ui.tabs[1]);

    if (!MB.SerialVerbindung.unterstuetzt()) {
      ui.verbinden.title = 'Web Serial gibt es nur in Chrome oder Edge am Computer';
    }

    sim.start();
  }

  init();
})();
