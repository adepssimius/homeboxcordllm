import type { Classification, ToolCall } from "discordllm";

/**
 * Sorts every Homebox tool call into a tier, which decides whether it waits
 * for a person to press Approve in Discord. Pure, so every rule is unit tested.
 *
 *   read         looks, changes nothing — never asks
 *   write        creates or edits inventory: items, locations, tags, fields,
 *                attachments, maintenance — asks only at APPROVAL_LEVEL=write
 *   destructive  deletes, and bulk CSV import — asks unless APPROVAL_LEVEL=none
 *
 * It fails toward asking: a tool this file has never heard of (a newer
 * homebox-mcp, say) is `write` unless its name says it deletes. The names are
 * homebox-mcp 1.5's; its readOnlyHint / destructiveHint annotations were the
 * starting point.
 */

export const TIERS = ["read", "write", "destructive"] as const;
export type Tier = (typeof TIERS)[number];

/** The MCP server name the bot registers homebox-mcp under. Tool names arrive as `mcp__homebox__<tool>`. */
export const BOX_SERVER = "homebox";
/**
 * Read-only. Includes the tools that only write a *local* file (a label PNG,
 * a QR code, a CSV export, a downloaded attachment): they change nothing in
 * Homebox, and where the file lands is policed by the bot's policy (bot.ts).
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

const LOCAL_FILE_ONLY = new Set(["get_attachment", "export_csv", "generate_label", "qrcode"]);

/** Sorts a call into a tier. Says nothing about tools that are not Homebox's. */
export function classify(call: Pick<ToolCall, "server" | "tool">): (Classification & { tier: Tier }) | undefined {
  if (call.server !== BOX_SERVER) return undefined;
  const t = call.tool;
  if (READ_TOOLS.has(t)) return { tier: "read", reason: LOCAL_FILE_ONLY.has(t) ? "only writes a local file" : "only reads" };
  if (DESTRUCTIVE_TOOLS.has(t)) return { tier: "destructive", reason: `${t} can overwrite many items at once` };
  if (DESTRUCTIVE_PREFIXES.some((p) => t.startsWith(p))) return { tier: "destructive", reason: `${t} deletes` };
  return { tier: "write", reason: `${t} changes the inventory` };
}

/**
 * The path-valued arguments of each tool, keyed by argument name. The
 * homebox-mcp subprocess reads and writes the local filesystem with these, so
 * the bot's policy (bot.ts) confines them to the workspace exactly like the agent's own
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
export const URL_ARGS = ["source"] as const;
