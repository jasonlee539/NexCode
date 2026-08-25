import { useKeyedClientResource } from "../client-resource";
import { buildQuotaRows } from "../components/QuotaBars";
import type { DesktopOverviewResponse } from "../desktop-types";
import { formatCompactTokens } from "../format-tokens";
import { navigateHash } from "../hash-routing";
import { useCodexAccountPool } from "../hooks/useCodexAccountPool";
import { IconActivity, IconHardDrive, IconKey, IconMessageSquare, IconSparkles } from "../icons";
import { useI18n } from "../i18n/shared";

async function fetchDesktopOverview(apiBase: string, signal: AbortSignal): Promise<DesktopOverviewResponse> {
  const response = await fetch(`${apiBase}/api/desktop/overview`, { signal });
  if (!response.ok) throw new Error("desktop overview unavailable");
  return response.json() as Promise<DesktopOverviewResponse>;
}

export default function DesktopDashboard({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const overview = useKeyedClientResource(
    `desktop-overview:${apiBase}`,
    [apiBase],
    signal => fetchDesktopOverview(apiBase, signal),
    { pollMs: 15_000 },
  );
  const accountPool = useCodexAccountPool(apiBase);
  const accounts = accountPool.accounts;
  const counts = overview.data?.counts;
  const localTokens30d = overview.data?.localTokenUsage30d.totalTokens ?? 0;
  const activeAccount = accounts.find(account => (
    account.isMain
      ? !accountPool.activeId || accountPool.activeId === "__main__"
      : accountPool.activeId === account.id
  )) ?? accounts[0] ?? null;
  const activeQuotaRows = activeAccount
    ? buildQuotaRows(activeAccount.quota, activeAccount.plan, t).slice(0, 2)
    : [];

  const summary = [
    {
      id: "codex-auth",
      tone: "blue",
      Icon: IconKey,
      label: t("nav.codexAuth"),
      value: accountPool.initialLoading ? "—" : String(accounts.length),
      detail: t("dashboard.accountCountHint"),
    },
    {
      id: "threads",
      tone: "orange",
      Icon: IconMessageSquare,
      label: t("nav.threads"),
      value: overview.loading && !overview.data ? "—" : String(counts?.threads ?? 0),
      detail: t("dashboard.activeThreads", { count: String(counts?.activeThreads ?? 0) }),
    },
    {
      id: "skills",
      tone: "green",
      Icon: IconSparkles,
      label: t("nav.skills"),
      value: overview.loading && !overview.data ? "—" : String(counts?.skills ?? 0),
      detail: t("dashboard.skillsHint"),
    },
    {
      id: "codex-auth",
      tone: "purple",
      Icon: IconActivity,
      label: t("dashboard.tokens30d"),
      value: overview.loading && !overview.data ? "—" : formatCompactTokens(localTokens30d),
      detail: t("dashboard.accountUsageOnly"),
    },
  ] as const;

  const healthRows = [
    { label: t("maintenance.checkRuntime"), ok: overview.data != null },
    { label: t("nav.codexAuth"), ok: accountPool.loadState === "ready" },
    { label: t("maintenance.checkDatabase"), ok: overview.data != null },
    { label: t("maintenance.checkSkills"), ok: overview.data != null },
  ];
  const healthLoading = (overview.loading && !overview.data) || accountPool.initialLoading;

  return (
    <div className="desktop-dashboard">
      <section className="desktop-summary-grid" aria-label={t("dashboard.summary")}>
        {summary.map(({ id, tone, Icon, label, value, detail }, index) => (
          <button key={`${id}-${index}`} type="button" className={`desktop-summary-card desktop-summary-card--${tone}`} onClick={() => navigateHash(id)}>
            <span className="desktop-summary-card__accent" aria-hidden />
            <span className="desktop-summary-card__head"><span>{label}</span><Icon aria-hidden /></span>
            <strong>{value}</strong>
            <span className="desktop-summary-card__detail">{detail}</span>
          </button>
        ))}
      </section>

      <section className="desktop-home-main-grid">
        <article className="desktop-home-account-card">
          <div className="desktop-home-card-head">
            <div>
              <h3>{t("dashboard.accountUsage")}</h3>
              <p>{t("dashboard.accountUsageOnly")}</p>
            </div>
            <span className={`desktop-status-chip${accountPool.loadState === "ready" ? " is-ok" : " is-warn"}`}>
              <span className={`dot ${accountPool.loadState === "ready" ? "dot-green" : "dot-amber"}`} />
              {accountPool.initialLoading ? t("common.loading") : accountPool.loadState === "ready" ? t("dash.online") : t("maintenance.attention")}
            </span>
          </div>

          {accountPool.initialLoading ? (
            <div className="desktop-home-loading">{t("common.loading")}</div>
          ) : activeAccount ? (
            <>
              <div className="desktop-home-account-identity">
                <span className="desktop-home-account-avatar" aria-hidden>
                  {(activeAccount.alias ?? activeAccount.email).slice(0, 1).toLocaleUpperCase()}
                </span>
                <div>
                  <small>{t("dashboard.currentAccount")}</small>
                  <strong>{activeAccount.alias ?? activeAccount.email}</strong>
                  <span>{activeAccount.email}</span>
                </div>
                <span className="desktop-home-plan-chip">{activeAccount.plan ?? "Codex"}</span>
                <div className="desktop-home-token-total">
                  <small>{t("dashboard.tokens30d")}</small>
                  <strong>{overview.loading && !overview.data ? "—" : formatCompactTokens(localTokens30d)}</strong>
                </div>
              </div>

              <div className="desktop-home-quota-grid">
                {activeQuotaRows.length > 0 ? activeQuotaRows.map(row => (
                  <div className="desktop-home-quota" key={row.limitLabel}>
                    <span><span>{row.label}</span><strong>{Math.round(row.percent)}%</strong></span>
                    <i><i style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></i>
                  </div>
                )) : (
                  <div className="desktop-home-quota-empty">
                    {t(accountPool.refreshing ? "accounts.quotaPending" : "accounts.quotaUnavailable")}
                  </div>
                )}
              </div>

              <div className="desktop-home-account-foot">
                <span><b>{accounts.length}</b><span>{t("dashboard.accountCountHint")}</span></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigateHash("codex-auth")}>{t("dashboard.manage")}</button>
              </div>
            </>
          ) : (
            <div className="desktop-home-empty">
              <span>{t("accounts.empty")}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigateHash("codex-auth")}>{t("dashboard.manage")}</button>
            </div>
          )}
        </article>

        <article className="desktop-home-health-card">
          <div className="desktop-home-card-head">
            <div>
              <h3>{t("dashboard.localHealth")}</h3>
              <p>{t("dashboard.localHealthHint")}</p>
            </div>
            <span className="desktop-home-health-icon"><IconHardDrive aria-hidden /></span>
          </div>
          <div className="desktop-home-health-list">
            {healthRows.map(row => (
              <div key={row.label}>
                <span><span className={`dot ${healthLoading ? "dot-amber" : row.ok ? "dot-green" : "dot-red"}`} />{row.label}</span>
                <strong>{healthLoading ? t("common.loading") : row.ok ? t("maintenance.passed") : t("maintenance.failed")}</strong>
              </div>
            ))}
          </div>
          <div className="desktop-home-health-foot">
            <span><small>{t("nav.threads")}</small><strong>{counts?.threads ?? "—"}</strong></span>
            <span><small>{t("nav.skills")}</small><strong>{counts?.skills ?? "—"}</strong></span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigateHash("maintenance")}>{t("nav.maintenance")}</button>
          </div>
        </article>
      </section>
    </div>
  );
}
