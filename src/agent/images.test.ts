import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareImages } from "./images.js";

describe("prepareImages", () => {
  it("shrinks a large photo to a JPEG block and leaves non-images and junk out", async () => {
    const work = await mkdtemp(join(tmpdir(), "box-img-"));
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#c33" } }).png().toBuffer();
    await writeFile(join(work, "big.png"), big);
    await writeFile(join(work, "broken.jpg"), Buffer.from("not an image"));
    await writeFile(join(work, "manual.pdf"), Buffer.from("%PDF-1.4"));

    const r = await prepareImages(work, [
      { path: "big.png", name: "big.png", contentType: "image/png", bytes: big.length, image: true },
      { path: "broken.jpg", name: "broken.jpg", contentType: "image/jpeg", bytes: 12, image: true },
      { path: "manual.pdf", name: "manual.pdf", contentType: "application/pdf", bytes: 8, image: false },
    ]);

    expect([...r.shown]).toEqual(["big.png"]);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]?.source.media_type).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(r.blocks[0]!.source.data, "base64")).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1568);
  });
});
