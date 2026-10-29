import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_SERVICE_URL = "https://cloud-thread.team-harness.com";

/**
 * Host-scoped settings, stored by the daemon next to the other plugin data.
 * Every field has a default so an untouched install reads as one document
 * instead of an invalid one.
 */
export const threadshareSettings = defineSettings({
  id: "threadshare",
  scope: "host",
  version: 2,
  schema: z.object({
    /** Empty means the hosted service. */
    baseUrl: z.string().default(""),
  }),
  // Version 1 also stored a CLI path; sharing no longer shells out, so the
  // field is dropped instead of kept as dead config.
  migrate: (values) => {
    const previous = (values ?? {}) as { baseUrl?: unknown };
    return { baseUrl: typeof previous.baseUrl === "string" ? previous.baseUrl : "" };
  },
});

export interface ThreadshareConfig {
  readonly baseUrl: string;
}

export function configFrom(values: { baseUrl: string }): ThreadshareConfig {
  return { baseUrl: values.baseUrl.trim() };
}

/** The service the plugin talks to, for labels and for `--url`. */
export function serviceLabel(baseUrl: string): string {
  return baseUrl.trim() || DEFAULT_SERVICE_URL;
}

/** Accepts an empty value, or an absolute http(s) URL with no query or fragment. */
export function baseUrlProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Use an absolute URL such as https://threadshare.example.com, or leave it empty.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "The address must start with http:// or https://.";
  }
  if (url.search || url.hash) {
    return "Use the service origin only; drop the query string and fragment.";
  }
  return null;
}
