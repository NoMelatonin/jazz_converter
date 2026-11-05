# Leere oder unhörbare Fassungen – Korrektur in 2.0.1

## Ursache und Nachweis

Die musikalische Pipeline besaß keine gemeinsame Abspielbarkeitsprüfung. Reproduziert wurden eine leere Reduktion und eine Originalfassung mit Noten nach dem Songende. Der Transport setzte dafür `playing = true`, obwohl er keinen Ton auslöste; auch nicht endliche Tonhöhen erreichten die Audio-Grenze.

Erzeugte Fassungen wurden außerdem nur durch ihre Einstellungen repräsentiert. Ihre tatsächlichen Noten wurden nicht gespeichert, und Export sowie erneutes Öffnen berechneten Ergebnisse erneut. Die PDF-Ansicht ersetzte dabei die gespeicherte Auswahl durch Automatisch/Einfach. So konnten angezeigte Auswahl und gehörte Fassung auseinanderfallen. Eine zusätzliche Hörprobenfalle waren gültige, aber erst sehr spät einsetzende Stimmen: Der Player begann vorher bei Stückposition null.

Die sechs zum Untersuchungszeitpunkt vorhandenen persönlichen Katalogeinträge wurden ausschließlich gelesen und enthielten gültige Quellnoten. Es wurde keine Beschädigung dieser Dateien nachgewiesen. Die Fehlerfälle wurden in getrennten Testdaten reproduziert.

## Änderungen

- Gemeinsame Prüfung beim Import, Konvertieren, Speichern/Laden und im Transport: positive Songlänge und Dauer, gültige Tonhöhe und Anschlagstärke, konsistente Zeitdaten, mindestens ein hörbares Ereignis. Fehlerhafte Noten werden nicht durch stilles Filtern kaschiert.
- Unveränderliche Fassungsdateien mit Quelle, Revision, Einstellungen, Engine-Version, exakten Noten-/Zeitdaten und Integritätsprüfsumme. Player und Export verwenden dieselbe Fassungskennung. Vor dem Abspielen und Export wird erneut geprüft.
- Gespeicherte PDF-Auswahl bleibt erhalten. Quellkorrekturen und verspätete Antworten dürfen keine alte oder fremde Fassung einsetzen.
- Melodie-Hörproben beginnen am ersten vorhandenen Ton; die gespeicherten Zeiten bleiben erhalten. Original und Übemodus behalten ihre Pausen.
- Fehlerhafte Katalogeinträge bleiben sichtbar und liefern einen Fehlergrund. Audiofehler stoppen die Wiedergabe und werden am Player angezeigt.

## Regressionen und Bestandsschutz

Die neuen Kern- und Speichertests prüfen leere Fassungen, ungültige Tonhöhen/Zeitwerte, Dauer null, Ereignisse außerhalb des Songs, MIDI-/XML-Import, unterschiedliche Fassungsarten, falsche Quellzuordnung, beschädigte Dateien, Neustart, Quellkorrekturen und verspätete Konvertierungen.

Der zusätzliche Electron-Test misst ein echtes Web-Audio-Signal, prüft eine späte Hörprobe, gespeichertes Mittel mit expliziter Melodiespur nach Neustart, identische gespeicherte Noten, Export, Quelländerungen, Navigation während einer verzögerten Konvertierung sowie Fehler bei veralteten Stimmen, beschädigten Fassungen und fehlenden Samples. Prüfsummen bestätigen, dass alle vorbereiteten Altbestandsdateien und die Originalquelle unverändert bleiben.

Originaldateien werden nicht verändert. Bestehende Katalogeinträge erhalten Fassungsdateien erst bei Bedarf. Vorherige Fassungsdateien bleiben auch nach Quelländerungen erhalten. Eine kaputte abgeleitete Datei wird nicht stillschweigend überschrieben. Sie erzeugt einen Fehler statt einer scheinbar laufenden Wiedergabe.

Der abschließende Test- und Paketstand steht in [VALIDIERUNG.json](VALIDIERUNG.json). Physische Lautsprecherlautstärke und wahrgenommene Audio-/Bild-Latenz auf dem Zielgerät bleiben außerhalb der automatischen Messung.
