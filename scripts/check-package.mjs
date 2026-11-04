import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const run = promisify(execFile),
  checks = [];
for (const arch of ["arm64", "x64"]) {
  const dmg = path.resolve(
    `release/Jazz Converter-1.0.0${arch === "arm64" ? "-arm64" : ""}.dmg`,
  );
  const mount = await mkdtemp(path.join(tmpdir(), "jazz-dmg-"));
  await run("/usr/bin/hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
    dmg,
  ]);
  try {
    const bundle = path.join(mount, "Jazz Converter.app");
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
    console.log(`PASS ${arch}: DMG geöffnet, App-Signatur vollständig geprüft`);
    if (arch === "arm64") {
      const result = await run(process.execPath, ["scripts/e2e.mjs"], {
        env: {
          ...process.env,
          JAZZ_TEST_EXECUTABLE: path.join(
            bundle,
            "Contents/MacOS/Jazz Converter",
          ),
        },
        maxBuffer: 8 * 1024 * 1024,
      });
      console.log(result.stdout);
    }
    checks.push({
      arch,
      dmg,
      signature: "verified",
      e2e:
        arch === "arm64"
          ? "passed from read-only DMG"
          : "not run on Intel hardware",
    });
  } finally {
    await run("/usr/bin/hdiutil", ["detach", mount]);
  }
}
await writeFile(
  "test-results/package-report.json",
  JSON.stringify(checks, null, 2),
);
