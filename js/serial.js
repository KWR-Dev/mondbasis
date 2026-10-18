/*
  serial.js – Verbindung zum ESP32 über die Web Serial API
  - Port wählen, öffnen, zeilenweise lesen und JSON parsen
  - Fehlerhafte Zeilen werden ignoriert
  - Kabel ab und wieder an: verbindet sich von selbst neu
*/
(function () {
  'use strict';

  const BAUDRATE = 115200;
  const KEINE_DATEN_MS = 3000;   // so lange ohne Daten -> Hinweis anzeigen
  const MODI = ['auto', 'on', 'off'];

  class SerialVerbindung {
    // onDaten(daten), onStatus(status, meldung, art)
    // status: 'verbinde' | 'verbunden' | 'getrennt' | 'frei' | 'fehler'
    constructor({ onDaten, onStatus }) {
      this.onDaten = onDaten;
      this.onStatus = onStatus;
      this.port = null;
      this.reader = null;
      this.lesen = null;
      this.vomNutzer = false;       // true = Nutzer hat auf „Trennen“ gedrückt
      this.wartetAufKabel = false;  // true = Kabel wurde abgezogen
      this.letzteDatenZeit = 0;
      this.ohneDatenGemeldet = false;
      this.sendeKette = Promise.resolve();

      if (SerialVerbindung.unterstuetzt()) {
        navigator.serial.addEventListener('connect', (e) => this._angesteckt(e.target));
        navigator.serial.addEventListener('disconnect', (e) => this._abgezogen(e.target));
      }

      // Mehrere Tabs mit dieser Seite: wer verbindet oder trennt, sagt den anderen Bescheid,
      // damit kein vergessener Tab den Port festhält
      this.kanal = 'BroadcastChannel' in window ? new BroadcastChannel('mondbasis-serial') : null;
      if (this.kanal) {
        this.kanal.onmessage = (e) => { if (e.data === 'freigeben') this._fremdFreigeben(); };
      }
      setInterval(() => this._datenPruefen(), 1000);
    }

    static unterstuetzt() {
      return 'serial' in navigator;
    }

    get verbunden() {
      return this.port !== null;
    }

    // Button „Mit ESP32 verbinden“
    async verbinden() {
      if (!window.isSecureContext) {
        this.onStatus('fehler', 'Web Serial braucht eine sichere Adresse. Öffne die Seite über http://localhost:8000 oder über https://.', 'fehler');
        return;
      }
      if (!SerialVerbindung.unterstuetzt()) {
        this.onStatus('fehler', 'Dein Browser kann leider nicht mit dem ESP32 sprechen. Nimm bitte Google Chrome oder Microsoft Edge auf einem Computer (nicht auf dem Handy oder Tablet). Die Simulation funktioniert aber überall!', 'fehler');
        return;
      }
      if (this.port) return;

      this._andereTabsFreigeben();
      let port;
      try {
        port = await navigator.serial.requestPort();
      } catch (e) {
        if (e.name === 'NotFoundError') {
          this.onStatus('fehler', 'Du hast kein Gerät ausgewählt. Ist der ESP32 mit dem USB-Kabel angesteckt? Dann nochmal auf „Mit ESP32 verbinden“ klicken.', 'warnung');
        } else {
          this.onStatus('fehler', 'Das hat nicht geklappt: ' + e.message, 'fehler');
        }
        return;
      }
      await this._oeffnen(port);
    }

    // Button „Trennen“: Port sauber freigeben (auch in anderen Tabs)
    async trennen(meldung) {
      this.wartetAufKabel = false;
      if (!meldung) this._andereTabsFreigeben();
      const port = this.port;
      if (!port) return;
      this.vomNutzer = true;
      if (this.reader) {
        try { await this.reader.cancel(); } catch (e) { /* egal */ }
      }
      try { await this.lesen; } catch (e) { /* egal */ }
      try { await this.sendeKette; } catch (e) { /* egal */ }
      try { await port.close(); } catch (e) { /* egal */ }
      this.port = null;
      this.onStatus('frei', meldung || 'Getrennt. Der Anschluss ist wieder frei – jetzt läuft wieder die Simulation.', 'info');
    }

    _andereTabsFreigeben() {
      if (this.kanal) this.kanal.postMessage('freigeben');
    }

    // Ein anderer Tab will den ESP32: hier loslassen und nicht mehr automatisch verbinden
    _fremdFreigeben() {
      const warAktiv = this.port || this.wartetAufKabel;
      this.wartetAufKabel = false;
      if (this.port) {
        this.trennen('Ein anderer Tab hat den ESP32 übernommen oder getrennt. Hier läuft jetzt die Simulation.');
      } else if (warAktiv) {
        this.onStatus('frei', 'Ein anderer Tab kümmert sich jetzt um den ESP32. Hier läuft die Simulation.', 'info');
      }
    }

    // Text an den ESP32 schicken, z. B. "MODE:auto\n"
    senden(text) {
      const port = this.port;
      if (!port || !port.writable) return Promise.resolve(false);
      this.sendeKette = this.sendeKette.then(async () => {
        if (!port.writable) return false;
        const writer = port.writable.getWriter();
        try {
          await writer.write(new TextEncoder().encode(text));
          return true;
        } catch (e) {
          return false;
        } finally {
          writer.releaseLock();
        }
      });
      return this.sendeKette;
    }

    // Eine Zeile prüfen und in ein sauberes Datenobjekt umwandeln (oder null)
    static pruefen(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (typeof obj.ldr !== 'number' || !Number.isFinite(obj.ldr)) return null;
      return {
        ldr: Math.round(Math.min(4095, Math.max(0, obj.ldr))),
        dunkel: obj.dunkel === true,
        led1: obj.led1 === true,
        led2: obj.led2 === true,
        schalter: obj.schalter === true,
        modus: MODI.includes(obj.modus) ? obj.modus : 'auto',
      };
    }

    // ---------- intern ----------

    async _oeffnen(port) {
      this.onStatus('verbinde', 'Verbinde mit dem ESP32 …', 'info');
      try {
        await port.open({ baudRate: BAUDRATE });
      } catch (e) {
        this.onStatus('fehler', 'Der Anschluss ist belegt. Bitte schließe den Seriellen Monitor der Arduino IDE (oder PlatformIO bzw. einen anderen Tab mit dieser Seite) und versuche es nochmal.', 'fehler');
        return false;
      }
      // DTR an, RTS aus: der ESP32-S3 sendet dann und wird nicht zurückgesetzt
      try { await port.setSignals({ dataTerminalReady: true, requestToSend: false }); } catch (e) { /* nicht schlimm */ }

      this.port = port;
      this.vomNutzer = false;
      this.wartetAufKabel = false;
      this.letzteDatenZeit = Date.now();
      this.ohneDatenGemeldet = false;
      this.onStatus('verbunden', 'Verbunden! Jetzt misst der echte Lichtsensor. 🎉', 'ok');
      this.lesen = this._leseSchleife(port);
      return true;
    }

    async _leseSchleife(port) {
      const decoder = new TextDecoder();
      let puffer = '';
      let verloren = false;

      while (port.readable && !this.vomNutzer && !verloren) {
        const reader = port.readable.getReader();
        this.reader = reader;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) {
              if (!this.vomNutzer) verloren = true;
              break;
            }
            puffer += decoder.decode(value, { stream: true });
            let i;
            while ((i = puffer.indexOf('\n')) >= 0) {
              this._zeile(puffer.slice(0, i));
              puffer = puffer.slice(i + 1);
            }
            if (puffer.length > 2000) puffer = '';   // Müll ohne Zeilenende verwerfen
          }
        } catch (e) {
          // Kleine Übertragungsfehler: weiterlesen. Gerät weg: port.readable wird null.
        } finally {
          reader.releaseLock();
          this.reader = null;
        }
      }

      if (!this.vomNutzer) await this._verloren(port);
    }

    _zeile(roh) {
      const zeile = roh.trim();
      if (!zeile.startsWith('{')) return;     // Debug-Texte o. Ä. ignorieren
      let obj;
      try { obj = JSON.parse(zeile); } catch (e) { return; }
      const daten = SerialVerbindung.pruefen(obj);
      if (!daten) return;

      this.letzteDatenZeit = Date.now();
      if (this.ohneDatenGemeldet) {
        this.ohneDatenGemeldet = false;
        this.onStatus('verbunden', 'Daten kommen an. 👍', 'ok');
      }
      this.onDaten(daten);
    }

    async _verloren(port) {
      try { await port.close(); } catch (e) { /* schon zu */ }
      if (this.port === port) this.port = null;
      this.wartetAufKabel = true;
      this.onStatus('getrennt', 'Getrennt. Wurde das Kabel abgezogen? Steck den ESP32 wieder an – die Seite verbindet sich dann von selbst. Bis dahin läuft die Simulation.', 'warnung');
    }

    _abgezogen(port) {
      if (port === this.port && this.reader) {
        this.reader.cancel().catch(() => {});
      }
    }

    async _angesteckt(port) {
      if (!this.wartetAufKabel || this.port) return;
      await new Promise((r) => setTimeout(r, 400));   // kurz warten, bis der Port bereit ist
      if (!this.wartetAufKabel || this.port) return;
      await this._oeffnen(port);
    }

    _datenPruefen() {
      if (!this.port || this.ohneDatenGemeldet) return;
      if (Date.now() - this.letzteDatenZeit > KEINE_DATEN_MS) {
        this.ohneDatenGemeldet = true;
        this.onStatus('verbunden', 'Verbunden, aber es kommen keine Daten an. Ist die Mondbasis-Firmware auf dem ESP32? Ist in der Arduino IDE „USB CDC On Boot: Enabled“ eingestellt?', 'warnung');
      }
    }
  }

  window.MB = window.MB || {};
  window.MB.SerialVerbindung = SerialVerbindung;
})();
