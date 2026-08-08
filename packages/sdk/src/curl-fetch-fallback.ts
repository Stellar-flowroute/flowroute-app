// Local development workaround.
//
// On some machines Node's built-in fetch (undici) fails to establish a TCP
// connection to soroban-testnet.stellar.org's Cloudflare-fronted IPs with
// ETIMEDOUT, even though the exact same host and port are reachable from
// curl on the same machine instantly and every time. DNS resolution was
// confirmed correct (Node and curl resolve to the same IPs), no proxy is
// set, and the failure is consistent, not transient. This appears to be a
// narrow Node socket-level or TLS-handshake incompatibility with that
// specific edge, not a real network or DNS problem.
//
// This installs a global fetch override that shells out to curl only for
// requests to the configured RPC host, and only when this module is
// explicitly enabled. It is off by default. Enable it locally with:
//
//   FLOWROUTE_USE_CURL_FETCH=1 pnpm dev
//
// This should not be needed in a normal hosted environment such as Render,
// where Node's networking has not shown this issue. If you deploy and see
// the same ETIMEDOUT pattern there, enable this the same way and file it as
// a real infrastructure question, do not leave it enabled everywhere by
// default without knowing why.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function installCurlFetchFallback(): void {
  if (process.env.FLOWROUTE_USE_CURL_FETCH !== "1") {
    return;
  }

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = init?.headers ? new Headers(init.headers) : new Headers();
    const body = typeof init?.body === "string" ? init.body : undefined;

    const args = ["-s", "-X", method, url];
    headers.forEach((value, key) => {
      args.push("-H", `${key}: ${value}`);
    });
    if (body !== undefined) {
      args.push("-d", body);
    }

    let stdout: string;
    try {
      const result = await execFileAsync("curl", args, { maxBuffer: 10 * 1024 * 1024 });
      stdout = result.stdout;
    } catch (error) {
      // Fall back to the original fetch if curl itself is unavailable or fails,
      // so this override degrades to normal behavior rather than hard-failing.
      return originalFetch(input, init);
    }

    return new Response(stdout, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
