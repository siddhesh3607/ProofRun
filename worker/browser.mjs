import { chromium } from "playwright";
import { createEgressProxy, validateTarget } from "./security.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
export const fixture =
  '<!doctype html><html><head><title>ProofRun demo</title><style>body{font:18px Arial;background:#f4f7fb;color:#1b3048;padding:70px}main{background:white;max-width:650px;padding:45px;border:1px solid #dce5ef;border-radius:16px}h1{font-size:36px}input,button{font:16px Arial;padding:14px;border:1px solid #cdd8e5;border-radius:6px}button{background:#1268eb;color:white;margin-left:8px}p{line-height:1.7}#error{color:#b54339}</style></head><body><main><p>PROOFRUN / BUILT-IN TEST FIXTURE</p><h1>A small form. Real evidence.</h1><p>This form intentionally has a broken submit handler. The browser should expose the missing validation message.</p><form novalidate><input type="email" aria-label="Email" placeholder="Your email"><button type="submit">Join waitlist</button></form><p id="error" role="alert"></p><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();console.error("Demo bug: validation handler did not display an error")}</script></main></body></html>';
export async function runBrowser(input, dir, { demo = false } = {}) {
  const start = Date.now();
  let browser, proxy, timer;
  await mkdir(dir, { recursive: true });
  try {
    proxy = await createEgressProxy();
    browser = await chromium.launch({
      headless: true,
      timeout: 20000,
      ...(process.env.BROWSER_CHANNEL
        ? { channel: process.env.BROWSER_CHANNEL }
        : {}),
      chromiumSandbox: !(demo && process.platform === "win32"),
      proxy: { server: proxy.url },
      args: [
        "--disable-gpu",
        "--disable-quic",
        "--proxy-bypass-list=<-loopback>",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ],
    });
    timer = setTimeout(() => browser.close().catch(() => {}), 45000);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: false,
    });
    let requests = 0;
    await context.route("**/*", async (route) => {
      if (++requests > 150) return route.abort();
      try {
        validateTarget(route.request().url());
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    context.on("page", (p) => {
      if (context.pages().length > 1) p.close().catch(() => {});
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(15000);
    const logs = [];
    page.on("console", (m) => {
      if (m.type() === "error" && logs.length < 30)
        logs.push(m.text().slice(0, 1000));
    });
    page.on("pageerror", (e) => {
      if (logs.length < 30) logs.push(e.message.slice(0, 1000));
    });
    const checks = [];
    if (demo) {
      await page.setContent(fixture, { waitUntil: "load" });
      checks.push({
        name: "Page loads",
        passed: true,
        expected: "Demo fixture renders",
        observed: "Fixture rendered in Chromium",
      });
    } else {
      validateTarget(input.url);
      try {
        const response = await page.goto(input.url, {
          waitUntil: "domcontentloaded",
        });
        checks.push({
          name: "Page loads",
          passed: !!response && response.status() < 400,
          expected: "HTTP status below 400",
          observed: "HTTP " + (response?.status() || "no response"),
        });
      } catch (e) {
        checks.push({
          name: "Page loads",
          passed: false,
          expected: "Page loads within 15 seconds",
          observed: e.message.slice(0, 700),
        });
      }
    }
    if (input.check !== "load" || demo) {
      const selector = demo ? 'button[type="submit"]' : input.selector;
      const expected = demo ? "Please enter your email" : input.expected;
      const kind = demo ? "validation" : input.check;
      try {
        await page.locator("css=" + selector).click();
        if (kind === "navigate") {
          await page.waitForURL(expected, { timeout: 7000 });
          checks.push({
            name: "Button navigation",
            passed: true,
            expected,
            observed: page.url(),
          });
        } else {
          await page
            .getByText(expected, { exact: false })
            .first()
            .waitFor({ state: "visible", timeout: 5000 });
          checks.push({
            name: "Form validation",
            passed: true,
            expected,
            observed: "Expected validation message is visible",
          });
        }
      } catch (e) {
        checks.push({
          name: kind === "navigate" ? "Button navigation" : "Form validation",
          passed: false,
          expected,
          observed:
            kind === "navigate"
              ? "Expected destination was not reached. Current URL: " +
                page.url()
              : "Expected message was not visible after clicking the submit button. " +
                e.message.slice(0, 250),
        });
      }
    }
    checks.push({
      name: "Browser console",
      passed: logs.length === 0,
      expected: "No JavaScript or console errors",
      observed: logs.length
        ? logs.length + " error(s) captured"
        : "No console errors recorded",
    });
    await page.screenshot({
      path: path.join(dir, "screenshot.png"),
      fullPage: false,
      timeout: 5000,
    });
    return {
      checks,
      console: logs,
      durationMs: Date.now() - start,
      screenshot: "screenshot.png",
      finalUrl: demo ? "proofrun:fixture" : page.url(),
    };
  } finally {
    clearTimeout(timer);
    if (browser) await browser.close().catch(() => {});
    if (proxy) await proxy.close();
  }
}
