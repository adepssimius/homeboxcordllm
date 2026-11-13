import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { bareBoxTool, classify, isBoxTool, isUrl, PATH_ARGS } from "../homebox/classify.js";

/**
 * The synchronous gate on tool calls. Pure, so every rule is unit tested.
 *
 * Three jobs:
 *  - keep the file tools inside the workspace (the agent's notes, the inbox of
 *    posted photos, generated labels) — and away from the volume's database,
 *    other processes' files under /proc, and anything else in the pod;
 *  - hold homebox-mcp to the same rule. It reads and writes local files on
 *    the agent's behalf (`attach_document` uploads a path, `get_attachment`
 *    and the label tools write one), so those paths are confined too;
 *  - keep a scheduled run to looking. Nobody is there to approve a change, so
 *    a scheduled run is refused every Homebox call that is not a read,
 *    whatever the approval level says.
 *
 * Whether an interactive change goes ahead is not decided here. That waits for
 * a person (agent/options.ts `answerPrompt`, discord/approvals.ts), which a
 * synchronous hook cannot do.
 */

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

export interface PolicyInput {
  readonly toolName: string;
  readonly toolInput: unknown;
  /** Absolute path of the workspace — the agent's working directory. */
  readonly workDir: string;
  /** False for a scheduled run. */
  readonly interactive: boolean;
  readonly aborted?: boolean;
}

const ALLOW: Decision = { allow: true };
const deny = (reason: string): Decision => ({ allow: false, reason });

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
/** Never registered (see options.ts); refused here too in case that ever drifts. */
const SHELL_TOOLS = new Set(["Bash", "BashOutput", "KillShell", "KillBash"]);

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function fieldString(input: unknown, key: string): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

/** `~` would be expanded by homebox-mcp (Python's expanduser), so it is never confined. */
function confined(raw: string, workDir: string): boolean {
  if (raw.trim().startsWith("~")) return false;
  const target = resolve(workDir, raw);
  return inside(workDir, target) || inside(resolve(tmpdir()), target);
}

/**
 * Argument names that look like a local path. Checked on every Homebox tool,
 * not just the ones in PATH_ARGS, so a tool added by a newer homebox-mcp is
 * confined before anyone remembers to list it.
 */
const PATHLIKE_KEY = /(^|_)(path|source|dir|file|filename|save_to|dest|destination)$/i;

function boxPaths(i: PolicyInput): Decision {
  const t = bareBoxTool(i.toolName);
  const input = i.toolInput !== null && typeof i.toolInput === "object" ? (i.toolInput as Record<string, unknown>) : {};
  const keys = new Set([...(PATH_ARGS[t] ?? []), ...Object.keys(input).filter((k) => PATHLIKE_KEY.test(k))]);
  for (const key of keys) {
    const raw = fieldString(i.toolInput, key);
    if (raw === undefined || raw.trim() === "") continue;
    if (key === "source" && isUrl(raw)) continue;
    if (!confined(raw, i.workDir)) {
      return deny(`${t}: '${raw}' is outside the workspace — local files stay inside ${i.workDir}`);
    }
  }
  return ALLOW;
}

export function evaluate(i: PolicyInput): Decision {
  if (i.aborted) return deny("this run was stopped from Discord");

  if (SHELL_TOOLS.has(i.toolName)) return deny("there is no shell here — Homebox is reached through its tools");

  if (WRITE_TOOLS.has(i.toolName)) {
    const raw = fieldString(i.toolInput, "file_path") ?? fieldString(i.toolInput, "notebook_path");
    if (!raw) return deny(`${i.toolName} was called without a file path`);
    if (!confined(raw, i.workDir)) return deny(`'${raw}' is outside the workspace — files stay inside ${i.workDir}`);
    return ALLOW;
  }

  if (READ_TOOLS.has(i.toolName)) {
    // Glob and Grep default to the working directory when no path is given.
    const raw = fieldString(i.toolInput, "file_path") ?? fieldString(i.toolInput, "path");
    if (raw && !confined(raw, i.workDir)) return deny(`'${raw}' is outside the workspace — only ${i.workDir} is readable`);
    return ALLOW;
  }

  if (isBoxTool(i.toolName)) {
    const paths = boxPaths(i);
    if (!paths.allow) return paths;

    if (!i.interactive) {
      const c = classify(i.toolName);
      if (c.tier !== "read") {
        return deny(
          `a scheduled run only looks — ${c.reason}. Say in the brief what you would change, ` +
            "and the person can ask for it from the thread",
        );
      }
    }
  }

  return ALLOW;
}

/** Exposed for tests: the directory separator makes path fixtures platform-shaped. */
export const PATH_SEP = sep;
