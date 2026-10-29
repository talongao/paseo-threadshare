import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import contribute from "../index.server";
import { exportHistory, selectRange } from "../server/export";
import { redactText, redactValue } from "../server/history";
import { listMessages } from "../server/messages";
import { uploadShare } from "../server/service";
import type { TimelineSnapshot } from "../server/timeline";
import { shareRpc } from "../shared/contracts";

interface Row {
  seq: number;
  item: AgentTimelineItem;
  timestamp: string;
}

function user(seq: number, text: string): Row {
  return { seq, item: { type: "user_message", text }, timestamp: `2026-01-01T00:00:0${seq}Z` };
}

function assistant(seq: number, text: string): Row {
  return {
    seq,
    item: { type: "assistant_message", text },
    timestamp: `2026-01-01T00:00:0${seq}Z`,
  };
}

function snapshot(rows: Row[]): TimelineSnapshot {
  return {
    agentId: "agent-1",
    title: "A conversation",
    provider: "codex",
    model: "gpt-5",
    entries: rows,
  };
}

/** A daemon stub that serves `rows` in pages, newest first. */
function fakePaseo(rows: Row[], pageSize = 2) {
  const calls: unknown[] = [];
  const handle = {
    current: () => ({ title: "A conversation", provider: "codex", model: "gpt-5" }),
    timeline: {
      refetch: async (options: {
        direction: "tail" | "before" | "after";
        cursor?: { epoch: string; seq: number };
        limit?: number;
      }) => {
        calls.push(options);
        const end = options.cursor ? options.cursor.seq : Number.POSITIVE_INFINITY;
        const older = rows.filter((row) => row.seq < end).sort((left, right) => right.seq - left.seq);
        const entries = older.slice(0, pageSize).map((row) => ({
          provider: "codex",
          item: row.item,
          timestamp: row.timestamp,
          seqStart: row.seq,
          seqEnd: row.seq,
        }));
        const oldest = entries.at(-1)?.seqStart;
        return {
          requestId: "r",
          agentId: "agent-1",
          agent: null,
          direction: options.direction,
          projection: "projected" as const,
          epoch: "e1",
          reset: false,
          staleCursor: false,
          gap: false,
          window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
          startCursor: oldest === undefined ? null : { epoch: "e1", seq: oldest },
          endCursor: entries[0] ? { epoch: "e1", seq: entries[0].seqStart } : null,
          hasOlder: older.length > entries.length,
          hasNewer: false,
          entries,
          error: null,
        };
      },
    },
  };
  const paseo = { agents: { ref: () => handle } };
  return { paseo, calls };
}

test("a share reads only the pages it needs and posts one history document", async () => {
  const rows = [user(1, "first"), assistant(2, "a"), user(3, "second"), assistant(4, "b")];
  const { paseo, calls } = fakePaseo(rows);
  let posted: { url: string; body: string } | null = null;
  const fetchStub = (async (url: URL, init: { body: string }) => {
    posted = { url: url.toString(), body: init.body };
    return new Response(JSON.stringify({ id: "abc123" }), { status: 201 });
  }) as unknown as typeof fetch;
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub;

  try {
    const call = fakeServer({ baseUrl: "https://ts.example.com" }, { paseo });
    const result = await call(shareRpc, { agentId: "agent-1", fromId: "3", beforeId: null });
    assert.deepEqual(result, {
      id: "abc123",
      url: "https://ts.example.com/?id=abc123",
    });
  } finally {
    globalThis.fetch = original;
  }

  // The picked turn was in the first page, so no older page is requested.
  assert.equal(calls.length, 1);
  assert.equal(posted!.url, "https://ts.example.com/api/v1/shares");
  const history = JSON.parse(posted!.body);
  assert.equal(history.format, "threadshare-history@v1");
  assert.deepEqual(
    history.entries.map((entry: { markdown?: string }) => entry.markdown),
    ["second", "b"],
  );
});

test("an empty service address falls back to the hosted service", async () => {
  const { paseo } = fakePaseo([user(1, "hello")]);
  let endpoint = "";
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: URL) => {
    endpoint = url.toString();
    return new Response(JSON.stringify({ id: "x" }), { status: 201 });
  }) as unknown as typeof fetch;
  try {
    const call = fakeServer({ baseUrl: "" }, { paseo });
    await call(shareRpc, { agentId: "agent-1", fromId: "1", beforeId: null });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(endpoint, "https://cloud-thread.team-harness.com/api/v1/shares");
});

test("the picker lists whole turns newest first and reads one page", async () => {
  const rows = [user(1, "first"), assistant(2, "a"), user(3, "second"), user(5, "third")];
  const { paseo, calls } = fakePaseo(rows, 3);
  const page = await listMessages(paseo as never, { agentId: "agent-1", limit: 2 });
  // One extra turn is read so the picker knows older ones exist.
  assert.equal(calls.length, 2);
  assert.deepEqual(
    page.items.map((item) => [item.id, item.preview]),
    [
      ["5", "third"],
      ["3", "second"],
    ],
  );
  assert.equal(page.hasMore, true);
});

test("a range ends at the turn the user picked as the last one", () => {
  const history = snapshot([user(1, "one"), assistant(2, "a"), user(3, "two"), assistant(4, "b")]);
  assert.deepEqual(
    selectRange(history, { fromId: "1", beforeId: "4" }).map((entry) => entry.seq),
    [1, 2, 3],
  );
  assert.deepEqual(
    selectRange(history, { fromId: "3", beforeId: null }).map((entry) => entry.seq),
    [3, 4],
  );
  assert.throws(() => selectRange(history, { fromId: "9", beforeId: null }));
});

test("export marks the source and keeps provider and model", () => {
  const history = exportHistory({
    snapshot: snapshot([user(1, "hello")]),
    entries: [user(1, "hello")],
    exportedAt: new Date("2026-02-03T04:05:06Z"),
  });
  assert.equal(history.exportedAt, "2026-02-03T04:05:06.000Z");
  assert.deepEqual(history.conversation, {
    id: "agent-1",
    title: "A conversation",
    source: "paseo",
    provider: "codex",
    model: "gpt-5",
  });
  assert.equal(history.entries.length, 1);
});

test("tool payloads lose credentials", () => {
  const redacted = redactValue({
    command: "curl https://user:hunter2@example.com",
    env: { API_KEY: "sk-live-1234567890", note: "keep" },
  });
  assert.deepEqual(redacted, {
    command: "curl https://user:[REDACTED]@example.com",
    env: { API_KEY: "[REDACTED]", note: "keep" },
  });
  assert.equal(
    redactText('{"token":"abc123","input_tokens":42}'),
    '{"token":"[REDACTED]","input_tokens":42}',
  );
});

test("upload responses and errors surface to the caller", async () => {
  const history = exportHistory({ snapshot: snapshot([user(1, "hi")]), entries: [user(1, "hi")] });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "quota exceeded" }), {
        status: 429,
      })) as unknown as typeof fetch;
    await assert.rejects(
      () => uploadShare({ baseUrl: "https://ts.example.com", history }),
      /quota exceeded/,
    );

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ nope: true }), { status: 201 })) as unknown as typeof fetch;
    await assert.rejects(
      () => uploadShare({ baseUrl: "https://ts.example.com", history }),
      /invalid response/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

/** The smallest plugin server: a settings document plus a handler registry. */
function fakeServer(
  values: { baseUrl: string },
  context: { paseo: unknown },
): (contract: { name: string }, input: unknown) => Promise<unknown> {
  const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
  const server = {
    registerSettings: () => ({
      read: async () => ({ status: "ready" as const, revision: "r1", values }),
      subscribe: () => () => {},
    }),
    handle(contract: { name: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) {
      handlers.set(contract.name, handler);
    },
  };
  contribute(server as never);
  return (contract, input) => handlers.get(contract.name)!(input, context);
}

