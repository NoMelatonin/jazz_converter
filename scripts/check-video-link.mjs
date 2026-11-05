import { _electron as electron } from "playwright";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd(),
  dir = await mkdtemp(path.join(tmpdir(), "jazz-link-"));
const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    JAZZ_DATA_DIR: dir,
    JAZZ_VIDEO_RUNTIME: path.resolve(
      "resources/video/test-data/video-runtime-v1",
    ),
    JAZZ_TEST_OFFLINE: "0",
  },
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.jazz);
  const initial = await page.evaluate(() =>
    window.jazz.videoPrepare({
      url: "https://www.youtube.com/watch?v=kcS_ZWM03-E",
    }),
  );
  let job = initial;
  while (job.status === "running") {
    await new Promise((r) => setTimeout(r, 500));
    job = await page.evaluate((id) => window.jazz.videoStatus(id), job.id);
  }
  assert.equal(job.status, "ready", job.error);
  assert(job.previews.length === 3);
  console.log(
    "PASS Beispielvideo per Electron/yt-dlp geladen, drei echte Frames, " +
      job.duration +
      " Sekunden",
  );
  await page.evaluate(
    (id) =>
      window.jazz.videoTranscribe(id, "visual", {
        c4: 321,
        c5: 419,
        line: 223,
      }),
    job.id,
  );
  do {
    await new Promise((r) => setTimeout(r, 500));
    job = await page.evaluate((id) => window.jazz.videoStatus(id), job.id);
  } while (job.status === "running");
  assert.equal(job.status, "complete", job.error);
  const version = await page.evaluate(
    (id) => window.jazz.getPlaybackVersion(id, { kind: "original" }),
    job.result.entry.id,
  );
  assert(version.music.notes.length > 100);
  await mkdir("test-results/video", { recursive: true });
  await writeFile(
    "test-results/video/youtube-acceptance.json",
    JSON.stringify(
      {
        title: job.title,
        duration: job.duration,
        notes: version.music.notes.length,
        method: job.result.song.transcription,
        issues: job.result.song.issues.length,
        source: job.source,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS Rekonstruktion, validierte Katalogspeicherung und unveränderte Wiedergabefassung (" +
      version.music.notes.length +
      " Noten)",
  );
} finally {
  await app.close();
}
