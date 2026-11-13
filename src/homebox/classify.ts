import type { ApprovalLevel } from "../config.js";

/**
 * Sorts every Homebox tool call into a tier, which decides whether it waits
 * for a person to press Approve in Discord. Pure, so every rule is unit tested.
 *
 *   read         looks, changes nothing — never asks
 *   write        creates or edits inventory: items, locations, tags, fields,
 *                attachments, maintenance — asks only at BOX_APPROVAL_LEVEL=write
 *   destructive  deletes, and bulk CSV import — asks unless BOX_APPROVAL_LEVEL=none
 *
 * It fails toward asking: a tool this file has never heard of (a newer
 * homebox-mcp, say) is `write` unless its name says it deletes. The names are
 * homebox-mcp 1.5's; its readOnlyHint / destructiveHint annotations were the
 * starting point.
 */

export type Tier = "read" | "write" | "destructive";

export interface Classification {
  readonly tier: Tier;
  /** Why, in a phrase, for the approval card and the audit log. */
  readonly reason: string;
}

/** The MCP server name the bot registers homebox-mcp under. Tool names arrive as `mcp__homebox__<tool>`. */
export const BOX_SERVER = "homebox";
const PREFIX = `mcp__${BOX_SERVER}__`;

export function isBoxTool(toolName: string): boolean {
  return toolName.startsWith(PREFIX);
}

export function bareBoxTool(toolName: string): string {
  return toolName.startsWith(PREFIX) ? toolName.slice(PREFIX.length) : toolName;
}

/**
 * Read-only. Includes the tools that only write a *local* file (a label PNG,
 * a QR code, a CSV export, a downloaded attachment): they change nothing in
 * Homebox, and where the file lands is policed by agent/policy.ts.
 */
const READ_TOOLS = new Set([
  "search_items",
  "get_item",
  "list_locations",
  "location_contents",
  "list_tags",
  "warranties_expiring",
  "list_attachments",
  "get_attachment",
  "field_index",
  "barcode_lookup",
  "list_maintenance",
  "inventory_stats",
  "list_custom_fields",
  "export_csv",
  "generate_label",
  "qrcode",
]);

/**
 * import_csv can create or overwrite many entities in one call, with nothing
 * to preview first. It is treated like a delete.
 */
const DESTRUCTIVE_TOOLS = new Set(["import_csv"]);

const DESTRUCTIVE_PREFIXES = ["delete_", "remove_", "purge_", "wipe_"];

const read = (reason: string): Classification => ({ tier: "read", reason });
const write = (reason: string): Classification => ({ tier: "write", reason });
const destructive = (reason: string): Classification => ({ tier: "destructive", reason });

export function classify(toolName: string): Classification {
  const t = bareBoxTool(toolName);
  if (READ_TOOLS.has(t)) return read(t === "get_attachment" || t === "export_csv" || t === "generate_label" || t === "qrcode" ? "only writes a local file" : "only reads");
  if (DESTRUCTIVE_TOOLS.has(t)) return destructive(`${t} can overwrite many items at once`);
  if (DESTRUCTIVE_PREFIXES.some((p) => t.startsWith(p))) return destructive(`${t} deletes`);
  return write(`${t} changes the inventory`);
}

const ASKS_FROM: Record<ApprovalLevel, readonly Tier[]> = {
  write: ["write", "destructive"],
  destructive: ["destructive"],
  none: [],
};

/** Whether a call in this tier waits for a person at this approval level. */
export function needsApproval(tier: Tier, level: ApprovalLevel): boolean {
  return ASKS_FROM[level].includes(tier);
}

/**
 * The path-valued arguments of each tool, keyed by argument name. The
 * homebox-mcp subprocess reads and writes the local filesystem with these, so
 * agent/policy.ts confines them to the workspace exactly like the agent's own
 * file tools. Without this, `attach_document(source="/proc/self/environ")`
 * would upload the Homebox token into Homebox.
 */
export const PATH_ARGS: Readonly<Record<string, readonly string[]>> = {
  attach_document: ["source"],
  get_attachment: ["save_to"],
  export_csv: ["save_to"],
  generate_label: ["out_dir"],
  qrcode: ["out_dir"],
};

/** `attach_document` may also take an http(s) URL — a manual on a manufacturer's site. */
export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}
