# Thread Share

Publishes a range of the current agent conversation as a Threadshare link that people and other agents can read.

A Share pill appears in the composer bar of every agent. Press it to open the conversation, pick the first message, then pick the last. The dialog closes, the link is copied to the clipboard, and a toast reports the result. Picking the first message offers a "share to latest" shortcut when the rest of the conversation is what you want.

The plugin reads the timeline from the daemon and uploads it itself, so nothing else has to be installed.

## Setup

Open Settings, Plugins, Thread Share and set the service address.

- Service address: where shares are published. Leave it empty to use the hosted service at `https://cloud-thread.team-harness.com`, or enter your own Threadshare deployment.

To run your own service, see the [Threadshare project](https://github.com/team-harness/threadshare). Its README covers self-hosting and the API the plugin posts to.

Paseo 0.13.0 or newer is required.

## Data and limits

Conversations are read from the agent timeline, so the export uses the same rows the chat shows, including tool calls and reasoning. Previews in the dialog and the uploaded document are redacted: private keys, credentials in URLs, API keys, tokens, and bearer or JWT values are replaced before anything leaves the host. Tool input is trimmed to the command, path, URL or query, and large outputs are dropped.

The selected range, and nothing else, is sent as one HTTPS request to the service address when you finish picking. That service stores the conversation and serves the resulting link; the plugin keeps no copy. The picker lists the newest 200 messages, and a share is refused when the export exceeds 5 MiB.

The plugin reads agent metadata to place the pill. Settings are stored by the daemon beside its other plugin data.
