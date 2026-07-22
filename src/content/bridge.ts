// Runs in the page's own JS world (manifest `"world": "MAIN"`). Some browsers (notably Brave)
// don't attach the page's cookies to fetches made from an extension's isolated world, which makes
// TSS answer with its SSO-interception page even though the user is logged in. This bridge
// performs fetches *as the page* — indistinguishable from the Fiori UI's own XHRs — on behalf of
// the isolated-world client (see bridgeClient.ts for the postMessage protocol).
//
// No imports: this file must build as a single self-contained script with no shared chunks.

const REQ = "tsh-bridge-req";
const RES = "tsh-bridge-res";

interface BridgeRequest {
  type?: string;
  id?: number;
  ping?: boolean;
  url?: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

async function run(id: number, url: string, init: BridgeRequest["init"]): Promise<void> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      body: init?.body,
      credentials: "include",
    });
    const body = await res.text();
    const headers: [string, string][] = [];
    res.headers.forEach((v, k) => headers.push([k, v]));
    window.postMessage(
      { type: RES, id, ok: true, status: res.status, statusText: res.statusText, headers, body },
      window.location.origin,
    );
  } catch (e) {
    window.postMessage(
      { type: RES, id, ok: false, error: String(e) },
      window.location.origin,
    );
  }
}

window.addEventListener("message", (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const msg = ev.data as BridgeRequest;
  if (!msg || msg.type !== REQ || typeof msg.id !== "number") return;
  if (msg.ping) {
    // In the page's main world `chrome.runtime.id` is absent; in an isolated world (e.g. a
    // browser that ignores `"world": "MAIN"`) it exists — report which, for diagnostics.
    const g = globalThis as { chrome?: { runtime?: { id?: string } } };
    const world = g.chrome?.runtime?.id ? "isolated" : "main";
    window.postMessage(
      { type: RES, id: msg.id, ok: true, pong: true, world },
      window.location.origin,
    );
    return;
  }
  if (typeof msg.url === "string") void run(msg.id, msg.url, msg.init);
});

export {};
