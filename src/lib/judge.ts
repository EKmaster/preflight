import type { EvaluatorResult, FinalVerdict } from "@/lib/types";

function scoreToConfidence(score: number): number {
  return Math.max(55, Math.min(98, Math.round(55 + score * 4.3)));
}

export function judge(results: EvaluatorResult[]): FinalVerdict {
  const byName = new Map(results.map((r) => [r.evaluator, r]));
  const reliability = byName.get("reliability");
  const security = byName.get("security");
  const accessibility = byName.get("accessibility");
  const ux = byName.get("ux");

  const blockedBySecurity = security?.recommendation === "block";
  const blockedByReliability = reliability ? reliability.score <= 4 || reliability.findings.length >= 3 : false;
  const shouldFixByExperience = (accessibility?.score ?? 10) <= 6 && (ux?.score ?? 10) <= 6;

  let status: FinalVerdict["status"] = "ship";
  if (blockedBySecurity || blockedByReliability) {
    status = "block";
  } else if (shouldFixByExperience || results.some((r) => r.recommendation === "fix")) {
    status = "ship_with_fixes";
  }

  const avg = results.reduce((sum, r) => sum + r.score, 0) / Math.max(1, results.length);
  const topFixes = results
    .flatMap((r) => r.findings.map((f) => `[${r.evaluator}] ${f}`))
    .slice(0, 5);

  const summary =
    status === "block"
      ? "Critical runtime risks detected. Merge should be blocked until issues are fixed."
      : status === "ship_with_fixes"
        ? "Deployment is close, but user-facing issues should be resolved before merge."
        : "Deployment appears stable and ready to ship based on sampled runtime behavior.";

  return {
    status,
    confidence: scoreToConfidence(avg),
    summary,
    topFixes,
  };
}
