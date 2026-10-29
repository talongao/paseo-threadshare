import type { PluginClientContext } from "@getpaseo/plugin/client";
import { messages } from "./client/messages";
import { contributePills } from "./client/pill";
import { ThreadshareSettingsScreen } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "threadshare-settings",
    title: messages.message("settingsTitle"),
    icon: "Share2",
    Component: ThreadshareSettingsScreen,
  });
  return contributePills(client);
}
