# Thread Share

A Paseo plugin that publishes a range of the current agent conversation as a Threadshare link.

Pick the Share pill above the composer, choose the first message, then the last one, and the link
is copied to your clipboard.

## Install

```bash
paseo plugin add talongao/paseo-threadshare
```

Or from a local checkout:

```bash
paseo plugin add /path/to/threadshare
```

## Setup

Open Settings, Plugins, Thread Share and set the service address. Leave it empty to use the hosted
service at `https://cloud-thread.team-harness.com`.

### Self-hosting

To run your own service, see [team-harness/threadshare](https://github.com/team-harness/threadshare).
The plugin only needs `POST {baseUrl}/api/v1/shares`, which that project implements.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin add .
paseo plugin reload threadshare
```

Paseo compiles the TypeScript entries itself, so there is no build step. React, React Native,
`@tanstack/react-query`, `zod` and `@getpaseo/plugin` are supplied by the host at runtime; the
dependencies in `package.json` are for typechecking and tests only.
