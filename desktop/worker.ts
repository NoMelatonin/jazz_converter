import { parentPort } from "node:worker_threads";
import { importSong } from "../src/core/import";
import { convertArrangement } from "../src/core/convert";
import { analyzePiano } from "../src/core/piano";
import { exportMusicXml } from "../src/core/musicxml";
import { exportMidi } from "../src/core/midi";
import { chordsFor } from "../src/core/harmony";
parentPort!.on(
  "message",
  ({ requestId, action, bytes, filename, song, settings, trackId }) => {
    try {
      const data =
        action === "import"
          ? importSong(bytes, filename)
          : action === "chords"
            ? chordsFor(song, trackId)
            : action === "arrange"
              ? convertArrangement(song, settings)
              : action === "piano-analysis"
                ? analyzePiano(song, trackId)
                : action === "musicxml"
                  ? exportMusicXml(
                      settings ? convertArrangement(song, settings) : song,
                    )
                  : exportMidi(convertArrangement(song, settings));
      parentPort!.postMessage({ requestId, ok: true, data });
    } catch (e) {
      parentPort!.postMessage({
        requestId,
        ok: false,
        error:
          e instanceof Error
            ? e.message
            : "Die Musikdatei konnte nicht verarbeitet werden.",
      });
    }
  },
);
