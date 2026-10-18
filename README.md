# 🚀 Mondbasis – Lichtsensor-Werkstatt

Eine Webseite mit animierter Mondbasis und Rakete, die live auf einen Lichtsensor reagiert.
Der Sensor hängt an einem **Seeed XIAO ESP32-S3**, der per USB-Kabel mit dem Rechner verbunden ist.
Im Tab **Bauplan** siehst du die Schaltung und wie der Strom fließt.

Ohne Hardware läuft die Seite im **Simulationsmodus**: Ein Schieberegler ersetzt dann den Lichtsensor.

## Was passiert?

| Es ist … | Mondbasis | Rakete |
|----------|-----------|--------|
| hell ☀️  | Fenster aus, Himmel blau | steht auf der Startrampe |
| dunkel 🌙 | Fenster gehen nacheinander an, Sterne funkeln | Countdown 3-2-1, Start! |
| wieder hell | Fenster gehen aus | landet sanft auf der Rampe |

Fenster 1 = LED 1, Fenster 2 = LED 2.

**👽 Aliens rufen:** Nachts kommt auf Knopfdruck ein UFO, beamt ein Alien auf den Mond, das winkt und
fliegt wieder weg. Solange das UFO da ist, flackert LED 2 – auf der Webseite und an der echten LED.
Tagsüber sind die Aliens zu schüchtern.

## Bauteile und Verdrahtung

| Pin | Bauteil | Verdrahtung |
|-----|---------|-------------|
| D0  | Lichtsensor (LDR) | 3V3 → LDR → D0 → 10 kΩ → GND |
| D1  | LED 1 | D1 → 330 Ω → LED (langes Bein) → GND |
| D2  | LED 2 | D2 → 330 Ω → LED (langes Bein) → GND |
| D3  | Schalter | D3 → Schalter → GND (interner Pull-up) |

**Schalter:** Jedes Umlegen wechselt den Modus: Automatik → Dauer-an → Dauer-aus.
Nutzt du einen Taster statt eines Kippschalters, setze in der Firmware `KIPPSCHALTER = false`.

## Projektstruktur

```
index.html                       Die Webseite
css/style.css                    Aussehen
js/serial.js                     Verbindung zum ESP32 (Web Serial)
js/scene.js                      Mondbasis und Rakete
js/schematic.js                  Bauplan mit Stromfluss
js/main.js                       Zustand, Simulation, Bedienung
firmware/mondbasis/mondbasis.ino Programm für den ESP32
.nojekyll                        Für GitHub Pages
```

## 1. Firmware hochladen (Arduino IDE 2.x)

1. **Board-Paket installieren:** Werkzeuge → Board → Boardverwalter → nach `esp32` suchen →
   **„esp32 von Espressif Systems“** installieren.
   Falls es nicht gefunden wird: Datei → Einstellungen → „Zusätzliche Boardverwalter-URLs“:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. **Board wählen:** Werkzeuge → Board → esp32 → **XIAO_ESP32S3**
3. **Wichtig:** Werkzeuge → **USB CDC On Boot: Enabled**
   (sonst kommen über das USB-Kabel keine Daten an)
4. Werkzeuge → Port → den Port des XIAO wählen (z. B. `COM5` unter Windows)
5. `firmware/mondbasis/mondbasis.ino` öffnen und auf **Hochladen** klicken.

Klappt das Hochladen nicht: **BOOT**-Taste am XIAO gedrückt halten, kurz **RESET** drücken,
BOOT loslassen und nochmal hochladen.

Die Firmware schickt alle 200 ms genau eine Zeile wie diese:

```json
{"ldr":2310,"dunkel":true,"led1":true,"led2":true,"schalter":false,"modus":"auto","alien":false}
```

Befehle von der Webseite (jeweils mit Zeilenende):

| Befehl | Wirkung |
|--------|---------|
| `MODE:auto` / `MODE:on` / `MODE:off` | Modus umschalten |
| `ALIEN:on` / `ALIEN:off` | LED 2 flackern lassen (endet spätestens nach 20 s von selbst) |

### Schwellwerte anpassen

Im Seriellen Monitor (115200 Baud) siehst du den Wert `ldr`. Miss ihn bei der Helligkeit, ab der das
Licht angehen soll, und trage ihn als `SCHWELLE_DUNKEL` ein. `SCHWELLE_HELL` setzt du etwa 300–500 höher.
**Trage dieselben Werte auch oben in `js/main.js` (CONFIG) ein**, damit Balken und Simulation passen.
Danach den Seriellen Monitor wieder schließen, sonst ist der Port belegt.

## 2. Lokal starten

Web Serial funktioniert nur über `localhost` oder `https://`, nicht durch Doppelklick auf die Datei.
Im Projektordner einen kleinen Webserver starten:

```bash
python -m http.server 8000
```

Dann im Browser **http://localhost:8000** öffnen. Auf **„Mit ESP32 verbinden“** klicken und den Port wählen.

Unterstützte Browser: **Google Chrome** oder **Microsoft Edge** am Computer.
(Firefox, Safari und Handys können kein Web Serial – die Simulation läuft dort aber trotzdem.)

## 3. Veröffentlichen auf GitHub Pages

1. Alle Dateien in ein GitHub-Repository hochladen (die Datei `.nojekyll` mit!).
2. Im Repository: **Settings → Pages**
3. Bei „Build and deployment“: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → **Save**.
4. Nach ein bis zwei Minuten ist die Seite unter `https://<dein-name>.github.io/<repo-name>/` erreichbar.

GitHub Pages nutzt HTTPS, deshalb funktioniert dort auch die Verbindung zum ESP32.

## Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| „Der Anschluss ist belegt“ | Seriellen Monitor der Arduino IDE schließen (auch PlatformIO-Monitor oder einen zweiten Tab mit der Seite). Dann nochmal verbinden. |
| Kein Port in der Liste | USB-Kabel prüfen – manche Kabel laden nur und übertragen keine Daten. Anderen USB-Anschluss probieren. Unter Windows im Geräte-Manager nach „Serielles USB-Gerät“ schauen. |
| Verbunden, aber keine Daten | Ist die Mondbasis-Firmware hochgeladen? Ist **USB CDC On Boot: Enabled** eingestellt? Einmal RESET am XIAO drücken. |
| „Dein Browser kann nicht …“ | Chrome oder Edge am Computer verwenden. |
| „Sichere Adresse nötig“ | Seite über `http://localhost:8000` oder GitHub Pages öffnen, nicht als Datei. |
| Kabel abgezogen | Status zeigt „Getrennt“. Wieder anstecken – die Seite verbindet sich von selbst neu. |
| Wert bleibt immer bei 4095 | Der 10-kΩ-Widerstand von D0 nach GND fehlt oder hat keinen Kontakt. |
| Modus wechselt beim Start | Bei Tastern `KIPPSCHALTER = false` setzen. |

## Barrierefreiheit

Wer im Betriebssystem „Bewegung reduzieren“ eingeschaltet hat, bekommt eine ruhigere Seite ohne Wackeln,
Rauch und wandernde Punkte.
