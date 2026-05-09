export type Severity = "low" | "medium" | "high" | "critical";

export type ScanRequest = {
  previewUrl: string;
};

export type AccessibilityFinding = {
  severity: "low" | "medium" | "high";
  description: string;
  selector: string;
};

export type Screenshot = {
  path: string;
  depth: number;
  viewport: "desktop" | "mobile";
  dataUrl: string;
};

export type PageMetadata = {
  path: string;
  title: string;
  status: number;
};

export type PerformanceMetrics = {
  lcpMs: number;
  ttiMs: number;
  tbtMs: number;
  slowRequests: string[];
};

export type SecurityFinding = {
  severity: Severity;
  description: string;
  evidence: string;
};

export type RuntimeArtifacts = {
  screenshots: Screenshot[];
  consoleErrors: string[];
  networkFailures: string[];
  accessibilityViolations: AccessibilityFinding[];
  pageMetadata: PageMetadata[];
  performanceMetrics: PerformanceMetrics;
  securityFindings: SecurityFinding[];
  visitedPaths: string[];
};

export type Recommendation = "ship" | "fix" | "block";

export type EvaluatorResult = {
  evaluator: "ux" | "reliability" | "accessibility" | "security" | "performance";
  score: number;
  findings: string[];
  recommendation: Recommendation;
};

export type FinalVerdict = {
  status: "ship" | "ship_with_fixes" | "block";
  confidence: number;
  summary: string;
  topFixes: string[];
};

export type StreamEvent =
  | { type: "navigation_update"; message: string; screenshot?: Screenshot }
  | { type: "evaluator_started"; evaluator: EvaluatorResult["evaluator"] }
  | { type: "evaluator_result"; result: EvaluatorResult }
  | { type: "final_verdict"; verdict: FinalVerdict }
  | { type: "error"; message: string }
  | { type: "done" };
