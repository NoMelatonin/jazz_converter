# Jazz Converter

Lokale macOS-App mit deutscher Oberfläche: MIDI oder MusicXML öffnen, ein spielbares Swing-Arrangement erstellen, anhören, mit fallenden Noten üben und MIDI speichern. Keine KI, kein Konto, kein Cloud-Dienst.

## App starten

Voraussetzung: macOS 14 oder neuer.

- **Apple Silicon (M1 und neuer):** `release/Jazz Converter-1.0.0-arm64.dmg`
- **Intel:** `release/Jazz Converter-1.0.0.dmg`

DMG öffnen, **Jazz Converter** nach **Programme** ziehen und starten. Die App ist lokal/ad hoc signiert und nicht Apple-notarisiert. Bei einer macOS-Sperre den Start unter **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen** bestätigen. Keine Sicherheitseinstellungen dauerhaft abschalten.

Zur Installation die DMGs verwenden. Node.js oder ein Terminal werden zur normalen Nutzung nicht benötigt. Die Apple-Silicon-App wurde direkt aus dem schreibgeschützten DMG getestet; ein nativer Intel-Lauf ist separat zu prüfen.

## Erster Song

1. Nach **Bruder Jakob** oder **Traditionell** suchen.
2. **Demo · Melodie mit Akkorden** wählen. Alternativ die mehrspurige MIDI-Version wählen und die Melodie per Hörprobe bestätigen.
3. **Einfach** oder **Mittel** wählen und **Swing-Arrangement erstellen** anklicken.
4. **Anhören**, **Üben** oder **MIDI speichern** nutzen.

Unter **So funktioniert’s → Demo-Dateien speichern** werden beide Quelldateien separat abgelegt. Sie liegen außerdem in `public/demo/`. Ihre neue Dateifassung und Ausgangsbegleitung sind unter CC0 1.0 freigegeben.

## Import und Katalog

- Dateiauswahl und Drag-and-drop: `.mid`, `.midi`, `.musicxml`, `.mxl`; maximal 20 MB pro Datei und 20 Dateien pro Vorgang.
- Alle importierten Songs werden in den lokalen Katalog kopiert. Originaldateien werden nicht verändert. Datei-Hashes verhindern doppelte Einträge; verschiedene Fassungen bleiben getrennt.
- Titel und Interpret/Komponist lassen sich über das Stiftsymbol bearbeiten.
- **Songs entdecken** durchsucht einen mitgelieferten Katalog mit drei ausgewählten Mutopia-MIDIs. Erst **Herunterladen** stellt eine Internetverbindung her. Quelle, Ausgabe und ausgewiesene Lizenz werden angezeigt und mitgespeichert.
- Bei mehrstimmigen Melodiespuren wird die obere Linie vorgeschlagen. Die Hörprobe spielt genau diese Linie; eine Spur kann gewechselt werden.
- Vorhandene Akkordsymbole werden genutzt. Sonst werden Akkorde aus Bass und Begleitung abgeleitet. Unsichere Stellen können pro Takt oder für einen Taktbereich korrigiert werden. Bei fehlenden Begleitdaten ist eine bewusste Bestätigung erforderlich.
- Akkorde verwenden internationale Symbole: **B = deutsches H**, **Bb = deutsches B**. Unterstützt: Dur, Moll, 7, maj7, m7, dim, dim7, ø7, aug, sus2, sus4, 6, m6 sowie Slash-Bässe.

## Spielbarkeit und Export

| Stufe   | Griffweite je Hand           | Links gleichzeitig | Rechts gleichzeitig |
| ------- | ---------------------------- | ------------------ | ------------------- |
| Einfach | maximal 7 Halbtöne (Quinte)  | 2                  | 3                   |
| Mittel  | maximal 12 Halbtöne (Oktave) | 3                  | 4                   |

Die Prüfung zählt auch noch gehaltene Töne. Die Begleitung wird zuerst vereinfacht. Ganze Melodiephrasen dürfen oktaviert werden; die App zeigt diese Änderungen an. Die Tonfolge bleibt erhalten. Swing betrifft geeignete gerade Achtelpaare, nicht Triolen oder schon geswingte Noten.

Das MIDI ist **Standard-MIDI Typ 1** mit einer Metadatenspur und je einer Notenspur **Linke Hand** und **Rechte Hand**. Beide verwenden ausschließlich General MIDI **Acoustic Grand Piano, Programm 0**. Tempo und Taktwechsel bleiben enthalten. Die Zeitauflösung ist 960 Ticks pro Viertel; feinere Quellzeiten werden beim Export deterministisch gerundet.

Identische Quelldaten, Melodieauswahl, Akkordkorrekturen, Einstellungen und Engine-Version ergeben identische MIDI-Bytes. Übetempo, Position und Handauswahl beeinflussen den Export nicht.

## Üben

88 Tasten von A0 bis C8; links blau, rechts orange. Die Balken zeigen Start und Dauer. Wiedergabe, Animation und Export verwenden dieselben Arrangementnoten und dieselbe Tempokarte.

- Play/Pause, Positionssprung, 25–100 % Tempo ohne Tonhöhenänderung.
- Hände gemeinsam oder einzeln; Wiederholung eines Taktbereichs.
- Nach Sprüngen und Tempowechseln werden veraltete Klänge abgebrochen und noch gehaltene Noten wiederhergestellt.
- Die Darstellung orientiert sich an der Audio-Ausgabezeit. Bei mehreren offenen Hörproben spielt immer nur ein Player.
- Ein angeschlossenes Keyboard wird nicht vorausgesetzt. Keyboard-Eingabe, Fingersätze und Notenblattausgabe sind nicht Teil dieser Version.

## Bekannte Importgrenzen

MIDI Typ 0/1 mit musikalischer Zeitbasis wird unterstützt. Typ 2, SMPTE-MIDI und reine Schlagzeugdateien werden verständlich abgewiesen. MIDI kennt normalerweise keine Auftakt- oder Wiederholungsnotation; hier gilt die bereits ausgeschriebene Ereignisfolge, mit vorhandenen Markern und Taktwechseln.

MusicXML unterstützt Partwise/Timewise, MXL-Container, Stimmen, Pausen, Auftakte, Bindungen, Tempo-/Taktwechsel und normale Wiederholungen einschließlich erster/zweiter Endungen. Standard-DTD-Verweise werden ohne Netzwerkzugriff ignoriert; interne DTD-Entitäten werden abgewiesen. Vorschlagsnoten, D.C./D.S./Coda und veränderte Akkorderweiterungen müssen vorher ausgeschrieben beziehungsweise vereinfacht oder als MIDI importiert werden. Für solche Fälle gibt es Fehlermeldungen statt einer stillen musikalischen Änderung.

Spracheingabe, PDF-Erkennung und MP3-Transkription gehören in spätere Ausbaustufen. Die automatische Harmonisierung ist ein regelbasierter Vorschlag; die Hörprobe und Korrekturmöglichkeit sind bei fremden Dateien wesentlich.

## Entwicklung

Node.js 24 und npm; macOS zum Paketieren.

```sh
npm ci
npm run dev
```

Die Klaviersamples und Lizenztexte sind bereits im Repository enthalten. Die laufende App lädt sie niemals aus dem Internet nach.

```sh
npm test                 # Import, musikalische Regeln, Export und Transport
npm run build            # Typprüfung, Lizenztexte und Produktionsbuild
npm run test:e2e         # echte Electron-App, vollständig offline
npm run verify:online    # drei echte Direktdownloads und beide Stufen
npm run verify:package   # DMGs einhängen, Signaturen und arm64-Offlineablauf prüfen
npm run package          # DMGs für arm64 und x64, ad hoc signiert
npm run package:local    # entpackte arm64-App
npm run previews         # Demoquellen, MIDI-Ausgaben und WAV-Hörproben
```

`npm run assets` lädt die Sampledateien und einen im npm-Tarball fehlenden Upstream-Lizenztext bei Bedarf erneut; nur dieses Entwicklungsskript benötigt dafür Internet. `npm run icon` rendert das eigene SVG als macOS-Symbol. `previews` verwendet den macOS-Konverter `afconvert` und Python 3 mit Standardbibliothek.

Für einen Test einer installierten App kann `JAZZ_TEST_EXECUTABLE` auf deren `Contents/MacOS/Jazz Converter` zeigen. `JAZZ_DATA_DIR` setzt ein separates Katalogverzeichnis; `JAZZ_TEST_OFFLINE=1` sperrt externe HTTP-Anfragen und Online-Downloads im Testlauf.

Der Paketbau läuft in einem temporären Verzeichnis außerhalb von Desktop/iCloud und kopiert anschließend die Artefakte nach `release/`. File Provider kann entpackten App-Bundles auf dem Desktop Finder-Metadaten anhängen und deren Signaturprüfung stören. Deshalb werden die DMGs geprüft und ausgeliefert; die entpackten Projektkopien unter `release/mac*` dienen nur als Zwischenartefakte.

## Aufbau und lokale Daten

- `src/core/`: rationale Notenzeiten, Import, Melodievorschlag, Harmonie, Arrangement, MIDI und Transport; unabhängig von React und Electron.
- `desktop/`: isolierte IPC-Schnittstelle, Worker-Verarbeitung, native Dateidialoge, atomare Katalogdateien und geprüfte Download-IDs.
- `src/components/`: Canvas-Klaviatur und Player; das lokale Sample-Klavier liegt in `src/audio.ts`.

Der Katalog liegt standardmäßig in `~/Library/Application Support/Jazz Converter/songs/`. Pro Quelldatei werden die unveränderten Bytes und eine JSON-Datei mit Metadaten, musikalischem Modell und zuletzt erfolgreich konvertierten Einstellungen gespeichert. Es gibt keine Telemetrie und keine automatischen Updates.

Quellen und Lizenzen stehen in der App sowie in `public/piano/LICENSE.txt`, `public/demo/LICENSE.txt` und `public/licenses/`. Electron bringt eigene Lizenztexte im App-Paket mit. Die Abnahme und verbleibende manuelle Prüfungen sind in [ABNAHME.md](ABNAHME.md) dokumentiert.
