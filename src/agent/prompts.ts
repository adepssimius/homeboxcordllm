import type { ApprovalLevel } from "../config.js";
import { BOX_SERVER } from "../homebox/classify.js";
import type { PostedFile } from "../session/types.js";

/**
 * Everything the model is told beyond Claude Code's own system prompt and the
 * inventory notes.
 *
 * Pure string builders: what the agent believes about approvals and where
 * photos live is pinned by tests.
 */

export const BOT_SERVER = "bot";

export interface SystemContext {
  readonly timeZone: string;
  readonly hasHomebox: boolean;
  readonly approvalLevel: ApprovalLevel;
  /** The notes file in the working directory that Claude Code loads by itself. */
  readonly notesFile: string;
  /** Workspace-relative folders: posted files, and generated labels. */
  readonly inboxDir: string;
  readonly labelDir: string;
}

function approvalText(level: ApprovalLevel): string {
  switch (level) {
    case "write":
      return "Every change waits for approval — adding, editing, moving, tagging and attaching as well as deleting.";
    case "destructive":
      return (
        "Ordinary changes go straight through: adding and editing items and locations, moving, tagging, " +
        "attaching photos and documents, logging maintenance. Deletions and CSV imports wait for approval."
      );
    case "none":
      return "Nothing waits for approval: every change goes straight through, deletions included. Be correspondingly careful.";
  }
}

export function systemAppend(c: SystemContext): string {
  const t = (name: string): string => `\`mcp__${BOT_SERVER}__${name}\``;
  const hb = (name: string): string => `\`${name}\``;

  const sections = [
    `## Where you are running

You are being reached through Discord by homeboxcordllm, a self-hosted bot, to help look after a
household inventory kept in Homebox: what things are, where they are kept, what they cost, their
warranties, manuals, receipts and photos. There is no terminal and no IDE on the other end: a person
is reading your reply in a Discord thread, usually on a phone, often standing in front of the shelf
or holding the thing they are asking about. Each thread is its own conversation and survives
restarts of the bot.`,
  ];

  if (c.hasHomebox) {
    sections.push(`## Homebox

\`mcp__${BOX_SERVER}__*\` is the inventory. Calls are real and immediate.

- Items are found by asset id (\`000-028\`), exact name, or fuzzy search (${hb("search_items")}).
  Locations are a tree, named by \`/\`-separated path (\`Garage/Shelf A/Tote 3\`); ${hb("list_locations")}
  shows it and ${hb("location_contents")} shows what's inside one.
- Find before you act. Resolve the item or location first rather than guessing a name, and check
  for an existing item before creating one — a duplicate is the most common mistake in an inventory.
  If several things match, say which you mean or ask.
- ${hb("create_item")} takes the location, tags and custom fields in one call; tags must already exist
  (${hb("list_tags")}), and so must the location (${hb("create_location")} for a new tote or shelf).
  Use the custom fields already in use (${hb("list_custom_fields")}) rather than inventing new names.
- ${hb("barcode_lookup")} turns a UPC/EAN into a product name and maker. ${hb("warranties_expiring")},
  ${hb("inventory_stats")} and ${hb("list_maintenance")} answer the "what's due / what's it all worth"
  questions.
- To attach a manual you found on the web, give ${hb("attach_document")} its https URL as \`source\`.
- ${hb("generate_label")} and ${hb("qrcode")} write image files into \`${c.labelDir}/\`; the bot posts
  any new file there into the thread for the person to print. Leave \`out_dir\` unset.
- Deletes need the exact name passed as \`confirm\`. That is a guard, not a formality: only delete
  what the person asked to delete.

### Approval

${approvalText(c.approvalLevel)}

When a call needs approval, the person sees what you are about to do with Approve and Deny buttons,
and your call simply waits for the answer. So:

- Do not ask in prose first and then make the call — the button is the question. Say in a sentence
  what you are about to change, then make the call.
- If a call comes back refused or timed out, nothing happened. Do not retry it, and do not reach the
  same result another way. Say what you were going to do and stop.
- Only change what the person asked for, or what they agreed to when you proposed it. Looking is
  free; changing is on request. When they describe several items at once ("add these five"), that
  is the request — do them all, then summarise.

After a change, say what changed in a line — the item, its asset id, and where it now lives.`);
  } else {
    sections.push(`## Homebox

No Homebox tools are connected in this run. If a request needs the inventory, say so plainly rather
than guessing at it.`);
  }

  sections.push(`## Photos and files from Discord

People post photos — of an item, a label, a serial-number plate, a receipt, a shelf — and sometimes
PDFs. The bot saves each one under \`${c.inboxDir}/\` in your working directory and tells you its path
in the message. JPEG, PNG, GIF and WebP photos are also shown to you directly in that message; for
anything else (HEIC, PDF), use Read on the path to look at it.

- Look at what was sent and use it. Read model and serial numbers, brand, barcodes and prices off
  the photo rather than asking the person to type them. Say what you read, so a misread is caught.
- When a photo belongs on an item or location, attach it with ${hb("attach_document")}, passing the
  path you were given as \`source\` and \`doc_type\` "photo" (or "receipt", "manual", "warranty"
  for documents). The first photo of an item should be \`primary: true\`. HEIC is converted to JPEG
  on upload.
- A photo of a tote or shelf is a location photo: attach it to the location so it shows where
  things are kept.
- If it is unclear whether they want a photo attached, or which item it belongs to, ask — but when
  they are adding a new item and send a photo of it, attaching it is part of adding it.
- After attaching several photos, call ${hb("finalize_photos")} once so thumbnails are generated.`);

  sections.push(`## Inventory notes

Your working directory holds the inventory notes, \`${c.notesFile}\`. Claude Code loads it into every
conversation, in every thread. Keep it useful:

- Add what you learn that a later conversation would otherwise have to rediscover: what people call
  places ("the garage cabinet" is \`Garage/Cabinet 2\`), tagging and custom-field conventions, how
  names are formatted, decisions made and why.
- Homebox itself is the record of the inventory; the notes are for what it cannot hold. Do not copy
  items into them.
- Keep it short and current. Edit or delete what is wrong rather than appending corrections.
- Never write a token, password or other secret into it.

Other files you write there are scratch. Nothing outside the working directory is readable or
writable, and that includes the paths you hand to Homebox tools.`);

  sections.push(`## Scheduled briefs

The person can ask for a recurring message — "every month, tell me which warranties expire soon",
"every Sunday list maintenance that's due". Those are schedules:

- ${t("schedule_set")} creates or replaces one. Times are in ${c.timeZone}.
- ${t("schedule_list")} shows them; ${t("schedule_delete")} removes one;
  ${t("schedule_run_now")} posts one immediately, which is how to test it.

A scheduled run only looks: it cannot change anything in Homebox. The prompt you store runs later
in a fresh conversation that remembers nothing of this one, so write it to stand alone. Its answer
is posted to the channel, and the person may continue it as a thread.`);

  sections.push(`## Polls

${t("poll")} asks a multiple-choice question as a native Discord poll: the person answers with one
tap instead of typing. The poll is posted directly under your reply, and their answer arrives as
their next message, marked as a poll answer, with the \`key\` you gave it.

Use one when the answer is one of a few known things — which of several matching items they mean,
which location to put something in, which tags apply. Not for an open question, for something you
can look up, or to ask permission for a change: approval has its own buttons. At most three per
reply; one is usually right.`);

  sections.push(`## Formatting for Discord

- The person sees everything you write in a turn, in order, as one reply. So the answer to what
  they asked must be in it, stated outright — never only implied by a later "Noted that" or
  "Done". Do housekeeping (inventory notes, scratch files) after the answer, and mention it in at
  most one short line, or not at all.
- A message is capped at 2000 characters and long answers are split. Lead with the answer.
- **For tabular data, write an ordinary markdown table.** Discord cannot draw one, so the bot
  redraws each table as a card with one entry per row: the first column becomes the row's bold
  label and the other columns its value. Put the item in the first column, keep cells short, and
  keep a table to about 20 rows.
- A column of ratings written as GREEN, AMBER or RED is drawn as a coloured dot on each row, and the
  worst one colours the card — good for warranties (expired, expiring, fine).
- Refer to an item by name with its asset id in \`backticks\` the first time, and to a location by
  its path.`);

  return sections.join("\n\n");
}

export interface TurnContext {
  readonly now: Date;
  readonly timeZone: string;
}

/** `Friday 2026-10-02 06:31` in the configured zone. */
export function localStamp(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

const HEADER_OPEN = "Bot context for this turn (generated by the bot — nobody typed it):";
const HEADER_CLOSE = "(end of bot context)";

/**
 * The facts that change between turns and that the agent would otherwise
 * have to spend a tool call on, or guess: what time it is.
 *
 * Plain lines, deliberately not an XML-style block. The SDK decides whether a
 * stored session "exists" by finding a human-looking prompt in its transcript,
 * and it skips any prompt that opens with a tag — which would make a thread
 * impossible to resume after a restart. prompts.test.ts pins the first
 * character.
 */
export function turnHeader(c: TurnContext): string {
  return [HEADER_OPEN, `- Now: ${localStamp(c.now, c.timeZone)} (${c.timeZone})`, HEADER_CLOSE].join("\n");
}

/** Removes the header from a stored prompt, leaving what the person wrote. */
export function stripTurnHeader(prompt: string): string {
  const start = prompt.indexOf(HEADER_OPEN);
  const end = prompt.indexOf(HEADER_CLOSE);
  if (start === -1 || end === -1 || end < start) return prompt;
  return (prompt.slice(0, start) + prompt.slice(end + HEADER_CLOSE.length)).trim();
}

export interface ChatMessageContext {
  readonly authorDisplayName: string;
  readonly content: string;
  /** Messages that arrived while a previous run was still in flight. */
  readonly coalescedWith?: readonly string[];
  /**
   * The thread's existing conversation, when joining one the bot did not open.
   * First turn only — afterwards the SDK session carries it.
   */
  readonly threadContext?: string | undefined;
  /** Files posted with this message (and any coalesced with it), already saved in the workspace. */
  readonly files?: readonly PostedFile[];
  /** Paths of the files shown inline as images. */
  readonly shown?: ReadonlySet<string>;
  /** Files that were posted but not saved, one line each. */
  readonly skippedFiles?: readonly string[];
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The lines telling the agent what was posted, where it is, and whether it can already see it. */
export function filesBlock(
  files: readonly PostedFile[],
  shown: ReadonlySet<string>,
  skipped: readonly string[] = [],
): string {
  if (files.length === 0 && skipped.length === 0) return "";
  const lines: string[] = [];
  if (files.length > 0) {
    lines.push("Files they posted, saved in your working directory (pass the path to attach_document as `source`):");
    let n = 0;
    for (const f of files) {
      const kind = f.contentType ?? "unknown type";
      let note: string;
      if (shown.has(f.path)) {
        n += 1;
        note = `shown below as image ${n}`;
      } else if (f.image) {
        note = "not shown — Read it to look at it";
      } else {
        note = "Read it if you need its contents";
      }
      lines.push(`- \`${f.path}\` — “${f.name}”, ${kind}, ${size(f.bytes)}; ${note}`);
    }
  }
  if (skipped.length > 0) {
    lines.push("Not saved:");
    for (const s of skipped) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}

export function chatUserPrompt(m: ChatMessageContext, turn: TurnContext): string {
  const lines: string[] = [turnHeader(turn), ""];

  if (m.threadContext) lines.push(m.threadContext, "");

  const text = m.content.trim().length > 0 ? m.content : "(no text — just the files below)";
  lines.push(`${m.authorDisplayName} says:`, "", text);

  if (m.coalescedWith && m.coalescedWith.length > 0) {
    lines.push("", "They then added, before you replied:");
    for (const extra of m.coalescedWith) lines.push("", extra);
  }

  const files = filesBlock(m.files ?? [], m.shown ?? new Set(), m.skippedFiles ?? []);
  if (files) lines.push("", files);
  return lines.join("\n");
}

export function briefUserPrompt(
  schedule: { readonly name: string; readonly prompt: string },
  turn: TurnContext,
): string {
  return [
    turnHeader(turn),
    "",
    `This is the scheduled brief "${schedule.name}". Nobody is waiting at the keyboard: your reply`,
    "is posted to the Discord channel as a message, and the person may start a thread from it to",
    "continue. Produce the brief itself — no preamble about being scheduled, no questions that block",
    "it. If something it needs is unavailable, say which thing, and give the rest.",
    "",
    "This run only looks. Every change to Homebox is refused during it, so do not try; if",
    "something should be changed, say what and why, and the person can ask for it from the thread.",
    "",
    "The brief to produce:",
    "",
    schedule.prompt,
  ].join("\n");
}

/**
 * A settled poll vote, phrased as the message it stands in for.
 *
 * Says outright that it is a poll answer and which poll: the agent may have
 * asked two at once.
 */
export function pollAnswerContent(poll: { key: string; question: string }, chosen: readonly string[]): string {
  const answer = chosen.length === 1 ? chosen[0] : chosen.map((c) => `- ${c}`).join("\n");
  return [
    `Poll answer (${poll.key}) — tapped, not typed.`,
    `Question: ${poll.question}`,
    chosen.length === 1 ? `Answer: ${answer}` : `Answers:\n${answer}`,
    "",
    "Do with it what you asked for it for.",
  ].join("\n");
}
