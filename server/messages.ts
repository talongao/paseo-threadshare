import type { MessagePage } from "../shared/contracts";
import { entryId } from "./export";
import { readTimeline, type PaseoApi } from "./timeline";

const MAX_PREVIEW_CHARS = 160;

/** Home paths are environment details, not conversation content. */
const HOME_PATHS = [
  /\/(?:Users|home)\/[^/\s]+(?:\/[^\s"'`<>]*)*/gu,
  /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s]+(?:[\\/][^\s"'`<>]*)*/gu,
];

function preview(text: string): string {
  let value = text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  for (const pattern of HOME_PATHS) value = value.replace(pattern, "[LOCAL_PATH]");
  const codePoints = Array.from(value);
  if (codePoints.length <= MAX_PREVIEW_CHARS) return value;
  return `${codePoints.slice(0, MAX_PREVIEW_CHARS - 3).join("")}...`;
}

/**
 * Lists the user turns the picker can use as range boundaries, newest first.
 */
export async function listMessages(
  paseo: PaseoApi,
  input: { agentId: string; limit: number },
): Promise<MessagePage> {
  // One extra turn tells the picker whether older ones exist.
  const wanted = input.limit + 1;
  const snapshot = await readTimeline(paseo, input.agentId, {
    stopAfter: (entries) => countUserTurns(entries) >= wanted,
  });
  const turns = snapshot.entries
    .filter((entry) => entry.item.type === "user_message")
    .reverse()
    .map((entry) => ({
      id: entryId(entry),
      preview: preview((entry.item as { text: string }).text),
      createdAt: entry.timestamp,
    }));

  return {
    items: turns.slice(0, input.limit),
    hasMore: turns.length > input.limit,
  };
}

function countUserTurns(entries: readonly { item: { type: string } }[]): number {
  let count = 0;
  for (const entry of entries) if (entry.item.type === "user_message") count += 1;
  return count;
}
