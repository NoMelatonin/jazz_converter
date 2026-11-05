import { mkdir, cp } from "node:fs/promises";
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
  await mkdir("public/pdf", { recursive: true });
  await cp(`node_modules/pdfjs-dist/${name}`, `public/pdf/${name}`, {
    recursive: true,
  });
}
