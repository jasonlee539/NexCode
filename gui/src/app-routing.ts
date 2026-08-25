/** Native product hash routing. Generic provider/model workspaces are intentionally absent. */
import { normalizeHashPath } from "./hash-routing";

export type Page =
  | "dashboard"
  | "codex-auth"
  | "threads"
  | "usage"
  | "skills"
  | "maintenance"
  | "settings";

export const VALID_PAGES = new Set<Page>([
  "dashboard",
  "codex-auth",
  "threads",
  "usage",
  "skills",
  "maintenance",
  "settings",
]);

const LEGACY_DESTINATIONS: Record<string, Page> = {
  providers: "codex-auth",
  models: "dashboard",
  logs: "threads",
  debug: "maintenance",
  storage: "maintenance",
  startup: "settings",
  integrations: "settings",
  api: "settings",
  claude: "settings",
  grok: "settings",
  subagents: "threads",
  combos: "dashboard",
  routing: "dashboard",
  lab: "dashboard",
};

export function readPageFromHash(hash?: string): Page {
  const raw = normalizeHashPath(
    hash ?? (typeof window !== "undefined" ? window.location.hash : ""),
  );
  const id = raw.split("/")[0] ?? "";
  if (VALID_PAGES.has(id as Page)) return id as Page;
  return LEGACY_DESTINATIONS[id] ?? "dashboard";
}

export function hashBelongsToPage(rawHash: string, page: Page): boolean {
  return rawHash === page;
}

export type AppHashChangeAction = {
  page: Page;
  replaceTo: string | null;
};

export function resolveAppHashChange(rawHash: string): AppHashChangeAction {
  const page = readPageFromHash(rawHash);
  return {
    page,
    replaceTo: rawHash === page ? null : page,
  };
}

// Empty compatibility exports for source modules that are no longer mounted.
export const DASHBOARD_TAB_HASHES = [] as const;
export const MODELS_TAB_HASHES = [] as const;
export const INTEGRATION_TAB_HASHES = [] as const;
export const DASHBOARD_UPDATE_HASH = "dashboard";
