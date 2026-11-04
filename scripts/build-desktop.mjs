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
