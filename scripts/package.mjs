import { build, Platform, Arch } from "electron-builder";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

// Build outside Desktop/iCloud File Provider: it can reattach Finder metadata
// between afterPack and codesign. Only finished artifacts are copied back.
const staging = await mkdtemp(path.join(tmpdir(), "jazz-package-"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const local = process.argv.includes("--local");
await build({
  targets: Platform.MAC.createTarget(
    local ? "dir" : "dmg",
    ...(local ? [Arch.arm64] : [Arch.arm64, Arch.x64]),
  ),
  config: {
    ...pkg.build,
    directories: { ...pkg.build.directories, output: staging },
  },
});
await mkdir("release", { recursive: true });
for (const name of await readdir(staging))
  await cp(path.join(staging, name), path.join("release", name), {
    recursive: true,
    force: true,
  });
await rm(staging, { recursive: true, force: true });
console.log("macOS artifacts copied to release/.");
