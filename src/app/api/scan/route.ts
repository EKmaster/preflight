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

const sseEncoder = new TextEncoder();

function toSSEBytes(event: StreamEvent): Uint8Array {
  return sseEncoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("previewUrl") ?? "";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(toSSEBytes(event));

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

        if (!artifacts.crawlSucceeded) {
          send({
            type: "error",
            message: `Crawl did not succeed — verdict will be BLOCK until a real browser run works. ${(artifacts.crawlFailureSummary ?? "").slice(0, 400)}`,
          });
        }

        const resultPromises = EVALUATORS.map(async (evaluator) => {
          send({ type: "evaluator_started", evaluator });
          const result = await runEvaluator(evaluator, artifacts);
          send({ type: "evaluator_result", result });
          return result;
        });
        const results = await Promise.all(resultPromises);

        const verdict = judge(results, artifacts);
        send({ type: "final_verdict", verdict });

        const comment = buildGitHubComment(verdict);
        send({ type: "navigation_update", message: "GitHub comment draft generated." });
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
      "X-Accel-Buffering": "no",
    },
  });
}
