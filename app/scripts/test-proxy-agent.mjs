import { request } from "https";
import { Agent as HttpsAgent } from "https";
import { connect as netConnect } from "net";
import { connect as tlsConnect } from "tls";
import { URL } from "url";

function buildProxyAgent(proxyUrl) {
  const u = new URL(proxyUrl);
  const proxyHost = u.hostname;
  const proxyPort = u.port ? Number(u.port) : 80;
  const agent = new HttpsAgent({ keepAlive: true });
  agent.createConnection = function (opts, cb) {
    const targetHost = opts.hostname ?? opts.host ?? "localhost";
    const targetPort = opts.port ?? 443;
    const sock = netConnect(proxyPort, proxyHost);
    let settled = false;
    const fail = (err) => { if (settled) return; settled = true; sock.destroy(); cb(err); };
    sock.once("error", fail);
    sock.once("connect", () => {
      sock.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: keep-alive\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    let parsed = false;
    sock.on("data", (chunk) => {
      if (parsed) return;
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;
      parsed = true;
      const head = buf.subarray(0, end).toString("ascii");
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(head.split("\r\n")[0] ?? "");
      const status = m ? Number(m[1]) : 0;
      if (status < 200 || status >= 300) return fail(new Error(`proxy CONNECT ${status || "malformed"}`));
      if (settled) return;
      settled = true;
      sock.removeAllListeners("error");
      const tlsSock = tlsConnect({ socket: sock, servername: opts.servername ?? targetHost });
      tlsSock.once("secureConnect", () => cb(null, tlsSock));
      tlsSock.once("error", fail);
    });
  };
  return agent;
}

const agent = buildProxyAgent("http://127.0.0.1:17570");
const req = request(
  { host: "api.github.com", path: "/zen", method: "GET", agent, headers: { "User-Agent": "proxy-test", Accept: "application/json" }, timeout: 8000 },
  (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => { console.log("status:", res.statusCode); console.log("body:", body); process.exit(0); });
  },
);
req.on("error", (e) => { console.log("err:", e.message); process.exit(1); });
req.on("timeout", () => { console.log("timeout"); req.destroy(); process.exit(2); });
req.end();
