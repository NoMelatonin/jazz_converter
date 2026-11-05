import { _electron as electron } from "playwright";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const root = process.cwd(),
  results = path.resolve("test-results");
await mkdir(results, { recursive: true });
const dataDir = await mkdtemp(path.join(tmpdir(), "jazz-version-ui-")),
  songs = path.join(dataDir, "songs");
await mkdir(songs);
await build({
  stdin: {
    contents: `export{demoXml}from'./src/core/demo';export{importSong}from'./src/core/import';`,
    resolveDir: root,
    loader: "ts",
  },
  outfile: path.join(results, "versions-fixtures.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { demoXml, importSong } = createRequire(import.meta.url)(
  path.join(results, "versions-fixtures.cjs"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  baseline = new Map(),
  ids = {};
async function seed(name, index, change) {
  const id = String(index).repeat(64),
    song = importSong(demoXml(), "demo.musicxml");
  song.id = id;
  song.title = name;
  const record = {
    entry: {
      id,
      title: name,
      artist: "Test",
      version: "Altbestand",
      format: "MusicXML",
      source: "CC0",
      license: "CC0",
    },
    song,
  };
  change?.(record);
  const file = path.join(songs, `${id}.json`);
  await writeFile(file, JSON.stringify(record));
  baseline.set(id, hash(await readFile(file)));
  ids[name] = id;
  return record;
}
const late = await seed("Späte Melodie", 1, (r) => {
  r.song.tracks[0].notes = r.song.tracks[0].notes.filter(
    (n) => n.start.n / n.start.d >= 16,
  );
});
const pdf = await seed("Gespeicherte Klavierfassung", 2, (r) => {
  r.song.format = "PDF";
  r.entry.format = "PDF";
  r.song.pdf = {
    version: "fixture",
    pages: [1],
    sourceHash: "f".repeat(64),
    issues: [],
    reviewed: true,
  };
  r.settings = {
    style: "swing",
    mode: "reduction",
    difficulty: "medium",
    melodyTrackId: r.song.tracks[0].id,
    chords: [],
  };
});
await seed("Leere Fassung", 3, (r) => {
  r.song.tracks[0].notes = [];
});
await seed("Ungültige Tonhöhe", 4, (r) => {
  r.song.tracks[0].notes[0].pitch = 128;
});
await seed("Außerhalb des Songs", 5, (r) => {
  r.song.tracks[0].notes[0].start = r.song.duration;
});
await seed("Dauer null", 6, (r) => {
  r.song.tracks[0].notes[0].duration = { n: 0, d: 1 };
});
await seed("Veraltete Melodiespur", 7, (r) => {
  r.song.format = "PDF";
  r.entry.format = "PDF";
  r.song.pdf = {
    version: "fixture",
    pages: [1],
    sourceHash: "f".repeat(64),
    issues: [],
    reviewed: true,
  };
  r.settings = {
    style: "swing",
    mode: "reduction",
    difficulty: "medium",
    melodyTrackId: "deleted-track",
    chords: [],
  };
});
const corruptCatalogId = "8".repeat(64),
  corruptCatalogFile = path.join(songs, `${corruptCatalogId}.json`);
await writeFile(corruptCatalogFile, "{ damaged catalog");
baseline.set(corruptCatalogId, hash(await readFile(corruptCatalogFile)));
await writeFile(path.join(songs, "immutable-source.musicxml"), demoXml());
const originalHash = hash(
  await readFile(path.join(songs, "immutable-source.musicxml")),
);
const steps = [],
  errors = [],
  network = [];
let app, page;
const log = (text) => {
  steps.push(text);
  console.log(`PASS ${text}`);
};
async function launch() {
  app = await electron.launch({
    ...(process.env.JAZZ_TEST_EXECUTABLE
      ? { executablePath: process.env.JAZZ_TEST_EXECUTABLE, args: [] }
      : { args: [root] }),
    env: { ...process.env, JAZZ_DATA_DIR: dataDir, JAZZ_TEST_OFFLINE: "1" },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await page
    .getByRole("button", { name: /Bruder Jakob.*Melodie mit Akkorden/ })
    .waitFor();
  await page.evaluate(() => {
    window.__audio = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (to, ...rest) {
      const result = connect.call(this, to, ...rest);
      if (to instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        connect.call(this, analyser);
        window.__audio.push(analyser);
      }
      return result;
    };
  });
}
async function library() {
  await page.getByRole("button", { name: "Meine Songs", exact: false }).click();
  await page.locator(".song-row").first().waitFor();
}
async function choose(name) {
  await page
    .locator(".song-row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
}
async function heard() {
  await page.waitForFunction(() =>
    window.__audio.some((a) => {
      const data = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(data);
      return data.some((v) => Math.abs(v) > 0.0001);
    }),
  );
}
try {
  await launch();
  for (const name of [
    "Leere Fassung",
    "Ungültige Tonhöhe",
    "Außerhalb des Songs",
    "Dauer null",
    "Beschädigter Katalogeintrag",
  ]) {
    await choose(name);
    await page
      .getByRole("alert")
      .filter({ hasText: "nicht abspielbar" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Abspielen", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(".song-row")
        .filter({ has: page.getByText(name, { exact: true }) })
        .count(),
      1,
    );
  }
  log(
    "Ungültige Altbestände bleiben sichtbar, mit Fehlergrund und ohne scheinbare Wiedergabe",
  );
  await choose("Späte Melodie");
  await page
    .getByRole("button", { name: "Melodie anhören", exact: true })
    .click();
  await page.locator(".player[data-version-id]").waitFor();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="piano-roll"]').dataset.position,
      ) === 16,
  );
  const lateVersion = await page
      .locator(".player")
      .getAttribute("data-version-id"),
    savedLate = await page.evaluate(
      ({ id, version }) => window.jazz.loadPlaybackVersion(id, version),
      { id: late.entry.id, version: lateVersion },
    );
  assert.equal(
    savedLate.music.notes[0].start.n / savedLate.music.notes[0].start.d,
    16,
  );
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await heard();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  log(
    "Späte Melodie-Hörprobe ist sofort hörbar; gespeicherte Notenzeiten bleiben unverändert",
  );
  await library();
  await choose("Gespeicherte Klavierfassung");
  await page.getByText("Klavierfassung bereit.", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Schwierigkeitsgrad Klavierreduktion").inputValue(),
    "medium",
  );
  assert.equal(
    await page.getByLabel("Hauptmelodie der Klavierfassung").inputValue(),
    pdf.settings.melodyTrackId,
  );
  const versionId = await page
      .locator(".player")
      .getAttribute("data-version-id"),
    stored = await page.evaluate(
      ({ id, version }) => window.jazz.loadPlaybackVersion(id, version),
      { id: pdf.entry.id, version: versionId },
    );
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await heard();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Nur links", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "keine hörbaren Noten" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Abspielen", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Beide Hände", exact: true }).click();
  log(
    "Eine leere Handwahl zeigt einen Fehlergrund und startet keine stille Wiedergabe",
  );
  await app.close();
  await launch();
  await choose("Gespeicherte Klavierfassung");
  await page.getByText("Klavierfassung bereit.", { exact: true }).waitFor();
  assert.equal(
    await page.locator(".player").getAttribute("data-version-id"),
    versionId,
  );
  assert.equal(
    await page.getByLabel("Schwierigkeitsgrad Klavierreduktion").inputValue(),
    "medium",
  );
  const restored = await page.evaluate(
    ({ id, version }) => window.jazz.loadPlaybackVersion(id, version),
    { id: pdf.entry.id, version: versionId },
  );
  assert.deepEqual(restored.music.notes, stored.music.notes);
  log(
    "Altbestand übernimmt gespeicherte Auswahl; Neustart lädt dieselbe Fassung und exakt dieselben Noten",
  );
  const exportPath = path.join(dataDir, "saved.mid");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page
    .getByRole("button", { name: "MIDI speichern", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: exportPath }).waitFor();
  assert.ok((await readFile(exportPath)).length > 100);
  log("Export und Player referenzieren dieselbe gespeicherte Fassungskennung");
  const sourceFile = path.join(songs, `${pdf.entry.id}.json`),
    sourceBytes = await readFile(sourceFile),
    changed = JSON.parse(sourceBytes);
  changed.song.tracks[0].notes[0].pitch++;
  await writeFile(sourceFile, JSON.stringify(changed));
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "inzwischen geändert" })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Pause", exact: true }).count(),
    0,
  );
  await app.evaluate(({ dialog }) => {
    globalThis.__saveCalls = 0;
    dialog.showSaveDialog = async () => {
      globalThis.__saveCalls++;
      return { canceled: true };
    };
  });
  await page
    .getByRole("button", { name: "MIDI speichern", exact: true })
    .click();
  assert.equal(await app.evaluate(() => globalThis.__saveCalls), 0);
  await writeFile(sourceFile, sourceBytes);
  log(
    "Quellkorrekturen sperren veraltete Wiedergabe und Export statt eine andere Fassung einzusetzen",
  );
  await library();
  await page
    .getByRole("button", { name: /Bruder Jakob.*Melodie mit Akkorden/ })
    .click();
  await app.evaluate(async () => {
    const { Worker } = process.getBuiltinModule("worker_threads");
    const original = Worker.prototype.postMessage;
    globalThis.__postMessage = original;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message.action === "arrange")
        setTimeout(() => original.call(this, message, ...rest), 600);
      else original.call(this, message, ...rest);
    };
  });
  await page
    .getByRole("button", { name: "Swing-Arrangement erstellen", exact: true })
    .click();
  await library();
  await page.waitForTimeout(1100);
  assert.equal(
    await page
      .getByText("Dein Arrangement ist bereit.", { exact: true })
      .count(),
    0,
  );
  assert.ok((await page.locator(".song-row").count()) > 0);
  await app.evaluate(async () => {
    const { Worker } = process.getBuiltinModule("worker_threads");
    Worker.prototype.postMessage = globalThis.__postMessage;
  });
  log(
    "Verspätete Konvertierung überschreibt nach Navigation keine andere Ansicht",
  );
  await library();
  await choose("Veraltete Melodiespur");
  await page
    .getByRole("alert")
    .filter({ hasText: /Melodiestimme|Melodiestimme.*vorhanden/ })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Abspielen", exact: true }).count(),
    0,
  );
  log(
    "Veraltete Melodiespur erzeugt eine Fehlermeldung und keinen stillen Ersatz",
  );
  await library();
  await choose("Gespeicherte Klavierfassung");
  await page.getByText("Klavierfassung bereit.", { exact: true }).waitFor();
  // Corrupt only a derived test snapshot, never an original or actual user catalog.
  const versionFile = path.join(
      dataDir,
      "versions",
      pdf.entry.id,
      `${versionId}.json`,
    ),
    corrupt = JSON.parse(await readFile(versionFile, "utf8"));
  corrupt.music.notes = [];
  await writeFile(versionFile, JSON.stringify(corrupt));
  const corruptHash = hash(await readFile(versionFile));
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Fassungsdaten" })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Pause", exact: true }).count(),
    0,
  );
  assert.equal(hash(await readFile(versionFile)), corruptHash);
  log(
    "Beschädigte Fassungsdaten werden unmittelbar vor Wiedergabe erkannt und bleiben zur Diagnose erhalten",
  );
  // Exercise a renderer/audio failure with otherwise valid source and saved notes.
  await library();
  await choose("Späte Melodie");
  await page
    .getByRole("button", { name: "Melodie anhören", exact: true })
    .click();
  await page.locator(".player").waitFor();
  await page.evaluate(() => {
    window.__fetch = window.fetch;
    window.fetch = (url, ...args) =>
      String(url).endsWith("piano/manifest.json")
        ? Promise.resolve(
            new Response("{}", {
              headers: { "Content-Type": "application/json" },
            }),
          )
        : window.__fetch(url, ...args);
  });
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Klaviersamples fehlen" })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Pause", exact: true }).count(),
    0,
  );
  log(
    "Fehlende Audioressourcen zeigen eine verständliche Fehlermeldung statt laufender Stille",
  );
  for (const [id, before] of baseline)
    assert.equal(
      hash(await readFile(path.join(songs, `${id}.json`))),
      before,
      `Legacy source changed: ${id}`,
    );
  assert.equal(
    hash(await readFile(path.join(songs, "immutable-source.musicxml"))),
    originalHash,
  );
  log(
    "Alle bestehenden Katalogdateien und die Originalquelle bleiben bytegleich",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  await writeFile(
    path.join(results, "versions-e2e-report.json"),
    JSON.stringify(
      { passed: true, steps, errors, externalRequests: network, dataDir },
      null,
      2,
    ),
  );
  await page.screenshot({ path: path.join(results, "versions-errors.png") });
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(results, "versions-failure.png") })
      .catch(() => {});
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
}
