import { AxeBuilder } from "@axe-core/playwright";
import type { Browser, ConsoleMessage, Page, Request, Response } from "playwright-core";
import { launchChromiumBrowser } from "@/lib/runtime/browser";
import type {
  AccessibilityFinding,
  PerformanceMetrics,
  RuntimeArtifacts,
  Screenshot,
  SecurityFinding,
} from "@/lib/types";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

type CrawlOptions = {
  maxDepth?: number;
  maxPages?: number;
  onNavigation?: (payload: { message: string; screenshot?: Screenshot }) => void;
};

function toAbsUrl(origin: string, href: string): string {
  try {
    return new URL(href, origin).toString();
  } catch {
    return "";
  }
}

function detectSecuritySignals(html: string, headers: Record<string, string>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const keyRegex = /(sk_live_[a-zA-Z0-9]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{30,})/g;
  const jwtRegex = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+/g;

  if (keyRegex.test(html)) {
    findings.push({
      severity: "high",
      description: "Possible secret key exposed in rendered HTML.",
      evidence: "Detected provider-style key pattern in client HTML.",
    });
  }

  if (jwtRegex.test(html)) {
    findings.push({
      severity: "medium",
      description: "Possible token leakage in rendered HTML.",
      evidence: "Detected JWT-like token pattern.",
    });
  }

  const csp = headers["content-security-policy"];
  if (!csp) {
    findings.push({
      severity: "medium",
      description: "Missing content-security-policy header.",
      evidence: "No CSP header found on main document response.",
    });
  }

  const xFrame = headers["x-frame-options"];
  if (!xFrame) {
    findings.push({
      severity: "low",
      description: "Missing x-frame-options header.",
      evidence: "No x-frame-options header found.",
    });
  }

  return findings;
}

function parseConsole(msg: ConsoleMessage): string {
  return `[${msg.type()}] ${msg.text()}`.trim();
}

function parseRequestFailure(req: Request): string {
  const failure = req.failure()?.errorText ?? "unknown";
  return `${req.method()} ${req.url()} (${failure})`;
}

function parseA11yViolations(raw: Awaited<ReturnType<AxeBuilder["analyze"]>>): AccessibilityFinding[] {
  return raw.violations.flatMap((violation) => {
    const severity: AccessibilityFinding["severity"] =
      violation.impact === "serious" || violation.impact === "critical"
        ? "high"
        : violation.impact === "moderate"
          ? "medium"
          : "low";

    return violation.nodes.slice(0, 3).map((node) => ({
      severity,
      description: `${violation.id}: ${violation.help}`,
      selector: node.target.join(", "),
    }));
  });
}

function makeTestCredentials() {
  const stamp = Date.now().toString().slice(-6);
  return {
    email: `preflight+${stamp}@example.com`,
    password: `Preflight!${stamp}`,
    fullName: "Preflight Test User",
    firstName: "Preflight",
    lastName: "User",
  };
}

async function attemptSignupFlow(page: Page): Promise<boolean> {
  const credentials = makeTestCredentials();

  const hasLikelySignupForm = await page.evaluate(() => {
    const hasEmail = !!document.querySelector(
      'input[type="email"], input[name*="email" i], input[placeholder*="email" i]',
    );
    const hasPassword = !!document.querySelector(
      'input[type="password"], input[name*="password" i], input[placeholder*="password" i]',
    );
    if (!hasEmail || !hasPassword) return false;

    const bodyText = (document.body?.textContent ?? "").toLowerCase();
    const path = window.location.pathname.toLowerCase();
    return (
      path.includes("sign") ||
      path.includes("auth") ||
      path.includes("register") ||
      bodyText.includes("sign up") ||
      bodyText.includes("signup") ||
      bodyText.includes("register") ||
      bodyText.includes("create account") ||
      bodyText.includes("execute_auth")
    );
  });

  if (!hasLikelySignupForm) return false;

  // Some custom auth UIs require selecting account creation mode first.
  const createAccountToggles = [
    'button:has-text("Create account")',
    'button:has-text("CREATE_ACCOUNT")',
    'a:has-text("Create account")',
    'a:has-text("CREATE_ACCOUNT")',
    '[role="button"]:has-text("Create account")',
    '[role="button"]:has-text("CREATE_ACCOUNT")',
  ];
  for (const selector of createAccountToggles) {
    const toggle = page.locator(selector).first();
    if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
      try {
        await toggle.click({ timeout: 2000 });
        await page.waitForTimeout(250);
        break;
      } catch {
        // Continue with other toggles.
      }
    }
  }

  const fillIfExists = async (selectors: string[], value: string) => {
    for (const selector of selectors) {
      const field = page.locator(selector).first();
      if ((await field.count()) > 0 && (await field.isVisible())) {
        await field.fill(value);
        return true;
      }
    }
    return false;
  };

  await fillIfExists(
    ['input[name*="name" i]', 'input[id*="name" i]', 'input[placeholder*="name" i]'],
    credentials.fullName,
  );
  await fillIfExists(
    ['input[name*="first" i]', 'input[id*="first" i]', 'input[placeholder*="first" i]'],
    credentials.firstName,
  );
  await fillIfExists(
    ['input[name*="last" i]', 'input[id*="last" i]', 'input[placeholder*="last" i]'],
    credentials.lastName,
  );

  const filledEmail = await fillIfExists(
    ['input[type="email"]', 'input[name*="email" i]', 'input[placeholder*="email" i]'],
    credentials.email,
  );
  const filledPassword = await fillIfExists(
    ['input[type="password"]', 'input[name*="password" i]', 'input[placeholder*="password" i]'],
    credentials.password,
  );

  if (!filledEmail || !filledPassword) return false;

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign up")',
    'button:has-text("SIGN UP")',
    'button:has-text("Create account")',
    'button:has-text("CREATE_ACCOUNT")',
    'button:has-text("Register")',
    'button:has-text("EXECUTE_AUTH")',
    '[role="button"]:has-text("EXECUTE_AUTH")',
    '[role="button"]:has-text("Create account")',
  ];

  for (const selector of submitSelectors) {
    const submit = page.locator(selector).first();
    if ((await submit.count()) > 0 && (await submit.isVisible())) {
      const beforeUrl = page.url();
      try {
        await Promise.allSettled([
          page.waitForLoadState("networkidle", { timeout: 12000 }),
          submit.click({ timeout: 5000 }),
        ]);
      } catch {
        // Continue trying fallback selectors.
      }
      if (page.url() !== beforeUrl) {
        return true;
      }
    }
  }

  // Last fallback: submit nearest form via Enter key.
  try {
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function runRuntimeCrawl(previewUrl: string, options: CrawlOptions = {}): Promise<RuntimeArtifacts> {
  const maxDepth = options.maxDepth ?? 2;
  const maxPages = options.maxPages ?? 8;

  let browser: Browser;
  try {
    browser = await launchChromiumBrowser();
  } catch (err) {
    return getPartialFailureArtifacts(`Browser launch failed: ${String(err)}`);
  }

  const runtime: RuntimeArtifacts = {
    screenshots: [],
    consoleErrors: [],
    networkFailures: [],
    accessibilityViolations: [],
    pageMetadata: [],
    performanceMetrics: {
      lcpMs: 0,
      ttiMs: 0,
      tbtMs: 0,
      slowRequests: [],
    },
    securityFindings: [],
    visitedPaths: [],
  };

  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: previewUrl, depth: 0 }];

  try {
    while (queue.length && visited.size < maxPages) {
      const next = queue.shift();
      if (!next) {
        break;
      }
      if (visited.has(next.url)) {
        continue;
      }
      visited.add(next.url);

      const desktopContext = await browser.newContext({ viewport: DESKTOP });
      const desktopPage = await desktopContext.newPage();
      let mainDocumentResponse: Response | null = null;
      const requestStart = new Map<Request, number>();

      desktopPage.on("request", (req) => {
        requestStart.set(req, Date.now());
      });

      desktopPage.on("requestfailed", (req) => {
        runtime.networkFailures.push(parseRequestFailure(req));
      });

      desktopPage.on("response", (response) => {
        const req = response.request();
        const started = requestStart.get(req);
        if (!started) return;
        const latency = Date.now() - started;
        if (latency > 1200) {
          runtime.performanceMetrics.slowRequests.push(`${req.method()} ${req.url()} (${latency}ms)`);
        }
      });

      desktopPage.on("console", (msg) => {
        if (msg.type() === "error" || msg.text().toLowerCase().includes("hydration")) {
          runtime.consoleErrors.push(parseConsole(msg));
        }
      });

      try {
        mainDocumentResponse = await desktopPage.goto(next.url, { waitUntil: "networkidle", timeout: 30000 });
      } catch (err) {
        runtime.networkFailures.push(`Navigation failed for ${next.url}: ${String(err)}`);
        await desktopContext.close();
        continue;
      }

      runtime.visitedPaths.push(new URL(next.url).pathname || "/");
      runtime.pageMetadata.push({
        path: new URL(next.url).pathname || "/",
        title: await desktopPage.title(),
        status: mainDocumentResponse?.status() ?? 0,
      });

      const desktopShot = await desktopPage.screenshot({ fullPage: true, type: "jpeg", quality: 60 });
      const desktopScreenshot: Screenshot = {
        path: new URL(next.url).pathname || "/",
        depth: next.depth,
        viewport: "desktop",
        dataUrl: `data:image/jpeg;base64,${desktopShot.toString("base64")}`,
      };
      runtime.screenshots.push(desktopScreenshot);
      options.onNavigation?.({
        message: `Visited ${next.url}`,
        screenshot: desktopScreenshot,
      });

      try {
        const signedUp = await attemptSignupFlow(desktopPage);
        if (signedUp) {
          const postSignupShot = await desktopPage.screenshot({ fullPage: true, type: "jpeg", quality: 60 });
          const postSignupScreenshot: Screenshot = {
            path: new URL(desktopPage.url()).pathname || "/",
            depth: next.depth,
            viewport: "desktop",
            dataUrl: `data:image/jpeg;base64,${postSignupShot.toString("base64")}`,
          };
          runtime.screenshots.push(postSignupScreenshot);
          options.onNavigation?.({
            message: `Submitted signup form and continued to ${desktopPage.url()}`,
            screenshot: postSignupScreenshot,
          });

          const postSignupUrl = desktopPage.url();
          if (
            postSignupUrl.startsWith(previewUrl.split("/").slice(0, 3).join("/")) &&
            !visited.has(postSignupUrl) &&
            queue.length < maxPages * 2
          ) {
            queue.push({ url: postSignupUrl, depth: next.depth + 1 });
          }
        }
      } catch (err) {
        runtime.consoleErrors.push(`Signup interaction failed on ${next.url}: ${String(err)}`);
      }

      const mobileContext = await browser.newContext({
        viewport: MOBILE,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
      });
      const mobilePage = await mobileContext.newPage();
      try {
        await mobilePage.goto(next.url, { waitUntil: "domcontentloaded", timeout: 25000 });
        const mobileShot = await mobilePage.screenshot({ fullPage: true, type: "jpeg", quality: 50 });
        runtime.screenshots.push({
          path: new URL(next.url).pathname || "/",
          depth: next.depth,
          viewport: "mobile",
          dataUrl: `data:image/jpeg;base64,${mobileShot.toString("base64")}`,
        });
      } catch {
        runtime.networkFailures.push(`Mobile screenshot failed for ${next.url}`);
      } finally {
        await mobileContext.close();
      }

      try {
        const axe = await new AxeBuilder({ page: desktopPage }).analyze();
        runtime.accessibilityViolations.push(...parseA11yViolations(axe));
      } catch (err) {
        // Keep this out of reliability scoring; axe injection can fail on some pages.
        runtime.networkFailures.push(`Accessibility scan failed on ${next.url}: ${String(err)}`);
      }

      try {
        const perf = await desktopPage.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
          const lcp = lcpEntries[lcpEntries.length - 1]?.startTime ?? 0;
          const tti = nav ? nav.domInteractive : 0;
          const tbt = nav ? Math.max(0, nav.domComplete - nav.domInteractive) : 0;
          return { lcpMs: Math.round(lcp), ttiMs: Math.round(tti), tbtMs: Math.round(tbt) };
        });

        runtime.performanceMetrics = {
          lcpMs: Math.max(runtime.performanceMetrics.lcpMs, perf.lcpMs),
          ttiMs: Math.max(runtime.performanceMetrics.ttiMs, perf.ttiMs),
          tbtMs: Math.max(runtime.performanceMetrics.tbtMs, perf.tbtMs),
          slowRequests: runtime.performanceMetrics.slowRequests,
        };
      } catch (err) {
        runtime.consoleErrors.push(`Performance evaluation failed on ${next.url}: ${String(err)}`);
      }

      try {
        const html = await desktopPage.content();
        const headers = (mainDocumentResponse?.headers() ?? {}) as Record<string, string>;
        runtime.securityFindings.push(...detectSecuritySignals(html, headers));
      } catch (err) {
        runtime.consoleErrors.push(`Security signal extraction failed on ${next.url}: ${String(err)}`);
      }

      if (next.depth < maxDepth) {
        try {
          const links = await desktopPage.$$eval("a[href], button[onclick]", (elements) => {
            const urls: string[] = [];
            for (const el of elements.slice(0, 20)) {
              if (el instanceof HTMLAnchorElement && el.href) {
                urls.push(el.href);
              } else if (el instanceof HTMLButtonElement) {
                const parentAnchor = el.closest("a");
                if (parentAnchor?.href) {
                  urls.push(parentAnchor.href);
                }
              }
            }
            return urls;
          });

          for (const href of links) {
            const abs = toAbsUrl(next.url, href);
            if (!abs || !abs.startsWith(previewUrl.split("/").slice(0, 3).join("/"))) {
              continue;
            }
            if (!visited.has(abs) && queue.length < maxPages * 2) {
              queue.push({ url: abs, depth: next.depth + 1 });
            }
          }
        } catch (err) {
          runtime.consoleErrors.push(`Link discovery failed on ${next.url}: ${String(err)}`);
        }
      }

      await desktopContext.close();
    }
  } finally {
    await browser.close();
  }

  return runtime;
}

export function getPartialFailureArtifacts(message: string): RuntimeArtifacts {
  const perf: PerformanceMetrics = { lcpMs: 0, ttiMs: 0, tbtMs: 0, slowRequests: [] };
  return {
    screenshots: [],
    consoleErrors: [message],
    networkFailures: [],
    accessibilityViolations: [],
    pageMetadata: [],
    performanceMetrics: perf,
    securityFindings: [],
    visitedPaths: [],
  };
}
