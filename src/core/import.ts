import { importMidi } from "./import-midi";
import { importXml } from "./import-xml";
export function importSong(bytes: Uint8Array, filename: string) {
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("Die Datei ist zu groß (maximal 20 MB).");
  if (/\.(mid|midi)$/i.test(filename)) {
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "MThd")
      throw new Error("Die Datei ist keine gültige MIDI-Datei.");
    return importMidi(bytes, filename);
  }
  if (/\.(musicxml|mxl)$/i.test(filename)) return importXml(bytes, filename);
  throw new Error(
    "Bitte eine MIDI- oder MusicXML-Datei öffnen (.mid, .midi, .musicxml, .mxl).",
  );
}
