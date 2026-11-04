import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import assert from "node:assert/strict";
import { parseMidi, writeMidi } from "midi-file";

const root = process.cwd(),
  results = path.join(root, "test-results");
await mkdir(results, { recursive: true });
const dataDir = await mkdtemp(path.join(tmpdir(), "jazz-e2e-"));
await build({
  entryPoints: ["src/core/demo.ts"],
  outfile: path.join(results, "demo.cjs"),
  platform: "node",
  format: "cjs",
  bundle: true,
});
const { demoMidi, demoXml } = createRequire(import.meta.url)(
  path.join(results, "demo.cjs"),
);
const midiPath = path.join(dataDir, "Mehrspuriger Import.mid");
const fixture = parseMidi(demoMidi());
fixture.tracks[0][0].text = "Importtest Bruder Jakob";
await writeFile(midiPath, new Uint8Array(writeMidi(fixture)));
const xmlPath = path.join(dataDir, "Import.musicxml");
await writeFile(xmlPath, demoXml());
let app, page;
const errors = [],
  network = [],
  steps = [];
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
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) network.push(request.url());
  });
  await page
    .getByRole("button", { name: /Bruder Jakob.*Melodie mit Akkorden/ })
    .waitFor();
  await page.evaluate(() => {
    window.__audioProbes = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        connect.call(this, analyser);
        window.__audioProbes.push(analyser);
      }
      return result;
    };
  });
}
try {
  await launch();
  await page.screenshot({ path: path.join(results, "01-library.png") });
  await page
    .getByRole("textbox", { name: "Song suchen" })
    .fill("Jakob Traditionell");
  await page.waitForFunction(
    () => document.querySelectorAll(".song-row").length === 2,
  );
  assert.equal(await page.locator(".song-row").count(), 2);
  log("Titelsuche und Versionsauswahl offline");
  await page
    .getByRole("button", { name: /Bruder Jakob.*Melodie mit Akkorden/ })
    .click();
  await page
    .getByRole("button", { name: "Swing-Arrangement erstellen" })
    .click();
  await page
    .getByText("Dein Arrangement ist bereit.", { exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(results, "02-arrangement.png") });
  log("Demo-Arrangement aus MusicXML");
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.waitForFunction(() =>
    window.__audioProbes.some((analyser) => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return samples.some((s) => Math.abs(s) > 0.0001);
    }),
  );
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid="piano-roll"]').dataset.position,
      ) > 1,
    { timeout: 10000 },
  );
  assert.equal(await page.getByRole("alert").count(), 0);
  log(
    "Echte Web-Audio-Wiedergabe mit lokalem Klavier und gemessenem Audiosignal",
  );
  await page.getByRole("button", { name: "Üben", exact: true }).click();
  await page.getByLabel("Übetempo", { exact: true }).selectOption("0.5");
  const posA = Number(
    await page.getByTestId("piano-roll").getAttribute("data-position"),
  );
  await page.waitForTimeout(700);
  const posB = Number(
    await page.getByTestId("piano-roll").getAttribute("data-position"),
  );
  assert.ok(
    posB - posA > 0.3 && posB - posA < 0.9,
    `Half-speed progress ${posB - posA}`,
  );
  await page.getByLabel("Position", { exact: true }).fill("16");
  await page.waitForTimeout(180);
  const jumped = Number(
    await page.getByTestId("piano-roll").getAttribute("data-position"),
  );
  assert.ok(jumped >= 16 && jumped < 17);
  log("Halbes Tempo und Positionssprung");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Nur links", exact: true }).click();
  await page.getByLabel("Wiederholen ab Takt").selectOption("2");
  await page.getByLabel("Wiederholen bis Takt").selectOption("3");
  await page
    .getByRole("button", { name: "Taktbereich wiederholen", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Taktbereich wiederholen", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.screenshot({ path: path.join(results, "03-practice.png") });
  log("Handauswahl und Taktwiederholung");
  const exportPath = path.join(dataDir, "swing.mid");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page
    .getByRole("button", { name: "MIDI speichern", exact: true })
    .first()
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "MIDI gespeichert:" })
    .waitFor();
  const bytes = await readFile(exportPath);
  assert.ok(bytes.length > 200);
  const hash = createHash("sha256").update(bytes).digest("hex");
  log("MIDI-Export durch native Desktop-Schnittstelle");
  const entry = await page.evaluate(async () =>
    (await window.jazz.list()).find((e) => e.format === "MusicXML"),
  );
  const saved = await page.evaluate((id) => window.jazz.load(id), entry.id);
  assert.ok(saved.settings);
  await app.close();
  await launch();
  const settingsReloaded = await page.evaluate(
    (id) => window.jazz.load(id),
    entry.id,
  );
  assert.deepEqual(settingsReloaded.settings, saved.settings);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.evaluate(
    async ({ id, settings }) => {
      await window.jazz.convert(id, settings);
      await window.jazz.saveMidi(id, settings);
    },
    { id: entry.id, settings: saved.settings },
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile(exportPath))
      .digest("hex"),
    hash,
  );
  log("Bytegleicher MIDI-Export nach echtem App-Neustart");
  await app.evaluate(
    ({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    },
    [midiPath, xmlPath],
  );
  await page.getByRole("button", { name: "Datei öffnen", exact: true }).click();
  await page.getByLabel("Melodiestimme").waitFor();
  const all = await page.evaluate(() => window.jazz.list());
  assert.equal(all.length, 3);
  assert.ok(all.some((e) => e.title === "Importtest Bruder Jakob"));
  log("MIDI/MusicXML-Dateiimport und Duplikaterkennung");
  await page.getByLabel("Melodiestimme").waitFor();
  assert.equal(
    await page.getByLabel("Melodiestimme").locator("option").count(),
    3,
  );
  assert.equal(await page.getByLabel("Melodiestimme").inputValue(), "midi-1-0");
  assert.equal(
    await page
      .getByRole("button", { name: "Swing-Arrangement erstellen" })
      .isDisabled(),
    true,
  );
  await page.getByLabel("Melodiestimme").selectOption("midi-3-2");
  await page
    .getByRole("button", { name: "Melodie anhören", exact: true })
    .click();
  await page.getByRole("button", { name: "Abspielen", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Hörprobe schließen", exact: true })
    .click();
  await page.getByLabel("Melodiestimme").selectOption("midi-1-0");
  await page
    .getByRole("button", { name: "Melodie bestätigen", exact: true })
    .click();
  await page.getByRole("button", { name: /Mittel/ }).click();
  await page
    .getByRole("button", { name: "Swing-Arrangement erstellen" })
    .click();
  await page
    .getByText("Dein Arrangement ist bereit.", { exact: true })
    .waitFor();
  log(
    "Mehrspurige MIDI: Vorschlag, Spurwechsel, Hörprobe, Bestätigung und Mittel",
  );
  await page
    .getByRole("button", { name: "Songs entdecken", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Song suchen" }).fill("Menuett");
  assert.equal(await page.locator(".online-row").count(), 3);
  await page
    .getByRole("button", { name: "Herunterladen", exact: true })
    .first()
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Datei importieren" })
    .waitFor();
  log("Online-Katalog mit Offline-Fehlermeldung und Importangebot");
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  log("Keine Rendererfehler und keinerlei externe Netzwerkanfragen");
  await writeFile(
    path.join(results, "e2e-report.json"),
    JSON.stringify(
      {
        passed: true,
        steps,
        midiSha256: hash,
        errors,
        externalRequests: network,
        dataDir,
        manualListening:
          "Noch offen: musikalische Hörabnahme und wahrgenommene Synchronität auf Zielgerät.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(results, "failure.png") })
      .catch(() => {});
    console.error(
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    console.error(
      await page
        .locator("input")
        .evaluateAll((inputs) =>
          inputs.map((input) => ({
            label: input.getAttribute("aria-label"),
            value: input.value,
          })),
        )
        .catch(() => []),
    );
  }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
}
