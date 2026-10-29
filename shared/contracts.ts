import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Timeline sequence numbers of the picked user turns. */
const messageId = z.string().min(1).max(40).regex(/^\d+$/);

const message = z.object({
  id: messageId,
  preview: z.string(),
  createdAt: z.string(),
});

export const listMessagesRpc = defineRpc({
  name: "threadshare.messages.list",
  input: z.object({
    agentId: z.string().min(1),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  output: z.object({
    items: z.array(message),
    hasMore: z.boolean(),
  }),
});

export const shareRpc = defineRpc({
  name: "threadshare.share",
  input: z.object({
    agentId: z.string().min(1),
    fromId: messageId,
    /** Exclusive upper bound: the turn after the last one the user picked. */
    beforeId: messageId.nullable().default(null),
  }),
  output: z.object({
    id: z.string(),
    url: z.string(),
  }),
});

export type Message = z.infer<typeof message>;
export type MessagePage = z.infer<typeof listMessagesRpc.output>;
