import {
  mkdir,
  readFile,
  writeFile,
  cp,
  mkdtemp,
  readdir,
  readlink,
  unlink,
  symlink,
  access,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
const run = promisify(execFile),
  version = "5.11.0";
const base = path.resolve("resources/omr");
await mkdir(base, { recursive: true });
const downloads = path.resolve("resources/omr-downloads");
await mkdir(downloads, { recursive: true });
async function fetchFile(url, file) {
  try {
    return await readFile(file);
  } catch {}
  console.log(`Downloading ${path.basename(file)} …`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(180000),
    headers: { "User-Agent": "Jazz-Converter-build/2.0" },
  });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(file, bytes);
  return bytes;
}
const response = await fetch(
  `https://api.github.com/repos/Audiveris/audiveris/releases/tags/${version}`,
  { headers: { "User-Agent": "Jazz-Converter-build/2.0" } },
);
if (!response.ok) throw new Error(`Release metadata: ${response.status}`);
const release = await response.json(),
  manifest = {
    version,
    assets: [],
    source: `https://github.com/Audiveris/audiveris/tree/${version}`,
  };
for (const [arch, assetArch] of [
  ["arm64", "arm64"],
  ["x64", "x86_64"],
]) {
  const asset = release.assets.find(
    (a) =>
      a.name.includes("macosx") &&
      a.name.includes(assetArch) &&
      a.name.endsWith(".dmg"),
  );
  if (!asset)
    throw new Error(`No ${arch} macOS installer in Audiveris ${version}`);
  const file = path.join(downloads, asset.name),
    bytes = await fetchFile(asset.browser_download_url, file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (asset.digest && asset.digest !== `sha256:${hash}`)
    throw new Error(`Checksum mismatch: ${asset.name}`);
  const destination = path.join(base, arch, "Audiveris.app");
  try {
    await readFile(path.join(destination, "Contents/Info.plist"));
  } catch {
    const mount = await mkdtemp(path.join(tmpdir(), "jazz-audiveris-"));
    // Audiveris' DMG contains its AGPL notice as an interactive SLA. It is the
    // same free-software license distributed with the engine and its source.
    const mounting = new Promise((resolve, reject) => {
      const child = execFile(
        "/usr/bin/hdiutil",
        ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, file],
        { timeout: 60000 },
        (error, stdout, stderr) =>
          error
            ? reject(new Error(`${error.message}\n${stderr}`))
            : resolve(stdout),
      );
      child.stdin.end("Y\n");
    });
    await mounting;
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(mount, "Audiveris.app"), destination, {
        recursive: true,
        verbatimSymlinks: true,
      });
    } finally {
      await run("/usr/bin/hdiutil", ["detach", mount]);
    }
  }
  // Older Node cp() defaults can turn relative JRE license links into absolute
  // paths pointing at the temporary mounted DMG. Keep the runtime portable.
  const portableLinks = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await portableLinks(file);
      else if (entry.isSymbolicLink()) {
        const target = await readlink(file),
          marker = "Audiveris.app/";
        if (path.isAbsolute(target) && target.includes(marker)) {
          const internal = path.join(
            destination,
            target.slice(target.indexOf(marker) + marker.length),
          );
          await access(internal);
          await unlink(file);
          await symlink(path.relative(path.dirname(file), internal), file);
        }
      }
    }
  };
  await portableLinks(destination);
  manifest.assets.push({
    arch,
    url: asset.browser_download_url,
    sha256: hash,
    bytes: bytes.length,
  });
  console.log(`Ready: ${arch}`);
}
await fetchFile(
  `https://github.com/Audiveris/audiveris/archive/refs/tags/${version}.zip`,
  path.join(base, "audiveris-source-5.11.0.zip"),
);
await mkdir(path.join(base, "tessdata"), { recursive: true });
for (const lang of ["eng", "deu"]) {
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0/${lang}.traineddata`;
  const bytes = await fetchFile(
    url,
    path.join(downloads, `tessdata-legacy-4.1.0-${lang}.traineddata`),
  );
  await writeFile(path.join(base, "tessdata", `${lang}.traineddata`), bytes);
  manifest.assets.push({
    language: lang,
    url,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  });
}
await fetchFile(
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.1.0/LICENSE",
  path.join(base, "tessdata/LICENSE"),
);
await fetchFile(
  `https://raw.githubusercontent.com/Audiveris/audiveris/${version}/LICENSE`,
  path.join(base, "LICENSE-Audiveris.txt"),
);
await writeFile(
  path.join(base, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Audiveris, native runtimes, models, OCR data and corresponding source are ready.",
);
