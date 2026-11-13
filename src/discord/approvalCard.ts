import type { ApprovalRequest } from "../agent/approval.js";
import { bareBoxTool, type Tier } from "../homebox/classify.js";

/**
 * What an approval request looks like in Discord. Pure, so the wording is
 * unit tested; discord/approvals.ts turns it into an embed with buttons.
 *
 * The card has to be decidable on a phone in a few seconds: one line saying
 * what will happen, one saying why it is being asked, and the exact input
 * underneath for anyone who wants to check it.
 */

export interface Card {
  readonly title: string;
  readonly summary: string;
  readonly reason: string;
  /** The tool input, pretty-printed and clipped to fit an embed. */
  readonly detail: string;
  readonly color: number;
  /** Whether to offer "approve the rest of this reply". Never for destructive calls. */
  readonly offerApproveRest: boolean;
}

const TIER_LOOK: Record<Tier, { label: string; color: number }> = {
  read: { label: "Read", color: 0x95a5a6 },
  write: { label: "Change", color: 0xf39c12 },
  destructive: { label: "Destructive", color: 0xe74c3c },
};

const MAX_DETAIL = 3500;

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

/** One line saying what the call will do. */
export function summarizeCall(toolName: string, input: unknown): string {
  const t = bareBoxTool(toolName);
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

export function renderDetail(input: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(input ?? null, null, 2);
  } catch {
    json = String(input);
  }
  // A literal fence in the input would close ours early.
  json = json.replace(/```/g, "ˋˋˋ");
  if (json.length > MAX_DETAIL) json = `${json.slice(0, MAX_DETAIL)}\n… (${json.length - MAX_DETAIL} more characters)`;
  return `\`\`\`json\n${json}\n\`\`\``;
}

export function buildCard(req: ApprovalRequest): Card {
  const look = TIER_LOOK[req.tier];
  return {
    title: `${look.label} — needs approval`,
    summary: summarizeCall(req.toolName, req.input),
    reason: req.reason,
    detail: renderDetail(req.input),
    color: look.color,
    offerApproveRest: req.tier !== "destructive",
  };
}

/** The line the card is left with once it is decided. */
export function outcomeLine(
  outcome:
    | { kind: "approved"; by: string; rest?: boolean }
    | { kind: "denied"; by: string }
    | { kind: "timeout"; minutes: number }
    | { kind: "stopped" },
): string {
  switch (outcome.kind) {
    case "approved":
      return outcome.rest
        ? `✅ Approved by <@${outcome.by}>, with the rest of this reply`
        : `✅ Approved by <@${outcome.by}>`;
    case "denied":
      return `🚫 Denied by <@${outcome.by}>`;
    case "timeout":
      return `⏱️ Nobody answered within ${outcome.minutes} min — not done`;
    case "stopped":
      return "🛑 Stopped — not done";
  }
}
