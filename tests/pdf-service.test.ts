import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PdfService } from "../desktop/pdf-service";

test("PDF staging validates inputs, preserves source bytes and checks pages before starting Java", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jazz-pdf-unit-"));
  const service = new PdfService(
    dir,
    path.resolve("resources/omr"),
    async () => {
      throw new Error("No commit expected");
    },
  );
  try {
    await service.init();
    const file = path.resolve("tests/fixtures/pdf/piano.pdf"),
      bytes = await readFile(file),
      doc = await service.prepare(file);
    expect(Buffer.from(await service.bytes(doc.id))).toEqual(bytes);
    expect((await service.prepare(file)).id).toBe(doc.id);
    await expect(service.start(doc.id, [2], 0)).rejects.toThrow(/gültige PDF/);
    await expect(service.start(doc.id, [1], 45)).rejects.toThrow(/gültige PDF/);
    const bad = path.join(dir, "bad.pdf");
    await writeFile(bad, "not a PDF");
    await expect(service.prepare(bad)).rejects.toThrow(/gültige PDF/);
    await writeFile(bad, "%PDF-1.7\ntruncated");
    await expect(service.prepare(bad)).rejects.toThrow(/beschädigt/);
    await expect(service.bytes("../escape")).rejects.toThrow(/Ungültiger PDF/);
  } finally {
    service.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
