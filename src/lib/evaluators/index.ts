import OpenAI from "openai";
import type { EvaluatorResult, RuntimeArtifacts } from "@/lib/types";

type EvaluatorModel = {
  evaluate(input: { evaluator: EvaluatorResult["evaluator"]; artifacts: RuntimeArtifacts }): Promise<{
    findings?: string[];
    scoreAdjust?: number;
    recommendation?: EvaluatorResult["recommendation"];
  }>;
};

class OpenAIEvaluatorModel implements EvaluatorModel {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async evaluate(input: {
    evaluator: EvaluatorResult["evaluator"];
    artifacts: RuntimeArtifacts;
  }): Promise<{ findings?: string[]; scoreAdjust?: number; recommendation?: EvaluatorResult["recommendation"] }> {
    const prompt = [
      "You are evaluating a preview deployment.",
      `Focus ONLY on ${input.evaluator}.`,
      "Return strict JSON with keys: findings (string[] up to 3), scoreAdjust (-2..2), recommendation (ship|fix|block).",
      "Do not speculate. Use only provided runtime artifacts.",
      `Artifacts: ${JSON.stringify(
        {
          consoleErrors: input.artifacts.consoleErrors.slice(0, 8),
          networkFailures: input.artifacts.networkFailures.slice(0, 8),
          accessibilityViolations: input.artifacts.accessibilityViolations.slice(0, 8),
          performance: input.artifacts.performanceMetrics,
          securityFindings: input.artifacts.securityFindings.slice(0, 8),
          pageMetadata: input.artifacts.pageMetadata.slice(0, 8),
          crawlSucceeded: input.artifacts.crawlSucceeded,
        },
        null,
        2,
      )}`,
    ].join("\n");

    const response = await this.client.responses.create({
      model: this.model,
      input: prompt,
      temperature: 0.1,
    });

    const text = response.output_text.trim();
    try {
      const parsed = JSON.parse(text) as {
        findings?: string[];
        scoreAdjust?: number;
        recommendation?: EvaluatorResult["recommendation"];
      };
      return parsed;
    } catch {
      return {};
    }
  }
}

function normalizeScore(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score)));
}

function summarizeText(values: string[], fallback: string): string[] {
  if (values.length === 0) return [fallback];
  return values.slice(0, 3);
}

function resultWhenCrawlSkipped(
  evaluator: EvaluatorResult["evaluator"],
  artifacts: RuntimeArtifacts,
): EvaluatorResult {
  const hint = artifacts.crawlFailureSummary ?? "Runtime crawl did not complete.";
  switch (evaluator) {
    case "reliability":
      return {
        evaluator,
        score: 1,
        recommendation: "block",
        findings: [hint.slice(0, 420), "No live preview was exercised — do not treat results as a deployment review."],
      };
    case "performance":
      return {
        evaluator,
        score: 1,
        recommendation: "block",
        findings: ["No performance metrics captured (crawl/browser did not run).", hint.slice(0, 200)],
      };
    case "ux":
      return {
        evaluator,
        score: 1,
        recommendation: "block",
        findings: ["No UI was sampled — verdict must not be inferred from empty data.", hint.slice(0, 200)],
      };
    case "accessibility":
      return {
        evaluator,
        score: 1,
        recommendation: "block",
        findings: ["Accessibility checks did not run on a loaded page.", hint.slice(0, 200)],
      };
    case "security":
      return {
        evaluator,
        score: 1,
        recommendation: "block",
        findings: ["Security signals were not collected from a live render (crawl unavailable).", hint.slice(0, 200)],
      };
  }
}

export async function runEvaluator(
  evaluator: EvaluatorResult["evaluator"],
  artifacts: RuntimeArtifacts,
): Promise<EvaluatorResult> {
  if (!artifacts.crawlSucceeded) {
    return resultWhenCrawlSkipped(evaluator, artifacts);
  }

  let base: EvaluatorResult;
  const consoleCount = artifacts.consoleErrors.length;
  const netFailCount = artifacts.networkFailures.length;
  const a11yHigh = artifacts.accessibilityViolations.filter((v) => v.severity === "high").length;
  const a11yTotal = artifacts.accessibilityViolations.length;
  const securityHigh = artifacts.securityFindings.filter((f) => f.severity === "high" || f.severity === "critical").length;
  const { lcpMs, ttiMs, tbtMs } = artifacts.performanceMetrics;

  switch (evaluator) {
    case "reliability": {
      const combined = [...artifacts.consoleErrors, ...artifacts.networkFailures];
      const catastrophic = combined.some((msg) =>
        /Browser launch failed|libnss3\.so|shared libraries|executable doesn't exist|browser has been closed/i.test(msg),
      );
      if (catastrophic) {
        base = {
          evaluator,
          score: 1,
          recommendation: "block",
          findings: summarizeText(combined, "Critical browser or runtime infrastructure failure."),
        };
        break;
      }
      const score = 10 - consoleCount * 2 - netFailCount * 2;
      const rec: EvaluatorResult["recommendation"] = score <= 4 ? "block" : score <= 7 ? "fix" : "ship";
      base = {
        evaluator,
        score: normalizeScore(score),
        findings: summarizeText(
          [...artifacts.consoleErrors, ...artifacts.networkFailures].slice(0, 3),
          "No major runtime reliability failures detected.",
        ),
        recommendation: rec,
      };
      break;
    }
    case "accessibility": {
      const score = 10 - a11yHigh * 2 - Math.floor(a11yTotal / 4);
      const rec: EvaluatorResult["recommendation"] = a11yHigh >= 3 ? "block" : score <= 7 ? "fix" : "ship";
      base = {
        evaluator,
        score: normalizeScore(score),
        findings: summarizeText(
          artifacts.accessibilityViolations.map((v) => `${v.description} (${v.selector})`),
          "No major accessibility blockers detected.",
        ),
        recommendation: rec,
      };
      break;
    }
    case "security": {
      const score = 10 - securityHigh * 3 - (artifacts.securityFindings.length - securityHigh);
      const rec: EvaluatorResult["recommendation"] = securityHigh > 0 ? "block" : score <= 7 ? "fix" : "ship";
      base = {
        evaluator,
        score: normalizeScore(score),
        findings: summarizeText(
          artifacts.securityFindings.map((f) => `${f.description} ${f.evidence}`),
          "No obvious runtime security leakage signals detected.",
        ),
        recommendation: rec,
      };
      break;
    }
    case "performance": {
      if (artifacts.pageMetadata.length === 0 && lcpMs === 0 && ttiMs === 0) {
        base = {
          evaluator,
          score: 2,
          recommendation: "fix",
          findings: [
            "No navigation timings — performance was not measured on loaded pages.",
            "If reliability shows browser errors, fix the crawler environment before trusting timings.",
          ],
        };
        break;
      }
      const lcpPenalty = lcpMs > 4000 ? 3 : lcpMs > 2500 ? 2 : lcpMs > 1500 ? 1 : 0;
      const ttiPenalty = ttiMs > 6000 ? 3 : ttiMs > 3500 ? 2 : ttiMs > 2000 ? 1 : 0;
      const tbtPenalty = tbtMs > 1200 ? 2 : tbtMs > 500 ? 1 : 0;
      const score = 10 - lcpPenalty - ttiPenalty - tbtPenalty - Math.min(2, artifacts.performanceMetrics.slowRequests.length);
      const rec: EvaluatorResult["recommendation"] = score <= 4 ? "block" : score <= 7 ? "fix" : "ship";
      base = {
        evaluator,
        score: normalizeScore(score),
        findings: summarizeText(
          [
            `LCP ${lcpMs}ms`,
            `TTI ${ttiMs}ms`,
            `TBT ${tbtMs}ms`,
            ...artifacts.performanceMetrics.slowRequests,
          ],
          "Performance metrics are within acceptable POC bounds.",
        ),
        recommendation: rec,
      };
      break;
    }
    case "ux":
    default: {
      const missingTitlePages = artifacts.pageMetadata.filter((p) => !p.title || p.title.length < 4).length;
      const brokenPages = artifacts.pageMetadata.filter((p) => p.status >= 400 || p.status === 0).length;
      const score = 10 - missingTitlePages - brokenPages * 2 - Math.floor(consoleCount / 2);
      const rec: EvaluatorResult["recommendation"] = brokenPages > 0 ? "fix" : score <= 6 ? "fix" : "ship";
      base = {
        evaluator: "ux",
        score: normalizeScore(score),
        findings: summarizeText(
          [
            brokenPages > 0 ? `${brokenPages} navigations returned non-success status.` : "Navigation paths were reachable.",
            missingTitlePages > 0 ? `${missingTitlePages} pages have weak or missing titles.` : "Page metadata appears consistent.",
            artifacts.screenshots.length < 2 ? "Limited visual evidence was captured." : "Desktop and mobile screenshots collected.",
          ],
          "UX appears coherent on sampled routes.",
        ),
        recommendation: rec,
      };
      break;
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !artifacts.crawlSucceeded) return base;

  try {
    const model = process.env.PREFLIGHT_MODEL ?? "gpt-4.1-mini";
    const ai = new OpenAIEvaluatorModel(apiKey, model);
    const aiResult = await ai.evaluate({ evaluator, artifacts });
    return {
      ...base,
      score: normalizeScore(base.score + (aiResult.scoreAdjust ?? 0)),
      findings: aiResult.findings?.length ? aiResult.findings.slice(0, 3) : base.findings,
      recommendation: aiResult.recommendation ?? base.recommendation,
    };
  } catch {
    return base;
  }
}
