/*
  schematic.js – Bauplan im Steckbrett-Stil mit animiertem Stromfluss
  Leuchtpunkte zeigen die technische Stromrichtung (+ -> −).
  Nur aktive Zweige sind animiert; LED-Zweige sind dicker und schneller.
*/
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  // Pin-Positionen am XIAO (rechte Kante)
  const PIN_X = 238;
  const PIN_Y = { '3V3': 150, D0: 200, D1: 250, D2: 300, D3: 350, GND: 400 };

  // Spalten auf dem Steckbrett
  const X_SCHALTER = 420, X_LED2 = 530, X_LED1 = 640, X_SENSOR = 770;
  const Y_PLUS = 70, Y_MINUS = 470;

  // Kindgerechte Erklärungen
  const INFOS = {
    xiao: ['Das Gehirn: XIAO ESP32-S3', 'Ein winziger Computer. Er misst an D0, wie hell es ist, entscheidet „hell oder dunkel?“ und schaltet über D1 und D2 die LEDs. Über das USB-Kabel schickt er alles an die Webseite.'],
    ldr: ['Lichtsensor (LDR)', 'Ein Fotowiderstand. Bei viel Licht lässt er viel Strom durch, im Dunkeln nur wenig. Daran merkt der ESP32, wie hell es ist. Halte die Hand darüber!'],
    r10k: ['Widerstand 10 kΩ', 'Er arbeitet im Team mit dem Lichtsensor (ein „Spannungsteiler“). So entsteht an D0 eine Spannung, die der ESP32 messen kann. Farbringe: braun – schwarz – orange = 10 000 Ohm.'],
    r330a: ['Widerstand 330 Ω', 'Er bremst den Strom, damit LED 1 nicht kaputtgeht. Farbringe: orange – orange – braun = 330 Ohm.'],
    r330b: ['Widerstand 330 Ω', 'Er bremst den Strom, damit LED 2 nicht kaputtgeht. Farbringe: orange – orange – braun = 330 Ohm.'],
    led1: ['LED 1', 'Eine Leuchtdiode. Sie leuchtet, wenn Strom durch sie fließt – aber nur in eine Richtung! Das lange Bein (+) zeigt zum Widerstand. Sie ist Fenster 1 der Mondbasis.'],
    led2: ['LED 2', 'Die zweite Leuchtdiode. Sie hängt an D2 und ist Fenster 2 der Mondbasis.'],
    schalter: ['Schalter', 'Jedes Mal, wenn du ihn umlegst, wechselt der Modus: Automatik → Dauer-an → Dauer-aus.'],
    plus: ['Rotes Kabel: 3,3 Volt (+)', 'Das ist Plus. Von hier bekommt der Lichtsensor seinen Strom.'],
    minus: ['Schwarzes Kabel: GND (−)', 'Das ist Minus (Masse). Hier fließt der Strom aus allen Zweigen zurück zum ESP32.'],
    d0: ['Gelbes Kabel: D0', 'Bringt die Spannung vom Lichtsensor zum Pin D0. Der ESP32 macht daraus eine Zahl von 0 bis 4095.'],
    d1: ['Oranges Kabel: D1', 'Wenn der ESP32 D1 einschaltet, fließt hier Strom zu LED 1.'],
    d2: ['Grünes Kabel: D2', 'Wenn der ESP32 D2 einschaltet, fließt hier Strom zu LED 2.'],
    d3: ['Blaues Kabel: D3', 'Verbindet den Schalter mit D3. Der ESP32 merkt so, ob der Schalter zu oder offen ist.'],
  };

  const SCHRITTE = [
    null,
    { titel: '1. Der Sensor misst', text: (d) => `Strom fließt von Plus durch den Lichtsensor und den 10-kΩ-Widerstand. An D0 misst der ESP32 gerade ${d.ldr}. Je dunkler es ist, desto kleiner wird die Zahl.` },
    { titel: '2. Der ESP32 entscheidet', text: (d) => `Ist die Zahl kleiner als ${MB.CONFIG.SCHWELLE_DUNKEL}, ist es dunkel. Erst über ${MB.CONFIG.SCHWELLE_HELL} gilt es wieder als hell. Gerade ist es ${d.dunkel ? 'dunkel 🌙' : 'hell ☀️'}${d.modus !== 'auto' ? ' – aber der Modus ist „' + (d.modus === 'on' ? 'Dauer-an' : 'Dauer-aus') + '“.' : '.'}` },
    { titel: '3. Die LEDs leuchten', text: (d) => d.led1 ? 'Der ESP32 schaltet D1 und D2 ein. Jetzt fließt viel Strom durch die Widerstände und die LEDs – sie leuchten! 💡' : 'Gerade sind D1 und D2 aus, also fließt kein Strom durch die LEDs. Mach es dunkel (Hand über den Sensor oder Regler nach links), dann leuchten sie!' },
  ];

  let svg, infoTitel, infoText, tour = {}, optionen = {};
  let teile = {};
  let daten = { ldr: 0, dunkel: false, led1: false, led2: false, schalter: false, modus: 'auto' };
  let schritt = 0;
  let sensorDauer = 0;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function text(parent, x, y, inhalt, klasse, anker) {
    const t = el('text', { x, y, class: klasse || 'beschriftung', 'text-anchor': anker || 'start' }, parent);
    t.textContent = inhalt;
    return t;
  }

  // Gruppe für ein anklickbares Bauteil
  function bauteil(parent, key, schritte) {
    return el('g', {
      class: 'bauteil teil', 'data-info': key, 'data-schritt': schritte || '',
      tabindex: '0', role: 'button', 'aria-label': INFOS[key][0],
    }, parent);
  }

  function kabel(parent, key, d, farbe, schritte) {
    const g = bauteil(parent, key, schritte);
    el('path', { d, class: 'treffer' }, g);
    el('path', { d, class: 'kabel', stroke: farbe }, g);
    return g;
  }

  // Senkrechter Widerstand mit Farbringen
  function widerstand(g, cx, y1, y2, ringe) {
    el('rect', { x: cx - 10, y: y1, width: 20, height: y2 - y1, rx: 9, class: 'widerstand-koerper' }, g);
    const h = y2 - y1;
    [0.24, 0.4, 0.56, 0.8].forEach((pos, i) => {
      el('rect', { x: cx - 10, y: y1 + h * pos - 3, width: 20, height: 6, fill: ringe[i] }, g);
    });
  }

  // LED von oben (+) nach unten (−)
  function led(g, cx, oben) {
    el('circle', { cx, cy: oben + 22, r: 34, class: 'led-schein', fill: 'url(#ledSchein)' }, g);
    el('path', { d: `M${cx - 13} ${oben + 40}V${oben + 14}A13 13 0 0 1 ${cx + 13} ${oben + 14}V${oben + 40}Z`, class: 'led-koerper' }, g);
    el('rect', { x: cx - 16, y: oben + 38, width: 32, height: 7, rx: 2, class: 'led-rand' }, g);
    el('path', { d: `M${cx - 7} ${oben + 16}a7 7 0 0 1 7 -7`, stroke: '#fff', 'stroke-opacity': '.7', 'stroke-width': 2, fill: 'none' }, g);
    text(g, cx - 22, oben + 8, '+', 'beschriftung', 'middle');
  }

  function aufbauen(container) {
    svg = el('svg', { viewBox: '0 0 900 520', role: 'img', 'aria-label': 'Bauplan: XIAO ESP32-S3 mit Lichtsensor, zwei LEDs und Schalter auf einem Steckbrett' });
    container.appendChild(svg);

    const defs = el('defs', {}, svg);
    const muster = el('pattern', { id: 'loecher', width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { x: 8, y: 8, width: 4, height: 4, rx: 1, fill: '#cfc6ae' }, muster);
    const ls = el('radialGradient', { id: 'ledSchein' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffe14d', 'stop-opacity': '.9' }, ls);
    el('stop', { offset: '1', 'stop-color': '#ffe14d', 'stop-opacity': '0' }, ls);
    const pfeil = el('marker', { id: 'pfeilspitze', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0 0L10 5L0 10Z', fill: '#ffae00' }, pfeil);

    // Steckbrett
    el('rect', { x: 270, y: 36, width: 612, height: 466, rx: 14, class: 'steckbrett' }, svg);
    el('rect', { x: 284, y: 92, width: 584, height: 356, fill: 'url(#loecher)' }, svg);
    text(svg, 868, 56, '+ 3,3 V', 'beschriftung', 'end').setAttribute('fill', '#c62828');
    text(svg, 868, 494, '− GND', 'beschriftung', 'end');

    // XIAO
    const xiao = bauteil(svg, 'xiao', '2');
    el('rect', { x: 119, y: 96, width: 50, height: 26, rx: 8, fill: '#9aa0aa' }, xiao);
    el('rect', { x: 50, y: 115, width: 188, height: 310, rx: 16, class: 'xiao-platine' }, xiao);
    el('rect', { x: 66, y: 190, width: 96, height: 130, rx: 6, fill: '#c9ced8', stroke: '#8e95a3', 'stroke-width': 2 }, xiao);
    text(xiao, 114, 250, 'ESP32', 'beschriftung', 'middle');
    text(xiao, 114, 270, '-S3', 'beschriftung', 'middle');
    teile.pins = {};
    for (const name in PIN_Y) {
      const y = PIN_Y[name];
      teile.pins[name] = el('rect', { x: 226, y: y - 9, width: 18, height: 18, rx: 4, class: 'pin' }, xiao);
      text(xiao, 216, y + 5, name, 'beschriftung-hell', 'end');
    }
    text(svg, 144, 455, 'XIAO ESP32-S3', 'beschriftung-hell', 'middle');

    // Kabel (unter den Bauteilen)
    kabel(svg, 'plus', `M${PIN_X} ${PIN_Y['3V3']}H255V${Y_PLUS}H860`, '#e53935', '1');
    kabel(svg, 'minus', `M${PIN_X} ${PIN_Y.GND}H260V${Y_MINUS}H860`, '#222', '3');
    kabel(svg, 'd0', `M${PIN_X} ${PIN_Y.D0}H${X_SENSOR}`, '#f2c200', '1');
    kabel(svg, 'd1', `M${PIN_X} ${PIN_Y.D1}H${X_LED1}V320`, '#ff8c1a', '3');
    kabel(svg, 'd2', `M${PIN_X} ${PIN_Y.D2}H${X_LED2}V320`, '#22a85a', '3');
    kabel(svg, 'd3', `M${PIN_X} ${PIN_Y.D3}H${X_SCHALTER}V378`, '#3b7bf6', '');
    el('circle', { cx: X_SENSOR, cy: PIN_Y.D0, r: 6, fill: '#222' }, svg);
    teile.messwert = text(svg, 300, 190, 'Messwert: –', 'messwert');

    // Lichtsensor
    const ldr = bauteil(svg, 'ldr', '1');
    el('path', { d: `M${X_SENSOR} ${Y_PLUS}V106M${X_SENSOR} 154V${PIN_Y.D0}`, class: 'bein' }, ldr);
    el('circle', { cx: X_SENSOR, cy: 130, r: 24, class: 'ldr-koerper' }, ldr);
    el('path', { d: 'M754 116H786V122H754V128H786V134H754V140H786', stroke: '#6b2f0e', 'stroke-width': 2.5, fill: 'none' }, ldr);
    teile.licht = el('g', { class: 'licht-pfeile' }, ldr);
    el('path', { d: 'M706 84L740 110', 'marker-end': 'url(#pfeilspitze)' }, teile.licht);
    el('path', { d: 'M700 112L738 128', 'marker-end': 'url(#pfeilspitze)' }, teile.licht);
    text(ldr, 802, 126, 'Licht-', 'beschriftung');
    text(ldr, 802, 144, 'sensor', 'beschriftung');

    // 10-kΩ-Widerstand
    const r10k = bauteil(svg, 'r10k', '1');
    el('path', { d: `M${X_SENSOR} ${PIN_Y.D0}V280M${X_SENSOR} 340V${Y_MINUS}`, class: 'bein' }, r10k);
    widerstand(r10k, X_SENSOR, 280, 340, ['#7a4a1f', '#111', '#ff8c1a', '#c9a227']);
    text(r10k, 790, 316, '10 kΩ', 'beschriftung');

    // LED-Zweige
    [['r330a', 'led1', X_LED1, 'LED 1'], ['r330b', 'led2', X_LED2, 'LED 2']].forEach(([rKey, lKey, x, name]) => {
      const r = bauteil(svg, rKey, '3');
      el('path', { d: `M${x} 365V385`, class: 'bein' }, r);
      widerstand(r, x, 320, 365, ['#ff8c1a', '#ff8c1a', '#7a4a1f', '#c9a227']);
      text(r, x + 18, 348, '330 Ω', 'beschriftung');
      const l = bauteil(svg, lKey, '3');
      l.classList.add('led');
      el('path', { d: `M${x} 430V${Y_MINUS}`, class: 'bein' }, l);
      led(l, x, 385);
      text(l, x + 22, 418, name, 'beschriftung');
      teile[lKey] = l;
    });

    // Schalter
    const sch = bauteil(svg, 'schalter', '');
    sch.classList.add('schalter');
    el('path', { d: `M${X_SCHALTER} 428V${Y_MINUS}`, class: 'bein' }, sch);
    el('rect', { x: 395, y: 376, width: 50, height: 52, rx: 8, class: 'schalter-koerper' }, sch);
    el('circle', { cx: X_SCHALTER, cy: 388, r: 4, fill: '#c9ccd4' }, sch);
    el('circle', { cx: X_SCHALTER, cy: 416, r: 5, fill: '#c9ccd4' }, sch);
    el('line', { x1: X_SCHALTER, y1: 416, x2: X_SCHALTER, y2: 388, class: 'schalter-hebel' }, sch);
    teile.schalterText = text(sch, 352, 405, 'offen', 'beschriftung', 'middle');
    teile.schalter = sch;

    // Stromfluss-Pfade (oben drauf, nicht anklickbar)
    const zurueck = `V${Y_MINUS}H260V${PIN_Y.GND}H${PIN_X}`;
    teile.fluss = {
      sensor: el('path', { d: `M${PIN_X} ${PIN_Y['3V3']}H255V${Y_PLUS}H${X_SENSOR}${zurueck}`, class: 'fluss fluss-sensor teil', 'data-schritt': '1' }, svg),
      led1: el('path', { d: `M${PIN_X} ${PIN_Y.D1}H${X_LED1}${zurueck}`, class: 'fluss fluss-led teil', 'data-schritt': '3' }, svg),
      led2: el('path', { d: `M${PIN_X} ${PIN_Y.D2}H${X_LED2}${zurueck}`, class: 'fluss fluss-led teil', 'data-schritt': '3' }, svg),
      schalter: el('path', { d: `M${PIN_X} ${PIN_Y.D3}H${X_SCHALTER}${zurueck}`, class: 'fluss fluss-schalter teil', 'data-schritt': '' }, svg),
    };
    teile.fluss.led1.style.setProperty('--dauer', '.5s');
    teile.fluss.led2.style.setProperty('--dauer', '.5s');
    teile.fluss.schalter.style.setProperty('--dauer', '3s');
  }

  // ---------- Infobox ----------

  function infoZeigen(g) {
    const key = g.dataset.info;
    const [titel, beschreibung] = INFOS[key];
    infoTitel.textContent = titel;
    let t = beschreibung;
    if (key === 'schalter') {
      t += optionen.istSimulation() ? ' In der Simulation kannst du ihn anklicken!' : ' Leg den echten Schalter um!';
    }
    infoText.textContent = t;
    svg.querySelectorAll('.bauteil.gewaehlt').forEach((b) => b.classList.remove('gewaehlt'));
    g.classList.add('gewaehlt');
  }

  function interaktionen() {
    svg.querySelectorAll('.bauteil').forEach((g) => {
      g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') infoZeigen(g); });
      g.addEventListener('focus', () => infoZeigen(g));
      g.addEventListener('click', () => {
        infoZeigen(g);
        if (g.dataset.info === 'schalter' && optionen.istSimulation()) optionen.onSchalter();
      });
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new MouseEvent('click')); }
      });
    });
  }

  // ---------- Schritt für Schritt ----------

  function tourZeigen() {
    svg.classList.remove('tour', 'schritt-1', 'schritt-2', 'schritt-3');
    tour.box.hidden = schritt === 0;
    tour.start.hidden = schritt !== 0;
    if (schritt === 0) return;
    svg.classList.add('tour', 'schritt-' + schritt);
    tour.titel.textContent = SCHRITTE[schritt].titel;
    tour.text.textContent = SCHRITTE[schritt].text(daten);
    tour.weiter.textContent = schritt < 3 ? 'Weiter ▸' : 'Nochmal von vorn ↺';
  }

  // ---------- Zustand ----------

  function setZustand(d) {
    daten = d;
    if (!svg) return;
    const f = teile.fluss;

    teile.led1.classList.toggle('an', d.led1);
    teile.led2.classList.toggle('an', d.led2);
    f.led1.classList.toggle('aktiv', d.led1);
    f.led2.classList.toggle('aktiv', d.led2);
    teile.pins.D1.classList.toggle('high', d.led1);
    teile.pins.D2.classList.toggle('high', d.led2);

    teile.schalter.classList.toggle('zu', d.schalter);
    teile.schalterText.textContent = d.schalter ? 'zu' : 'offen';
    f.schalter.classList.toggle('aktiv', d.schalter);

    // Sensorzweig fließt immer – bei viel Licht schneller (mehr Strom)
    const anteil = d.ldr / MB.CONFIG.ADC_MAX;
    const dauer = Math.round((4 - 2.8 * anteil) * 2) / 2;   // in 0,5-s-Schritten, damit es nicht ruckelt
    if (dauer !== sensorDauer) {
      sensorDauer = dauer;
      f.sensor.style.setProperty('--dauer', dauer + 's');
    }
    f.sensor.classList.add('aktiv');
    teile.licht.setAttribute('opacity', (0.12 + 0.88 * anteil).toFixed(2));
    teile.messwert.textContent = 'Messwert: ' + d.ldr;

    if (schritt) tour.text.textContent = SCHRITTE[schritt].text(d);
  }

  // Alien-Besuch: LED 2 flackert
  function setAlien(aktiv) {
    if (teile.led2) teile.led2.classList.toggle('flackert', aktiv);
  }

  function init(opts) {
    optionen = opts;
    infoTitel = opts.infoTitel;
    infoText = opts.infoText;
    tour = opts.tour;
    aufbauen(opts.container);
    interaktionen();

    tour.start.addEventListener('click', () => { schritt = 1; tourZeigen(); });
    tour.weiter.addEventListener('click', () => { schritt = schritt < 3 ? schritt + 1 : 1; tourZeigen(); });
    tour.ende.addEventListener('click', () => { schritt = 0; tourZeigen(); tour.start.focus(); });
  }

  window.MB = window.MB || {};
  window.MB.Bauplan = { init, setZustand, setAlien };
})();
