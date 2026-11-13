import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { PostedFile } from "../session/types.js";

/**
 * Files people post with a message: photos of an item, a receipt, a PDF
 * manual. Each is saved under `inbox/<session>/` in the workspace, where the
 * agent can look at it and homebox-mcp can upload it.
 *
 * Saved when the message arrives, not when its turn runs: Discord's CDN links
 * are signed and expire, and a message can sit in a thread's queue behind a
 * long turn.
 */

export interface IncomingAttachment {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly contentType: string | null;
}

export interface Planned {
  readonly accept: readonly IncomingAttachment[];
  /** One line each, for the reply: what was not saved and why. */
  readonly skipped: readonly string[];
}

/** Video and audio are no use to the inventory and are large. Everything else is kept. */
const UNWANTED = /^(video|audio)\//;

export function planAttachments(
  all: readonly IncomingAttachment[],
  limits: { readonly maxBytes: number; readonly maxCount: number },
): Planned {
  const accept: IncomingAttachment[] = [];
  const skipped: string[] = [];
  for (const a of all) {
    if (a.contentType && UNWANTED.test(a.contentType)) {
      skipped.push(`${a.name}: ${a.contentType.split("/")[0]} files aren't used`);
    } else if (a.size > limits.maxBytes) {
      skipped.push(`${a.name}: larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB`);
    } else if (accept.length >= limits.maxCount) {
      skipped.push(`${a.name}: more than ${limits.maxCount} files in one message`);
    } else {
      accept.push(a);
    }
  }
  return { accept, skipped };
}

/**
 * A filename that is safe on disk and still recognisable: `IMG_4412.HEIC`
 * stays `IMG_4412.HEIC`; `../../etc/passwd` becomes `etc_passwd`. Prefixed
 * with the message id and position, so two `image.png` never collide.
 */
export function safeName(messageId: string, index: number, name: string): string {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
  const stem = name
    .slice(0, name.length - extname(name).length)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(0, 60);
  return `${messageId}-${index + 1}-${stem || "file"}${ext}`;
}

export function isImage(contentType: string | null, name: string): boolean {
  if (contentType?.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp)$/i.test(name);
}

export async function saveAttachments(
  planned: readonly IncomingAttachment[],
  opts: {
    readonly inboxDir: string;
    readonly workDir: string;
    readonly sessionId: string;
    readonly messageId: string;
    readonly maxBytes: number;
    readonly fetchImpl?: typeof fetch;
  },
): Promise<{ saved: PostedFile[]; failed: string[] }> {
  const dir = join(opts.inboxDir, opts.sessionId);
  await mkdir(dir, { recursive: true });
  const doFetch = opts.fetchImpl ?? fetch;
  const saved: PostedFile[] = [];
  const failed: string[] = [];

  for (const [i, a] of planned.entries()) {
    try {
      const res = await doFetch(a.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // The size Discord reported is a claim; this is the fact.
      if (buf.byteLength > opts.maxBytes) throw new Error("larger than the limit");
      const abs = join(dir, safeName(opts.messageId, i, a.name));
      await writeFile(abs, buf);
      saved.push({
        path: relative(opts.workDir, abs),
        name: a.name,
        contentType: a.contentType,
        bytes: buf.byteLength,
        image: isImage(a.contentType, a.name),
      });
    } catch (e) {
      failed.push(`${a.name}: could not be downloaded (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { saved, failed };
}
