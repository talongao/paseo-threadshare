import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { messages } from "./messages";
import { openThreadshare, ThreadshareModal } from "./modal";

type Paseo = PluginClientContext["paseo"];
type AgentList = Awaited<ReturnType<Paseo["agents"]["list"]>>;
type AgentUpdate = Parameters<Parameters<Paseo["agents"]["subscribe"]>[0]>[0];

interface PillState {
  workspaceId: string;
  registration: PluginButtonRegistration;
}

/**
 * The pill icon also mounts the dialog: a composer pill has no other slot for a
 * surface, and Paseo's Modal renders outside the button's own layout.
 */
function SharePillIcon({ size, color, theme, host, layout, ...target }: PluginButtonIconProps) {
  const agentId = target.context === "agent" ? target.agentId : null;
  return (
    <>
      <Icon name="Share2" size={size} color={color} />
      {agentId ? <ThreadshareModal agentId={agentId} theme={theme} host={host} layout={layout} /> : null}
    </>
  );
}

export function contributePills(client: PluginClientContext) {
  const pills = new Map<string, PillState>();
  const lifetime = new AbortController();
  let stopped = false;

  function remove(agentId: string) {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  }

  function add(agentId: string, workspaceId: string) {
    if (stopped) return;
    const existing = pills.get(agentId);
    if (existing?.workspaceId === workspaceId) return;
    remove(agentId);
    pills.set(agentId, {
      workspaceId,
      registration: client.addComposerPill({
        id: "threadshare",
        workspaceId,
        agentId,
        button: {
          title: messages.message("pillTitle"),
          label: messages.message("pillLabel"),
          icon: SharePillIcon,
          visible: true,
          behavior: { kind: "action", onPress: () => openThreadshare(agentId) },
        },
      }),
    });
  }

  function applySnapshot(list: AgentList) {
    if (stopped) return;
    const listed = new Set<string>();
    for (const { agent } of list.entries) {
      if (!agent.workspaceId) continue;
      listed.add(agent.id);
      add(agent.id, agent.workspaceId);
    }
    for (const agentId of [...pills.keys()]) {
      if (!listed.has(agentId)) remove(agentId);
    }
  }

  function applyUpdate(update: AgentUpdate) {
    if (update.kind === "remove") {
      remove(update.agentId);
      return;
    }
    if (update.agent.workspaceId) {
      add(update.agent.id, update.agent.workspaceId);
    }
  }

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      if (lifetime.signal.aborted) return;
      subscription.subscribe({
        snapshot: applySnapshot,
        update: (message) => {
          if (message.type === "agent_update") applyUpdate(message.payload as AgentUpdate);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Threadshare: agent observation failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.registration.remove();
    pills.clear();
  };
}
