import type { PaseoApi } from "@getpaseo/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

const PAGE_SIZE = 100;
const MAX_PAGES = 200;

export interface TimelineEntry {
  seq: number;
  item: AgentTimelineItem;
  timestamp: string;
}

export interface TimelineSnapshot {
  agentId: string;
  title: string | null;
  provider: string | null;
  model: string | null;
  entries: TimelineEntry[];
}

type Page = Awaited<
  ReturnType<Awaited<ReturnType<PaseoApi["agents"]["ref"]>>["timeline"]["refetch"]>
>;

export interface ReadTimelineOptions {
  /**
   * Called after every page that still has older rows, with what has been read
   * so far. Returning true stops paging: the caller has every row it needs.
   */
  stopAfter?(entries: readonly TimelineEntry[]): boolean;
}

/**
 * Reads the visible timeline from the newest row backwards.
 * The daemon already merges streamed fragments into canonical rows, so this is
 * one round trip per 100 rows and no local session files are touched.
 *
 * Callers that only need the tail (a share range, the newest N prompts) pass
 * `stopAfter` and pay for one round trip instead of the whole session.
 */
export async function readTimeline(
  paseo: PaseoApi,
  agentId: string,
  options: ReadTimelineOptions = {},
): Promise<TimelineSnapshot> {
  const handle = paseo.agents.ref(agentId);
  const bySeq = new Map<number, TimelineEntry>();
  let page: Page = await handle.timeline.refetch({
    direction: "tail",
    limit: PAGE_SIZE,
    projection: "projected",
  });
  if (page.error) throw new Error(page.error);

  const epoch = page.epoch;
  let pages = 1;
  for (;;) {
    for (const entry of page.entries) {
      bySeq.set(entry.seqStart, {
        seq: entry.seqStart,
        item: entry.item,
        timestamp: entry.timestamp,
      });
    }
    const cursor = page.startCursor?.seq;
    if (!page.hasOlder || cursor === undefined) break;
    if (options.stopAfter?.(sortedEntries(bySeq))) break;
    if (pages >= MAX_PAGES) {
      throw new Error("This conversation has more history than one share can read.");
    }
    page = await handle.timeline.refetch({
      direction: "before",
      cursor: { epoch, seq: cursor },
      limit: PAGE_SIZE,
      projection: "projected",
    });
    pages += 1;
    if (page.error) throw new Error(page.error);
    if (page.epoch !== epoch || page.reset || page.gap || page.staleCursor) {
      throw new Error("The conversation changed while it was being read. Try again.");
    }
  }

  const agent = handle.current();
  return {
    agentId,
    title: agent?.title ?? null,
    provider: agent?.provider ?? null,
    model: agent?.model ?? null,
    entries: sortedEntries(bySeq),
  };
}

function sortedEntries(bySeq: Map<number, TimelineEntry>): TimelineEntry[] {
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}
