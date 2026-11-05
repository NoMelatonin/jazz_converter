import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseMidi } from "midi-file";

const root = process.cwd(),
  results = path.resolve("test-results");
await mkdir(results, { recursive: true });
const dataDir = await mkdtemp(path.join(tmpdir(), "jazz-pdf-ui-")),
  steps = [],
  errors = [],
  network = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let app, page;
const log = (text) => {
  steps.push(text);
  console.log(`PASS ${text}`);
};
async function open(name) {
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    },
    path.resolve(`tests/fixtures/pdf/${name}.pdf`),
  );
  await page
    .getByRole("button", { name: "Datei öffnen", exact: true })
    .first()
    .click();
  await page.getByLabel("PDF-Seiten auswählen").waitFor();
}
async function recognize() {
  console.log(
    "PDF page selection:",
    JSON.stringify(await page.getByLabel("PDF-Seiten auswählen").inputValue()),
  );
  await page
    .getByRole("button", { name: "Noten erkennen", exact: true })
    .click();
  await Promise.race([
    page
      .getByText(
        /Originalnoten erhalten\.|Klavierfassung bereit\.|Noten prüfen und korrigieren/,
      )
      .first()
      .waitFor({ timeout: 180000 }),
    page
      .getByRole("alert")
      .waitFor({ timeout: 180000 })
      .then(async () => {
        throw new Error(await page.getByRole("alert").innerText());
      }),
  ]);
}
async function save(button, file) {
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    },
    path.join(dataDir, file),
  );
  await page.getByRole("button", { name: button, exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: `Gespeichert: ${path.join(dataDir, file)}` })
    .waitFor();
  return readFile(path.join(dataDir, file));
}
try {
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
  await open("cover-and-score");
  await page.getByLabel("PDF-Vorschauseite").selectOption("2");
  await page.getByLabel("PDF-Seiten auswählen").fill("2");
  await page.waitForFunction(
    () => document.querySelector(".pdf-view canvas")?.width > 500,
  );
  await page
    .getByRole("button", { name: "PDF vergrößern", exact: true })
    .click();
  await page.screenshot({ path: path.join(results, "pdf-01-preview.png") });
  log("Lokale PDF-Vorschau, Zoom und Seitenauswahl ohne Deckblatt");
  await page.evaluate(async () => {
    await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  });
  log("Lokale WebAssembly-PDF-Decoder sind durch die CSP erlaubt");
  await recognize();
  await page.getByText("Originalnoten erhalten.", { exact: true }).waitFor();
  const records = await page.evaluate(async () => {
    const all = await window.jazz.list();
    return Promise.all(
      all.filter((e) => e.format === "PDF").map((e) => window.jazz.load(e.id)),
    );
  });
  const record = records[0];
  assert.deepEqual(record.song.pdf.pages, [2]);
  assert.equal(record.song.tracks.flatMap((t) => t.notes).length, 32);
  assert.equal(
    hash(
      await readFile(
        path.join(dataDir, "pdfs", record.song.pdf.sourceHash, "original.pdf"),
      ),
    ),
    hash(await readFile("tests/fixtures/pdf/cover-and-score.pdf")),
  );
  log("Echte lokale OMR und unveränderte Originaldatei");
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.getByRole("button", { name: "Üben", exact: true }).click();
  await page.getByLabel("Übetempo", { exact: true }).selectOption("0.5");
  await page.getByLabel("Position", { exact: true }).fill("4");
  await page.waitForTimeout(200);
  assert.ok(
    Number(
      await page.getByTestId("piano-roll").getAttribute("data-position"),
    ) >= 4,
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.screenshot({ path: path.join(results, "pdf-02-piano.png") });
  log("Originalfassung anhören und bei halbem Tempo nach Sprung üben");
  const midi = parseMidi(await save("MIDI speichern", "original.mid"));
  assert.equal(midi.tracks.length, 3);
  assert.deepEqual(
    midi.tracks
      .flat()
      .filter((e) => e.type === "programChange")
      .map((e) => e.programNumber),
    [0, 0],
  );
  assert.match(
    (await save("MusicXML speichern", "piano.musicxml")).toString(),
    /<staves>2<\/staves>/,
  );
  await save("Erkannte Partitur speichern", "source.musicxml");
  log("Zwei-Hand-MIDI und beide MusicXML-Ausgaben aus nativer Dateiauswahl");
  await page.getByRole("button", { name: "Noten prüfen", exact: true }).click();
  const firstPitch = page.getByRole("textbox", { name: /^Ton / }).first();
  await firstPitch.fill("F4");
  await firstPitch.press("Tab");
  await page
    .getByRole("button", { name: "Pause ergänzen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Geprüfte Noten übernehmen", exact: true })
    .click();
  await page.getByText("Originalnoten erhalten.", { exact: true }).waitFor();
  const corrected = await page.evaluate(
    (id) => window.jazz.load(id),
    record.entry.id,
  );
  assert.equal(corrected.song.pdf.reviewed, true);
  assert.ok(corrected.song.rests.length);
  assert.ok(
    corrected.song.tracks.flatMap((t) => t.notes).some((n) => n.pitch === 65),
  );
  log("Noten- und Pausenkorrektur mit gespeicherter Prüffreigabe");
  await open("orchestra-scan");
  await recognize();
  await page.getByText("Klavierfassung bereit.", { exact: true }).waitFor();
  await page
    .getByLabel("Schwierigkeitsgrad Klavierreduktion")
    .selectOption("medium");
  await page
    .getByRole("button", { name: "Klavierfassung erstellen", exact: true })
    .click();
  await page.getByText("Klavierfassung bereit.", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(results, "pdf-03-orchestra.png") });
  await save("MIDI speichern", "orchestra.mid");
  log("Orchester-Scan mit B-Klarinette automatisch auf Klavier reduziert");
  await page
    .getByRole("button", { name: "Als Swing arrangieren", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Swing-Arrangement erstellen", exact: true })
    .waitFor();
  log("Swing bleibt als optionaler zweiter Schritt erreichbar");
  await open("solo");
  await recognize();
  await page
    .getByRole("heading", { name: "Noten prüfen und korrigieren", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "MIDI speichern", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: path.join(results, "pdf-04-review-required.png"),
  });
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Original übernehmen", exact: true })
      .isDisabled(),
    true,
  );
  log(
    "Überfüllter Takt öffnet die Prüfung und verhindert automatische Klavierausgabe",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  log("Keine Rendererfehler oder externen Netzwerkanfragen");
  await writeFile(
    path.join(results, "pdf-e2e-report.json"),
    JSON.stringify(
      { passed: true, steps, errors, externalRequests: network, dataDir },
      null,
      2,
    ),
  );
} catch (e) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(results, "pdf-failure.png") })
      .catch(() => {});
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw e;
} finally {
  await app?.close().catch(() => {});
}
