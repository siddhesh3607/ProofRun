import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";
import ipaddr from "ipaddr.js";
export function isPublicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && ip.isIPv4MappedAddress())
      ip = ip.toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function validateTarget(value) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Use a public HTTP or HTTPS URL without credentials.");
  if (u.port && !["80", "443"].includes(u.port))
    throw new Error("Only standard web ports are supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (net.isIP(host) && !isPublicAddress(host))
  )
    throw new Error("Private network destinations are blocked.");
  return u;
}
export async function resolvePublic(host) {
  host = host.replace(/^\[|\]$/g, "");
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error("Destination resolves to a non-public network.");
  return addresses[0];
}
// Chromium sends all web traffic through this proxy. Resolve and pin the IP at
// connection time (including redirects and subresources), preventing DNS rebinding.
export async function createEgressProxy() {
  const sockets = new Set();
  const track = (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
    s.setTimeout(20000, () => s.destroy());
  };
  const proxy = http.createServer(async (req, res) => {
    try {
      const u = validateTarget(req.url);
      if (u.protocol !== "http:") throw Error("Unsupported protocol");
      const a = await resolvePublic(u.hostname);
      const headers = { ...req.headers, host: u.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request(
        {
          hostname: a.address,
          family: a.family,
          port: 80,
          path: u.pathname + u.search,
          method: req.method,
          headers,
        },
        (r) => {
          res.writeHead(r.statusCode || 502, r.headers);
          r.pipe(res);
        },
      );
      upstream.on("socket", track);
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end("Blocked destination");
    }
  });
  proxy.on("connection", track);
  proxy.on("connect", async (req, client, head) => {
    try {
      const u = validateTarget("https://" + req.url);
      if ((u.port || "443") !== "443") throw Error("Port blocked");
      const a = await resolvePublic(u.hostname);
      const remote = net.connect({
        host: a.address,
        family: a.family,
        port: 443,
      });
      track(remote);
      remote.on("error", () => client.destroy());
      client.on("error", () => remote.destroy());
      client.on("close", () => remote.destroy());
      remote.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) remote.write(head);
        remote.pipe(client);
        client.pipe(remote);
      });
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  return {
    url: "http://127.0.0.1:" + proxy.address().port,
    close: async () => {
      proxy.closeAllConnections();
      for (const s of sockets) s.destroy();
      await Promise.race([
        new Promise((resolve) => proxy.close(resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    },
  };
}
