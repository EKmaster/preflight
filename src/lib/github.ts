import type { FinalVerdict } from "@/lib/types";

function verdictLabel(status: FinalVerdict["status"]): string {
  if (status === "block") return "❌ BLOCK";
  if (status === "ship_with_fixes") return "⚠️ SHIP WITH FIXES";
  return "✅ SHIP";
}

export function buildGitHubComment(verdict: FinalVerdict): string {
  const fixes = verdict.topFixes.slice(0, 5).map((f) => `- ${f}`).join("\n");
  return [
    "## Preflight Deployment Review",
    "",
    "### Final Verdict",
    verdictLabel(verdict.status),
    "",
    "### Summary",
    verdict.summary,
    "",
    `**Confidence:** ${verdict.confidence}%`,
    "",
    "### Suggested Fixes",
    fixes || "- No fixes suggested.",
  ].join("\n");
}
