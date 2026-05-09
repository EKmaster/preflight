import type { Browser } from "playwright-core";

/**
 * Vercel serverless (and AWS Lambda) do not bundle Playwright’s downloaded Chromium.
 * Use Chromium from @sparticuz/chromium with playwright-core instead.
 */
function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL === "1" ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV,
  );
}

export async function launchChromiumBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    const [{ chromium }, sparticuzMod] = await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium"),
    ]);

    const raw = sparticuzMod as unknown as { default?: unknown };
    const Sc = (raw.default ?? raw) as {
      args: string[];
      executablePath: () => Promise<string>;
    };
    const executablePath = await Sc.executablePath();

    return chromium.launch({
      args: [...Sc.args],
      executablePath,
      headless: true,
    });
  }

  try {
    const { chromium } = await import("playwright");
    return chromium.launch({ headless: true });
  } catch {
    const [{ chromium }, sparticuzMod] = await Promise.all([
      import("playwright-core"),
      import("@sparticuz/chromium"),
    ]);

    const raw = sparticuzMod as unknown as { default?: unknown };
    const Sc = (raw.default ?? raw) as {
      args: string[];
      executablePath: () => Promise<string>;
    };
    return chromium.launch({
      args: [...Sc.args],
      executablePath: await Sc.executablePath(),
      headless: true,
    });
  }
}
