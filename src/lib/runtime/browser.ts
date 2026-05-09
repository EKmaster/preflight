import type { Browser } from "playwright-core";

/**
 * Vercel serverless (and AWS Lambda) do not bundle Playwright’s downloaded Chromium.
 * Use Chromium from @sparticuz/chromium with playwright-core instead.
 */
/** True on Vercel / Lambda-style runtimes where Playwright-managed browsers are unavailable. */
export function isPreflightServerless(): boolean {
  return Boolean(
    process.env.VERCEL === "1" ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV,
  );
}

export async function launchChromiumBrowser(): Promise<Browser> {
  const launchServerless = async () => {
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

    const extraArgs = ["--disable-gpu"];

    return chromium.launch({
      args: [...Sc.args, ...extraArgs],
      executablePath,
      headless: true,
      timeout: 120_000,
    });
  };

  if (isPreflightServerless()) {
    try {
      return await launchServerless();
    } catch (first) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await launchServerless();
      } catch {
        throw first;
      }
    }
  }

  try {
    const { chromium } = await import("playwright");
    return chromium.launch({ headless: true, timeout: 120_000 });
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
      args: [...Sc.args, "--disable-gpu"],
      executablePath: await Sc.executablePath(),
      headless: true,
      timeout: 120_000,
    });
  }
}
