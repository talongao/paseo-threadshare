import type { TimelineEntry, TimelineItem, TimelineSnapshot } from "./timeline";
import {
  HISTORY_FORMAT,
  HISTORY_SCHEMA_VERSION,
  MAX_SHARE_BYTES,
  redactText,
  redactValue,
  type SharedEntry,
  type SharedHistory,
} from "./history";

function iso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeToolStatus(
  status: "running" | "completed" | "failed" | "canceled",
): "running" | "completed" | "failed" | "canceled" {
  return status;
}

/** Row identity used by both the picker and the range selection. */
export function entryId(entry: TimelineEntry): string {
  return String(entry.seq);
}

function exportEntry(entry: TimelineEntry): SharedEntry | null {
  const base = { id: entryId(entry), createdAt: iso(entry.timestamp) };
  const item: TimelineItem = entry.item;

  switch (item.type) {
    case "user_message":
      return { ...base, kind: "message", role: "user", markdown: redactText(item.text) };
    case "assistant_message":
      return { ...base, kind: "message", role: "assistant", markdown: redactText(item.text) };
    case "reasoning":
      return { ...base, kind: "thought", text: redactText(item.text), status: "ready" };
    case "todo":
      return {
        ...base,
        kind: "todo",
        items: item.items.map((todo) => ({
          text: redactText(todo.text),
          completed: todo.completed,
        })),
      };
    case "notification":
      return {
        ...base,
        kind: "activity",
        message: redactText(item.message),
        level: item.level === "warning" ? "info" : item.level,
      };
    case "error":
      return { ...base, kind: "activity", message: redactText(item.message), level: "error" };
    case "compaction":
      return {
        ...base,
        kind: "compaction",
        status: item.status,
        ...(item.trigger ? { trigger: item.trigger } : {}),
        ...(typeof item.preTokens === "number" ? { preTokens: item.preTokens } : {}),
      };
    case "plugin":
      return null;
    case "tool_call":
      return {
        ...base,
        kind: "tool",
        name: item.name,
        status: normalizeToolStatus(item.status),
        input: redactValue(item.detail),
        ...(item.error === null || item.error === undefined
          ? {}
          : { error: redactValue(item.error) }),
      };
    default:
      return null;
  }
}

export interface ShareRange {
  /** Inclusive first row of the range. */
  fromId: string;
  /** Exclusive last row: the row after the turn the user picked. */
  beforeId: string | null;
}

/** Selects whole turns: from the picked user turn up to the next user turn. */
export function selectRange(snapshot: TimelineSnapshot, range: ShareRange): TimelineEntry[] {
  const start = snapshot.entries.findIndex((entry) => entryId(entry) === range.fromId);
  if (start === -1) throw new Error("The first message is no longer in this conversation.");
  if (!range.beforeId) return snapshot.entries.slice(start);

  const end = snapshot.entries.findIndex((entry) => entryId(entry) === range.beforeId);
  if (end === -1) throw new Error("The last message is no longer in this conversation.");
  return snapshot.entries.slice(start, end);
}

export function exportHistory(input: {
  snapshot: TimelineSnapshot;
  entries: readonly TimelineEntry[];
  exportedAt?: Date;
}): SharedHistory {
  const title = input.snapshot.title?.trim() || "Paseo conversation";
  return {
    format: HISTORY_FORMAT,
    schemaVersion: HISTORY_SCHEMA_VERSION,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    conversation: {
      id: input.snapshot.agentId,
      title: redactText(title),
      source: "paseo",
      ...(input.snapshot.provider ? { provider: input.snapshot.provider } : {}),
      ...(input.snapshot.model ? { model: input.snapshot.model } : {}),
    },
    entries: input.entries
      .map(exportEntry)
      .filter((entry): entry is SharedEntry => entry !== null),
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keeps what identifies a tool call and drops the payload: file bodies, command
 * logs and module output are where an oversized share gets its bytes from.
 */
function compactToolInput(input: unknown): unknown {
  if (!isRecord(input) || typeof input.type !== "string") return input;
  switch (input.type) {
    case "shell":
      return { type: input.type, command: input.command, cwd: input.cwd };
    case "read":
      return {
        type: input.type,
        filePath: input.filePath,
        offset: input.offset,
        limit: input.limit,
      };
    case "write":
      return { type: input.type, filePath: input.filePath };
    case "search":
      return {
        type: input.type,
        query: input.query,
        toolName: input.toolName,
        mode: input.mode,
      };
    case "fetch":
      return { type: input.type, url: input.url, prompt: input.prompt };
    case "sub_agent":
      return {
        type: input.type,
        subAgentType: input.subAgentType,
        description: input.description,
      };
    case "worktree_setup":
      return { type: input.type, worktreePath: input.worktreePath, branchName: input.branchName };
    case "plain_text":
      return { type: input.type, label: input.label, icon: input.icon };
    case "unknown":
      return input.input ?? null;
    default:
      return { type: input.type };
  }
}

/** Shrinks tool rows, and drops repeats, so an oversized range still fits. */
function compactTools(entries: SharedEntry[]): SharedEntry[] {
  const seen = new Set<string>();
  const compacted: SharedEntry[] = [];
  for (const entry of entries) {
    if (entry.kind !== "tool") {
      compacted.push(entry);
      continue;
    }
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    compacted.push({
      ...entry,
      input: compactToolInput(entry.input),
      // Output carries command logs and file bodies; the viewer still shows the
      // call itself, its status and any error.
      output: undefined,
    });
  }
  return compacted;
}

export class ShareTooLargeError extends Error {
  constructor(readonly sizeBytes: number) {
    super("This range is too large to share as one link.");
    this.name = "ShareTooLargeError";
  }
}

export function prepareUpload(history: SharedHistory): { body: string; sizeBytes: number } {
  const body = JSON.stringify(history);
  const sizeBytes = utf8ByteLength(body);
  if (sizeBytes <= MAX_SHARE_BYTES) return { body, sizeBytes };

  const compacted = JSON.stringify({ ...history, entries: compactTools(history.entries) });
  const compactedBytes = utf8ByteLength(compacted);
  if (compactedBytes > MAX_SHARE_BYTES) throw new ShareTooLargeError(compactedBytes);
  return { body: compacted, sizeBytes: compactedBytes };
}
