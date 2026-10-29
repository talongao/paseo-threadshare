import { prepareUpload } from "./export";
import type { SharedHistory } from "./history";
import { serviceLabel } from "../shared/settings";

interface CreateShareResponse {
  id: string;
}

export class ShareUploadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShareUploadError";
  }
}

function shareEndpoint(baseUrl: string): URL {
  const endpoint = new URL("/api/v1/shares", serviceLabel(baseUrl));
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("Chat sharing needs an http or https service address.");
  }
  return endpoint;
}

async function readError(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && "error" in payload) {
      const message = (payload as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
  } catch {
    // The service may answer with a non-JSON infrastructure page.
  }
  return `The share service refused this upload (HTTP ${response.status}).`;
}

/** Same upload the client performs: one POST, one viewer link. */
export async function uploadShare(input: {
  baseUrl: string;
  history: SharedHistory;
}): Promise<{ id: string; url: string }> {
  const endpoint = shareEndpoint(input.baseUrl);
  const { body } = prepareUpload(input.history);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!response.ok) throw new ShareUploadError(response.status, await readError(response));

  const payload = (await response.json()) as CreateShareResponse;
  if (typeof payload?.id !== "string" || !payload.id) {
    throw new Error("The share service returned an invalid response.");
  }
  const viewerUrl = new URL("/", endpoint);
  viewerUrl.searchParams.set("id", payload.id);
  return { id: payload.id, url: viewerUrl.toString() };
}

