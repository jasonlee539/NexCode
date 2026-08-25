import { useMemo, useState } from "react";
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

type ActivityDay = NonNullable<DesktopOverviewResponse["activity365d"]>[number];
interface ActivityMonth {
  key: string;
  label: string;
  slots: Array<ActivityDay | null>;
}
const ACTIVITY_COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"] as const;

function activityDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseActivityDate(raw: string | undefined): Date {
  const [year, month, day] = (raw ?? "").split("-").map(Number);
  const parsed = new Date(year || 0, (month || 1) - 1, day || 1);
  if (year > 0 && !Number.isNaN(parsed.getTime())) return parsed;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function completeActivityWindow(input: ActivityDay[]): ActivityDay[] {
  const indexed = new Map(input.map(day => [day.date, day]));
  const anchor = parseActivityDate(input.at(-1)?.date);
  return Array.from({ length: 365 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - (364 - index));
    const key = activityDateKey(date);
    return indexed.get(key) ?? { date: key, threadCount: 0, totalTokens: 0 };
  });
}

function localThreadActivity(overview: DesktopOverviewResponse | undefined): ActivityDay[] {
  // Never synthesize this chart from the five recent-thread cards or the active
  // account. Only the backend's all-local-thread aggregation is authoritative.
  return overview?.activity365d ?? overview?.activity30d ?? [];
}

function twelveActivityMonths(days: ActivityDay[], locale: string): ActivityMonth[] {
  const indexed = new Map(days.map(day => [day.date, day]));
  const anchor = parseActivityDate(days.at(-1)?.date);
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(anchor.getFullYear(), anchor.getMonth() - (11 - index), 1);
    const totalDays = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const monthDays = Array.from({ length: totalDays }, (_, dayIndex) => {
      const date = new Date(start.getFullYear(), start.getMonth(), dayIndex + 1);
      const key = activityDateKey(date);
      return indexed.get(key) ?? { date: key, threadCount: 0, totalTokens: 0 };
    });
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: formatter.format(start),
      slots: [...Array.from({ length: start.getDay() }, () => null), ...monthDays],
    };
  });
}

export default function DesktopDashboard({ apiBase }: { apiBase: string }) {
  const { locale, t } = useI18n();
  const [activityMetric, setActivityMetric] = useState<"threads" | "tokens">("threads");
  const [selectedActivityDate, setSelectedActivityDate] = useState<string | null>(null);
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
  const rawActivityDays = useMemo(() => localThreadActivity(overview.data), [overview.data]);
  const activityDays = useMemo(() => completeActivityWindow(rawActivityDays), [rawActivityDays]);
  const activityMonths = useMemo(() => twelveActivityMonths(activityDays, locale), [activityDays, locale]);
  const maxActivity = useMemo(() => Math.max(1, ...activityDays.map(day => (
    activityMetric === "threads" ? day.threadCount : day.totalTokens
  ))), [activityDays, activityMetric]);
  const formatActivityDate = (raw: string) => {
    const [year, month, day] = raw.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" })
      .format(new Date(year || 2000, (month || 1) - 1, day || 1));
  };
  const defaultActivityDay = useMemo(() => (
    [...activityDays].reverse().find(day => day.threadCount > 0 || day.totalTokens > 0)
      ?? activityDays.at(-1)
  ), [activityDays]);
  const selectedActivityDay = activityDays.find(day => day.date === selectedActivityDate)
    ?? defaultActivityDay;
  const activityDayText = (day: ActivityDay) => t("dashboard.activityDay", {
    date: formatActivityDate(day.date),
    threads: String(day.threadCount),
    tokens: formatCompactTokens(day.totalTokens),
  });
  const activityLevel = (day: ActivityDay) => {
    const value = activityMetric === "threads" ? day.threadCount : day.totalTokens;
    if (value === 0) return 0;
    return activityMetric === "threads"
      ? Math.max(1, Math.ceil((value / maxActivity) * 4))
      : Math.max(1, Math.ceil((Math.log1p(value) / Math.log1p(maxActivity)) * 4));
  };

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
            <div className="desktop-home-loading is-compact">{t("common.loading")}</div>
          ) : activeAccount ? (
            <div className="desktop-home-account-overview">
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
            </div>
          ) : (
            <div className="desktop-home-empty is-compact">
              <span>{t("accounts.empty")}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigateHash("codex-auth")}>{t("dashboard.manage")}</button>
            </div>
          )}

          <div className="desktop-home-activity">
            <div className="desktop-home-activity__head">
              <div><strong>{t("dashboard.activity30d")}</strong><span>{t("dashboard.activityHint")}</span></div>
              <div className="desktop-home-activity__segments" role="tablist" aria-label={t("dashboard.activityMetric")}>
                <button type="button" role="tab" aria-selected={activityMetric === "threads"} className={activityMetric === "threads" ? "is-active" : ""} onClick={() => setActivityMetric("threads")}>{t("dashboard.activityThreads")}</button>
                <button type="button" role="tab" aria-selected={activityMetric === "tokens"} className={activityMetric === "tokens" ? "is-active" : ""} onClick={() => setActivityMetric("tokens")}>{t("dashboard.activityTokens")}</button>
              </div>
            </div>
            {selectedActivityDay && (
              <div className="desktop-home-activity__day-detail" role="status">
                {activityDayText(selectedActivityDay)}
              </div>
            )}
            <div className="desktop-home-activity__months-grid" data-days={activityDays.length} data-months={activityMonths.length}>
              {activityMonths.map(month => (
                <section className="desktop-home-activity__month" key={month.key} aria-label={month.label}>
                  <strong>{month.label}</strong>
                  <div className="desktop-home-activity__month-days">
                    {month.slots.map((day, slotIndex) => {
                      if (!day) return <span className="desktop-home-activity__cell is-placeholder" key={`${month.key}-empty-${slotIndex}`} aria-hidden="true" />;
                      const future = day.date > (activityDays.at(-1)?.date ?? day.date);
                      const level = activityLevel(day);
                      return (
                        <button
                          type="button"
                          key={day.date}
                          disabled={future}
                          className={`desktop-home-activity__cell is-level-${level}${future ? " is-future" : ""}${selectedActivityDay?.date === day.date ? " is-selected" : ""}`}
                          data-activity-date={day.date}
                          data-activity-level={level}
                          data-thread-count={day.threadCount}
                          data-total-tokens={day.totalTokens}
                          style={{ backgroundColor: ACTIVITY_COLORS[level] }}
                          title={activityDayText(day)}
                          aria-label={activityDayText(day)}
                          aria-pressed={selectedActivityDay?.date === day.date}
                          onClick={() => setSelectedActivityDate(day.date)}
                          onFocus={() => setSelectedActivityDate(day.date)}
                          onMouseEnter={() => setSelectedActivityDate(day.date)}
                        />
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="desktop-home-activity__legend"><span>{t("dashboard.activityLess")}</span><i className="is-level-0" /><i className="is-level-1" /><i className="is-level-2" /><i className="is-level-3" /><i className="is-level-4" /><span>{t("dashboard.activityMore")}</span></div>
          </div>

          {!accountPool.initialLoading && activeAccount && (
            <div className="desktop-home-account-foot">
              <span><b>{accounts.length}</b><span>{t("dashboard.accountCountHint")}</span></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigateHash("codex-auth")}>{t("dashboard.manage")}</button>
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
