# Abnahme Version 1.0.0

Die automatischen Ergebnisse stehen unter `test-results/`. Die Tests benutzen ein eigenes temporäres Katalogverzeichnis und verändern keine persönlichen Musikdateien.

## Automatisch geprüft

- 26 Tests für MIDI/MusicXML/MXL, mehrspurige Quellen, Kanaltrennung, Schlagzeugfilter, Auftakt, Pausen, Bindungen, Stimmen, Wiederholungen und Takt-/Tempowechsel.
- Standard-MusicXML-DTD ohne Netzwerk; Ablehnung beschädigter Dateien, interner Entitäten und nicht unterstützter Navigation.
- Deterministische Konvertierung für Einfach und Mittel; vollständige Melodietonfolge modulo erlaubter Oktavierung und veränderte Begleitung.
- Genau zwei MIDI-Notenspuren plus Metadatenspur, beide Acoustic Grand Piano / Programm 0. Export-Rückimport erhält die erzeugten Noten bis auf die dokumentierte Tick-Rundung.
- Griffgrenzen einschließlich gehaltener Noten; aktivere Bassbegleitung in Mittel.
- Transport bei halbem Tempo, Sprung in gehaltene Noten, Pause/Fortsetzen, Handisolation, Tempowechsel und zeitlich vorausgeplanter Taktwiederholung.

Der Electron-Test prüft den vollständigen Offline-Ablauf: Suche, Versionsauswahl, Konvertierung, ein tatsächlich gemessenes Web-Audio-Signal aus lokalen Samples, halbes Tempo, Positionssprung, Handauswahl, Wiederholung, nativen MIDI-Export, App-Neustart, persistente Einstellungen und bytegleichen erneuten Export. Zusätzlich werden Melodiespurwechsel und Hörprobe bei mehrspurigem MIDI geprüft. Der Lauf verlangt null Rendererfehler und null externe HTTP-Anfragen.

Die drei echten Mutopia-Direktdownloads werden separat importiert und in beiden Schwierigkeitsstufen arrangiert. Quellen und Ergebnisse stehen in `test-results/online-report.json`.

Beide DMGs wurden mit `hdiutil verify` geprüft. Die darin enthaltenen App-Signaturen bestehen `codesign --verify --deep --strict`. Der vollständige Electron-Offline-Test wurde zusätzlich direkt mit der Apple-Silicon-App aus dem schreibgeschützt eingehängten DMG ausgeführt. Details stehen in `test-results/package-report.json` und `test-results/e2e-report.json`.

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
