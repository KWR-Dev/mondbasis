/*
  Mondbasis – Firmware für Seeed Studio XIAO ESP32-S3

  - LDR an D0 wird alle 100 ms gelesen und geglättet
  - Hell/Dunkel mit Hysterese, bei Dunkelheit leuchten LED 1 + LED 2
  - Schalter an D3 wechselt den Modus: Automatik -> Dauer-an -> Dauer-aus
  - Alle 200 ms genau eine JSON-Zeile für die Webseite, z. B.:
    {"ldr":2310,"dunkel":true,"led1":true,"led2":true,"schalter":false,"modus":"auto"}
  - Befehle von der Webseite (jeweils mit \n): MODE:auto  MODE:on  MODE:off
    ALIEN:on / ALIEN:off – Alien-Besuch: LED 2 flackert (stoppt spätestens nach 20 s)

  WICHTIG (Arduino IDE): Werkzeuge -> "USB CDC On Boot: Enabled" einstellen,
  sonst kommt über das USB-Kabel nichts an.
*/

// #define DEBUG   // Debug-Texte einschalten (die Webseite ignoriert sie, besser aber aus lassen)

#ifdef DEBUG
  #define DEBUG_PRINTLN(x) Serial.println(x)
#else
  #define DEBUG_PRINTLN(x)
#endif

// ---------- Pins ----------
const uint8_t PIN_LDR      = D0;   // 3V3 -> LDR -> D0 -> 10 kΩ -> GND
const uint8_t PIN_LED1     = D1;   // aktiv HIGH
const uint8_t PIN_LED2     = D2;   // aktiv HIGH
const uint8_t PIN_SCHALTER = D3;   // schaltet gegen GND (INPUT_PULLUP)

// ---------- Schwellwerte (ADC 0..4095, hell = hoher Wert) ----------
// Gleiche Werte auch in js/main.js (CONFIG) eintragen!
const int SCHWELLE_DUNKEL = 1200;  // darunter -> dunkel
const int SCHWELLE_HELL   = 1600;  // darüber -> hell

// ---------- Schalter-Art ----------
// true:  Kippschalter – jedes Umlegen (beide Richtungen) wechselt den Modus
// false: Taster – nur das Drücken wechselt den Modus
const bool KIPPSCHALTER = true;

// ---------- Zeiten (ms) ----------
const unsigned long MESS_INTERVALL  = 100;  // LDR lesen
const unsigned long SENDE_INTERVALL = 200;  // JSON-Zeile senden
const unsigned long ENTPRELL_ZEIT   = 50;   // Schalter-Entprellung
const unsigned long ALIEN_MAX_DAUER = 20000; // Sicherheit: Flackern endet von selbst

// ---------- Glättung ----------
const uint8_t ANZAHL_MESSUNGEN = 10;  // gleitender Mittelwert über 1 s

// ---------- Modi ----------
enum Modus { AUTO, DAUER_AN, DAUER_AUS };
const char* MODUS_JSON[] = { "auto", "on", "off" };

// ---------- Zustand ----------
Modus modus = AUTO;
bool istDunkel = false;
bool ledsAn = false;

int messwerte[ANZAHL_MESSUNGEN];
uint8_t messIndex = 0;
long messSumme = 0;
int ldrGeglaettet = 0;

bool schalterStabil = HIGH;          // entprellter Zustand (LOW = geschlossen)
bool schalterLetzterRoh = HIGH;
unsigned long schalterWechselZeit = 0;

bool alienAktiv = false;             // Alien-Besuch: LED 2 flackert
unsigned long alienStart = 0;
unsigned long naechstesFlackern = 0;
bool flackerZustand = false;

char befehl[24];                     // Puffer für Befehle von der Webseite
uint8_t befehlLaenge = 0;

unsigned long letzteMessung = 0;
unsigned long letzteSendung = 0;
bool sofortSenden = false;

void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED1, OUTPUT);
  pinMode(PIN_LED2, OUTPUT);
  pinMode(PIN_SCHALTER, INPUT_PULLUP);

  analogReadResolution(12);  // 0..4095

  // Schalterstellung beim Start übernehmen (kein falscher Moduswechsel)
  schalterStabil = schalterLetzterRoh = digitalRead(PIN_SCHALTER);

  // Mittelwert-Puffer mit erster Messung füllen
  int start = analogRead(PIN_LDR);
  for (uint8_t i = 0; i < ANZAHL_MESSUNGEN; i++) messwerte[i] = start;
  messSumme = (long)start * ANZAHL_MESSUNGEN;
  ldrGeglaettet = start;
  istDunkel = (start < SCHWELLE_DUNKEL);

  DEBUG_PRINTLN("Mondbasis gestartet");
}

void loop() {
  unsigned long jetzt = millis();

  befehleLesen();
  schalterPruefen(jetzt);

  if (jetzt - letzteMessung >= MESS_INTERVALL) {
    letzteMessung = jetzt;
    ldrMessen();
    helligkeitAuswerten();
  }

  ledsSteuern();

  if (sofortSenden || jetzt - letzteSendung >= SENDE_INTERVALL) {
    letzteSendung = jetzt;
    sofortSenden = false;
    statusSenden();
  }
}

// LDR lesen und gleitenden Mittelwert bilden
void ldrMessen() {
  int roh = analogRead(PIN_LDR);
  messSumme -= messwerte[messIndex];
  messwerte[messIndex] = roh;
  messSumme += roh;
  messIndex = (messIndex + 1) % ANZAHL_MESSUNGEN;
  ldrGeglaettet = messSumme / ANZAHL_MESSUNGEN;
}

// Hysterese: Zustand wechselt nur beim Überschreiten der jeweiligen Schwelle
void helligkeitAuswerten() {
  if (!istDunkel && ldrGeglaettet < SCHWELLE_DUNKEL) {
    istDunkel = true;
  } else if (istDunkel && ldrGeglaettet > SCHWELLE_HELL) {
    istDunkel = false;
  }
}

// Nächsten Modus wählen: Automatik -> Dauer-an -> Dauer-aus -> Automatik
void naechsterModus() {
  modus = (Modus)((modus + 1) % 3);
  sofortSenden = true;
  DEBUG_PRINTLN(MODUS_JSON[modus]);
}

// Schalter entprellen und auswerten
void schalterPruefen(unsigned long jetzt) {
  bool roh = digitalRead(PIN_SCHALTER);

  if (roh != schalterLetzterRoh) {      // Pegel hat sich geändert -> Timer neu
    schalterLetzterRoh = roh;
    schalterWechselZeit = jetzt;
  }

  if (jetzt - schalterWechselZeit >= ENTPRELL_ZEIT && roh != schalterStabil) {
    schalterStabil = roh;
    if (KIPPSCHALTER || schalterStabil == LOW) naechsterModus();
    sofortSenden = true;
  }
}

// Befehle von der Webseite zeilenweise einlesen (nicht blockierend)
void befehleLesen() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (befehlLaenge > 0) {
        befehl[befehlLaenge] = '\0';
        befehlAusfuehren(befehl);
        befehlLaenge = 0;
      }
    } else if (befehlLaenge < sizeof(befehl) - 1) {
      befehl[befehlLaenge++] = c;
    }
  }
}

void befehlAusfuehren(const char* b) {
  if      (strcmp(b, "MODE:auto") == 0) modus = AUTO;
  else if (strcmp(b, "MODE:on") == 0)   modus = DAUER_AN;
  else if (strcmp(b, "MODE:off") == 0)  modus = DAUER_AUS;
  else if (strcmp(b, "ALIEN:on") == 0)  { alienAktiv = true; alienStart = millis(); }
  else if (strcmp(b, "ALIEN:off") == 0) alienAktiv = false;
  else return;                          // unbekannte Befehle ignorieren
  sofortSenden = true;
}

// LEDs je nach Modus schalten
void ledsSteuern() {
  switch (modus) {
    case AUTO:      ledsAn = istDunkel; break;
    case DAUER_AN:  ledsAn = true;      break;
    case DAUER_AUS: ledsAn = false;     break;
  }
  digitalWrite(PIN_LED1, ledsAn ? HIGH : LOW);

  // Alien-Besuch: LED 2 flackert zufällig (nicht blockierend)
  unsigned long jetzt = millis();
  if (alienAktiv && jetzt - alienStart > ALIEN_MAX_DAUER) alienAktiv = false;
  if (alienAktiv) {
    if ((long)(jetzt - naechstesFlackern) >= 0) {
      flackerZustand = !flackerZustand;
      naechstesFlackern = jetzt + random(30, 160);
    }
    digitalWrite(PIN_LED2, flackerZustand ? HIGH : LOW);
  } else {
    digitalWrite(PIN_LED2, ledsAn ? HIGH : LOW);
  }
}

// Genau eine JSON-Zeile senden
void statusSenden() {
  char zeile[128];
  int n = snprintf(zeile, sizeof(zeile),
    "{\"ldr\":%d,\"dunkel\":%s,\"led1\":%s,\"led2\":%s,\"schalter\":%s,\"modus\":\"%s\",\"alien\":%s}\n",
    ldrGeglaettet,
    istDunkel ? "true" : "false",
    ledsAn ? "true" : "false",
    ledsAn ? "true" : "false",
    schalterStabil == LOW ? "true" : "false",
    MODUS_JSON[modus],
    alienAktiv ? "true" : "false");

  // Nur senden, wenn Platz im Puffer ist – so blockiert nichts ohne angeschlossenen PC
  if (n > 0 && Serial.availableForWrite() >= n) {
    Serial.write((const uint8_t*)zeile, n);
  }
}
