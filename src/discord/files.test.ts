import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isImage, planAttachments, safeName, saveAttachments, type IncomingAttachment } from "./files.js";

const att = (over: Partial<IncomingAttachment> = {}): IncomingAttachment => ({
  id: "1",
  name: "drill.jpg",
  url: "https://cdn.example/drill.jpg",
  size: 1000,
  contentType: "image/jpeg",
  ...over,
});

describe("planAttachments", () => {
  const limits = { maxBytes: 5000, maxCount: 2 };

  it("keeps photos and documents, drops video, oversize and overflow", () => {
    const p = planAttachments(
      [
        att(),
        att({ name: "clip.mp4", contentType: "video/mp4" }),
        att({ name: "huge.png", size: 9000 }),
        att({ name: "manual.pdf", contentType: "application/pdf" }),
        att({ name: "third.jpg" }),
      ],
      limits,
    );
    expect(p.accept.map((a) => a.name)).toEqual(["drill.jpg", "manual.pdf"]);
    expect(p.skipped).toHaveLength(3);
    expect(p.skipped.join("\n")).toMatch(/clip\.mp4: video/);
    expect(p.skipped.join("\n")).toMatch(/huge\.png: larger than/);
    expect(p.skipped.join("\n")).toMatch(/third\.jpg: more than 2/);
  });
});

describe("safeName", () => {
  it("keeps a normal name recognisable and unique per message", () => {
    expect(safeName("99", 0, "IMG_4412.HEIC")).toBe("99-1-IMG_4412.heic");
  });

  it("cannot escape the folder", () => {
    const n = safeName("99", 1, "../../etc/passwd");
    expect(n).not.toContain("/");
    expect(n.startsWith("99-2-")).toBe(true);
  });
});

describe("isImage", () => {
  it("trusts the content type, else the extension", () => {
    expect(isImage("image/png", "x")).toBe(true);
    expect(isImage(null, "IMG_1.HEIC")).toBe(true);
    expect(isImage("application/pdf", "manual.pdf")).toBe(false);
  });
});

describe("saveAttachments", () => {
  it("saves into the session's inbox and reports workspace-relative paths", async () => {
    const work = await mkdtemp(join(tmpdir(), "box-files-"));
    const inbox = join(work, "inbox");
    const fetchImpl = (async () => new Response(new Uint8Array([1, 2, 3]))) as typeof fetch;
    const r = await saveAttachments([att()], {
      inboxDir: inbox,
      workDir: work,
      sessionId: "s1",
      messageId: "m1",
      maxBytes: 10,
      fetchImpl,
    });
    expect(r.failed).toEqual([]);
    expect(r.saved).toEqual([
      { path: join("inbox", "s1", "m1-1-drill.jpg"), name: "drill.jpg", contentType: "image/jpeg", bytes: 3, image: true },
    ]);
    expect([...(await readFile(join(work, r.saved[0]!.path)))]).toEqual([1, 2, 3]);
  });

  it("refuses a download bigger than Discord said it was", async () => {
    const work = await mkdtemp(join(tmpdir(), "box-files-"));
    const fetchImpl = (async () => new Response(new Uint8Array(50))) as typeof fetch;
    const r = await saveAttachments([att()], {
      inboxDir: join(work, "inbox"),
      workDir: work,
      sessionId: "s1",
      messageId: "m1",
      maxBytes: 10,
      fetchImpl,
    });
    expect(r.saved).toEqual([]);
    expect(r.failed[0]).toMatch(/larger than the limit/);
  });
});
