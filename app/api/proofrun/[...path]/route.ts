import { env } from "cloudflare:workers";
type Settings = {
  PROOFRUN_WORKER_URL?: string;
  PROOFRUN_SERVICE_TOKEN?: string;
};
async function handle(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/");
  const allowed =
    /^(health|demo|runs|runs\/[a-f0-9-]{36}(\/(execute|retry|screenshot))?)$/;
  if (!allowed.test(route))
    return Response.json({ error: "Not found" }, { status: 404 });
  const settings = env as unknown as Settings;
  const base = settings.PROOFRUN_WORKER_URL,
    token = settings.PROOFRUN_SERVICE_TOKEN;
  if (!base || !token) {
    if (route === "health")
      return Response.json({
        connected: false,
        paymentsReady: false,
        price: "0.10",
      });
    return Response.json(
      {
        error:
          "Connect the browser worker in the deployment settings to start testing.",
      },
      { status: 503 },
    );
  }
  if (req.method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return Response.json(
        { error: "Cross-origin request rejected" },
        { status: 403 },
      );
  }
  const current = req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)pr_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const owner =
    current ||
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const headers = new Headers({ "x-service-token": token, "x-owner": owner });
  if (req.headers.has("payment-signature"))
    headers.set("payment-signature", req.headers.get("payment-signature")!);
  let body: string | undefined;
  if (req.method === "POST") {
    body = await req.text();
    if (body.length > 16384)
      return Response.json({ error: "Request too large" }, { status: 413 });
    headers.set("Content-Type", "application/json");
  }
  try {
    const upstream = await fetch(
      base.replace(/\/$/, "") +
        (route === "health" ? "/health" : "/v1/" + route),
      {
        method: req.method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(55000),
      },
    );
    if (upstream.status >= 300 && upstream.status < 400)
      throw new Error("Unexpected worker redirect");
    const out = new Headers({
      "Content-Type":
        upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const h of ["payment-required", "payment-response"])
      if (upstream.headers.has(h)) out.set(h, upstream.headers.get(h)!);
    if (!current)
      out.set(
        "Set-Cookie",
        "pr_session=" +
          owner +
          "; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000" +
          (new URL(req.url).protocol === "https:" ? "; Secure" : ""),
      );
    if (route.endsWith("/screenshot"))
      return new Response(upstream.body, {
        status: upstream.status,
        headers: out,
      });
    const data = (await upstream.json()) as Record<string, unknown>;
    delete data.accessToken;
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: out,
    });
  } catch (e) {
    console.error("ProofRun proxy unavailable", (e as Error).message);
    if (route === "health")
      return Response.json({
        connected: false,
        paymentsReady: false,
        price: "0.10",
      });
    return Response.json(
      {
        error:
          "The browser service is unreachable. Your paid run remains saved; check again before submitting another payment.",
      },
      { status: 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
