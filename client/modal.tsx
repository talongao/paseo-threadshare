import {
  type PluginHostProps,
  useRpc,
  useTranslation,
} from "@getpaseo/plugin/client";
import {
  copyText,
  Icon,
  Modal,
  type ToastOptions,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { listMessagesRpc, shareRpc } from "../shared/contracts";
import { messages } from "./messages";

/** Newest turns first; a longer chat shows a hint that older ones exist. */
const MAX_MESSAGES = 200;

/** Module-level store so the composer pill can open the dialog it renders. */
const listeners = new Set<(agentId: string | null) => void>();
let openedAgentId: string | null = null;

export function openThreadshare(agentId: string): void {
  openedAgentId = agentId;
  for (const listener of listeners) listener(agentId);
}

function closeDialog(agentId: string): void {
  if (openedAgentId !== agentId) return;
  openedAgentId = null;
  for (const listener of listeners) listener(null);
}

/** Same wording the chat uses: time today, weekday within a week, date beyond. */
function formatTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (daysAgo <= 0) return time;
  if (daysAgo < 7) return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  const day = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${day}, ${time}`;
}

interface ThreadshareModalProps extends PluginHostProps {
  agentId: string;
}

export function ThreadshareModal({ agentId, theme }: ThreadshareModalProps) {
  const colors = theme.colors;
  const { t } = useTranslation(messages);
  const toast = useToast();
  const list = useRpc(listMessagesRpc);
  const share = useRpc(shareRpc);
  const [open, setOpen] = useState(openedAgentId === agentId);
  const [startId, setStartId] = useState<string | null>(null);

  useEffect(() => {
    const listener = (next: string | null) => setOpen(next === agentId);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [agentId]);

  // Every open starts clean, and so does every close.
  useEffect(() => {
    if (!open) setStartId(null);
  }, [open]);

  const transcript = useQuery({
    queryKey: ["threadshare", "messages", agentId],
    enabled: open,
    retry: false,
    staleTime: 15_000,
    queryFn: () => list({ agentId, limit: MAX_MESSAGES }),
  });

  // The daemon returns the newest turns first; the sheet reads top to bottom.
  const items = useMemo(
    () => [...(transcript.data?.items ?? [])].reverse(),
    [transcript.data],
  );
  const startIndex = startId ? items.findIndex((item) => item.id === startId) : -1;
  const picked = startIndex >= 0 ? items[startIndex] : null;
  // Once the first turn is picked, earlier turns are out of range and go away.
  const visible = startIndex >= 0 ? items.slice(startIndex) : items;

  const publish = useMutation({
    mutationFn: async (input: { fromId: string; beforeId: string | null }) =>
      share({ agentId, fromId: input.fromId, beforeId: input.beforeId }),
    onSuccess: async ({ url }) => {
      await copyText(url).catch(() => undefined);
      toast.show(t("shared"), { variant: "success", durationMs: 5000 });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const dismiss = useCallback(() => closeDialog(agentId), [agentId]);

  function publishRange(fromId: string, beforeId: string | null) {
    // The sheet goes away as soon as the range is chosen; the upload runs in the
    // background and reports through the toast slot.
    dismiss();
    toast.show(t("sharing"), {
      durationMs: 600_000,
      icon: <ActivityIndicator size="small" color={colors.foregroundMuted} />,
    } as ToastOptions);
    publish.mutate({ fromId, beforeId });
  }

  const step = picked ? "end" : "start";

  // Host text tokens: Paseo's own picker rows are `sm` text with a muted
  // timestamp underneath.
  const preview = { color: colors.foreground, fontSize: 12, lineHeight: 18 } as const;
  const muted = { color: colors.foregroundMuted, fontSize: 12, lineHeight: 18 } as const;
  const row = {
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 4,
  } as const;

  return (
    <Modal
      title={step === "end" ? t("pickEnd") : t("pickStart")}
      icon={<Icon name="Share2" color={colors.foreground} />}
      open={open}
      onOpenChange={(next) => {
        if (next) openThreadshare(agentId);
        else dismiss();
        setOpen(next);
      }}
    >
      <Modal.Content
        contentContainerStyle={{
          // Rows carry the sheet's own 24px inset so highlights run edge to edge,
          // the way the chat's picker does.
          paddingHorizontal: 0,
          paddingTop: 8,
          paddingBottom: 16,
          gap: 0,
        }}
      >
        {picked ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("back")}
            onPress={() => setStartId(null)}
            style={({ pressed }) => ({
              ...row,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: pressed ? colors.surface1 : "transparent",
            })}
          >
            <Icon name="ArrowLeft" size={14} color={colors.foregroundMuted} />
            <Text numberOfLines={1} style={{ ...preview, flex: 1 }}>
              {picked.preview || "…"}
            </Text>
          </Pressable>
        ) : null}

        {picked ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => publishRange(picked.id, null)}
            style={({ pressed }) => ({
              ...row,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: pressed ? colors.surface1 : "transparent",
            })}
          >
            <Text style={preview}>{t("shareToEnd")}</Text>
            <Icon name="ChevronsDown" size={14} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}

        {transcript.isPending ? <Text style={{ ...muted, ...row }}>{t("loading")}</Text> : null}
        {transcript.error ? (
          <Text style={{ ...row, color: colors.statusDanger, fontSize: 12, lineHeight: 18 }}>
            {transcript.error.message}
          </Text>
        ) : null}
        {transcript.data && items.length === 0 ? (
          <Text style={{ ...muted, ...row }}>{t("empty")}</Text>
        ) : null}

        {visible.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.preview.slice(0, 80)}
            onPress={() => {
              if (step === "start") {
                setStartId(item.id);
                return;
              }
              if (!picked) return;
              const index = items.findIndex((candidate) => candidate.id === item.id);
              // Rows are whole turns: the next prompt starts the following turn.
              const after = items[index + 1];
              publishRange(picked.id, after?.id ?? null);
            }}
            style={(state) => {
              // React Native Web adds `hovered`; the native type has no such field.
              const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
              return {
                ...row,
                backgroundColor: pressed || hovered ? colors.surface1 : "transparent",
              };
            }}
          >
            <Text numberOfLines={2} style={preview}>
              {item.preview || "…"}
            </Text>
            <Text style={muted}>{formatTime(item.createdAt)}</Text>
          </Pressable>
        ))}

        {transcript.data?.hasMore ? (
          <View style={{ ...row, paddingTop: 8 }}>
            <Text style={muted}>{t("truncated")}</Text>
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
