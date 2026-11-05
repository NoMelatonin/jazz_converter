import { cp, rm, mkdir } from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["desktop/main.ts", "desktop/preload.ts", "desktop/worker.ts"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
});

await rm("dist-electron/video", { recursive: true, force: true });
await mkdir("dist-electron/video", { recursive: true });
for (const file of ["runner.py", "requirements.txt", "NOTICE.md"])
  await cp(`scripts/video/${file}`, `dist-electron/video/${file}`);
