import { resolve } from "node:path";
import sharp from "sharp";
import type { PostedFile } from "../session/types.js";

/**
 * Turns posted photos into image blocks the model sees in the message itself,
 * so "what is this?" costs no tool call.
 *
 * Every image is re-encoded: rotated upright from its EXIF orientation,
 * shrunk to fit 1568px on the long side (beyond which the API downsamples
 * anyway), and saved as JPEG. A 6 MB phone photo becomes a few hundred KB,
 * well under the API's per-image limit. The original on disk is untouched —
 * that is what gets attached in Homebox.
 *
 * A format sharp cannot decode (HEIC, in the prebuilt binaries) is left out
 * here; the prompt tells the agent to Read it instead.
 */

export interface ImageBlock {
  readonly type: "image";
  readonly source: { readonly type: "base64"; readonly media_type: "image/jpeg"; readonly data: string };
}

export interface Prepared {
  readonly blocks: readonly ImageBlock[];
  /** Workspace-relative paths of the files that were turned into blocks. */
  readonly shown: ReadonlySet<string>;
}

const LONG_SIDE = 1568;
/** Per turn. More than this and the person is bulk-uploading; the agent can Read the rest. */
export const MAX_INLINE_IMAGES = 20;

export async function prepareImages(workDir: string, files: readonly PostedFile[]): Promise<Prepared> {
  const blocks: ImageBlock[] = [];
  const shown = new Set<string>();
  for (const f of files) {
    if (!f.image || blocks.length >= MAX_INLINE_IMAGES) continue;
    try {
      const buf = await sharp(resolve(workDir, f.path), { failOn: "none" })
        .rotate()
        .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 85 })
        .toBuffer();
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } });
      shown.add(f.path);
    } catch {
      // Undecodable here; the agent is told to Read it.
    }
  }
  return { blocks, shown };
}
