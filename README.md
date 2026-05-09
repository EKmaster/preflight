# Preflight POC

**Preflight** is a **proof-of-concept** for **AI-assisted deployment review**: it loads a live **HTTPS preview URL** in a headless browser, collects runtime signals (navigation, console, network, screenshots, axe accessibility, lightweight security headers / patterns), runs **parallel evaluators**, aggregates a **judge verdict**, and streams progress to the UI via **Server-Sent Events (SSE)**.

Positioning (one line):

> Static tools analyze *source before deploy*; Preflight analyzes the **deployed preview before merge**.

This repo is intentionally **POC-grade**: no auth, no database, no billing, no multi-tenant history.

---

## What you get

- **Live feed** of crawl + evaluator events  
- **Screenshot stream** (viewport-sized on Vercel to keep SSE payloads small)  
- **Scorecards** for reliability, security, performance, accessibility, and UX  
- **Final verdict**: `ship`, `ship_with_fixes`, or `block` (with explicit handling when the crawl never ran)  
- **GitHub-style PR comment** draft (markdown)

---

## Architecture (high level)

```text
Browser (Next.js UI)
    → GET /api/scan?previewUrl=…  (SSE)
        → Playwright crawl (Chromium)
        → Runtime artifacts
        → Parallel evaluators (+ optional OpenAI refinement)
        → Judge aggregation
        → stream events until final_verdict + done
```

- **Local dev:** full `playwright` (Chromium installed via `npx playwright install chromium`).  
- **Vercel:** `playwright-core` + `@sparticuz/chromium`, with **Amazon Linux compatibility libs** unpacked and `LD_LIBRARY_PATH` configured (Vercel does not set Lambda-only env vars Sparticuz relies on by default).  
- **Optional:** `PREFLIGHT_BROWSER_WS_ENDPOINT` to connect to a **remote** Playwright-compatible browser (Browserless, etc.) instead of launching Chromium in the function.

---

## Tech stack

| Area | Choice |
|------|--------|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Automation | Playwright / `playwright-core`, `@axe-core/playwright`, `axe-core` |
| Serverless Chromium | `@sparticuz/chromium` |
| Validation | `zod` |
| Optional AI | OpenAI SDK (`OPENAI_API_KEY`) |

---

## Prerequisites

- **Node.js** (LTS recommended)
- **npm**

For **local** runs, install a Playwright browser once:

```bash
npx playwright install chromium
```

---

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste a **public `https://…` preview URL** (not `localhost`), and run **Run Preflight**.

### Production build (smoke test)

```bash
npm run build
npm start
```

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | No | If set, evaluators can refine scores/findings via the OpenAI API. Without it, heuristic evaluators still run. |
| `PREFLIGHT_MODEL` | No | OpenAI model id (defaults to `gpt-4.1-mini` in code if unset). |
| `PREFLIGHT_BROWSER_WS_ENDPOINT` | No | WebSocket URL for `playwright-core` `chromium.connect(…)` — use when in-function Chromium is not viable. |

**Local:** use `.env.local` (see Next.js docs). **Vercel:** Project → Settings → Environment Variables (Production / Preview as needed).

---

## Deploying on Vercel

1. Connect the repo and deploy (default Next.js settings are fine).  
2. Ensure **`@sparticuz/chromium`** and **`playwright-core`** stay in **dependencies** (not only devDependencies).  
3. **`playwright`** is a **devDependency** for local Chromium; production uses Sparticuz + `playwright-core`.  
4. The API route sets a **max duration** for the scan; align with your plan’s function timeout in the Vercel dashboard.  
5. If Chromium is still unstable: try **disabling Fluid Compute** for the project as a troubleshooting step, or set **`PREFLIGHT_BROWSER_WS_ENDPOINT`** to a hosted browser.

---

## API

### `GET /api/scan?previewUrl=<url>`

- **Response:** `text/event-stream` (SSE)  
- **Events:** `navigation_update`, `evaluator_started`, `evaluator_result`, `final_verdict`, `error`, `done`  
- Validates `previewUrl`: must be `https://`, not `localhost` / loopback  

---

## Project layout (principal paths)

```text
src/app/page.tsx           # POC dashboard UI + EventSource client
src/app/api/scan/route.ts  # SSE orchestration
src/lib/runtime/browser.ts # Chromium launch (local vs Vercel vs remote WS)
src/lib/runtime/sparticuz-libs.ts  # Vercel: unpack AL2/AL2023 libs for Sparticuz
src/lib/runtime/crawler.ts # Playwright crawl + artifacts
src/lib/evaluators/        # UX, reliability, a11y, security, performance
src/lib/judge.ts           # Verdict aggregation
src/lib/github.ts          # PR comment markdown
```

---

## Limitations (POC scope)

- **No** persisted runs, accounts, teams, or billing  
- **Not** a full security scanner — security signals are **heuristic** (headers, regex on HTML, etc.)  
- **No** guaranteed parity with Lighthouse or full WCAG audits  
- **Crawl breadth** capped (depth / max pages); behavior differs slightly on Vercel (navigation waits, screenshot size)  

---

## License

Private project unless you add a license file.
