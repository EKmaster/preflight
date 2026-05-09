import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

/**
 * Sparticuz only auto-extracts al2/al2023 NSS/glibc helper libs when AWS Lambda env vars exist.
 * VercelFunctions set VERCEL=1 but not AWS_EXECUTION_ENV, so libnss3.so is never unpacked → Chromium dies.
 * We unpack the same tarballs and mirror setupLambdaEnvironment().
 */
export async function prepareSparticuzAmazonLinuxLibs(): Promise<void> {
  const require = createRequire(import.meta.url);
  let pkgDir: string;
  try {
    pkgDir = path.dirname(require.resolve("@sparticuz/chromium/package.json"));
  } catch {
    pkgDir = path.join(process.cwd(), "node_modules", "@sparticuz", "chromium");
  }

  const binDir = path.join(pkgDir, "bin");
  const al2 = path.join(binDir, "al2.tar.br");
  const al2023 = path.join(binDir, "al2023.tar.br");

  const [{ default: lambdafs }, { setupLambdaEnvironment }] = await Promise.all([
    import("@sparticuz/chromium/build/lambdafs.js"),
    import("@sparticuz/chromium/build/helper.js"),
  ]);

  if (fs.existsSync(al2)) {
    await lambdafs.inflate(al2);
    setupLambdaEnvironment("/tmp/al2/lib");
  }
  if (fs.existsSync(al2023)) {
    await lambdafs.inflate(al2023);
    setupLambdaEnvironment("/tmp/al2023/lib");
  }
}
