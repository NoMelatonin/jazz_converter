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
