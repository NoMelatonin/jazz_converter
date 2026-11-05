import { importMidi } from "./import-midi";
import { importXml } from "./import-xml";
import { assertSong } from "./playback";
export function importSong(bytes: Uint8Array, filename: string) {
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("Die Datei ist zu groß (maximal 20 MB).");
  if (/\.(mid|midi)$/i.test(filename)) {
    if (String.fromCharCode(...bytes.slice(0, 4)) !== "MThd")
      throw new Error("Die Datei ist keine gültige MIDI-Datei.");
    const song = importMidi(bytes, filename);
    assertSong(song);
    return song;
  }
  if (/\.(musicxml|mxl)$/i.test(filename)) {
    const song = importXml(bytes, filename);
    assertSong(song);
    return song;
  }
  throw new Error(
    "Bitte eine MIDI- oder MusicXML-Datei öffnen (.mid, .midi, .musicxml, .mxl).",
  );
}
