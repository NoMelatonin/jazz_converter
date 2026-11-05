import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const root = "public/licenses";
await mkdir(root, { recursive: true });
const entries = [];
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory || pkg.dev || !directory.startsWith("node_modules/")) continue;
  let files;
  try {
    files = await readdir(directory);
  } catch {
    continue;
  }
  const info = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const licenseFile = files.find((f) =>
    /^licen[cs]e(?:\.(?:txt|md))?$/i.test(f),
  );
  const filename = info.name.replace(/[@/]/g, "_") + ".txt";
  const licenseText = licenseFile
    ? await readFile(path.join(directory, licenseFile), "utf8")
    : info.name === "@nodable/entities"
      ? await readFile(
          path.join(root, "_nodable_entities-upstream.txt"),
          "utf8",
        )
      : info.name.startsWith('@napi-rs/canvas-') ? await readFile('node_modules/@napi-rs/canvas/LICENSE','utf8') : undefined;
  if (!licenseText) throw new Error(`Missing license: ${directory}`);
  await writeFile(
    path.join(root, filename),
    `${info.name} ${info.version}\n${info.license ?? ""}\n\n${licenseText}`,
  );
  entries.push({
    name: info.name,
    version: info.version,
    license: info.license,
    file: filename,
  });
}
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(entries, null, 2),
);
console.log(`${entries.length} runtime license notices bundled.`);
