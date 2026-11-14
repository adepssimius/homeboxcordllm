import type { ToolCall } from "discordllm";
import { BOX_SERVER } from "./classify.js";

/**
 * What a Homebox call looks like on an approval card. Pure, so the wording is
 * unit tested. The card has to be decidable on a phone in a few seconds: this
 * is the one line saying what will happen.
 */

function field(input: unknown, key: string): unknown {
  return input !== null && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined;
}

function str(input: unknown, key: string): string | undefined {
  const v = field(input, key);
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** `set_warranty` → "set warranty". */
const words = (tool: string): string => tool.replace(/_/g, " ");

const VERBS: Record<string, string> = {
  create_item: "Add item",
  create_location: "Add location",
  attach_document: "Attach a file to",
  set_item: "Update",
  set_location: "Update location",
  set_fields: "Set custom fields on",
  set_identity: "Set make/model/serial on",
  set_warranty: "Set warranty on",
  set_tags: "Tag",
  set_tag: "Update tag",
  move_item: "Move",
  mark_sold: "Mark sold:",
  duplicate_item: "Duplicate",
  rename_attachment: "Rename an attachment on",
  log_maintenance: "Log maintenance on",
  set_maintenance: "Update maintenance on",
  finalize_photos: "Set primary photos and generate thumbnails",
  import_csv: "Import items from CSV",
  delete_item: "Delete item",
  delete_location: "Delete location",
  delete_tag: "Delete tag",
  delete_attachment: "Delete an attachment from",
  delete_maintenance: "Delete a maintenance entry from",
};

/** One line saying what the call will do, for the approval card. */
export function summarizeCall(call: ToolCall): string | undefined {
  if (call.server !== BOX_SERVER) return undefined;
  const t = call.tool;
  const input = call.input;
  const subject = str(input, "identifier") ?? str(input, "name");
  const verb = VERBS[t] ?? words(t).charAt(0).toUpperCase() + words(t).slice(1);

  if (t === "import_csv") {
    const csv = str(input, "csv_text") ?? "";
    const rows = Math.max(0, csv.split("\n").filter((l) => l.trim()).length - 1);
    return `${verb} (${rows} row${rows === 1 ? "" : "s"})`;
  }
  if (t === "finalize_photos") return verb;

  let line = subject ? `${verb} “${subject}”` : verb;
  const to = str(input, "location");
  if (to) line += ` → \`${to}\``;
  return line;
}
