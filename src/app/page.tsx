"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { EvaluatorResult, FinalVerdict, Screenshot, StreamEvent } from "@/lib/types";
import { buildGitHubComment } from "@/lib/github";

type FeedItem = {
  id: string;
  message: string;
};

const EVALUATOR_ORDER: EvaluatorResult["evaluator"][] = [
  "reliability",
  "security",
  "performance",
  "accessibility",
  "ux",
];

function verdictClass(status: FinalVerdict["status"]): string {
  if (status === "block") return "bg-red-500/20 text-red-200 border-red-400/40";
  if (status === "ship_with_fixes") return "bg-amber-500/20 text-amber-200 border-amber-400/40";
  return "bg-emerald-500/20 text-emerald-200 border-emerald-400/40";
}

function recommendationClass(recommendation: EvaluatorResult["recommendation"]): string {
  if (recommendation === "block") return "bg-red-500/20 text-red-200 border-red-400/40";
  if (recommendation === "fix") return "bg-amber-500/20 text-amber-200 border-amber-400/40";
  return "bg-emerald-500/20 text-emerald-200 border-emerald-400/40";
}

function formatEvaluatorName(name: EvaluatorResult["evaluator"]): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

export default function Home() {
  const [previewUrl, setPreviewUrl] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [results, setResults] = useState<Record<string, EvaluatorResult>>({});
  const [verdict, setVerdict] = useState<FinalVerdict | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const githubComment = useMemo(() => {
    if (!verdict) return "";
    return buildGitHubComment(verdict);
  }, [verdict]);

  const orderedResults = useMemo(
    () =>
      EVALUATOR_ORDER.map((name) => results[name]).filter(
        (result): result is EvaluatorResult => Boolean(result),
      ),
    [results],
  );

  const pushFeed = (message: string) => {
    setFeed((prev) => [
      ...prev.slice(-35),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message },
    ]);
  };

  const startScan = () => {
    setRunning(true);
    setError(null);
    setFeed([]);
    setResults({});
    setVerdict(null);
    setScreenshot(null);

    const source = new EventSource(`/api/scan?previewUrl=${encodeURIComponent(previewUrl)}`);
    source.onmessage = (evt) => {
      let data: StreamEvent;
      try {
        data = JSON.parse(evt.data) as StreamEvent;
      } catch {
        pushFeed("SSE parse error — payload may be truncated (try re-run).");
        return;
      }
      if (data.type === "navigation_update") {
        pushFeed(data.message);
        if (data.screenshot) setScreenshot(data.screenshot);
      } else if (data.type === "evaluator_started") {
        pushFeed(`[${data.evaluator}] evaluator started`);
      } else if (data.type === "evaluator_result") {
        setResults((prev) => ({ ...prev, [data.result.evaluator]: data.result }));
        pushFeed(
          `[${data.result.evaluator}] score ${data.result.score}/10 - ${data.result.recommendation.toUpperCase()}`,
        );
      } else if (data.type === "final_verdict") {
        setVerdict(data.verdict);
        pushFeed(`Final verdict: ${data.verdict.status.toUpperCase()}`);
      } else if (data.type === "error") {
        setError(data.message);
        pushFeed(`Error: ${data.message}`);
      } else if (data.type === "done") {
        source.close();
        setRunning(false);
      }
    };

    source.onerror = () => {
      source.close();
      setRunning(false);
      setError("Stream disconnected. You may retry the scan.");
    };
  };

  return (
    <div className="min-h-screen bg-[#05070f] text-zinc-100">
      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 py-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] text-indigo-300">Preflight MVP</p>
          <h1 className="text-3xl font-semibold">AI-Powered Deployment Review</h1>
          <p className="text-sm text-zinc-400">
            Runtime deployment intelligence for Vercel previews. Paste a preview URL to start.
          </p>
        </header>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              value={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.value)}
              placeholder="https://your-preview.vercel.app"
              className="h-11 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-4 text-sm outline-none ring-indigo-400 focus:ring-2"
            />
            <button
              type="button"
              onClick={startScan}
              disabled={running || !previewUrl}
              className="h-11 rounded-md bg-indigo-500 px-6 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Evaluating..." : "Run Preflight"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        </section>

        {verdict ? (
          <section className={`rounded-xl border px-4 py-3 ${verdictClass(verdict.status)}`}>
            <p className="text-xs uppercase tracking-[0.2em]">Final Verdict</p>
            <p className="mt-1 text-2xl font-semibold">{verdict.status.replaceAll("_", " ").toUpperCase()}</p>
            <p className="mt-1 text-sm opacity-90">{verdict.summary}</p>
            <p className="mt-1 text-xs">Confidence: {verdict.confidence}%</p>
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[320px_1fr_360px]">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">Live Feed</h2>
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1 text-sm text-zinc-300">
              {feed.length === 0 ? (
                <p className="text-zinc-500">Waiting for evaluation events...</p>
              ) : (
                feed.map((item) => (
                  <p
                    key={item.id}
                    className="rounded-md border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs leading-relaxed break-words"
                  >
                    {item.message}
                  </p>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-zinc-300">Screenshot Stream</h2>
            {screenshot ? (
              <div className="space-y-2">
                <Image
                  src={screenshot.dataUrl}
                  alt="Runtime preview screenshot"
                  width={1200}
                  height={700}
                  unoptimized
                  className="w-full rounded-md border border-zinc-700"
                />
                <p className="text-xs text-zinc-400">
                  {screenshot.viewport.toUpperCase()} - {screenshot.path} (depth {screenshot.depth})
                </p>
              </div>
            ) : (
              <div className="flex h-[460px] items-center justify-center rounded-md border border-dashed border-zinc-700 text-sm text-zinc-500">
                Screenshots will appear during navigation.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h2 className="mb-3 text-sm font-semibold text-zinc-300">Evaluator Scorecards</h2>
              <div className="space-y-3">
                {orderedResults.length === 0 ? (
                  <p className="text-sm text-zinc-500">No evaluator results yet.</p>
                ) : (
                  orderedResults.map((result) => (
                    <article key={result.evaluator} className="rounded-lg border border-zinc-700 bg-zinc-900/70 p-3.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold tracking-wide text-zinc-200">
                          {formatEvaluatorName(result.evaluator)}
                        </p>
                        <p className="text-sm font-semibold text-zinc-100">{result.score}/10</p>
                      </div>
                      <div
                        className={`mb-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${recommendationClass(result.recommendation)}`}
                      >
                        {result.recommendation}
                      </div>
                      <ul className="mt-1 space-y-1.5 text-xs text-zinc-300">
                        {result.findings.slice(0, 2).map((f) => (
                          <li key={f} className="rounded border border-zinc-800 bg-zinc-950/70 px-2 py-1 leading-relaxed break-words">
                            {truncate(f)}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-300">GitHub PR Comment Draft</h2>
              <textarea
                value={githubComment}
                readOnly
                className="h-52 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs leading-relaxed text-zinc-300"
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
