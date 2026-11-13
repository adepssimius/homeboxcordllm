import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";

/**
 * The workspace: the agent's working directory, shared by every thread.
 *
 *   CLAUDE.md   the inventory notes. Claude Code loads a project CLAUDE.md into
 *               every session by itself, so what the agent writes there — that
 *               "the garage" means `Garage/Shelf A`, which custom fields are in
 *               use, how things get tagged — is known in the next thread.
 *   inbox/      photos and files people post in Discord, one folder per
 *               conversation. The agent looks at them and hands their paths to
 *               homebox-mcp's `attach_document`.
 *   labels/     labels and QR codes homebox-mcp generates. The bot posts any
 *               new file here back to the thread.
 *
 * The notes are seeded once and never overwritten afterwards.
 */

export const NOTES_FILE = "CLAUDE.md";
export const INBOX_DIR = "inbox";
export const LABEL_DIR = "labels";

export const NOTES_SEED = `# Inventory notes

Kept by homeboxcordllm. Loaded into every conversation. Short, current, no secrets.

## Locations and what people call them

## Tagging and custom-field conventions

## Item naming conventions

## Recurring tasks and decisions
`;

export async function ensureWorkspace(cfg: Config): Promise<{ dir: string; seeded: boolean }> {
  const dir = cfg.workDir;
  await mkdir(dir, { recursive: true });
  await mkdir(cfg.inboxDir, { recursive: true });
  await mkdir(cfg.labelDir, { recursive: true });
  const notes = join(dir, NOTES_FILE);
  try {
    await access(notes);
    return { dir, seeded: false };
  } catch {
    // `wx`: if two processes race, the loser fails instead of clobbering.
    await writeFile(notes, NOTES_SEED, { flag: "wx" }).catch(() => undefined);
    return { dir, seeded: true };
  }
}

/**
 * Deletes inbox and label files older than the retention window. Once a photo
 * is attached it lives in Homebox; the inbox copy only matters while the
 * conversation is still going.
 */
export async function pruneWorkspace(cfg: Config, now = Date.now()): Promise<number> {
  const cutoff = now - cfg.INBOX_RETENTION_DAYS * 86_400_000;
  let removed = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        if ((await readdir(p).catch(() => ["x"])).length === 0) await rm(p, { recursive: true }).catch(() => undefined);
        continue;
      }
      const s = await stat(p).catch(() => undefined);
      if (s && s.mtimeMs < cutoff) {
        await rm(p).catch(() => undefined);
        removed += 1;
      }
    }
  };
  await walk(cfg.inboxDir);
  await walk(cfg.labelDir);
  return removed;
}
