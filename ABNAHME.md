# Ergänzung 2.1.0 · 5. November 2026

- Neue installierbare DMGs: `release/Jazz Converter-2.1.0-arm64.dmg` und `release/Jazz Converter-2.1.0.dmg`. Beide schreibgeschützt eingehängt, Signaturen geprüft. Apple-Silicon-App direkt aus dem DMG: bestehende Import-/PDF-/Wiedergabe-/Fassungstests sowie neuer Video-End-to-End-Test bestanden (`npm run verify:package`, `test-results/package-report.json`).
- Die erste zusätzliche PDF-Paketprüfung scheiterte am Seitenfeld, bevor OMR startete. Die Wiederholung mit protokollierter Eingabe und sofortigem Abbruch bei UI-Fehlern bestand vollständig; eine produktseitige Ursache wurde nicht nachgewiesen.
- 82 Unit-Tests bestanden, einschließlich neuer Harmonie-, Dichte-, Transkriptions-, Timing- und Exportregressionen.
- Bestehende Electron-Tests für Import, hörbares Web Audio, Transport, MIDI-Export und Fassungs-/Altbestandsschutz bestanden.
- Neuer echter Electron-Ablauf bestanden: lokale Videodatei, Vorschau, drei Kalibrierpunkte, Bilderkennung, unveränderte Hörprobe, MIDI/MusicXML, Notenkorrektur, Tempozuordnung, Prüfstatus, Akkordbestätigung, Jazzumwandlung, lokale Audioerkennung, Abbruch und Linkvalidierung. Eigene Testkataloge; keine bestehenden Nutzerdaten verändert.
- Einrichtung aus leerem privaten Laufzeitverzeichnis mit echten offiziellen Downloads bestanden. Modelldatei SHA-256-geprüft; Python und 55 Pakete einschließlich FFmpeg/yt-dlp installiert. Ein Zenodo-HTTP-403 wurde durch Nutzung des offiziellen Datei-API-Endpunkts behoben. Modell 172 MB; installierte Umgebung mit Cache rund 2,1 GB.
- Beide vollständigen Beispiel-Transkriptionen (Bild und Audio) in der tatsächlichen App-Oberfläche geöffnet: vollständige Noten mit Aufnahmetiming statt automatischer Reduktion.
- Paketauflösung für Intel-macOS im Dry-run bestanden; dies ersetzt keine native Intel-Ausführung.
- Beispiel `kcS_ZWM03-E` tatsächlich geladen und Frames gesichtet: gefilmte Klaviatur mit farbigen fallenden Noten. Electron-Abruf, drei Vorschauen, Bilderkennung und validierte Katalog-/Wiedergabefassung bestanden: 275,18 Sekunden, 1916 Ereignisse mit C4=321, C5=419, Linie=223 (720 Pixel breite Vorschau). Separater vollständiger Audio-Modelllauf: 2039 Ereignisse. Diese Zahlen sind **keine Genauigkeitsmessung** gegen eine Originalpartitur.
- Beim Beispiel laufen Bildanschläge gegenüber den Audioanschlägen ungefähr 0,1–0,15 Sekunden vor. Dafür ist ein expliziter Bild-/Tonversatz einstellbar. Keine stille automatische Korrektur oder Rasterquantisierung.
- Echter Bilderkennungstest: sechs bekannte Ereignisse einschließlich Polyphonie, schwarzer Taste und wiederholter Taste; Tonhöhen korrekt, Einsätze/Enden innerhalb eines Frames bei 30 fps. Expliziter Zeitversatz geprüft. Leeres und beschädigtes Video abgewiesen.
- Echter Audiotest mit lokalen Klaviersamples: fünf Referenztöne einschließlich Dreiklang innerhalb 80 ms erkannt. Ein zusätzlicher Oberton wurde mit niedrigem Modellwert zur Kontrolle markiert. Dauern sind weniger zuverlässig als Einsätze; Pedal wird nicht als separate Pedalspur exportiert.

## Musikalische Prüfung und ihre Grenze

Vorher-/Nachher-MIDI und gerenderte WAVs: `test-results/jazz-quality/`, reproduzierbar über `node scripts/compare-arrangements.mjs` (vorheriger Git-Stand, gleiche Quellen und Einstellungen). Drei echte Mutopia-Stücke vorher mit `npm run verify:online` laden. Weitere Referenzen: Bruder Jakob, Ballade, Mollfolge, Walzer, 6/8 und dichte Melodie.

Bei dezentem Standard sinkt die Begleitung bei Bruder Jakob von 56 auf 16 Ereignisse, bei den drei Katalogstücken von 157/140/118 auf 64/58/48. Die Prüfung umfasst außerdem erhaltene Melodietonfolge/-dynamik, Ausgangsakkorde, keine pauschalen Septimen, geringere Begleitlautstärke, unterschiedliche metrische Gruppen, Pausen und Register-/Griffbelegung. Dichte Melodie unterdrückt zusätzliche Akkordanschläge. Diese Kriterien adressieren die konkrete Überladung, beweisen jedoch **keine subjektiv bessere musikalische Wirkung**. Eine menschliche Hörabnahme bleibt ausdrücklich offen; die A/B-Hörproben liegen dafür vor.

Die Bilderkennung verlangt eine feste, kalibrierte Ansicht mit gut unterscheidbaren farbigen Balken. Sie erkennt keine beliebigen Tutorialformate oder Kameraschnitte automatisch. Audio kann bei Hall, Pedal, Obertönen oder weiteren Instrumenten falsch liegen; lange Noten an Analysefenstergrenzen können verkürzt sein. Hohe Modell-/Bildwerte garantieren keine korrekten Noten. Freies Timing bleibt erhalten und kann unhandliche MusicXML-Notenwerte ergeben. Tempo/Takt sind zunächst ausdrücklich technische Hilfswerte und können zeitneutral zugeordnet werden.

Die neue App wird lokal/ad hoc signiert; keine Apple-Notarisierung. Native Intel-Ausführung und physische Audio-/Bildlatenz sind weiterhin separat zu prüfen.

---

# Abnahme Version 2.0.1

Die automatischen Ergebnisse stehen unter `test-results/`. Die Tests benutzen ein eigenes temporäres Katalogverzeichnis und verändern keine persönlichen Musikdateien.

## Fassungen: Korrektur in 2.0.1

Die neuen Regressionen prüfen alle Grenzen von Quelle über gespeicherte Fassung bis Transport und Export. Leere Reduktionen, Ereignisse nach dem Songende, Dauer null, ungültige Tonhöhen/Zeitwerte und unhörbare Anschlagstärken werden abgewiesen. Falsche Quellzuordnung, beschädigte Fassungsdateien, veraltete Quellrevisionen und verspätete Konvertierungen sind abgedeckt. Der musikalische Kern und die Exporte verwenden dieselbe Prüfung.

Der zusätzliche Desktop-Test `npm run test:e2e:versions` bestätigt mit gemessenem Web-Audio-Signal: Eine spät einsetzende Melodie ist als Hörprobe sofort hörbar; gespeicherte Auswahl und Mittel bleiben nach Neustart erhalten; Player und Export greifen auf dieselbe Fassung zu. Quellkorrekturen sperren alte Referenzen, verzögerte Antworten überschreiben nach Navigation keine andere Ansicht, und beschädigte Fassungen oder fehlende Samples ergeben Fehlermeldungen. Alle vorbereiteten Altbestandsdateien und die Originalquelle bleiben nach Prüfsummenvergleich bytegleich. Fehlerhafte Katalogeinträge bleiben sichtbar.

Die sechs vorhandenen persönlichen Songs wurden nur gelesen und bestanden die neue Quellenprüfung. Es wurde keine Beschädigung ihrer Quelldaten nachgewiesen. Details zur Ursache und zur Korrektur: [FEHLERBEHEBUNG-FASSUNGEN.md](FEHLERBEHEBUNG-FASSUNGEN.md).

## Automatisch geprüft

- 71 Tests für MIDI/MusicXML/MXL, mehrspurige Quellen, Kanaltrennung, Schlagzeugfilter, Auftakt, Pausen, Bindungen, Stimmen, Wiederholungen und Takt-/Tempowechsel.
- Standard-MusicXML-DTD ohne Netzwerk; Ablehnung beschädigter Dateien, interner Entitäten und nicht unterstützter Navigation.
- Deterministische Konvertierung für Einfach und Mittel; vollständige Melodietonfolge modulo erlaubter Oktavierung und veränderte Begleitung.
- Genau zwei MIDI-Notenspuren plus Metadatenspur, beide Acoustic Grand Piano / Programm 0. Export-Rückimport erhält die erzeugten Noten bis auf die dokumentierte Tick-Rundung.
- Griffgrenzen einschließlich gehaltener Noten; aktivere Bassbegleitung in Mittel.
- Transport bei halbem Tempo, Sprung in gehaltene Noten, Pause/Fortsetzen, Handisolation, Tempowechsel und zeitlich vorausgeplanter Taktwiederholung.

Der Electron-Test prüft den vollständigen Offline-Ablauf: Suche, Versionsauswahl, Konvertierung, ein tatsächlich gemessenes Web-Audio-Signal aus lokalen Samples, halbes Tempo, Positionssprung, Handauswahl, Wiederholung, nativen MIDI-Export, App-Neustart, persistente Einstellungen und bytegleichen erneuten Export. Zusätzlich werden Melodiespurwechsel und Hörprobe bei mehrspurigem MIDI geprüft. Der Lauf verlangt null Rendererfehler und null externe HTTP-Anfragen.

Die drei echten Mutopia-Direktdownloads wurden für Version 1 separat importiert und in beiden Schwierigkeitsstufen arrangiert; dieser Netzwerktest wurde für Version 2 nicht erneut ausgeführt. Quellen und Ergebnisse stehen in `test-results/online-report.json`.

## PDF-Erkennung und Klavierfassung

`npm run verify:pdf` führt die echte mitgelieferte Audiveris-/Java-Laufzeit auf acht eigenen CC0-Referenzpartituren aus:

| Quelle                                   | Ergebnis                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Klavier, digitales PDF                   | 32 Noten mit korrekten Tonhöhen, Beginnzeiten und Dauern; Originalzuordnung                   |
| Klavier, 300-dpi-Scan                    | 32 Noten korrekt; Originalzuordnung                                                           |
| Flöte, 300-dpi-Scan                      | 16 Noten korrekt; Einzelinstrument                                                            |
| Flöte und Cello, digitales PDF           | 32 Noten korrekt; Ensemble passt vollständig auf zwei Hände                                   |
| Orchester mit B-Klarinette, 300-dpi-Scan | 80 Noten korrekt einschließlich Transposition; automatische Reduktion                         |
| Weit gesetztes Klavier, digitales PDF    | 64 Noten korrekt; Reduktion erforderlich                                                      |
| Flöte, digitales PDF                     | Taktzeichen teilweise als Note erkannt; überfüllter Takt blockiert die automatische Ausgabe   |
| Orchester, digitales PDF                 | Zwei falsche Zusatznoten aus Taktzeichen; überfüllter Takt blockiert die automatische Ausgabe |

Die zwei fehlerhaften Erkennungsergebnisse sind ausdrücklich **keine fehlerfreien OMR-Imports**. Erfolgreich geprüft ist hier die verpflichtende Korrekturschranke. Die Matrix bestätigt für die sechs exakt erkannten Partituren die vollständige Übereinstimmung mit den beim Notensatz gespeicherten Referenzdaten. Beide Reduktionsstufen werden auf Griffgrenzen und bytegleichen wiederholten MIDI-Export geprüft. Für Version 2.0.0 erzeugten zusätzlich vollständig neue, unabhängige OMR-Läufe von Klavier-PDF und Orchester-Scan in beiden Stufen bytegleiche MIDI-Dateien (auf diesem Apple-Silicon-Mac). Nach `verify:pdf` lässt sich das mit `node scripts/check-pdf-repeat.mjs` wiederholen; Ergebnis: `test-results/pdf-repeat-report.json`. Abbruch, erneutes Laden des Auftragszustands und Cache-Wiederverwendung werden ebenfalls geprüft. Die Fixtures sind klein und decken nicht beliebige veröffentlichte Partituren ab.

Der zusätzliche Electron-PDF-Test prüft lokale Vorschau und Zoom, die WebAssembly-Freigabe für lokale PDF-Decoder, Seitenauswahl ohne Deckblatt, echte OMR, Seitenverweise, unveränderten Original-Hash, Originalzuordnung, Wiedergabe bei halbem Tempo nach Sprung, MIDI mit zwei Klavier-Handspuren, Quell- und Klavier-MusicXML, Noten-/Pausenkorrektur mit gespeicherter Prüffreigabe sowie automatische Orchesterreduktion mit B-Klarinette. Er prüft außerdem, dass ein realer Erkennungsfehler die Prüfoberfläche öffnet und die Klavierausgabe blockiert. Rendererfehler und externe Renderer-HTTP-Anfragen müssen ausbleiben.

Zusätzliche Kerntests prüfen gehaltene Tasten, exakte Unisonos mit Herkunft, Originalzuordnung unabhängig von Einfach, zwischen Instrumenten wechselnde Melodie, Transpositionen, Bassschlüssel/Pausen im XML-Rückimport und Bindungen über Taktgrenzen. Beschädigte PDFs, ungültige Seitenauswahl und Auftragskennungen werden abgefangen.

## Installationspakete

Beide finalen DMGs bestehen `hdiutil verify` und die Prüfung der enthaltenen App mit `codesign --verify --deep --strict`. Die drei vollständigen Offline-Desktopabläufe einschließlich der neuen Fassungsregressionen wurden erfolgreich mit der Apple-Silicon-App direkt aus dem schreibgeschützten DMG ausgeführt, einschließlich der gebündelten Java-Notenerkennung und der WebAssembly-Freigabe für lokale PDF-Decoder. Der abschließende Status steht in `VALIDIERUNG.json`, die Laufdetails in `test-results/package-report.json`.

## Manuelle Hörabnahme – noch offen

Automatische Notenvergleiche und gemessene Audiosignale ersetzen kein musikalisches Urteil und keine Messung des tatsächlich gehörten Tons am Zielgerät. Eine maximale physische Audio-/Bildabweichung von 30 ms wurde nicht gemessen. Der Intel-Build muss zusätzlich auf einem Intel-Mac gestartet werden.

Mitgelieferte Hörproben nach `npm run previews`:

- `test-results/Hoerprobe-Original.wav`
- `test-results/Hoerprobe-Swing-Einfach.wav`
- `test-results/Hoerprobe-Swing-Mittel.wav`

Diese Referenzmischungen verwenden dieselben Noten- und Tempodaten sowie dieselben Klaviersamples. Sie sind keine Aufzeichnung des Audioausgangs der App und kein Latenztest.

Zur Abnahme mit deinem Vater:

1. **Bruder Jakob → Demo · Mehrspurige MIDI-Datei** öffnen. Melodie anhören und bestätigen. Prüfen, dass die richtige Melodie erkennbar ist.
2. Original, Einfach und Mittel vergleichen. Melodie vollständig wiedererkennen; neue Bass-/Akkordbegleitung und Swing bei den Achteln deutlich unterscheiden.
3. **Üben → 50 %** einstellen und beide Hände anhören. Prüfen, dass jeder Balken beim Tastenkontakt den passenden Ton auslöst und die Taste bis zum Notenende leuchtet.
4. Während der Wiedergabe zu Takt 5 springen, pausieren, fortsetzen und einen Bereich wiederholen. Keine alten oder hängen gebliebenen Töne; weiterhin passende Tastenmarkierungen.
5. Links und rechts einzeln üben. MIDI speichern und in einem unabhängigen MIDI-Player öffnen. Beide Handspuren und ausschließlich Klavier prüfen.

Die App ist lokal/ad hoc signiert, nicht Apple-notarisiert. Für eine breite Veröffentlichung wären Apple Developer ID, Notarisierung und eine Abnahme auf beiden Mac-Architekturen nachzuziehen.

Für die PDF-Abnahme zusätzlich eine eigene gut lesbare Partitur öffnen, Instrumente und Transposition prüfen, die erkannte Melodie mit dem Original vergleichen und die erzeugte Klavierfassung musikalisch beurteilen. Bei markierten Problemen Noten korrigieren und ausdrücklich übernehmen. Handschrift und stark verzerrte Fotos sind nicht Bestandteil dieser Version.

Den Aufbau und den Software-Stack erklärt [ARCHITEKTUR.md](ARCHITEKTUR.md) in vier Lesestufen.
