import { useMemo, useState } from "react";
import { useKeyedClientResource } from "../client-resource";
import type {
  DesktopUsageRange,
  DesktopUsageResponse,
  DesktopUsageTotals,
} from "../desktop-types";
import { formatCompactTokens } from "../format-tokens";
import { IconActivity, IconArrowDown, IconArrowUp, IconMessageSquare, IconRefresh } from "../icons";
import { useI18n, type TKey } from "../i18n/shared";

const RANGE_DAYS: Record<DesktopUsageRange, number> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
};

const RANGE_OPTIONS: Array<{ id: DesktopUsageRange; label: TKey }> = [
  { id: "1d", label: "usage.range1d" },
  { id: "3d", label: "usage.range3d" },
  { id: "7d", label: "usage.range7d" },
  { id: "30d", label: "usage.range30d" },
];

const EMPTY_TOTALS: DesktopUsageTotals = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  turns: 0,
  threadCount: 0,
};

async function fetchUsage(apiBase: string, signal: AbortSignal): Promise<DesktopUsageResponse> {
  const response = await fetch(`${apiBase}/api/desktop/usage`, { signal });
  if (!response.ok) throw new Error("local usage unavailable");
  return response.json() as Promise<DesktopUsageResponse>;
}

export default function DesktopUsage({ apiBase }: { apiBase: string }) {
  const { locale, t } = useI18n();
  const [range, setRange] = useState<DesktopUsageRange>("7d");
  const usage = useKeyedClientResource(
    `desktop-local-usage:${apiBase}`,
    [apiBase],
    signal => fetchUsage(apiBase, signal),
    { staleAfterMs: 15_000, deadlineMs: 45_000 },
  );
  const totals = usage.data?.ranges[range] ?? EMPTY_TOTALS;
  const visibleDays = useMemo(
    () => (usage.data?.days ?? []).slice(-RANGE_DAYS[range]),
    [range, usage.data?.days],
  );
  const topThreads = usage.data?.topThreads[range] ?? [];
  const maxDailyTokens = Math.max(1, ...visibleDays.map(day => day.totalTokens));
  const maxThreadTokens = Math.max(1, ...topThreads.map(thread => thread.totalTokens));
  const inputOutputTotal = totals.inputTokens + totals.outputTokens;
  const inputPercent = inputOutputTotal > 0 ? (totals.inputTokens / inputOutputTotal) * 100 : 0;
  const formatDate = (raw: string) => {
    const [year, month, day] = raw.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" })
      .format(new Date(year || 2000, (month || 1) - 1, day || 1));
  };

  if (usage.loading && !usage.data) {
    return <div className="desktop-page-loading"><span className="spinner" />{t("common.loading")}</div>;
  }
  if (usage.error && !usage.data) {
    return (
      <div className="desktop-page-error">
        <strong>{t("usage.loadFailed")}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => usage.refresh({ forceLoading: true })}>{t("common.retry")}</button>
      </div>
    );
  }

  const summaries = [
    { tone: "blue", Icon: IconActivity, label: t("usage.total"), value: formatCompactTokens(totals.totalTokens), detail: `${totals.threadCount} ${t("usage.threads")}` },
    { tone: "orange", Icon: IconArrowDown, label: t("usage.input"), value: formatCompactTokens(totals.inputTokens), detail: `${t("usage.cached")} ${formatCompactTokens(totals.cachedInputTokens)}` },
    { tone: "green", Icon: IconArrowUp, label: t("usage.output"), value: formatCompactTokens(totals.outputTokens), detail: `${t("usage.reasoning")} ${formatCompactTokens(totals.reasoningOutputTokens)}` },
    { tone: "purple", Icon: IconMessageSquare, label: t("usage.turns"), value: new Intl.NumberFormat(locale).format(totals.turns), detail: t("usage.localSource") },
  ];

  return (
    <div className="desktop-usage">
      <div className="desktop-section-toolbar desktop-usage-toolbar">
        <div>
          <h2>{t("usage.title")}</h2>
          <p>{t("usage.subtitle")}</p>
        </div>
        <div className="desktop-usage-toolbar__actions">
          <div className="desktop-range-segments" role="tablist" aria-label={t("usage.title")}>
            {RANGE_OPTIONS.map(option => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={range === option.id}
                className={range === option.id ? "is-active" : ""}
                onClick={() => setRange(option.id)}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={usage.refreshing} onClick={() => usage.refresh()}>
            <IconRefresh width={13} />{t("usage.refresh")}
          </button>
        </div>
      </div>

      <section className="desktop-usage-summary" aria-label={t("usage.title")}>
        {summaries.map(({ tone, Icon, label, value, detail }) => (
          <article key={label} className={`desktop-usage-summary-card is-${tone}`}>
            <span className="desktop-usage-summary-card__icon"><Icon aria-hidden /></span>
            <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
          </article>
        ))}
      </section>

      <section className="desktop-usage-insights">
        <article className="desktop-usage-panel desktop-usage-trend-panel">
          <header>
            <div><h3>{t("usage.trend")}</h3><p>{t("usage.trendHint")}</p></div>
            <span>{t(`usage.range${range}` as TKey)}</span>
          </header>
          {totals.totalTokens > 0 ? (
            <div
              className="desktop-usage-chart"
              data-days={visibleDays.length}
              style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleDays.length)}, minmax(0, 1fr))` }}
            >
              {visibleDays.map((day, index) => {
                const height = Math.max(5, (day.totalTokens / maxDailyTokens) * 100);
                const showLabel = visibleDays.length <= 7 || index % 3 === 0 || index === visibleDays.length - 1;
                return (
                  <div className="desktop-usage-chart__day" key={day.date} title={`${formatDate(day.date)} · ${formatCompactTokens(day.totalTokens)}`}>
                    <div><i style={{ height: `${height}%` }} /></div>
                    <span>{showLabel ? formatDate(day.date) : ""}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="desktop-usage-empty"><strong>{t("usage.noData")}</strong><span>{t("usage.noDataHint")}</span></div>
          )}
        </article>

        <article className="desktop-usage-panel desktop-usage-composition">
          <header><div><h3>{t("usage.composition")}</h3><p>{t("usage.compositionHint")}</p></div></header>
          <div className="desktop-usage-ring" style={{ background: `conic-gradient(var(--desktop-green) 0 ${inputPercent}%, #8b68d6 ${inputPercent}% 100%)` }}>
            <div><strong>{formatCompactTokens(totals.totalTokens)}</strong><span>{t("usage.tokenUnit")}</span></div>
          </div>
          <div className="desktop-usage-legend">
            <div><span className="is-input" />{t("usage.input")}<strong>{Math.round(inputPercent)}%</strong></div>
            <div><span className="is-output" />{t("usage.output")}<strong>{Math.round(100 - inputPercent)}%</strong></div>
            <div><span className="is-cache" />{t("usage.cached")}<strong>{formatCompactTokens(totals.cachedInputTokens)}</strong></div>
          </div>
        </article>
      </section>

      <section className="desktop-usage-panel desktop-usage-ranking">
        <header>
          <div><h3>{t("usage.topThreads")}</h3><p>{t("usage.topThreadsHint")}</p></div>
          <span>{usage.data?.coverage.fallbackThreads ? t("usage.fallback", { count: String(usage.data.coverage.fallbackThreads) }) : t("usage.localSource")}</span>
        </header>
        {topThreads.length > 0 ? (
          <div className="desktop-usage-ranking__list">
            {topThreads.map((thread, index) => (
              <div className="desktop-usage-thread" key={thread.id}>
                <b>{index + 1}</b>
                <div className="desktop-usage-thread__copy">
                  <strong title={thread.title}>{thread.title}</strong>
                  <span>{[thread.projectName, thread.model, `${thread.turns} ${t("usage.turns")}`].filter(Boolean).join(" · ")}</span>
                </div>
                <i><i style={{ width: `${Math.max(4, (thread.totalTokens / maxThreadTokens) * 100)}%` }} /></i>
                <strong>{formatCompactTokens(thread.totalTokens)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="desktop-usage-empty is-compact"><strong>{t("usage.noData")}</strong></div>
        )}
      </section>
    </div>
  );
}
