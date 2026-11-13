import { randomUUID } from "node:crypto";
import { getSessionInfo, renameSession, type McpServerConfig, type SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import type { Approver } from "../agent/approval.js";
import { buildOptions } from "../agent/options.js";
import {
  briefUserPrompt,
  chatUserPrompt,
  localStamp,
  stripTurnHeader,
  systemAppend,
  type ChatMessageContext,
  type TurnContext,
} from "../agent/prompts.js";
import { runQuery, type AgentSink } from "../agent/runner.js";
import { prepareImages, type ImageBlock } from "../agent/images.js";
import { BOX_SERVER } from "../homebox/classify.js";
import { explainVerdict, type QuotaGuard } from "../quota/budget.js";
import type { Store } from "../store/index.js";
import { createBotServer, POLLS_PER_TURN } from "../tools/bot.js";
import { INBOX_DIR, LABEL_DIR, NOTES_FILE } from "../workspace.js";
import type { NewToolCall, PollRequest, PostedFile, Schedule, Session, TurnTrigger } from "./types.js";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Owns the commit protocol. Nothing else writes session or turn state.
 *
 * Ordering (each step is what makes the next one recoverable):
 *   1. the Discord message or thread exists, then the session row
 *   2. turn row + session running, atomically, BEFORE any token is spent
 *   3. tool-call and approval audit streams in
 *   4. terminal turn state + session counters, atomically
 *   5. caller delivers to Discord and records the message id
 *
 * What makes a thread survive a restart is its row here and its SDK
 * transcript under HOME. Lose the transcript and the turn still runs, from a
 * short recap.
 */

export interface ManagerDeps {
  readonly cfg: Config;
  readonly log: Logger;
  readonly store: Store;
  /** homebox-mcp, from homebox/mcp.ts. Empty when Homebox is not configured. */
  readonly external: Readonly<Record<string, McpServerConfig>>;
  /** Omit to run unmetered — dev only. */
  readonly quota?: QuotaGuard;
}

export interface TurnRan {
  readonly blocked: false;
  readonly turnId: number;
  readonly ok: boolean;
  readonly text: string;
  readonly numTurns: number;
  readonly costUsd: number;
  readonly deniedTools: number;
  /** True when the SDK transcript was gone and context was rebuilt from SQLite. */
  readonly contextRebuilt: boolean;
  /** Polls the agent asked for. The caller posts them after delivering the reply. */
  readonly polls: readonly PollRequest[];
  /** Absolute paths of labels / QR codes generated during the turn, for the bot to post. */
  readonly generated: readonly string[];
  readonly rateLimit?: SDKRateLimitInfo;
}

/** Refused before anything was sent to the model. No turn row, no spend. */
export interface TurnBlocked {
  readonly blocked: true;
  readonly message: string;
}

export type TurnResult = TurnRan | TurnBlocked;

interface ExecuteRequest {
  readonly session: Session;
  readonly trigger: TurnTrigger;
  readonly actorId: string | null;
  readonly buildPrompt: (turn: TurnContext) => string;
  /** Posted photos, shown to the model with the prompt. */
  readonly images?: readonly ImageBlock[];
  /** False for a scheduled run: no Homebox writes, no scheduling tools. */
  readonly interactive: boolean;
  readonly approver?: Approver | undefined;
}

const TOOL_FLUSH_EVERY = 10;

export class SessionManager {
  private readonly aborted = new Set<string>();
  private runScheduleNow: ((s: Schedule) => void) | undefined;

  constructor(private readonly deps: ManagerDeps) {}

  /** Wired by the bot once it can post to a channel. */
  onRunScheduleNow(fn: (s: Schedule) => void): void {
    this.runScheduleNow = fn;
  }

  get hasHomebox(): boolean {
    return BOX_SERVER in this.deps.external;
  }

  /** Step 1 for chat. The caller must have created the Discord thread already. */
  openChat(input: {
    guildId: string;
    channelId: string;
    threadId: string;
    openedBy: string | null;
    title: string;
  }): Session {
    const existing = this.deps.store.sessions.byThread(input.threadId);
    if (existing) return existing;
    return this.create("chat", { ...input, scheduleId: null });
  }

  /**
   * Step 1 for a scheduled brief. `anchorId` is the id of the message already
   * posted to the channel — and the id any thread started from it will have.
   */
  openBrief(input: { guildId: string; channelId: string; anchorId: string; schedule: Schedule }): Session {
    const day = localStamp(new Date(), this.deps.cfg.BOT_TIMEZONE).split(" ")[1] ?? "";
    return this.create("brief", {
      guildId: input.guildId,
      channelId: input.channelId,
      threadId: input.anchorId,
      openedBy: null,
      title: `${input.schedule.name} ${day}`.trim(),
      scheduleId: input.schedule.id,
    });
  }

  private create(
    kind: Session["kind"],
    input: {
      guildId: string;
      channelId: string;
      threadId: string;
      openedBy: string | null;
      title: string;
      scheduleId: number | null;
    },
  ): Session {
    return this.deps.store.sessions.create({
      id: randomUUID(),
      kind,
      guildId: input.guildId,
      channelId: input.channelId,
      threadId: input.threadId,
      // Generated here, so it is durable before the agent subprocess exists.
      agentSessionId: randomUUID(),
      openedBy: input.openedBy,
      title: input.title.slice(0, 100),
      scheduleId: input.scheduleId,
    });
  }

  abort(sessionId: string): void {
    this.aborted.add(sessionId);
  }

  clearAbort(sessionId: string): void {
    this.aborted.delete(sessionId);
  }

  isAborted(sessionId: string): boolean {
    return this.aborted.has(sessionId);
  }

  /**
   * Decides whether the stored SDK session can actually be resumed.
   *
   * A deterministic pre-check beats string-matching an error after the fact:
   * it costs no turns, and a lost transcript is a normal consequence of the
   * volume being replaced rather than an exceptional case.
   */
  private async resolveResume(session: Session): Promise<string | null> {
    if (!session.agentSessionId) return null;
    // Asked even on a first turn: a turn that was cut off by a restart leaves a
    // transcript behind without ever having been counted, and resuming it
    // keeps whatever the agent had already worked out.
    try {
      const info = await getSessionInfo(session.agentSessionId, { dir: this.deps.cfg.workDir });
      return info ? session.agentSessionId : null;
    } catch {
      return null;
    }
  }

  /** Rebuilds enough context to continue usefully when the transcript is gone. */
  private recapPrefix(sessionId: string): string {
    const turns = this.deps.store.turns.recent(sessionId, 4);
    if (turns.length === 0) return "";
    const lines = [
      "## Earlier in this thread",
      "",
      "Your own record of this conversation was lost. This recap comes from the bot's log of it.",
      "",
    ];
    for (const t of turns) {
      lines.push(`- They wrote: ${stripTurnHeader(t.prompt).slice(0, 400)}`);
      lines.push(`  You answered: ${(t.result ?? "").slice(0, 600)}`);
    }
    lines.push("", "---", "");
    return lines.join("\n");
  }

  async runChatTurn(
    req: {
      session: Session;
      trigger: TurnTrigger;
      actorId: string | null;
      message: ChatMessageContext;
      files?: readonly PostedFile[];
      skippedFiles?: readonly string[];
      approver?: Approver | undefined;
    },
    sink: AgentSink = {},
  ): Promise<TurnResult> {
    const files = req.files ?? [];
    const prepared = await prepareImages(this.deps.cfg.workDir, files);
    if (files.length > 0) {
      this.deps.log.info(
        { sessionId: req.session.id, files: files.length, shown: prepared.shown.size },
        "posted files prepared",
      );
    }
    const message: ChatMessageContext = {
      ...req.message,
      files,
      shown: prepared.shown,
      ...(req.skippedFiles && req.skippedFiles.length > 0 ? { skippedFiles: req.skippedFiles } : {}),
    };
    return this.execute(
      {
        session: req.session,
        trigger: req.trigger,
        actorId: req.actorId,
        buildPrompt: (turn) => chatUserPrompt(message, turn),
        images: prepared.blocks,
        // A brief that someone continued in a thread is a conversation like
        // any other from then on: a person is there to approve.
        interactive: true,
        approver: req.approver,
      },
      sink,
    );
  }

  async runBriefTurn(session: Session, schedule: Schedule, sink: AgentSink = {}): Promise<TurnResult> {
    return this.execute(
      {
        session,
        trigger: "schedule",
        actorId: null,
        buildPrompt: (turn) => briefUserPrompt(schedule, turn),
        interactive: false,
      },
      sink,
    );
  }

  private async execute(req: ExecuteRequest, sink: AgentSink): Promise<TurnResult> {
    const { cfg, log, store, quota, external } = this.deps;
    const session = req.session;

    // Before anything else: refusing here means no turn row, no subprocess, and
    // nothing for restart recovery to reconcile.
    if (quota) {
      const verdict = quota.check();
      if (!verdict.allowed) {
        log.warn({ sessionId: session.id, reason: verdict.reason }, "turn refused by quota guard");
        return { blocked: true, message: explainVerdict(verdict) };
      }
    }

    const resume = await this.resolveResume(session);
    const contextRebuilt = session.turnCount > 0 && resume === null;
    if (contextRebuilt) {
      log.warn({ sessionId: session.id }, "SDK transcript unavailable — rebuilding context from the store");
    }

    const turn: TurnContext = { now: new Date(), timeZone: cfg.BOT_TIMEZONE };
    const prompt = (contextRebuilt ? this.recapPrefix(session.id) : "") + req.buildPrompt(turn);

    // Step 2 — durable before a token is spent.
    const turnId = store.turns.begin({
      sessionId: session.id,
      trigger: req.trigger,
      actorId: req.actorId,
      prompt,
      resumedFrom: resume,
    });

    // A fresh SDK session needs an id we own; a continuing one needs `resume`.
    const freshId = resume ? null : randomUUID();
    if (freshId) store.sessions.setAgentSession(session.id, freshId);

    const pending: NewToolCall[] = [];
    const polls: PollRequest[] = [];
    let denied = 0;
    let rateLimit: SDKRateLimitInfo | undefined;

    const flush = (): void => {
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      try {
        store.turns.recordToolCalls(batch);
      } catch (e) {
        log.error({ err: e }, "failed to persist tool audit batch");
      }
    };

    const options = buildOptions({
      cfg,
      log,
      systemAppend: systemAppend({
        timeZone: cfg.BOT_TIMEZONE,
        hasHomebox: this.hasHomebox,
        approvalLevel: cfg.BOX_APPROVAL_LEVEL,
        notesFile: NOTES_FILE,
        inboxDir: INBOX_DIR,
        labelDir: LABEL_DIR,
      }),
      externalServers: external,
      botServer: createBotServer({
        cfg,
        store,
        actorId: req.actorId,
        interactive: req.interactive,
        // Only a real Discord id: the dev REPL's "repl" channel is not one.
        defaultChannelId: /^\d{5,25}$/.test(session.channelId) ? session.channelId : undefined,
        requestPoll: (p) => {
          if (polls.length >= POLLS_PER_TURN) return false;
          polls.push(p);
          return true;
        },
        runScheduleNow: this.runScheduleNow,
      }),
      interactive: req.interactive,
      approver: req.approver,
      isAborted: () => this.aborted.has(session.id),
      onDecision: (e) => {
        if (!e.decision.allow) denied += 1;
        pending.push({
          turnId,
          sessionId: session.id,
          toolName: e.toolName,
          inputJson: JSON.stringify(e.toolInput ?? null).slice(0, 4000),
          allowed: e.decision.allow,
          denyReason: e.decision.allow ? null : e.decision.reason,
        });
        if (pending.length >= TOOL_FLUSH_EVERY) flush();
      },
      onApproval: (e) => {
        if (!e.answer.approved) denied += 1;
        try {
          store.turns.recordApproval({
            turnId,
            sessionId: session.id,
            toolName: e.toolName,
            inputJson: JSON.stringify(e.input ?? null).slice(0, 4000),
            tier: e.tier,
            reason: e.reason,
            approved: e.answer.approved,
            answeredBy: e.answer.by,
            denyReason: e.answer.approved ? null : e.answer.reason,
          });
        } catch (err) {
          log.error({ err }, "failed to record an approval");
        }
      },
      ...(resume ? { resume } : { sessionId: freshId! }),
    });

    const chunks: string[] = [];
    const run = (): Promise<Awaited<ReturnType<typeof runQuery>>> =>
      runQuery(
        { text: prompt, ...(req.images && req.images.length > 0 ? { images: req.images } : {}) },
        options,
        {
          ...sink,
          onText: (t) => {
            chunks.push(t);
            sink.onText?.(t);
          },
          onRateLimit: (info) => {
            rateLimit = info;
            // Feed the guard first: it may set a cooldown that refuses the
            // *next* run before a subprocess is ever spawned.
            quota?.onRateLimit(info);
            sink.onRateLimit?.(info);
          },
        },
        () => this.aborted.has(session.id),
      );

    const startedAt = Date.now();
    // The permit is held only around the model call, not the bookkeeping.
    const outcome = quota ? await quota.semaphore.run(run) : await run();

    flush();

    // Keep our record of the SDK session honest if it reported a different id.
    if (outcome.sessionId && outcome.sessionId !== (resume ?? freshId)) {
      log.warn(
        { expected: resume ?? freshId, actual: outcome.sessionId },
        "agent reported a different session id than requested",
      );
      store.sessions.setAgentSession(session.id, outcome.sessionId);
    }

    // Give a newly started SDK session a title. `getSessionInfo` — the check
    // that decides whether a thread can be resumed — only reports sessions it
    // can summarise, and a title makes the session findable whatever anyone
    // typed.
    const startedId = resume ? null : (outcome.sessionId ?? freshId);
    if (startedId) {
      await renameSession(startedId, session.title.trim() || "thread", { dir: cfg.workDir }).catch((e: unknown) =>
        log.warn({ err: e, sessionId: session.id }, "could not title the SDK session"),
      );
    }

    const text = replyText(chunks, outcome.ok ? outcome.result : "");
    const wasAborted = this.aborted.has(session.id);

    // Step 4 — turn state and session counters move together.
    store.turns.finish(turnId, {
      status: outcome.ok ? "ok" : wasAborted ? "aborted" : "error",
      result: text || null,
      error: outcome.ok ? null : outcome.error,
      errorSubtype: outcome.ok ? null : (outcome.subtype ?? null),
      numTurns: outcome.numTurns,
      costUsd: outcome.costUsd,
      deniedToolCount: denied,
    });

    this.clearAbort(session.id);

    return {
      blocked: false,
      turnId,
      ok: outcome.ok,
      text: outcome.ok ? text : `${describeFailure(outcome.error, wasAborted)}${text ? `\n\n${text}` : ""}`,
      numTurns: outcome.numTurns,
      costUsd: outcome.costUsd,
      deniedTools: denied,
      contextRebuilt,
      // A run that failed part-way may have queued a poll about work it never
      // finished; asking the person about that would be noise.
      polls: outcome.ok ? polls : [],
      generated: await filesSince(cfg.labelDir, startedAt),
      ...(rateLimit ? { rateLimit } : {}),
    };
  }

  /** Step 5 bookkeeping, once the caller has delivered the answer. */
  markDelivered(turnId: number, messageId: string): void {
    this.deps.store.turns.setDiscordMessage(turnId, messageId);
  }
}

/**
 * Boot recovery. Interrupted turns are never retried automatically: the
 * question may be stale, and replaying a half-finished change to the inventory is
 * the last thing anyone wants after a restart. The sessions are returned so
 * the bot can say so in each thread instead of leaving a question hanging.
 */
export function recoverInterrupted(store: Store, log: Logger): { interrupted: readonly Session[] } {
  const orphans = store.turns.running();
  store.turns.markInterrupted(orphans.map((t) => t.id));
  const reset = store.sessions.resetRunning();

  const sessions = [...new Set(orphans.map((t) => t.sessionId))]
    .map((id) => store.sessions.byId(id))
    .filter((s): s is Session => s !== undefined);

  if (orphans.length > 0) {
    log.warn({ interrupted: orphans.length, sessionsReset: reset }, "recovered from an unclean shutdown");
  }
  return { interrupted: sessions };
}

/** Files written under `dir` since `since` — labels and QR codes from this turn. */
async function filesSince(dir: string, since: number): Promise<string[]> {
  try {
    const names = await readdir(dir);
    const out: string[] = [];
    for (const n of names) {
      const p = join(dir, n);
      const st = await stat(p).catch(() => undefined);
      // A second's slack for filesystems with coarse timestamps.
      if (st?.isFile() && st.mtimeMs >= since - 1000) out.push(p);
    }
    return out.sort();
  } catch {
    return [];
  }
}

/**
 * The reply, made of everything the agent wrote this turn, in order.
 *
 * Not the SDK's `result`: that is only the final text block. An agent that
 * answers, then tidies up (updates the inventory notes) and signs off with "Noted
 * that for next time" would otherwise deliver the sign-off and drop the
 * answer — which is exactly what happened in the first real thread.
 * `result` is the fallback for a run that produced no text blocks we saw.
 */
export function replyText(blocks: readonly string[], result: string): string {
  const parts = blocks.map((b) => b.trim()).filter((b) => b.length > 0);
  return parts.length > 0 ? parts.join("\n\n") : result;
}

function describeFailure(error: string, aborted: boolean): string {
  if (aborted) return "_Stopped._";
  if (/error_max_turns/.test(error)) {
    return "_I ran out of steps before finishing. Tell me to continue and I'll pick up where I stopped._";
  }
  return `_The run failed: ${error}_`;
}
