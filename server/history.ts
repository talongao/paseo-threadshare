import type { JsonValue } from "@getpaseo/protocol/agent-types";

export const HISTORY_FORMAT = "threadshare-history@v1";
export const HISTORY_SCHEMA_VERSION = 1;
export const MAX_SHARE_BYTES = 5 * 1024 * 1024;

const REDACTED = "[REDACTED]";
const BEARER_PROSE_TERMS = new Set([
  "authentication",
  "authorization",
  "credential",
  "credentials",
  "mechanism",
  "middleware",
  "protocol",
  "specification",
  "standard",
]);
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export type SharedEntry =
  | { id: string; createdAt: string; kind: "message"; role: "user" | "assistant"; markdown: string }
  | {
      id: string;
      createdAt: string;
      kind: "tool";
      name: string;
      status: "running" | "completed" | "failed" | "canceled";
      input?: unknown;
      output?: unknown;
      error?: unknown;
    }
  | { id: string; createdAt: string; kind: "thought"; text: string; status: "loading" | "ready" }
  | { id: string; createdAt: string; kind: "todo"; items: Array<{ text: string; completed: boolean }> }
  | {
      id: string;
      createdAt: string;
      kind: "activity";
      message: string;
      level: "system" | "info" | "success" | "error";
    }
  | {
      id: string;
      createdAt: string;
      kind: "compaction";
      status: "loading" | "completed";
      trigger?: "auto" | "manual";
      preTokens?: number;
    };

export interface SharedHistory {
  format: typeof HISTORY_FORMAT;
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  exportedAt: string;
  conversation: {
    id: string;
    title: string;
    source: "paseo";
    provider?: string;
    model?: string;
  };
  entries: SharedEntry[];
}

/** Ported from the client implementation so both exports redact the same way. */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const isTokenMetric =
    /^(?:input|output|prompt|completion|cached|reasoning|total|max|min)tokens?(?:count|used|usage|limit|remaining|type|status|expires|expiry|ttl|length)?$/.test(
      normalized,
    ) ||
    /^tokens?(?:count|used|usage|limit|remaining|max|min|type|status|expires|expiry|ttl|length)$/.test(
      normalized,
    );
  const isAuthMetadata =
    /^(?:auth|oauth|authentication|authorization)(?:status|state|enabled|mode|type|scheme|required)$/.test(
      normalized,
    );
  if (isTokenMetric || isAuthMetadata) return false;

  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const wordForms = words.flatMap((word) =>
    word.endsWith("s") ? [word, word.slice(0, -1)] : [word],
  );
  const hasSensitiveWord = wordForms.some((word) =>
    [
      "auth",
      "authentication",
      "authorization",
      "cookie",
      "credential",
      "oauth",
      "passphrase",
      "passwd",
      "password",
      "secret",
      "token",
    ].includes(word),
  );
  if (hasSensitiveWord) return true;

  const hasSensitiveKey =
    wordForms.includes("key") &&
    ["access", "api", "encryption", "private", "secret", "signing", "ssh"].some((word) =>
      wordForms.includes(word),
    );
  if (hasSensitiveKey) return true;

  const forms = normalized.endsWith("s") ? [normalized, normalized.slice(0, -1)] : [normalized];
  const sensitiveNames = [
    "accesskey",
    "apikey",
    "auth",
    "authentication",
    "authorization",
    "credential",
    "clientsecret",
    "passphrase",
    "passwd",
    "password",
    "privatekey",
    "secret",
    "secretkey",
    "token",
    "accesskeyid",
    "accesskeysecret",
    "secretaccesskey",
    "refreshtoken",
    "sessiontoken",
    "cookie",
  ];
  return forms.some((form) => sensitiveNames.some((name) => form === name || form.endsWith(name)));
}

function isBasicCredential(value: string): boolean {
  const unpadded = value.replace(/=+$/, "");
  if (unpadded.length < 2 || unpadded.length % 4 === 1) return false;

  let bits = 0;
  let bitCount = 0;
  for (const character of unpadded) {
    const sextet = BASE64_ALPHABET.indexOf(character);
    if (sextet < 0) return false;
    bits = (bits << 6) | sextet;
    bitCount += 6;
    if (bitCount < 8) continue;
    bitCount -= 8;
    const byte = (bits >> bitCount) & 0xff;
    if (byte === 0x3a) return true;
    bits &= (1 << bitCount) - 1;
  }
  return false;
}

function redactPlainText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      REDACTED,
    )
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, `$1${REDACTED}@`)
    .replace(
      /((?:"|')?(?:api[_-]?keys?|access[_-]?key(?:s|[_-]?(?:ids?|secrets?))?|secret[_-]?access[_-]?keys?|access[_-]?tokens?|refresh[_-]?tokens?|session[_-]?tokens?|auths?|authentications?|authorizations?|cookies?|credentials?|client[_-]?secrets?|passwords?|private[_-]?keys?|secrets?|tokens?)(?:"|')?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Basic|Bearer|Token)\s+[A-Za-z0-9._~+/=-]+|[^\s,;]+)/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b(Basic)\s+([A-Za-z0-9+/]+={0,2})/gi, (match, scheme, token) =>
      isBasicCredential(token) ? `${scheme} ${REDACTED}` : match,
    )
    .replace(/\b(Bearer)\s+([A-Za-z0-9._~+/=-]+)/gi, (match, scheme, token) =>
      /^[A-Za-z]+$/.test(token) && BEARER_PROSE_TERMS.has(token.toLowerCase())
        ? match
        : `${scheme} ${REDACTED}`,
    )
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:sk|rk)[-_][A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{8,}\b/g, REDACTED)
    .replace(
      /\b(?:AKIA[0-9A-Z]{16}|LTAI[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g,
      REDACTED,
    );
}

/**
 * Tool payloads often carry JSON as text. Redact it structurally when it
 * parses, otherwise fall back to the plain-text rules.
 */
export function redactText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed)));
    } catch {
      // Not JSON; the plain-text rules still apply.
    }
  }
  return redactPlainText(value);
}

/** JSON-safe copy of a tool payload with sensitive keys and tokens removed. */
export function redactValue(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
      if (isSensitiveKey(key)) return [[key, REDACTED] as const];
      const redacted = redactValue(child);
      return redacted === undefined ? [] : [[key, redacted] as const];
    });
    return Object.fromEntries(entries);
  }
  return value === undefined ? null : String(value);
}
