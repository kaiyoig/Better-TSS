import type { FetchLike } from "../api/tss";

// Isolated-world side of the main-world fetch bridge (see bridge.ts). Requests go out as
// `tsh-bridge-req` postMessages; the bridge replies with `tsh-bridge-res` carrying a serialized
// response we rehydrate into a real Response. If the bridge never answers a ping (script blocked,
// old browser), we fall back to plain isolated-world fetch permanently.

const REQ = "tsh-bridge-req";
const RES = "tsh-bridge-res";
const REQUEST_TIMEOUT_MS = 30_000;

interface BridgeResponse {
  type?: string;
  id?: number;
  ok?: boolean;
  pong?: boolean;
  world?: string;
  status?: number;
  statusText?: string;
  headers?: [string, string][];
  body?: string;
  error?: string;
}

let seq = 0;
let availability: Promise<boolean> | null = null;
let bridgeWorld: string | null = null;

function nextId(): number {
  return ++seq;
}

function waitFor(id: number, timeoutMs: number): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== window) return;
      const msg = ev.data as BridgeResponse;
      if (!msg || msg.type !== RES || msg.id !== id) return;
      cleanup();
      resolve(msg);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("bridge timeout"));
    }, timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
    };
    window.addEventListener("message", onMsg);
  });
}

function pingBridge(): Promise<boolean> {
  if (!availability) {
    availability = (async () => {
      const id = nextId();
      const answer = waitFor(id, 1_500);
      window.postMessage({ type: REQ, id, ping: true }, window.location.origin);
      try {
        const pong = await answer;
        bridgeWorld = pong.world ?? "unknown";
        return pong.pong === true;
      } catch {
        return false;
      }
    })();
  }
  return availability;
}

/** Empty-body statuses where the Response constructor forbids a body string. */
function bodyFor(status: number, body: string | undefined): string | null {
  return status === 204 || status === 205 || status === 304 ? null : (body ?? "");
}

/** One-line transport description for error reports, e.g. "bridge (main world)". */
export async function describeBridge(): Promise<string> {
  const up = await pingBridge();
  return up ? `bridge (${bridgeWorld ?? "unknown"} world)` : "no bridge — direct fetch";
}

/**
 * A `fetch`-shaped function that executes in the page's main world when the bridge is up
 * (page-identical cookies/credentials), and falls back to direct fetch otherwise.
 */
export function createBridgedFetch(): FetchLike {
  return async (url, init) => {
    if (!(await pingBridge())) return fetch(url, init);

    const id = nextId();
    const answer = waitFor(id, REQUEST_TIMEOUT_MS);
    window.postMessage(
      {
        type: REQ,
        id,
        url,
        init: {
          method: init?.method,
          headers: init?.headers as Record<string, string> | undefined,
          body: typeof init?.body === "string" ? init.body : undefined,
        },
      },
      window.location.origin,
    );

    const msg = await answer;
    if (!msg.ok) throw new TypeError(msg.error ?? "bridge fetch failed");
    const status = msg.status ?? 0;
    if (status < 200 || status > 599) throw new TypeError(`bridge returned status ${status}`);
    return new Response(bodyFor(status, msg.body), {
      status,
      statusText: msg.statusText,
      headers: msg.headers,
    });
  };
}
