import "server-only";
import { Agent as HttpsAgent } from "https";
import { connect as netConnect } from "net";
import { connect as tlsConnect, TLSSocket } from "tls";
import { URL } from "url";

/**
 * Build a Node https.Agent that tunnels through an HTTP CONNECT proxy.
 *
 * Implementation note: Next.js dev webpack tree-shaking can break
 * `class extends https.Agent` — subclass methods may not survive the bundle,
 * causing `this.createConnection is not a function` from Node's internal
 * `_http_agent.createSocket`. We sidestep this by instantiating a plain
 * `https.Agent` and attaching `createConnection` as an own property.
 */
export function buildProxyAgent(proxyUrl: string): HttpsAgent {
  const u = new URL(proxyUrl);
  const proxyHost = u.hostname;
  const proxyPort = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;

  const agent = new HttpsAgent({ keepAlive: true });
  // Override as own property so Node's _http_agent picks it up regardless
  // of how the bundle handles prototype methods.
  (agent as unknown as { createConnection: typeof createTunneledConnection }).createConnection =
    createTunneledConnection;

  function createTunneledConnection(
    opts: { host?: string; hostname?: string; port?: number; servername?: string },
    cb: (err: NodeJS.ErrnoException | null, socket?: TLSSocket) => void,
  ): void {
    const targetHost = opts.hostname ?? opts.host ?? "localhost";
    const targetPort = opts.port ?? 443;

    const sock = netConnect(proxyPort, proxyHost);
    let settled = false;

    const fail = (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      cb(err);
    };

    sock.once("error", fail);
    sock.once("connect", () => {
      sock.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`,
      );
    });

    let buf = Buffer.alloc(0);
    let parsed = false;

    sock.on("data", (chunk: Buffer) => {
      if (parsed) return;
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      parsed = true;

      const head = buf.subarray(0, headerEnd).toString("ascii");
      const statusMatch = /^HTTP\/1\.[01] (\d{3})/.exec(head.split("\r\n")[0] ?? "");
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      if (status < 200 || status >= 300) {
        return fail(new Error(`proxy CONNECT failed with ${status || "malformed response"}`));
      }

      if (settled) return;
      settled = true;
      sock.removeAllListeners("error");
      const tlsSock = tlsConnect({
        socket: sock,
        servername: opts.servername ?? targetHost,
      });
      tlsSock.once("secureConnect", () => cb(null, tlsSock));
      tlsSock.once("error", fail);
    });
  }

  return agent;
}
