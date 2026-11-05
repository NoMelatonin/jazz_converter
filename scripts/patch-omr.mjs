import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
const run = promisify(execFile),
  root = path.resolve("resources/omr");
const archive = unzipSync(
  await readFile(path.join(root, "audiveris-source-5.11.0.zip")),
  { filter: (f) => f.name.endsWith("/org/audiveris/omr/WellKnowns.java") },
);
let source = strFromU8(Object.values(archive)[0]).replace(/\r\n/g, "\n");
const signature = "private static Path getFolder (FolderKind kind)\n    {";
if (!source.includes(signature))
  throw new Error("Upstream changed: isolation patch must be reviewed.");
source = source.replace(
  signature,
  signature +
    `
        // Jazz Converter: keep OMR config, data and logs in the app's private
        // directory without changing HOME or the user's Audiveris installation.
        final String privateRoot = System.getProperty("jazz.omr.userRoot");
        if (privateRoot != null) {
            return Paths.get(privateRoot).resolve(kind.name().toLowerCase(Locale.ROOT));
        }
`,
);
const directory = path.join(root, "patch"),
  file = path.join(directory, "src/org/audiveris/omr/WellKnowns.java");
await mkdir(path.dirname(file), { recursive: true });
await mkdir(path.join(directory, "classes"), { recursive: true });
await writeFile(file, source);
await run("/usr/bin/javac", [
  "-cp",
  path.join(root, "arm64/Audiveris.app/Contents/app/*"),
  "-d",
  path.join(directory, "classes"),
  file,
]);
await run("/usr/bin/jar", [
  "--create",
  "--file",
  path.join(root, "jazz-omr-isolation.jar"),
  "-C",
  path.join(directory, "classes"),
  ".",
]);
await writeFile(
  path.join(directory, "README.txt"),
  "Audiveris 5.11.0 modification for Jazz Converter, AGPL-3.0-or-later.\nOnly WellKnowns.getFolder changes: system property jazz.omr.userRoot takes precedence over platform user folders. HOME remains unchanged. Original copyright and license headers are preserved. Build recipe: scripts/patch-omr.mjs (provided with the application source).\n",
);
await writeFile(
  path.join(directory, "patch-omr.mjs"),
  await readFile("scripts/patch-omr.mjs"),
);
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
manifest.isolationPatchSha256 = createHash("sha256")
  .update(source)
  .digest("hex");
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Private OMR data-directory patch built; corresponding source included.",
);
