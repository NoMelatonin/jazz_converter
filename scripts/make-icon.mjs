import { _electron as electron } from "playwright";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const app = await electron.launch({
  args: [process.cwd()],
  env: {
    ...process.env,
    JAZZ_DATA_DIR: await mkdtemp(path.join(tmpdir(), "jazz-icon-")),
  },
});
try {
  const page = await app.firstWindow(),
    svg = await readFile("public/icon.svg", "utf8");
  const chunks = [];
  for (const [size, type] of [
    [256, "ic08"],
    [512, "ic09"],
    [1024, "ic10"],
  ]) {
    const url = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image();
        image.src = "data:image/svg+xml;base64," + btoa(svg);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png");
      },
      { svg, size },
    );
    const png = Buffer.from(url.split(",")[1], "base64");
    if (size === 1024) await writeFile("public/icon.png", png);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(
    chunks.reduce((n, c) => n + c.length, 8),
    4,
  );
  await writeFile("public/icon.icns", Buffer.concat([header, ...chunks]));
} finally {
  await app.close();
}
