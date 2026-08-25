/**
 * Native NexCode desktop management surface.
 *
 * These routes deliberately expose only Codex/GPT account-adjacent state:
 * threads, user Skills, local diagnostics, and an explicitly confirmed Codex
 * process stop. They do not project provider configuration or credentials.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  constants as fsConstants,
  accessSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { Database, constants as sqliteConstants } from "bun:sqlite";
import { resolveCodexHomeDir } from "../../codex/home";
import { resolveCodexStateDbPath } from "../../codex/paths";
import {
  listRunningCodexProcesses,
  type CodexWriterProcessCheck,
} from "../../codex/log-guard/processes";
import { scanStorage } from "../../storage/scanner";
import { jsonResponse } from "../auth-cors";
import type { ManagementContext } from "./context";
import { readManagementJsonBody, rethrowManagementBodyTooLarge } from "./body";

const IMMUTABLE_READONLY_FLAGS = sqliteConstants.SQLITE_OPEN_READONLY | sqliteConstants.SQLITE_OPEN_URI;
const MAX_THREAD_ROWS = 1_000;
const MAX_THREAD_EXPORT_BYTES = 32 * 1024 * 1024;
const MAX_SKILL_BYTES = 512 * 1024;
const SKILL_FILE = "SKILL.md";
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const THIRTY_DAY_WINDOW_DAYS = 30;
const MAX_USAGE_ROLLOUT_BYTES = 256 * 1024 * 1024;
const MAX_USAGE_JSONL_LINE_BYTES = 32 * 1024 * 1024;

export interface DesktopRoutesDeps {
  codexHome?: () => string;
  userHome?: () => string;
  stateDbPath?: () => string;
  listCodexProcesses?: () => CodexWriterProcessCheck;
  signalProcess?: (pid: number, signal: NodeJS.Signals) => unknown;
  settleDelayMs?: number;
  now?: () => number;
}

interface RawThreadRow {
  id: unknown;
  rollout_path: unknown;
  created_at: unknown;
  updated_at: unknown;
  source: unknown;
  model_provider: unknown;
  cwd: unknown;
  title: unknown;
  tokens_used: unknown;
  archived: unknown;
  archived_at: unknown;
  first_user_message: unknown;
  agent_nickname: unknown;
  agent_role: unknown;
  model: unknown;
  reasoning_effort: unknown;
  preview: unknown;
  name: unknown;
  is_pinned: unknown;
}

export interface DesktopThreadSummary {
  id: string;
  title: string;
  preview: string;
  projectName: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
  archivedAt: number | null;
  archived: boolean;
  pinned: boolean;
  tokensUsed: number;
  model: string;
  reasoningEffort: string;
  source: string;
  agentNickname: string;
  agentRole: string;
}

interface DesktopThreadRecord extends DesktopThreadSummary {
  rolloutPath: string;
}

export interface DesktopSkillSummary {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  updatedAt: number;
  readOnly: boolean;
  scope: "user" | "project" | "legacy" | "admin" | "system";
  locationId: string;
}

export interface DesktopSkillLocation {
  id: string;
  label: string;
  scope: "user" | "project" | "legacy";
}

function normalizeWireText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.round(value * 1_000) : Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return normalizeTimestamp(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numericValue(value: unknown): number {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function openImmutableDatabase(path: string): Database {
  const uri = `${pathToFileURL(path).href}?immutable=1`;
  return new Database(uri, IMMUTABLE_READONLY_FLAGS);
}

function quoteKnownColumn(name: string): string {
  return `"${name}"`;
}

const THREAD_COLUMNS = [
  "id",
  "rollout_path",
  "created_at",
  "updated_at",
  "source",
  "model_provider",
  "cwd",
  "title",
  "tokens_used",
  "archived",
  "archived_at",
  "first_user_message",
  "agent_nickname",
  "agent_role",
  "model",
  "reasoning_effort",
  "preview",
  "name",
  "is_pinned",
] as const;

function readThreadRecords(stateDbPath: string): DesktopThreadRecord[] {
  if (!existsSync(stateDbPath)) return [];
  let db: Database | undefined;
  try {
    db = openImmutableDatabase(stateDbPath);
    const table = db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'threads'",
    ).get();
    if (!table) return [];
    const columns = new Set(
      db.query<{ name: string }, []>("PRAGMA table_info(threads)").all().map(row => row.name),
    );
    if (!columns.has("id")) return [];
    const projection = THREAD_COLUMNS.map(column => (
      columns.has(column)
        ? `${quoteKnownColumn(column)} AS ${quoteKnownColumn(column)}`
        : `NULL AS ${quoteKnownColumn(column)}`
    )).join(", ");
    const order = columns.has("updated_at")
      ? `${quoteKnownColumn("updated_at")} DESC`
      : `${quoteKnownColumn("id")} DESC`;
    const rows = db.query<RawThreadRow, [number]>(
      `SELECT ${projection} FROM threads ORDER BY ${order} LIMIT ?`,
    ).all(MAX_THREAD_ROWS);
    return rows.flatMap(row => {
      const id = normalizeWireText(row.id, 256);
      if (!id) return [];
      const cwd = normalizeWireText(row.cwd, 1_024);
      const title = normalizeWireText(row.name, 180)
        || normalizeWireText(row.title, 180)
        || normalizeWireText(row.first_user_message, 180)
        || id.slice(0, 12);
      return [{
        id,
        title,
        preview: normalizeWireText(row.preview, 280) || normalizeWireText(row.first_user_message, 280),
        projectName: cwd ? basename(cwd) : "",
        cwd,
        createdAt: normalizeTimestamp(row.created_at),
        updatedAt: normalizeTimestamp(row.updated_at),
        archivedAt: normalizeTimestamp(row.archived_at),
        archived: booleanValue(row.archived),
        pinned: booleanValue(row.is_pinned),
        tokensUsed: numericValue(row.tokens_used),
        model: normalizeWireText(row.model, 120),
        reasoningEffort: normalizeWireText(row.reasoning_effort, 60),
        source: normalizeWireText(row.source, 80),
        agentNickname: normalizeWireText(row.agent_nickname, 100),
        agentRole: normalizeWireText(row.agent_role, 100),
        rolloutPath: normalizeWireText(row.rollout_path, 2_048),
      }];
    });
  } catch {
    return [];
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
  }
}

function publicThread(record: DesktopThreadRecord): DesktopThreadSummary {
  const { rolloutPath: _rolloutPath, ...summary } = record;
  return summary;
}

function filterThreadRecords(
  records: DesktopThreadRecord[],
  status: string,
  query: string,
): DesktopThreadRecord[] {
  const filteredByStatus = status === "active"
    ? records.filter(record => !record.archived)
    : status === "archived"
      ? records.filter(record => record.archived)
      : records;
  if (!query) return filteredByStatus;
  const needle = query.toLocaleLowerCase();
  return filteredByStatus.filter(record => (
    `${record.title}\n${record.preview}\n${record.projectName}\n${record.cwd}\n${record.model}\n${record.id}`
      .toLocaleLowerCase()
      .includes(needle)
  ));
}

function safeCodexRolloutPath(rawPath: string, codexHome: string): string | null {
  if (!rawPath) return null;
  const home = resolve(codexHome);
  const candidate = resolve(isAbsolute(rawPath) ? rawPath : join(home, rawPath));
  const rel = relative(home, candidate).split(sep).join("/");
  if (!rel || rel.startsWith("../") || isAbsolute(rel)) return null;
  if (!rel.startsWith("sessions/") && !rel.startsWith("archived_sessions/")) return null;
  try {
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return candidate;
  } catch {
    const compressed = `${candidate}.zst`;
    try {
      const stat = lstatSync(compressed);
      return stat.isFile() && !stat.isSymbolicLink() ? compressed : null;
    } catch {
      return null;
    }
  }
}

type DesktopUsageRange = "1d" | "3d" | "7d" | "30d";

interface LocalTokenEvent {
  timestamp: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface LocalUsageTotals {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  turns: number;
  threadCount: number;
}

interface LocalUsageThread {
  id: string;
  title: string;
  projectName: string;
  model: string;
  totalTokens: number;
  turns: number;
}

interface RolloutTokenCacheEntry {
  device: number;
  inode: number;
  size: number;
  modifiedAt: number;
  events: LocalTokenEvent[];
  trailing: string;
}

const rolloutTokenCache = new Map<string, RolloutTokenCacheEntry>();
const rolloutTokenInflight = new Map<string, Promise<LocalTokenEvent[] | null>>();

const USAGE_RANGE_DAYS: Record<DesktopUsageRange, number> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": THIRTY_DAY_WINDOW_DAYS,
};

function localDayStart(timestamp: number, days: number): number {
  const start = new Date(timestamp);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blankLocalUsageTotals(): LocalUsageTotals {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    turns: 0,
    threadCount: 0,
  };
}

function addLocalTokenEvent(target: LocalUsageTotals, event: LocalTokenEvent): void {
  target.totalTokens = Math.min(Number.MAX_SAFE_INTEGER, target.totalTokens + event.totalTokens);
  target.inputTokens = Math.min(Number.MAX_SAFE_INTEGER, target.inputTokens + event.inputTokens);
  target.cachedInputTokens = Math.min(Number.MAX_SAFE_INTEGER, target.cachedInputTokens + event.cachedInputTokens);
  target.outputTokens = Math.min(Number.MAX_SAFE_INTEGER, target.outputTokens + event.outputTokens);
  target.reasoningOutputTokens = Math.min(Number.MAX_SAFE_INTEGER, target.reasoningOutputTokens + event.reasoningOutputTokens);
  target.turns += 1;
}

function parseLocalTokenEvent(line: string): LocalTokenEvent | null {
  if (!line.includes("token_count")) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as { timestamp?: unknown; type?: unknown; payload?: unknown };
  if (root.type !== "event_msg" || !root.payload || typeof root.payload !== "object") return null;
  const payload = root.payload as { type?: unknown; info?: unknown };
  if (payload.type !== "token_count" || !payload.info || typeof payload.info !== "object") return null;
  const info = payload.info as { last_token_usage?: unknown };
  if (!info.last_token_usage || typeof info.last_token_usage !== "object") return null;
  const usage = info.last_token_usage as Record<string, unknown>;
  const timestamp = normalizeTimestamp(root.timestamp);
  if (timestamp === null) return null;
  const inputTokens = numericValue(usage.input_tokens);
  const cachedInputTokens = numericValue(usage.cached_input_tokens);
  const outputTokens = numericValue(usage.output_tokens);
  const reasoningOutputTokens = numericValue(usage.reasoning_output_tokens);
  const totalTokens = numericValue(usage.total_tokens) || inputTokens + outputTokens;
  if (totalTokens <= 0) return null;
  return {
    timestamp,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

async function scanPlainRolloutTokenEvents(
  path: string,
  start: number,
  end: number,
  prefix: string,
): Promise<{ events: LocalTokenEvent[]; trailing: string }> {
  const events: LocalTokenEvent[] = [];
  const decoder = new TextDecoder();
  let pending = prefix;
  let droppingOversizedLine = false;

  const append = (incoming: string) => {
    let text = incoming;
    if (droppingOversizedLine) {
      const newline = text.indexOf("\n");
      if (newline < 0) return;
      droppingOversizedLine = false;
      text = text.slice(newline + 1);
    }
    pending += text;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      const event = parseLocalTokenEvent(line);
      if (event) events.push(event);
      newline = pending.indexOf("\n");
    }
    if (Buffer.byteLength(pending, "utf8") > MAX_USAGE_JSONL_LINE_BYTES) {
      pending = "";
      droppingOversizedLine = true;
    }
  };

  if (end >= start) {
    const stream = createReadStream(path, { start, end });
    for await (const chunk of stream) append(decoder.decode(chunk as Buffer, { stream: true }));
    append(decoder.decode());
  }
  if (!droppingOversizedLine && pending) {
    const finalEvent = parseLocalTokenEvent(pending.replace(/\r$/, ""));
    if (finalEvent) {
      events.push(finalEvent);
      pending = "";
    }
  }
  return { events, trailing: droppingOversizedLine ? "" : pending };
}

async function scanRolloutTokenEventsUncached(path: string): Promise<LocalTokenEvent[] | null> {
  if (path.endsWith(".zst")) return null;
  let stat: ReturnType<typeof statSync>;
  try { stat = statSync(path); } catch { return null; }
  if (!stat.isFile() || stat.size > MAX_USAGE_ROLLOUT_BYTES) return null;
  const previous = rolloutTokenCache.get(path);
  if (previous
    && previous.device === stat.dev
    && previous.inode === stat.ino
    && previous.size === stat.size
    && previous.modifiedAt === stat.mtimeMs) {
    return previous.events;
  }

  const canAppend = Boolean(previous
    && previous.device === stat.dev
    && previous.inode === stat.ino
    && stat.size > previous.size);
  const start = canAppend ? previous!.size : 0;
  const baseEvents = canAppend ? previous!.events : [];
  const prefix = canAppend ? previous!.trailing : "";
  try {
    const scanned = await scanPlainRolloutTokenEvents(path, start, stat.size - 1, prefix);
    const events = [...baseEvents, ...scanned.events];
    rolloutTokenCache.set(path, {
      device: stat.dev,
      inode: stat.ino,
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      events,
      trailing: scanned.trailing,
    });
    return events;
  } catch {
    return previous?.events ?? null;
  }
}

async function scanRolloutTokenEvents(path: string): Promise<LocalTokenEvent[] | null> {
  const existing = rolloutTokenInflight.get(path);
  if (existing) return existing;
  const task = scanRolloutTokenEventsUncached(path).finally(() => {
    if (rolloutTokenInflight.get(path) === task) rolloutTokenInflight.delete(path);
  });
  rolloutTokenInflight.set(path, task);
  return task;
}

async function localTokenAnalytics(
  records: DesktopThreadRecord[],
  codexHome: string,
  now: number,
) {
  const rangeKeys = Object.keys(USAGE_RANGE_DAYS) as DesktopUsageRange[];
  const starts = Object.fromEntries(
    rangeKeys.map(range => [range, localDayStart(now, USAGE_RANGE_DAYS[range])]),
  ) as Record<DesktopUsageRange, number>;
  const ranges = Object.fromEntries(
    rangeKeys.map(range => [range, blankLocalUsageTotals()]),
  ) as Record<DesktopUsageRange, LocalUsageTotals>;
  const rangeThreadIds = Object.fromEntries(
    rangeKeys.map(range => [range, new Set<string>()]),
  ) as Record<DesktopUsageRange, Set<string>>;
  const rangeThreads = Object.fromEntries(
    rangeKeys.map(range => [range, new Map<string, LocalUsageThread>()]),
  ) as Record<DesktopUsageRange, Map<string, LocalUsageThread>>;
  const days = new Map<string, LocalUsageTotals>();
  const dayThreadIds = new Map<string, Set<string>>();
  for (let offset = THIRTY_DAY_WINDOW_DAYS - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = localDayKey(date.getTime());
    days.set(key, blankLocalUsageTotals());
    dayThreadIds.set(key, new Set());
  }

  let scannedThreads = 0;
  let fallbackThreads = 0;
  let skippedThreads = 0;
  for (const record of records) {
    const rollout = safeCodexRolloutPath(record.rolloutPath, codexHome);
    const events = rollout ? await scanRolloutTokenEvents(rollout) : null;
    if (events === null) skippedThreads += 1;
    else scannedThreads += 1;
    const usableEvents = events?.filter(event => event.timestamp >= starts["30d"] && event.timestamp <= now + 60_000) ?? [];

    if (usableEvents.length === 0 && (!events || events.length === 0) && record.tokensUsed > 0) {
      const activityAt = record.updatedAt ?? record.createdAt;
      if (activityAt !== null && activityAt >= starts["30d"] && activityAt <= now + 60_000) {
        usableEvents.push({
          timestamp: activityAt,
          inputTokens: record.tokensUsed,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: record.tokensUsed,
        });
        fallbackThreads += 1;
      }
    }

    for (const event of usableEvents) {
      const day = days.get(localDayKey(event.timestamp));
      if (day) {
        addLocalTokenEvent(day, event);
        dayThreadIds.get(localDayKey(event.timestamp))?.add(record.id);
      }
      for (const range of rangeKeys) {
        if (event.timestamp < starts[range]) continue;
        addLocalTokenEvent(ranges[range], event);
        rangeThreadIds[range].add(record.id);
        const current = rangeThreads[range].get(record.id) ?? {
          id: record.id,
          title: record.title,
          projectName: record.projectName,
          model: record.model,
          totalTokens: 0,
          turns: 0,
        };
        current.totalTokens = Math.min(Number.MAX_SAFE_INTEGER, current.totalTokens + event.totalTokens);
        current.turns += 1;
        rangeThreads[range].set(record.id, current);
      }
    }
  }

  for (const range of rangeKeys) ranges[range].threadCount = rangeThreadIds[range].size;
  for (const [date, totals] of days) totals.threadCount = dayThreadIds.get(date)?.size ?? 0;
  return {
    generatedAt: now,
    source: "codex-local-rollouts" as const,
    ranges,
    days: [...days].map(([date, totals]) => ({ date, ...totals })),
    topThreads: Object.fromEntries(rangeKeys.map(range => [
      range,
      [...rangeThreads[range].values()].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 8),
    ])) as Record<DesktopUsageRange, LocalUsageThread[]>,
    coverage: {
      threadRecords: records.length,
      scannedThreads,
      fallbackThreads,
      skippedThreads,
    },
  };
}

function readRolloutText(path: string): string {
  const stat = statSync(path);
  if (stat.size > MAX_THREAD_EXPORT_BYTES) throw new Error("rollout_too_large");
  const raw = readFileSync(path);
  if (!path.endsWith(".zst")) return raw.toString("utf8");
  const decoded = zstdDecompressSync(raw as Uint8Array<ArrayBuffer>, {
    maxOutputLength: MAX_THREAD_EXPORT_BYTES,
  });
  return Buffer.from(decoded).toString("utf8");
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap(part => {
    if (!part || typeof part !== "object") return [];
    const item = part as { text?: unknown; type?: unknown };
    if (typeof item.text !== "string") return [];
    return [item.text.trim()];
  }).filter(Boolean).join("\n\n");
}

function rolloutMarkdown(record: DesktopThreadRecord, raw: string): string {
  const messages: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    const root = parsed as { type?: unknown; payload?: unknown };
    if (!root.payload || typeof root.payload !== "object") continue;
    const payload = root.payload as {
      type?: unknown;
      role?: unknown;
      content?: unknown;
      message?: unknown;
    };
    let role: "user" | "assistant" | null = null;
    let text = "";
    if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
      role = payload.role;
      text = messageText(payload.content);
    } else if (payload.type === "user_message") {
      role = "user";
      text = messageText(payload.message);
    } else if (payload.type === "agent_message") {
      role = "assistant";
      text = messageText(payload.message);
    }
    if (!role || !text) continue;
    const previous = messages.at(-1);
    if (previous?.role === role && previous.text === text) continue;
    messages.push({ role, text });
  }
  const header = [
    `# ${record.title.replace(/^#+\s*/, "")}`,
    "",
    `- Thread: \`${record.id}\``,
    record.projectName ? `- Project: ${record.projectName}` : "",
    record.model ? `- Model: \`${record.model}\`` : "",
    record.updatedAt ? `- Updated: ${new Date(record.updatedAt).toISOString()}` : "",
    "",
  ].filter(line => line !== "");
  const body = messages.flatMap(message => [
    `## ${message.role === "user" ? "User" : "Assistant"}`,
    "",
    message.text,
    "",
  ]);
  return [...header, "", ...body].join("\n").trimEnd() + "\n";
}

function safeFileStem(value: string): string {
  const stem = value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  return stem || "codex-thread";
}

type DesktopSkillScope = DesktopSkillSummary["scope"];

interface DesktopSkillRoot {
  id: string;
  scope: DesktopSkillScope;
  rootPath: string;
  displayPath: string;
  mutable: boolean;
}

interface DesktopSkillRecord extends DesktopSkillSummary {
  dirPath: string;
  filePath: string;
  directoryName: string;
  root: DesktopSkillRoot;
}

function opaquePathId(kind: "root" | "skill", path: string): string {
  return createHash("sha256").update(`${kind}\0${resolve(path)}`).digest("base64url").slice(0, 32);
}

function skillRootId(scope: DesktopSkillScope, path: string): string {
  return createHash("sha256").update(`root\0${scope}\0${resolve(path)}`).digest("base64url").slice(0, 32);
}

function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function displayLocalPath(path: string, userHome: string): string {
  const rel = relative(resolve(userHome), resolve(path));
  if (rel === "") return "~";
  if (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) {
    return `~/${rel.split(sep).join("/")}`;
  }
  return resolve(path).split(sep).join("/");
}

function existingDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function projectSkillRootPaths(stateDbPath: string, userHome: string): string[] {
  const discovered = new Set<string>();
  let home = resolve(userHome);
  try { home = realpathSync(home); } catch { return []; }
  for (const thread of readThreadRecords(stateDbPath).slice(0, MAX_THREAD_ROWS)) {
    if (!thread.cwd) continue;
    let cwd: string;
    try { cwd = realpathSync(resolve(thread.cwd)); } catch { continue; }
    if (!pathIsWithin(home, cwd) || !existingDirectory(cwd)) continue;

    const chain: string[] = [];
    let current = cwd;
    let repositoryFound = false;
    while (pathIsWithin(home, current)) {
      chain.push(current);
      if (existsSync(join(current, ".git"))) {
        repositoryFound = true;
        for (const directory of chain) discovered.add(join(directory, ".agents", "skills"));
        break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    // Codex also supports a CWD-scoped directory outside a Git repository.
    if (!repositoryFound) discovered.add(join(cwd, ".agents", "skills"));
  }
  return [...discovered].sort((left, right) => left.localeCompare(right));
}

function skillRoots(codexHome: string, userHome: string, stateDbPath: string): DesktopSkillRoot[] {
  const roots: DesktopSkillRoot[] = [];
  const seen = new Set<string>();
  let home = resolve(userHome);
  try { home = realpathSync(home); } catch { /* keep the unresolved home for display-only roots */ }
  const add = (scope: DesktopSkillScope, path: string, mutable: boolean, includeWhenMissing = false) => {
    const rootPath = resolve(path);
    if (seen.has(rootPath) || (!includeWhenMissing && !existsSync(rootPath))) return;
    seen.add(rootPath);
    roots.push({
      id: skillRootId(scope, rootPath),
      scope,
      rootPath,
      displayPath: displayLocalPath(rootPath, home),
      mutable: mutable && pathIsWithin(home, rootPath),
    });
  };

  // Current official Codex locations.
  add("user", join(home, ".agents", "skills"), true, true);
  for (const projectRoot of projectSkillRootPaths(stateDbPath, home)) add("project", projectRoot, true, true);

  // Compatibility for existing Codex installations that still have this tree.
  let normalizedCodexHome = resolve(codexHome);
  try { normalizedCodexHome = realpathSync(normalizedCodexHome); } catch { /* legacy root may not exist */ }
  const legacyRoot = join(normalizedCodexHome, "skills");
  add("legacy", legacyRoot, true);
  add("system", join(legacyRoot, ".system"), false);

  // Machine-admin and bundled skills are visible but never mutable through NexCode.
  add("admin", "/etc/codex/skills", false);
  return roots;
}

function parseSkillFrontmatter(content: string, fallback: string): { name: string; description: string } {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(content)?.[1] ?? "";
  const readField = (key: string) => {
    const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, "mi").exec(frontmatter);
    return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  };
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? "";
  return {
    name: normalizeWireText(readField("name") || heading || fallback, 100),
    description: normalizeWireText(readField("description"), 240),
  };
}

function listSkillRecords(codexHome: string, userHome: string, stateDbPath: string): DesktopSkillRecord[] {
  const found: DesktopSkillRecord[] = [];
  const home = resolve(userHome);
  let realHome = home;
  try { realHome = realpathSync(home); } catch { /* a missing home makes every root read-only */ }

  for (const root of skillRoots(codexHome, home, stateDbPath)) {
    let rootReal: string;
    let entries: Dirent<string>[];
    try {
      rootReal = realpathSync(root.rootPath);
      if (!statSync(rootReal).isDirectory()) continue;
      entries = readdirSync(root.rootPath, { withFileTypes: true });
    } catch { continue; }
    const rootMutable = root.mutable && pathIsWithin(realHome, rootReal);

    for (const entry of entries) {
      if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const child = join(root.rootPath, entry.name);
      let childReal: string;
      try {
        childReal = realpathSync(child);
        if (!statSync(childReal).isDirectory()) continue;
      } catch { continue; }
      const file = join(child, SKILL_FILE);
      try {
        const fileStat = lstatSync(file);
        if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_SKILL_BYTES) continue;
        const content = readFileSync(file, "utf8");
        const meta = parseSkillFrontmatter(content, entry.name);
        const readOnly = !rootMutable || entry.isSymbolicLink() || !pathIsWithin(realHome, childReal);
        found.push({
          id: opaquePathId("skill", realpathSync(file)),
          name: meta.name,
          description: meta.description,
          relativePath: `${root.displayPath}/${entry.name}/${SKILL_FILE}`,
          updatedAt: fileStat.mtimeMs,
          readOnly,
          scope: root.scope,
          locationId: root.id,
          dirPath: child,
          filePath: file,
          directoryName: entry.name,
          root,
        });
      } catch { /* malformed or inaccessible Skills are not exposed */ }
    }
  }
  return found.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
}

function listSkills(codexHome: string, userHome: string, stateDbPath: string): DesktopSkillSummary[] {
  return listSkillRecords(codexHome, userHome, stateDbPath).map(record => ({
    id: record.id,
    name: record.name,
    description: record.description,
    relativePath: record.relativePath,
    updatedAt: record.updatedAt,
    readOnly: record.readOnly,
    scope: record.scope,
    locationId: record.locationId,
  }));
}

function listSkillLocations(codexHome: string, userHome: string, stateDbPath: string): DesktopSkillLocation[] {
  return skillRoots(codexHome, userHome, stateDbPath)
    .filter((root): root is DesktopSkillRoot & { scope: DesktopSkillLocation["scope"] } => (
      root.mutable && (root.scope === "user" || root.scope === "project" || root.scope === "legacy")
    ))
    .map(root => ({ id: root.id, label: root.displayPath, scope: root.scope }));
}

function mutableSkillPaths(
  codexHome: string,
  userHome: string,
  stateDbPath: string,
  id: string,
): { dir: string; file: string; directoryName: string; record: DesktopSkillRecord } | null {
  const record = listSkillRecords(codexHome, userHome, stateDbPath).find(skill => skill.id === id);
  if (!record || record.readOnly || record.scope === "system" || record.scope === "admin") return null;
  try {
    const dirStat = lstatSync(record.dirPath);
    const fileStat = lstatSync(record.filePath);
    const realHome = realpathSync(userHome);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || !fileStat.isFile() || fileStat.isSymbolicLink()) return null;
    if (!pathIsWithin(realHome, realpathSync(record.dirPath))) return null;
  } catch {
    return null;
  }
  return { dir: record.dirPath, file: record.filePath, directoryName: record.directoryName, record };
}

function validSkillContent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= MAX_SKILL_BYTES;
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows ACL policy is owned elsewhere */ }
}

function createSkill(
  codexHome: string,
  userHome: string,
  stateDbPath: string,
  locationId: string | undefined,
  name: string,
  content: string,
): DesktopSkillSummary {
  if (!SKILL_NAME_RE.test(name)) throw new Error("invalid_name");
  const locations = skillRoots(codexHome, userHome, stateDbPath).filter(root => root.mutable);
  const selected = locationId
    ? locations.find(root => root.id === locationId)
    : locations.find(root => root.scope === "user");
  if (locationId && !selected) throw new Error("invalid_location");
  if (!selected || selected.scope === "system" || selected.scope === "admin") throw new Error("read_only");
  const root = selected.rootPath;
  const dir = join(root, name);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    if (!statSync(root).isDirectory() || !pathIsWithin(realpathSync(userHome), realpathSync(root))) throw new Error("read_only");
  } catch (error) {
    if (error instanceof Error && error.message === "read_only") throw error;
    throw new Error("read_only");
  }
  if (existsSync(dir)) throw new Error("already_exists");
  mkdirSync(dir, { mode: 0o700 });
  try {
    writePrivateFile(join(dir, SKILL_FILE), content);
  } catch (error) {
    try { renameSync(dir, `${dir}.failed-${randomUUID()}`); } catch { /* retain evidence */ }
    throw error;
  }
  const summary = listSkills(codexHome, userHome, stateDbPath).find(skill => (
    skill.id === opaquePathId("skill", realpathSync(join(dir, SKILL_FILE)))
  ));
  if (!summary) throw new Error("create_failed");
  return summary;
}

function updateSkill(codexHome: string, userHome: string, stateDbPath: string, id: string, content: string, now: number): DesktopSkillSummary {
  const paths = mutableSkillPaths(codexHome, userHome, stateDbPath, id);
  if (!paths) throw new Error("read_only");
  const backupRoot = join(codexHome, ".nexcode", "skill-backups", id);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const oldContent = readFileSync(paths.file, "utf8");
  writePrivateFile(join(backupRoot, `${Math.trunc(now)}-${randomUUID()}.md`), oldContent);
  const temp = join(paths.dir, `.SKILL.${randomUUID()}.tmp`);
  writePrivateFile(temp, content);
  renameSync(temp, paths.file);
  const summary = listSkills(codexHome, userHome, stateDbPath).find(skill => skill.id === id);
  if (!summary) throw new Error("update_failed");
  return summary;
}

function trashSkill(codexHome: string, userHome: string, stateDbPath: string, id: string, now: number): void {
  const paths = mutableSkillPaths(codexHome, userHome, stateDbPath, id);
  if (!paths) throw new Error("read_only");
  const trashRoot = join(codexHome, ".nexcode", "skill-trash");
  mkdirSync(trashRoot, { recursive: true, mode: 0o700 });
  renameSync(paths.dir, join(trashRoot, `${Math.trunc(now)}-${paths.directoryName}-${randomUUID()}`));
}

function processIdentityMap(check: CodexWriterProcessCheck): Map<number, string> | null {
  if (check.state !== "ok") return null;
  return new Map(check.processes.map(entry => [entry.pid, entry.commandLine]));
}

async function forceQuitCodex(deps: DesktopRoutesDeps): Promise<{
  ok: boolean;
  requested: number;
  stopped: number;
  surviving: number;
  failed: number;
  error?: "enumeration_unavailable";
}> {
  const enumerate = deps.listCodexProcesses ?? (() => listRunningCodexProcesses());
  const signal = deps.signalProcess ?? ((pid: number, nextSignal: NodeJS.Signals) => process.kill(pid, nextSignal));
  const initial = processIdentityMap(enumerate());
  if (!initial) return { ok: false, requested: 0, stopped: 0, surviving: 0, failed: 0, error: "enumeration_unavailable" };
  if (initial.size === 0) return { ok: true, requested: 0, stopped: 0, surviving: 0, failed: 0 };

  let failed = 0;
  const beforeTerm = processIdentityMap(enumerate());
  if (!beforeTerm) return { ok: false, requested: initial.size, stopped: 0, surviving: initial.size, failed: 0, error: "enumeration_unavailable" };
  for (const [pid, commandLine] of initial) {
    if (beforeTerm.get(pid) !== commandLine) continue;
    try { signal(pid, "SIGTERM"); } catch { failed += 1; }
  }
  const delay = Math.max(0, deps.settleDelayMs ?? 650);
  if (delay > 0) await new Promise(resolveDelay => setTimeout(resolveDelay, delay));

  const afterTerm = processIdentityMap(enumerate());
  if (!afterTerm) return { ok: false, requested: initial.size, stopped: 0, surviving: initial.size, failed, error: "enumeration_unavailable" };
  const survivors = [...initial].filter(([pid, commandLine]) => afterTerm.get(pid) === commandLine);
  for (const [pid, commandLine] of survivors) {
    const finalIdentity = processIdentityMap(enumerate());
    if (!finalIdentity || finalIdentity.get(pid) !== commandLine) continue;
    try { signal(pid, "SIGKILL"); } catch { failed += 1; }
  }
  if (delay > 0 && survivors.length > 0) {
    await new Promise(resolveDelay => setTimeout(resolveDelay, Math.min(250, delay)));
  }
  const final = processIdentityMap(enumerate());
  if (!final) return { ok: false, requested: initial.size, stopped: 0, surviving: initial.size, failed, error: "enumeration_unavailable" };
  const surviving = [...initial].filter(([pid, commandLine]) => final.get(pid) === commandLine).length;
  const stopped = initial.size - surviving;
  return { ok: surviving === 0 && failed === 0, requested: initial.size, stopped, surviving, failed };
}

function diagnostics(codexHome: string, userHome: string, stateDbPath: string, deps: DesktopRoutesDeps) {
  let homeReadable = false;
  let homeWritable = false;
  try { accessSync(codexHome, fsConstants.R_OK); homeReadable = true; } catch { /* unavailable */ }
  try { accessSync(codexHome, fsConstants.W_OK); homeWritable = true; } catch { /* unavailable */ }
  const threadRecords = readThreadRecords(stateDbPath);
  const skills = listSkills(codexHome, userHome, stateDbPath);
  const processCheck = (deps.listCodexProcesses ?? (() => listRunningCodexProcesses()))();
  let storageBytes = 0;
  let storageFiles = 0;
  try {
    const storage = scanStorage(codexHome);
    storageBytes = storage.total.bytes;
    storageFiles = storage.total.fileCount;
  } catch { /* reported as zero + failed check below */ }
  const checks = {
    runtime: true,
    codexHome: homeReadable && homeWritable,
    stateDatabase: existsSync(stateDbPath),
    processEnumeration: processCheck.state === "ok",
    skillsDirectory: existsSync(join(codexHome, "skills")),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    generatedAt: Date.now(),
    checks,
    runtime: {
      platform: process.platform,
      bunVersion: Bun.version,
      uptimeSeconds: Math.round(process.uptime()),
    },
    counts: {
      threads: threadRecords.length,
      activeThreads: threadRecords.filter(thread => !thread.archived).length,
      archivedThreads: threadRecords.filter(thread => thread.archived).length,
      skills: skills.length,
      codexProcesses: processCheck.state === "ok" ? processCheck.processes.length : null,
      storageBytes,
      storageFiles,
    },
  };
}

function errorStatus(error: unknown): { status: number; code: string } {
  const code = error instanceof Error ? error.message : "operation_failed";
  if (code === "invalid_name" || code === "invalid_content" || code === "invalid_location") return { status: 400, code };
  if (code === "already_exists") return { status: 409, code };
  if (code === "read_only") return { status: 403, code };
  return { status: 500, code: "operation_failed" };
}

export async function handleDesktopRoutes(ctx: ManagementContext): Promise<Response | null> {
  const { req, url, config } = ctx;
  if (!url.pathname.startsWith("/api/desktop/")) return null;
  const deps = ctx.deps.desktopRoutes ?? {};
  const codexHome = (deps.codexHome ?? resolveCodexHomeDir)();
  const userHome = (deps.userHome ?? homedir)();
  const stateDbPath = (deps.stateDbPath ?? resolveCodexStateDbPath)();
  const now = deps.now ?? Date.now;

  if (url.pathname === "/api/desktop/threads" && req.method === "GET") {
    const query = normalizeWireText(url.searchParams.get("q"), 120).toLocaleLowerCase();
    const status = url.searchParams.get("status") ?? "all";
    const requestedLimit = Number(url.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(requestedLimit) ? Math.min(500, Math.max(1, Math.trunc(requestedLimit))) : 200;
    const all = readThreadRecords(stateDbPath);
    const filtered = filterThreadRecords(all, status, query);
    return jsonResponse({
      total: filtered.length,
      counts: {
        all: all.length,
        active: all.filter(thread => !thread.archived).length,
        archived: all.filter(thread => thread.archived).length,
      },
      threads: filtered.slice(0, limit).map(publicThread),
    }, 200, req, config);
  }

  const exportMatch = /^\/api\/desktop\/threads\/([^/]+)\/export$/.exec(url.pathname);
  if (exportMatch && req.method === "GET") {
    const id = normalizeWireText(decodeURIComponent(exportMatch[1] ?? ""), 256);
    const record = readThreadRecords(stateDbPath).find(thread => thread.id === id);
    if (!record) return jsonResponse({ error: "thread_not_found" }, 404, req, config);
    const rollout = safeCodexRolloutPath(record.rolloutPath, codexHome);
    if (!rollout) return jsonResponse({ error: "rollout_unavailable" }, 409, req, config);
    try {
      const markdown = rolloutMarkdown(record, readRolloutText(rollout));
      return jsonResponse({
        fileName: `${safeFileStem(record.title)}.md`,
        markdown,
      }, 200, req, config);
    } catch (error) {
      const code = error instanceof Error && error.message === "rollout_too_large"
        ? "rollout_too_large"
        : "export_failed";
      return jsonResponse({ error: code }, code === "rollout_too_large" ? 413 : 500, req, config);
    }
  }

  if (url.pathname === "/api/desktop/skills" && req.method === "GET") {
    return jsonResponse({
      skills: listSkills(codexHome, userHome, stateDbPath),
      locations: listSkillLocations(codexHome, userHome, stateDbPath),
    }, 200, req, config);
  }

  if (url.pathname === "/api/desktop/skills" && req.method === "POST") {
    let body: { locationId?: unknown; name?: unknown; content?: unknown };
    try { body = await readManagementJsonBody(req); } catch (error) {
      rethrowManagementBodyTooLarge(error);
      return jsonResponse({ error: "invalid_json" }, 400, req, config);
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const locationId = typeof body.locationId === "string" ? body.locationId : undefined;
    if (!validSkillContent(body.content)) return jsonResponse({ error: "invalid_content" }, 400, req, config);
    try {
      return jsonResponse({ ok: true, skill: createSkill(codexHome, userHome, stateDbPath, locationId, name, body.content) }, 201, req, config);
    } catch (error) {
      const mapped = errorStatus(error);
      return jsonResponse({ error: mapped.code }, mapped.status, req, config);
    }
  }

  const skillMatch = /^\/api\/desktop\/skills\/([^/]+)$/.exec(url.pathname);
  if (skillMatch) {
    const id = skillMatch[1] ?? "";
    if (req.method === "GET") {
      const record = listSkillRecords(codexHome, userHome, stateDbPath).find(skill => skill.id === id);
      if (!record) return jsonResponse({ error: "skill_not_found" }, 404, req, config);
      try {
        const stat = lstatSync(record.filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_BYTES) throw new Error();
        return jsonResponse({
          skill: {
            id: record.id,
            name: record.name,
            description: record.description,
            relativePath: record.relativePath,
            updatedAt: record.updatedAt,
            readOnly: record.readOnly,
            scope: record.scope,
            locationId: record.locationId,
            content: readFileSync(record.filePath, "utf8"),
          },
        }, 200, req, config);
      } catch {
        return jsonResponse({ error: "skill_read_failed" }, 500, req, config);
      }
    }
    if (req.method === "PUT") {
      let body: { content?: unknown };
      try { body = await readManagementJsonBody(req); } catch (error) {
        rethrowManagementBodyTooLarge(error);
        return jsonResponse({ error: "invalid_json" }, 400, req, config);
      }
      if (!validSkillContent(body.content)) return jsonResponse({ error: "invalid_content" }, 400, req, config);
      try {
        return jsonResponse({ ok: true, skill: updateSkill(codexHome, userHome, stateDbPath, id, body.content, now()) }, 200, req, config);
      } catch (error) {
        const mapped = errorStatus(error);
        return jsonResponse({ error: mapped.code }, mapped.status, req, config);
      }
    }
    if (req.method === "DELETE") {
      try {
        trashSkill(codexHome, userHome, stateDbPath, id, now());
        return jsonResponse({ ok: true }, 200, req, config);
      } catch (error) {
        const mapped = errorStatus(error);
        return jsonResponse({ error: mapped.code }, mapped.status, req, config);
      }
    }
  }

  if (url.pathname === "/api/desktop/overview" && req.method === "GET") {
    const threads = readThreadRecords(stateDbPath);
    const skills = listSkills(codexHome, userHome, stateDbPath);
    const usage = await localTokenAnalytics(threads, codexHome, now());
    return jsonResponse({
      counts: {
        threads: threads.length,
        activeThreads: threads.filter(thread => !thread.archived).length,
        archivedThreads: threads.filter(thread => thread.archived).length,
        skills: skills.length,
      },
      localTokenUsage30d: {
        ...usage.ranges["30d"],
        since: localDayStart(usage.generatedAt, THIRTY_DAY_WINDOW_DAYS),
      },
      recentThreads: threads.slice(0, 5).map(publicThread),
      recentSkills: skills.slice(0, 5),
    }, 200, req, config);
  }

  if (url.pathname === "/api/desktop/usage" && req.method === "GET") {
    const threads = readThreadRecords(stateDbPath);
    return jsonResponse(await localTokenAnalytics(threads, codexHome, now()), 200, req, config);
  }

  if (url.pathname === "/api/desktop/diagnostics" && req.method === "GET") {
    return jsonResponse(diagnostics(codexHome, userHome, stateDbPath, deps), 200, req, config);
  }

  if (url.pathname === "/api/desktop/codex/force-quit" && req.method === "POST") {
    const result = await forceQuitCodex(deps);
    return jsonResponse(result, result.error === "enumeration_unavailable" ? 503 : 200, req, config);
  }

  return jsonResponse({ error: "desktop_route_not_found" }, 404, req, config);
}
