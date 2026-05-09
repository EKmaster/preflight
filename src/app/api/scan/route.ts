import { NextRequest } from "next/server";
import { runEvaluator } from "@/lib/evaluators";
import { buildGitHubComment } from "@/lib/github";
import { judge } from "@/lib/judge";
import { getPartialFailureArtifacts, runRuntimeCrawl } from "@/lib/runtime/crawler";
import type { EvaluatorResult, StreamEvent } from "@/lib/types";
import { validatePreviewUrl } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Needed for Playwright crawl on slow previews (Vercel Pro+ can extend further). */
export const maxDuration = 60;

const EVALUATORS: EvaluatorResult["evaluator"][] = [
  "ux",
  "reliability",
  "accessibility",
  "security",
  "performance",
];

function toSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("previewUrl") ?? "";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(toSSE(event));

      try {
        const previewUrl = validatePreviewUrl(rawUrl);
        send({ type: "navigation_update", message: `Starting runtime crawl for ${previewUrl}` });

        let artifacts;
        try {
          artifacts = await runRuntimeCrawl(previewUrl, {
            onNavigation: ({ message, screenshot }) => {
              send({ type: "navigation_update", message, screenshot });
            },
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          artifacts = getPartialFailureArtifacts(reason);
          send({
            type: "error",
            message: `Unable to fully evaluate deployment. Partial results available. Reason: ${reason}`,
          });
        }

        const resultPromises = EVALUATORS.map(async (evaluator) => {
          send({ type: "evaluator_started", evaluator });
          const result = await runEvaluator(evaluator, artifacts);
          send({ type: "evaluator_result", result });
          return result;
        });
        const results = await Promise.all(resultPromises);

        const verdict = judge(results);
        send({ type: "final_verdict", verdict });

        const comment = buildGitHubComment(verdict);
        send({
          type: "navigation_update",
          message: "GitHub comment draft generated.",
          screenshot: artifacts.screenshots[0],
        });
        send({ type: "navigation_update", message: comment });

        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unexpected scan failure.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
