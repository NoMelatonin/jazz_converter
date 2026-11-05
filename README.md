# Jazz Converter

Lokale macOS-App mit deutscher Oberfläche: PDF-Notenblätter, MIDI oder MusicXML öffnen, auf Klavierspielbarkeit prüfen, bei Bedarf eine Klavierfassung erzeugen und optional als Swing arrangieren. Anhören, mit fallenden Noten üben, MIDI und MusicXML speichern. Kein Konto und kein Cloud-Dienst. Die PDF-Erkennung verwendet mitgelieferte lokale Modelle; das Arrangement folgt festen Regeln.

**Architektur verstehen:** [ARCHITEKTUR.md](ARCHITEKTUR.md) erklärt den Aufbau und den Software-Stack in vier Lesestufen – vom Überblick ohne Programmierwissen bis zu den Algorithmen.

## App starten

Voraussetzung: macOS 14 oder neuer.

- **Apple Silicon (M1 und neuer):** `release/Jazz Converter-2.1.0-arm64.dmg`
- **Intel:** `release/Jazz Converter-2.1.0.dmg`

DMG öffnen, **Jazz Converter** nach **Programme** ziehen und starten. Die App ist lokal/ad hoc signiert und nicht Apple-notarisiert. Bei einer macOS-Sperre den Start unter **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen** bestätigen. Keine Sicherheitseinstellungen dauerhaft abschalten.

Zur Installation die DMGs verwenden. Node.js oder ein Terminal werden zur normalen Nutzung nicht benötigt. Die Apple-Silicon-App wurde direkt aus dem schreibgeschützten DMG getestet; ein nativer Intel-Lauf ist separat zu prüfen.

## Erster Song

1. Nach **Bruder Jakob** oder **Traditionell** suchen.
2. **Demo · Melodie mit Akkorden** wählen. Alternativ die mehrspurige MIDI-Version wählen und die Melodie per Hörprobe bestätigen.
3. **Einfach** oder **Mittel** wählen und **Swing-Arrangement erstellen** anklicken.
4. **Anhören**, **Üben** oder **MIDI speichern** nutzen.

Unter **So funktioniert’s → Demo-Dateien speichern** werden beide Quelldateien separat abgelegt. Sie liegen außerdem in `public/demo/`. Ihre neue Dateifassung und Ausgangsbegleitung sind unter CC0 1.0 freigegeben.

## Import und Katalog

- Dateiauswahl und Drag-and-drop: `.pdf`, `.mid`, `.midi`, `.musicxml`, `.mxl`; MIDI/XML maximal 20 MB, PDF maximal 100 MB, insgesamt höchstens 20 Dateien pro Vorgang.
- Alle importierten Songs werden in den lokalen Katalog kopiert. Originaldateien werden nicht verändert. Datei-Hashes verhindern doppelte Einträge; verschiedene Fassungen bleiben getrennt.
- Titel und Interpret/Komponist lassen sich über das Stiftsymbol bearbeiten.
- **Songs entdecken** durchsucht einen mitgelieferten Katalog mit drei ausgewählten Mutopia-MIDIs. Erst **Herunterladen** stellt eine Internetverbindung her. Quelle, Ausgabe und ausgewiesene Lizenz werden angezeigt und mitgespeichert.
- Bei mehrstimmigen Melodiespuren wird die obere Linie vorgeschlagen. Die Hörprobe spielt genau diese Linie; eine Spur kann gewechselt werden.
- Vorhandene Akkordsymbole werden genutzt. Sonst werden Akkorde aus Bass und Begleitung abgeleitet. Unsichere Stellen können pro Takt oder für einen Taktbereich korrigiert werden. Bei fehlenden Begleitdaten ist eine bewusste Bestätigung erforderlich.
- Akkorde verwenden internationale Symbole: **B = deutsches H**, **Bb = deutsches B**. Unterstützt: Dur, Moll, 7, maj7, m7, dim, dim7, ø7, aug, sus2, sus4, 6, m6 sowie Slash-Bässe.

## PDF-Notenblätter und Klavierfassung

1. **Datei öffnen** oder PDF hineinziehen. Gedruckte Partituren und gut lesbare Scans werden unterstützt; 300 dpi sind für Scans sinnvoll.
2. Vorschau ansehen, Notenseiten auswählen und gegebenenfalls drehen. Maximal 200 Seiten pro Auftrag; Deckblätter auslassen.
3. **Noten erkennen** starten. Audiveris 5.11.0 und Tesseract arbeiten mit mitgelieferter Java-Laufzeit und Modellen vollständig lokal. Fortschritt, Abbrechen und erneuter Versuch sind verfügbar.
4. Die App prüft Instrumente, klingende Tonhöhen und Handbelegung. Passen alle Noten auf zwei Hände, wird das Original übernommen. Andernfalls entsteht automatisch eine Klavierfassung in **Einfach**; **Mittel** und eine andere Melodiestimme lassen sich auswählen.
5. Unter **Noten prüfen** Original und erkannte Noten vergleichen. Tonhöhe, Beginn, Länge, Pausen, Stimme, Notensystem, Taktmaß und Instrumententransposition lassen sich korrigieren. Blockierende Erkennungsprobleme müssen vor dem Arrangement geprüft werden.
6. Direkt **Anhören**, **Üben**, **MIDI speichern** oder **MusicXML speichern** nutzen. **Erkannte Partitur speichern** exportiert die volle, gegebenenfalls korrigierte Quelle. **Als Swing arrangieren** ist ein zusätzlicher Schritt.

Die unveränderte Zuordnung erlaubt bis zu fünf Töne und zwölf Halbtöne Griffweite je Hand, einschließlich gehaltener Tasten, im Bereich A0–C8. Exakte Unisono-Verdopplungen werden zusammengefasst. Die Instrumentenanzahl allein entscheidet nicht: Auch ein kleines Ensemble kann vollständig auf zwei Hände passen; ein sehr weit gesetztes Klavierstück kann eine Reduktion benötigen. Schnelle Sprünge brauchen zusätzlich eine Prüfung des Spieltempos.

Die Reduktion verfolgt die Melodie taktweise, auch bei Instrumentwechsel, und übernimmt Bass sowie harmonische Quellnoten. Ganze Melodiephrasen können oktaviert werden. Die folgenden Einfach-/Mittel-Grenzen gelten für Reduktion und Swing; Originalnoten werden nicht automatisch auf Einfach vereinfacht.

Notenerkennung ist fehlbar. Die Referenztests enthalten auch PDFs mit tatsächlich falsch gelesenen Taktzeichen; die daraus entstehenden überfüllten Takte werden erkannt und zur Prüfung angehalten. Nicht jeder falsche Einzelton lässt sich automatisch erkennen. Original-PDF und rohes Erkennungsergebnis bleiben erhalten. MusicXML exportiert die normalisierte Musik, während das ursprüngliche Drucklayout im PDF bleibt.

## Video → bearbeitbare Klaviernoten (2.1.0)

1. **Video importieren → Lokale Videoverarbeitung einrichten**. Einmalig ungefähr 500 MB Internetdownload, mindestens 3 GB freier Platz. Das Modell allein belegt 172 MB; mit Laufzeit und Installationscache waren es im Test rund 2,1 GB. Kein Python-Terminal, Konto, API-Schlüssel oder kostenpflichtiger Dienst erforderlich.
2. YouTube-Link laden oder **Lokale Videodatei öffnen** wählen. Unterstützt: MP4, MOV, MKV, WebM, maximal 2 GB / 30 Minuten; einzelne YouTube-Videos, keine Playlists oder Livestreams. Bei privaten, gesperrten oder anmeldungsgebundenen Quellen eine rechtmäßig vorliegende lokale Datei nutzen.
3. Drei Vorschaubilder prüfen. Für normale Klavieraufnahmen **Audio** wählen. Für feste Ansichten mit farbigen fallenden Noten **Bild** wählen und im Bild C4, C5 sowie die Anschlaglinie unmittelbar oberhalb der Tasten markieren. Die Referenzen müssen die wirklichen Tonhöhen bezeichnen. Ein optionaler Bild-/Tonversatz korrigiert vorlaufende Balken (positiv = späterer Einsatz). Kamerafahrten, Perspektivwechsel und wechselnde Klaviaturen sind für diese Bilderkennung ungeeignet.
4. **Transkribieren**. Fortschritt und Abbrechen stehen beim Laden, Einrichten und Erkennen zur Verfügung. Nach erfolgreicher Validierung wird eine neue **Transkription des Videos** gespeichert. **Transkription anhören und prüfen** öffnet die vollständigen erkannten Noten, ohne automatische Reduktion.
5. **Noten prüfen** erlaubt Tonhöhen, Beginn und Dauer zu korrigieren. Niedrige Erkennungswerte werden markiert; hohe Werte garantieren keine Richtigkeit. **MIDI speichern** und **MusicXML speichern** exportieren dieselbe gespeicherte Fassung wie der Player.
6. Vor Jazzumwandlung die Hörkontrolle bestätigen. Für eine passende Begleitung bei Bedarf **Tempo der Begleitung / Taktmaß → Zeitbasis zuordnen** verwenden: Dies setzt ein metrisches Raster, erhält aber die absoluten Aufnahmezeiten. Automatische Achtel-Swingverschiebung ist für Videotranskriptionen ausgeschaltet.

Die erste Zeitbasis ist 60 BPM / 4/4: ein technisches Sekundenraster, **kein erkanntes Tempo oder Taktmaß**. Es wird nicht quantisiert. Der Export erhält Zeiten auf Millisekundenbasis beziehungsweise beim MIDI-Export innerhalb eines 960stel Viertels. Freies Timing kann im MusicXML ungewöhnliche Notenwerte ergeben.

Die lokale Audioerkennung verwendet Kong et al. CRNN (CPU). Pedal, Hall, Obertöne und andere Instrumente können falsche/fehlende Noten und ungenaue Dauern verursachen; lange Noten können an Analysegrenzen verkürzt werden. Bildanalyse schätzt Lautstärken, kann gleichfarbige Wiederholungen ohne Lücke zusammenfassen und erkennt keine beliebigen Videoformate automatisch. Die drei Vorschauen ersetzen keine Kontrolle auf Bildschnitte. Keine Methode liefert eine garantiert fehlerfreie oder offiziell originale Partitur.

Download und Einrichtung sind wiederholbar; fertige, geprüfte Komponenten werden wiederverwendet. Angebrochene Downloads beginnen erneut. Lokale Datei-Transkription funktioniert nach der Einrichtung offline. YouTube-Verfügbarkeit kann sich ändern. Quellenrechte werden nicht aus der öffentlichen Erreichbarkeit abgeleitet.

**Jazzbegleitung** bietet **Dezent** (Standard), **Ausgewogen** und **Lebendig**, unabhängig von der Griffschwierigkeit. Die Engine erhält Ausgangsakkorde und Melodiedynamik, ergänzt Septimen nur bei kontextueller Eignung und nimmt bei dichter Melodie Begleitung zurück. Unsichere abgeleitete Akkorde bleiben zur Korrektur markiert.

Technik und Lizenzen: [Video-Komponenten](scripts/video/NOTICE.md). Private Laufzeit unter `video-runtime-v1/`, Auftragscache unter `video-jobs/` im App-Datenverzeichnis. Bei der Videoverarbeitung werden keine Cloudmodelle verwendet.

## Spielbarkeit und Export

| Stufe   | Griffweite je Hand           | Links gleichzeitig | Rechts gleichzeitig |
| ------- | ---------------------------- | ------------------ | ------------------- |
| Einfach | maximal 7 Halbtöne (Quinte)  | 2                  | 3                   |
| Mittel  | maximal 12 Halbtöne (Oktave) | 3                  | 4                   |

Die Prüfung zählt auch noch gehaltene Töne. Die Begleitung wird zuerst vereinfacht. Ganze Melodiephrasen dürfen oktaviert werden; die App zeigt diese Änderungen an. Die Tonfolge bleibt erhalten. Swing betrifft geeignete gerade Achtelpaare, nicht Triolen oder schon geswingte Noten.

Das MIDI ist **Standard-MIDI Typ 1** mit einer Metadatenspur und je einer Notenspur **Linke Hand** und **Rechte Hand**. Beide verwenden ausschließlich General MIDI **Acoustic Grand Piano, Programm 0**. Tempo und Taktwechsel bleiben enthalten. Die Zeitauflösung ist 960 Ticks pro Viertel; feinere Quellzeiten werden beim Export deterministisch gerundet.

Identische Quelldaten, Melodieauswahl, Akkordkorrekturen, Einstellungen und Engine-Version ergeben identische MIDI-Bytes. Übetempo, Position und Handauswahl beeinflussen den Export nicht.

## Gespeicherte Fassungen (ab 2.0.1)

Original-Hörprobe, Melodie-Hörprobe und erzeugte Arrangements erhalten jeweils eine eindeutige Kennung. Unter `versions/<Song-ID>/<Fassungs-ID>.json` werden ihre tatsächlichen Noten, Zeitdaten, Einstellungen, Quellrevision und eine Integritätsprüfsumme unveränderlich gespeichert. Player und Export greifen auf genau diese Daten zu. Gespeicherte Melodieauswahl und Schwierigkeit werden beim Öffnen übernommen.

Ältere Katalogeinträge bleiben erhalten. Beim ersten Aufruf wird eine geprüfte Fassung aus ihren vorhandenen Einstellungen angelegt; Originaldateien und bisherige Katalogdaten werden dabei nicht umgeschrieben. Leere, ungültige, beschädigte oder nicht mehr zur Quelle passende Fassungen liefern eine verständliche Fehlermeldung. Fehlerhafte Katalogeinträge bleiben sichtbar. Nach einer Quellkorrektur wird eine neue Fassung angelegt; vorherige Fassungsdateien bleiben erhalten.

Eine Melodie-Hörprobe startet bei ihrem ersten Ton, auch wenn die gewählte Stimme erst spät im Stück einsetzt. Ihre gespeicherten Zeitpositionen bleiben unverändert. Originalwiedergabe und Übemodus erhalten die vollständigen Pausen.

## Üben

88 Tasten von A0 bis C8; links blau, rechts orange. Die Balken zeigen Start und Dauer. Wiedergabe, Animation und Export verwenden dieselben Arrangementnoten und dieselbe Tempokarte.

- Play/Pause, Positionssprung, 25–100 % Tempo ohne Tonhöhenänderung.
- Hände gemeinsam oder einzeln; Wiederholung eines Taktbereichs.
- Nach Sprüngen und Tempowechseln werden veraltete Klänge abgebrochen und noch gehaltene Noten wiederhergestellt.
- Die Darstellung orientiert sich an der Audio-Ausgabezeit. Bei mehreren offenen Hörproben spielt immer nur ein Player.
- Ein angeschlossenes Keyboard wird nicht vorausgesetzt. Keyboard-Eingabe, Fingersätze und ein neu gesetztes PDF-Notenblatt sind nicht Teil dieser Version; MusicXML kann in einem Notensatzprogramm geöffnet werden.

## Bekannte Importgrenzen

MIDI Typ 0/1 mit musikalischer Zeitbasis wird unterstützt. Typ 2, SMPTE-MIDI und reine Schlagzeugdateien werden verständlich abgewiesen. MIDI kennt normalerweise keine Auftakt- oder Wiederholungsnotation; hier gilt die bereits ausgeschriebene Ereignisfolge, mit vorhandenen Markern und Taktwechseln.

MusicXML unterstützt Partwise/Timewise, MXL-Container, Stimmen, Pausen, Auftakte, Bindungen, Tempo-/Taktwechsel und normale Wiederholungen einschließlich erster/zweiter Endungen. Standard-DTD-Verweise werden ohne Netzwerkzugriff ignoriert; interne DTD-Entitäten werden abgewiesen. Vorschlagsnoten, D.C./D.S./Coda und veränderte Akkorderweiterungen müssen vorher ausgeschrieben beziehungsweise vereinfacht oder als MIDI importiert werden. Für solche Fälle gibt es Fehlermeldungen statt einer stillen musikalischen Änderung.

Bei der PDF-Erkennung werden einige nicht unterstützte Schreibweisen als Prüfstellen übernommen; die Prüfung muss dann das beabsichtigte Ergebnis herstellen. Handschrift, stark verzerrte Fotos, Spracheingabe und direkter MP3-Dateiimport werden nicht unterstützt. Klavieraudio in Videodateien kann über den Videoimport transkribiert werden. Die automatische Melodieverfolgung und Harmonisierung sind regelbasierte Vorschläge; Hörprobe und Korrekturmöglichkeit sind bei fremden Dateien wesentlich.

## Entwicklung

Node.js 24 und npm; macOS zum Paketieren.

```sh
npm ci
npm run omr:assets       # einmalig: offizielle OMR-Pakete, Modelle und Quellcode
npm run dev
```

Die Klaviersamples und Lizenztexte sind bereits im Repository enthalten. Die laufende App lädt sie niemals aus dem Internet nach.

```sh
npm test                 # Import, musikalische Regeln, Export und Transport
npm run build            # Typprüfung, Lizenztexte und Produktionsbuild
npm run test:e2e         # echte Electron-App, vollständig offline
npm run test:e2e:video    # echte Bild-/Audiotranskription; lokale Einrichtung und Testvideo erforderlich
node scripts/compare-arrangements.mjs # MIDI/WAV-Vergleich mit vorherigem Git-Stand
npm run test:e2e:versions # Fassungszuordnung, Altbestand, Fehler und hörbare Wiedergabe
npm run test:e2e:pdf     # PDF-Vorschau, echte OMR, Korrektur und beide Exporte
npm run verify:pdf       # Referenzpartituren, Scans und blockierte Erkennungsfehler
npm run verify:omr       # einzelner echter Audiveris-Import
npm run verify:online    # drei echte Direktdownloads und beide Stufen
npm run verify:package   # DMGs einhängen, Signaturen und arm64-Offlineablauf prüfen
npm run package          # DMGs für arm64 und x64, ad hoc signiert
npm run package:local    # entpackte arm64-App
npm run previews         # Demoquellen, MIDI-Ausgaben und WAV-Hörproben
```

`npm run assets` lädt die Sampledateien und einen im npm-Tarball fehlenden Upstream-Lizenztext bei Bedarf erneut. `omr:assets` benötigt zum Beschaffen der festgelegten OMR-Fassungen ebenfalls Internet und für die kleine Java-Anpassung ein JDK. Beide Laufzeitarchitekturen werden getrennt gebündelt. Im fertigen Paket wird nichts nachgeladen. `npm run icon` rendert das eigene SVG als macOS-Symbol. `previews` verwendet den macOS-Konverter `afconvert` und Python 3 mit Standardbibliothek. Build und GUI-Tests nacheinander ausführen.

Für einen Test einer installierten App kann `JAZZ_TEST_EXECUTABLE` auf deren `Contents/MacOS/Jazz Converter` zeigen. `JAZZ_DATA_DIR` setzt ein separates Katalogverzeichnis; `JAZZ_TEST_OFFLINE=1` sperrt externe HTTP-Anfragen und Online-Downloads im Testlauf.

Der Paketbau läuft in einem temporären Verzeichnis außerhalb von Desktop/iCloud und kopiert anschließend die Artefakte nach `release/`. File Provider kann entpackten App-Bundles auf dem Desktop Finder-Metadaten anhängen und deren Signaturprüfung stören. Deshalb werden die DMGs geprüft und ausgeliefert; die entpackten Projektkopien unter `release/mac*` dienen nur als Zwischenartefakte.

## Aufbau und lokale Daten

- `src/core/`: rationale Notenzeiten, Import, Melodievorschlag, Harmonie, Arrangement, MIDI und Transport; unabhängig von React und Electron.
- `desktop/`: isolierte IPC-Schnittstelle, Worker-Verarbeitung, native Dateidialoge, atomare Katalogdateien und geprüfte Download-IDs.
- `src/components/`: Canvas-Klaviatur und Player; das lokale Sample-Klavier liegt in `src/audio.ts`.

Der Katalog liegt standardmäßig in `~/Library/Application Support/Jazz Converter/songs/`. Pro Quelldatei werden die unveränderten Bytes und eine JSON-Datei mit Metadaten, musikalischem Modell und zuletzt erfolgreich konvertierten Einstellungen gespeichert. Es gibt keine Telemetrie und keine automatischen Updates.

PDF-Originale liegen getrennt unter `pdfs/<Hash>/`, abgeleitete Erkennungsdateien unter `pdf-cache/<Auftrag>/`, private Audiveris-Daten unter `omr-home/`. Eine vorhandene Audiveris-Installation bleibt unberührt. Die vollständige Ordnerstruktur erklärt [ARCHITEKTUR.md](ARCHITEKTUR.md).

Audiveris steht unter AGPL v3; Lizenz, offizielles Quellarchiv und die kleine Änderung für private Arbeitsordner werden mitgeliefert. OCR-Sprachdaten stehen unter Apache 2.0. Die ursprüngliche Vorgabe ohne lokale Modelle wurde für diese PDF-Notenerkennung gezielt erweitert; Arrangement und Export verwenden weiterhin feste Regeln und keine KI-API.

Quellen und Lizenzen stehen in der App sowie in `public/piano/LICENSE.txt`, `public/demo/LICENSE.txt` und `public/licenses/`. Electron bringt eigene Lizenztexte im App-Paket mit. Die Abnahme und verbleibende manuelle Prüfungen sind in [ABNAHME.md](ABNAHME.md) dokumentiert.
