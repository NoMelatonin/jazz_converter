import { _electron as electron } from "playwright";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { parseMidi } from "midi-file";
const root = process.cwd(),
  dataDir = await mkdtemp(path.join(tmpdir(), "jazz-video-e2e-"));
const runtime =
  process.env.JAZZ_VIDEO_RUNTIME ??
  path.resolve("resources/video/test-data/video-runtime-v1");
await mkdir("test-results/video", { recursive: true });
const app = await electron.launch({
  ...(process.env.JAZZ_TEST_EXECUTABLE
    ? { executablePath: process.env.JAZZ_TEST_EXECUTABLE, args: [] }
    : { args: [root] }),
  env: {
    ...process.env,
    JAZZ_DATA_DIR: dataDir,
    JAZZ_VIDEO_RUNTIME: runtime,
    JAZZ_TEST_OFFLINE: "1",
  },
  timeout: 30000,
});
let page;
const errors = [];
const log = (s) => console.log("PASS " + s);
async function waitJob(id) {
  for (let i = 0; i < 360; i++) {
    const j = await page.evaluate((id) => window.jazz.videoStatus(id), id);
    if (j.status !== "running") return j;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("job timeout");
}
try {
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Video importieren", exact: true })
    .click();
  await page
    .getByText("Lokale Videoverarbeitung bereit.", { exact: true })
    .waitFor();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, path.resolve("test-results/video/piano.mp4"));
  await page
    .getByRole("button", { name: "Lokale Videodatei öffnen", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Erkennungsverfahren" }).waitFor();
  await page
    .getByRole("combobox", { name: "Erkennungsverfahren" })
    .selectOption("visual");
  const img = page.getByAltText("Videovorschau zur Kalibrierung");
  const box = await img.boundingBox();
  for (const [x, y] of [
    [200, 280],
    [340, 280],
    [200, 220],
  ])
    await img.click({
      position: { x: (x * box.width) / 720, y: (y * box.height) / 400 },
    });
  await page
    .getByRole("button", { name: "Transkribieren", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Transkription anhören und prüfen",
      exact: true,
    })
    .waitFor({ timeout: 60000 });
  await page
    .getByRole("button", {
      name: "Transkription anhören und prüfen",
      exact: true,
    })
    .click();
  await page
    .getByText("Erkannte Noten mit Aufnahmetiming.", { exact: true })
    .waitFor();
  const records = await page.evaluate(() => window.jazz.list());
  const video = records.find((r) => r.format === "Video");
  assert(video);
  const original = await page.evaluate(
    (id) => window.jazz.getPlaybackVersion(id, { kind: "original" }),
    video.id,
  );
  assert.equal(original.music.notes.length, 6);
  assert.equal(original.music.notes[0].pitch, 60);
  assert.equal(
    original.music.notes[0].start.n / original.music.notes[0].start.d,
    0.3,
  );
  log(
    "Lokaler Videoimport, Vorschau, Kalibrierung und echte visuelle Erkennung",
  );
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="piano-roll"]').dataset.position,
      ) > 0.4,
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  log("Unveränderte Transkription im Player");
  for (const [name, extension] of [
    ["MIDI speichern", "mid"],
    ["MusicXML speichern", "musicxml"],
  ]) {
    const target = path.resolve(`test-results/video/export.${extension}`);
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: target,
      });
    }, target);
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByText(`Gespeichert: ${target}`, { exact: true }).waitFor();
    const bytes = await readFile(target);
    assert(bytes.length > 100);
    if (extension === "mid")
      assert.equal(
        parseMidi(bytes)
          .tracks.flat()
          .filter((e) => e.type === "noteOn").length,
        6,
      );
  }
  log("MIDI und MusicXML aus derselben gespeicherten Transkription");
  await page.getByRole("button", { name: "Noten prüfen", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Ton video-0", exact: true })
    .fill("D4");
  await page
    .getByRole("textbox", { name: "Ton video-0", exact: true })
    .press("Tab");
  await page.getByRole("button", { name: "Geprüfte Noten übernehmen", exact: true }).click();
  await page
    .getByRole("button", { name: "Noten prüfen", exact: true })
    .waitFor();
  const updated = await page.evaluate((id) => window.jazz.load(id), video.id);
  assert.equal(updated.song.tracks[0].notes[0].pitch, 62);
  assert(updated.song.transcription.reviewed);
  log("Noteneditor, persistierte Korrektur und Prüfstatus");
  await page.getByRole('button',{name:'Zeitbasis zuordnen',exact:true}).click();
  await page.waitForFunction(id=>window.jazz.load(id).then(r=>r.song.tempos[0].bpm===120),video.id);
  await page.getByRole('button',{name:'Hörkontrolle bestätigen und als Swing arrangieren',exact:true}).click();
  await page.getByRole('combobox',{name:'Jazzbegleitung',exact:true}).waitFor();
  await page.getByRole('button',{name:/Akkorde prüfen & anpassen/}).click();
  const confirmChords=page.getByRole('button',{name:'Ich habe die Vorschläge geprüft – alle bestätigen',exact:true});
  if(await confirmChords.count())await confirmChords.click();
  await page.getByRole('button',{name:'Swing-Arrangement erstellen',exact:true}).click();
  await page.getByText('Dein Arrangement ist bereit.',{exact:true}).waitFor();
  log('Tempozuordnung ohne Timingänderung, Hörkontrolle, Akkordbestätigung und Jazzumwandlung');

  const input = await page.evaluate(
    (file) => window.jazz.videoPrepare({ file }),
    path.resolve("test-results/video/piano.mp4"),
  );
  assert.equal((await waitJob(input.id)).status, "ready");
  const audio = await page.evaluate(
    (id) => window.jazz.videoTranscribe(id, "audio"),
    input.id,
  );
  const done = await waitJob(audio.id);
  assert.equal(done.status, "complete", done.error);
  assert(done.result.song.tracks[0].notes.some((n) => n.pitch === 60));
  log("Echte lokale polyphone Audioerkennung und Katalogspeicherung");
  const bad = await page.evaluate(async () => {
    try {
      await window.jazz.videoPrepare({
        url: "https://evil.example/watch?v=kcS_ZWM03-E",
      });
      return "";
    } catch (e) {
      return e.message;
    }
  });
  assert.match(bad, /YouTube/);
  const cancel = await page.evaluate(
    (file) => window.jazz.videoPrepare({ file }),
    path.resolve("test-results/video/piano.mp4"),
  );
  assert.equal(
    (await page.evaluate((id) => window.jazz.videoCancel(id), cancel.id))
      .status,
    "cancelled",
  );
  log("Linkvalidierung und echter Abbruch eines Unterprozesses");
  await page.screenshot({ path: "test-results/video/workspace.png" });
  assert.deepEqual(errors, []);
  log("Keine Rendererfehler");
  console.log("Testkatalog: " + dataDir);
} finally {
  await app.close();
}
