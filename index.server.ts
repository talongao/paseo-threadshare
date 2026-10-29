import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listMessagesRpc, shareRpc } from "./shared/contracts";
import { configFrom, threadshareSettings } from "./shared/settings";
import { exportHistory, selectRange } from "./server/export";
import { listMessages } from "./server/messages";
import { uploadShare } from "./server/service";
import { readTimeline } from "./server/timeline";

export default function contribute(server: PluginServerContext) {
  // The daemon owns the settings file; handlers read it on every share so a
  // save applies without reloading the plugin.
  const settings = server.registerSettings(threadshareSettings);
  const config = async () => {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`Threadshare settings are invalid: ${state.error}`);
    return configFrom(state.values);
  };

  // Both handlers read the daemon timeline directly, so sharing never depends
  // on an external executable being installed on the host.
  server.handle(listMessagesRpc, async (input, { paseo }) => listMessages(paseo, input));
  server.handle(shareRpc, async (input, { paseo }) => {
    // Read settings first: a bad address must not cost a timeline read.
    const { baseUrl } = await config();
    const snapshot = await readTimeline(paseo, input.agentId, {
      // The range starts at the picked turn, so newer rows come first and paging
      // can stop as soon as that row is in hand.
      stopAfter: (entries) => entries.some((entry) => String(entry.seq) === input.fromId),
    });
    const entries = selectRange(snapshot, { fromId: input.fromId, beforeId: input.beforeId });
    return uploadShare({ baseUrl, history: exportHistory({ snapshot, entries }) });
  });

  return () => {};
}
