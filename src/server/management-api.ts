import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CatalogModel } from "../codex/catalog";
import { catalogModelSlug, invalidateCodexModelsCache, nativeContextLimits, nativeModelRows, uniqueCatalogModelsForPublicList } from "../codex/catalog";
import {
  DEFAULT_SUBAGENT_MODELS,
  codexAutoStartEnabled,
  hasOwnProvider,
  isValidProviderName,
  multiAgentGuidanceEnabled,
  providerBaseUrlConfigError,
  providerHeadersConfigError,
  saveConfigPreservingClaudeCode,
} from "../config";
import {
  clearLoginState,
  getLoginStatus,
  isPublicOAuthProvider,
  listOAuthProviders,
  startLoginFlow,
  submitManualLoginCode,
  upsertOAuthProvider,
} from "../oauth";
import { OAuthMutationBusyError, removeCredential } from "../oauth/store";
import { providerDestinationResolvedError } from "../lib/destination-policy";
import { enrichProviderFromCatalog, listKeyLoginProviders } from "../oauth/key-providers";
import { deriveProviderPresets } from "../providers/derive";
import { providerCodexAccountMode } from "../providers/registry";
import { routedSlug, slugEquals } from "../providers/slug-codec";
import { clearProviderQuotaCache, fetchProviderQuotaReports } from "../providers/quota";
import { isCanonicalOpenAiForwardProvider, OPENAI_CODEX_PROVIDER_ID } from "../providers/openai-tiers";
import { clearThreadAccountMap } from "../codex/routing";
import { primeCodexPoolQuotas } from "../codex/auth-api";
import { DEFAULT_PROVIDER_CONTEXT_CAP, globalContextCapValue, providerContextCap, providerContextCaps, setAllProviderContextCaps, setGlobalContextCapValue, setProviderContextCap } from "../providers/context-cap";
import { resolveCodexHomeDir } from "../codex/home";
import { readUsageEntries } from "../usage/log";
import { getUsageDebugLogEntries } from "../usage/debug";
import { parseRange, parseUsageSurface, summarizeUsage } from "../usage/summary";
import { stripCodexRuntimeProviderFields } from "../codex/auth-context";
import { getProviderRegistryEntry } from "../providers/registry";
import { getDebugLogEntries } from "../lib/debug-log-buffer";
import { getInjectionDebugLogEntries } from "../lib/injection-debug-log";
import {
  clearDebugSettings,
  clearDebugSetting,
  getDebugSettings,
  setDebugSettings,
  type DebugFlag,
} from "../lib/debug-settings";
import type { NxcClaudeCodeConfig, NxcClaudeDesktopProfile, NxcConfig, NxcCustomModel, NxcProviderConfig } from "../types";
import type { DesktopProfileModel } from "../claude/desktop-profile";
import { drainAndShutdown } from "./lifecycle";
import { filterRequestLogs, getRequestLogEntries, type RequestLogEntry } from "./request-log";
import { estimateComboCost, estimateRequestCost, normalizeCostTokens, tokensPerSecond } from "../usage/cost";
import type { PersistedUsageAttempt } from "../usage/log";
import { isAllowedManagementOrigin, jsonResponse, providerManagementConfigError, publicProviderBaseUrl, safeConfigDTO } from "./auth-cors";
import { applySystemEnvToggle } from "./system-env";

import type { ManagementApiDeps } from "./management/context";
import { handleConfigRoutes } from "./management/config-routes";
import { handleLogsUsageRoutes } from "./management/logs-usage-routes";
import { handleStorageLogGuardRoutes } from "./management/storage-log-guard-routes";
import { handleRequestHistoryRoutes } from "./management/request-history-routes";
import { handleAgentSettingsRoutes } from "./management/agent-settings-routes";
import { handleSystemRoutes } from "./management/system-routes";
import { handleDesktopRoutes } from "./management/desktop-routes";
import type { ManagementContext } from "./management/context";
import type { ManagementPrincipal } from "./management-auth";
export type { ManagementApiDeps } from "./management/context";
import { fetchAllModels } from "./management/shared";
import { CatalogGatherBusyError } from "../codex/catalog/provider-fetch";
import type { CatalogDisposition, ConvergeCodex } from "../codex/convergence-types";
import { normalizeCatalogDisposition } from "../codex/catalog-refresh-status";
import { managementBodyTooLargeResponse } from "./management/body";

// installed npm version instead of a stale hardcode.
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;
  } catch {
    return "0.0.0";
  }
})();

const managementConvergenceBindings = new WeakMap<object, Readonly<{
  factory: (config: Readonly<NxcConfig>) => ConvergeCodex;
  converge: ConvergeCodex;
}>>();

function pathInManagementNamespace(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Generic-provider and unrelated integration management APIs removed from NexCode Desktop. */
const REMOVED_MANAGEMENT_NAMESPACES = [
  "/api/config",
  "/api/providers",
  "/api/provider-quotas",
  "/api/provider-context-caps",
  "/api/provider-presets",
  "/api/provider-request-pacing",
  "/api/models",
  "/api/catalog",
  "/api/disabled-models",
  "/api/model-visibility",
  "/api/selected-models",
  "/api/custom-models",
  "/api/oauth",
  "/api/key-providers",
  "/api/keys",
  "/api/combos",
  "/api/routing-profiles",
  "/api/routing-analytics",
  "/api/lab",
  "/api/client-config",
  "/api/client-integrations",
  "/api/native-integrations",
  "/api/claude-code",
  "/api/claude-desktop",
  "/api/grok",
  "/api/shadow-call-settings",
  "/api/sidecar-settings",
] as const;

function removedManagementNamespace(pathname: string): boolean {
  return REMOVED_MANAGEMENT_NAMESPACES.some(prefix => pathInManagementNamespace(pathname, prefix));
}

export async function handleManagementAPI(
  req: Request,
  url: URL,
  config: NxcConfig,
  deps: ManagementApiDeps = {},
  principal?: ManagementPrincipal,
): Promise<Response | null> {
  if (!isAllowedManagementOrigin(req, config)) {
    return jsonResponse({ error: "cross-origin request blocked" }, 403, req, config);
  }
  // Management bodies are small JSON (provider names, key ids, settings). Reject oversized
  // payloads before any handler buffers them — the data plane has its own decompression cap.
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024) {
      return jsonResponse({ error: "request body too large" }, 413, req, config);
    }
  }
  if (removedManagementNamespace(url.pathname)) {
    return jsonResponse({ error: "management surface removed" }, 404, req, config);
  }
  async function convergeCodexCatalog(): Promise<CatalogDisposition> {
    let convergenceInvoked = false;
    let managementConvergeCodex: ConvergeCodex | undefined;
    try {
      if (!managementConvergeCodex) {
        const factory = deps.createManagementConvergeCodex
          ?? (await import("../codex/management-convergence")).createManagementConvergeCodex;
        if (typeof factory !== "function") throw new TypeError("Catalog convergence factory is unavailable.");
        let binding = managementConvergenceBindings.get(config);
        if (!binding || binding.factory !== factory) {
          const created = factory(config);
          if (typeof created !== "function") throw new TypeError("Catalog convergence factory returned no function.");
          binding = { factory, converge: created };
          managementConvergenceBindings.set(config, binding);
        }
        managementConvergeCodex = binding.converge;
      }
      const { createCatalogConvergeRequest } = await import("../codex/catalog-admission");
      convergenceInvoked = true;
      const outcome = await managementConvergeCodex(createCatalogConvergeRequest({ deadlineMs: 1_000 }));
      const catalogRefresh = outcome?.kind === "catalog-only"
        ? normalizeCatalogDisposition(outcome.catalogRefresh)
        : null;
      if (!catalogRefresh) {
        throw new TypeError("Catalog convergence returned an invalid outcome.");
      }
      return catalogRefresh;
    } catch (error) {
      // #1784: this used to manufacture `reason: "disk"` for every escaping error, so a
      // programming fault and a full filesystem were indistinguishable and both reported
      // non-retryable. Classify honestly and keep the cause allowlisted.
      const invalidRequest = error instanceof TypeError
        || error instanceof RangeError
        || error instanceof SyntaxError;
      return {
        status: "failed",
        reason: invalidRequest ? "request-invalid" : "internal",
        phase: convergenceInvoked ? "commit" : "gather",
        retryable: false,
        partialWrite: convergenceInvoked,
        cause: { kind: invalidRequest ? "invalid-request" : "unknown" },
      };
    }
  }

  async function syncClaudeAgentDefsBestEffort(): Promise<void> {
    try {
      const { injectClaudeAgentDefs } = await import("../claude/agents-inject");
      if (config.claudeCode?.enabled === false || config.claudeCode?.injectAgents === false) {
        injectClaudeAgentDefs(config, {});
        return;
      }
      try {
        const [models, { buildClaudeContextWindows }, { visibleNativeSlugs }] = await Promise.all([
          fetchAllModels(config),
          import("../claude/context-windows"),
          import("../codex/catalog"),
        ]);
        injectClaudeAgentDefs(config, buildClaudeContextWindows([...visibleNativeSlugs(config)], models, nativeContextLimits(config)));
      } catch {
        // Keep routes available through a provider-discovery blip. A later
        // launch-time sync restores any context markers missing from this pass.
        injectClaudeAgentDefs(config, {});
      }
    } catch { /* best-effort */ }
  }
  const ctx: ManagementContext = { req, url, config, deps, principal, convergeCodexCatalog, syncClaudeAgentDefsBestEffort };
  let routed: Response | null;
  try {
    routed = (await handleConfigRoutes(ctx))
    ??     (await handleStorageLogGuardRoutes(ctx))
    ??     (await handleLogsUsageRoutes(ctx))
    ??     (await handleRequestHistoryRoutes(ctx))
    ??     (await handleDesktopRoutes(ctx))
    ??     (await handleAgentSettingsRoutes(ctx))
    ??     (await handleSystemRoutes(ctx))
    ;
  } catch (error) {
    const tooLarge = managementBodyTooLargeResponse(error, req, config);
    if (tooLarge) return tooLarge;
    if (error instanceof OAuthMutationBusyError) {
      return new Response(JSON.stringify({ error: { type: "server_error", code: "oauth_mutation_busy", message: error.message } }), {
        status: 503,
        headers: { "content-type": "application/json", "Retry-After": "1" },
      });
    }
    if (!(error instanceof CatalogGatherBusyError)) throw error;
    return new Response(JSON.stringify({ error: { type: "server_error", code: "catalog_busy", message: error.message } }), {
      status: 503,
      headers: { "content-type": "application/json", "Retry-After": "1" },
    });
  }
  if (routed) return routed;

  if (url.pathname === "/api/stop" && req.method === "POST") {
    const { restoreNativeCodexAsync } = await import("../codex/inject");
    const { stopServiceIfInstalled, isServiceOwnershipError } = await import("../service");
    try {
      stopServiceIfInstalled();
    } catch (err) {
      if (isServiceOwnershipError(err)) {
        // The installed service belongs to another CODEX_HOME/NEXCODE_HOME: it would respawn
        // this proxy immediately, and its shared config is not ours to tear down. Refuse the
        // stop instead of half-performing it. 409, not 500 — the request is well-formed.
        return jsonResponse({ success: false, message: err.message }, 409, req, config);
      }
      throw err;
    }
    const restore = await restoreNativeCodexAsync();
    // Both managed configs come down together on an explicit teardown. The daemon's own
    // syncCleanup skips this when NXC_SERVICE is set (so a crash/respawn keeps the fence),
    // which is exactly why an intentional stop has to do it here.
    const { stripGrokConfig } = await import("../grok/inject");
    const grok = stripGrokConfig();
    setTimeout(async () => {
      await drainAndShutdown(undefined, config.shutdownTimeoutMs ?? 5000);
      process.exit(0);
    }, 200);
    const grokNote = grok.ok ? "" : ` Grok config cleanup failed: ${grok.message}`;
    return jsonResponse(restore.success
      ? { success: true, message: `Proxy stopping, native Codex restored.${grokNote}` }
      : { success: false, message: `Proxy stopping, but native Codex restore failed: ${restore.message}. Run \`nxc restore\`.${grokNote}` });
  }

  if (url.pathname.startsWith("/api/native-main-profiles")) {
    const { handleNativeProfileAPI } = await import("../codex/native-profile-api");
    return handleNativeProfileAPI(req, url, config, deps.nativeProfileApi);
  }

  if (url.pathname.startsWith("/api/codex-auth/")) {
    const { handleCodexAuthAPI } = await import("../codex/auth-api");
    const { ConfigMutationLockError } = await import("../config");
    const { CodexCredentialRefreshLockTimeoutError } = await import("../codex/account-store");
    try {
      return await handleCodexAuthAPI(req, url, config, convergeCodexCatalog);
    } catch (error) {
      // Credential writers remap ConfigMutationLockError to CodexCredentialRefreshLockTimeoutError;
      // treat both as the same retryable busy response.
      if (error instanceof ConfigMutationLockError || error instanceof CodexCredentialRefreshLockTimeoutError) {
        return jsonResponse(
          { error: "Configuration is busy; retry shortly", code: "CONFIG_MUTATION_LOCK_UNAVAILABLE" },
          503,
          req,
          config,
        );
      }
      throw error;
    }
  }

  return null;
}


export { buildClaudeDesktopState, fetchAllModels } from "./management/shared";
