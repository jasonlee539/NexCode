export interface DesktopThreadSummary {
  id: string;
  title: string;
  preview: string;
  projectName: string;
  cwd: string;
  createdAt: number | null;
  updatedAt: number | null;
  archivedAt: number | null;
  archived: boolean;
  pinned: boolean;
  tokensUsed: number;
  model: string;
  reasoningEffort: string;
  source: string;
  agentNickname: string;
  agentRole: string;
}

export interface DesktopSkillSummary {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  updatedAt: number;
  readOnly: boolean;
  scope: "user" | "project" | "legacy" | "admin" | "system";
  locationId: string;
}

export interface DesktopSkillLocation {
  id: string;
  label: string;
  scope: "user" | "project" | "legacy";
}

export interface DesktopOverviewResponse {
  activityVersion?: 2;
  activityScope?: "all-local-threads";
  counts: {
    threads: number;
    activeThreads: number;
    archivedThreads: number;
    skills: number;
  };
  localTokenUsage30d: {
    totalTokens: number;
    threadCount: number;
    since: number;
  };
  activity365d?: Array<{
    date: string;
    threadCount: number;
    totalTokens: number;
  }>;
  activity30d?: Array<{
    date: string;
    threadCount: number;
    totalTokens: number;
  }>;
  recentThreads: DesktopThreadSummary[];
  recentSkills: DesktopSkillSummary[];
}

export interface DesktopDiagnosticsResponse {
  ok: boolean;
  generatedAt: number;
  checks: {
    runtime: boolean;
    codexHome: boolean;
    configFile: boolean;
    authentication: boolean;
    stateDatabase: boolean;
    processEnumeration: boolean;
    skillsDirectory: boolean;
  };
  runtime: {
    platform: string;
    bunVersion: string;
    uptimeSeconds: number;
  };
  counts: {
    threads: number;
    activeThreads: number;
    archivedThreads: number;
    skills: number;
    codexProcesses: number | null;
    storageBytes: number;
    storageFiles: number;
  };
}

export type DesktopUsageRange = "1d" | "3d" | "7d" | "30d";

export interface DesktopUsageTotals {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  turns: number;
  threadCount: number;
}

export interface DesktopUsageDay extends DesktopUsageTotals {
  date: string;
}

export interface DesktopUsageThread {
  id: string;
  title: string;
  projectName: string;
  model: string;
  totalTokens: number;
  turns: number;
}

export interface DesktopUsageResponse {
  generatedAt: number;
  source: "codex-local-rollouts";
  ranges: Record<DesktopUsageRange, DesktopUsageTotals>;
  days: DesktopUsageDay[];
  topThreads: Record<DesktopUsageRange, DesktopUsageThread[]>;
  coverage: {
    threadRecords: number;
    scannedThreads: number;
    fallbackThreads: number;
    skippedThreads: number;
  };
}
