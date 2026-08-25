import { buildQuotaRows } from "./QuotaBars";
import type { CodexAccountEntry } from "./codex-account-pool-types";
import { codexAccountDisplayLabel } from "../codex-account-display";
import type { DesktopUsageTotals } from "../desktop-types";
import { formatCompactTokens } from "../format-tokens";
import { IconActivity, IconPlus, IconRefresh, IconTrash } from "../icons";
import { useI18n } from "../i18n/shared";

export default function DesktopAccountGrid({
  accounts,
  activeId,
  switchingId,
  refreshing,
  localUsage30d,
  usageLoading,
  onRefresh,
  onAdd,
  onSwitch,
  onReauth,
  onRemove,
}: {
  accounts: CodexAccountEntry[];
  activeId: string | null;
  switchingId: string | null;
  refreshing: boolean;
  localUsage30d: DesktopUsageTotals | null;
  usageLoading: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onSwitch: (account: CodexAccountEntry) => void;
  onReauth: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const isActive = (account: CodexAccountEntry) => account.isMain
    ? !activeId || activeId === "__main__"
    : activeId === account.id;

  return (
    <section className="desktop-account-surface">
      <div className="desktop-section-toolbar">
        <div>
          <h2>{t("accounts.title")}</h2>
          <p>{t("accounts.subtitle")}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={refreshing} onClick={onRefresh}>
          <IconRefresh width={14} />
          {refreshing ? t("codexAuth.refreshingQuota") : t("codexAuth.refreshQuota")}
        </button>
      </div>

      <div className="desktop-account-local-usage">
        <span className="desktop-account-local-usage__icon" aria-hidden><IconActivity width={16} /></span>
        <div className="desktop-account-local-usage__copy">
          <strong>{t("accounts.localUsage30d")}</strong>
          <small>{t("accounts.localUsageScope")}</small>
        </div>
        <div className="desktop-account-local-usage__value">
          <strong>{usageLoading ? "…" : localUsage30d ? formatCompactTokens(localUsage30d.totalTokens) : "—"}</strong>
          <small>{localUsage30d
            ? t("accounts.usageMeta", {
                threads: String(localUsage30d.threadCount),
                turns: String(localUsage30d.turns),
              })
            : t("usage.localSource")}</small>
        </div>
      </div>

      <div className="desktop-account-grid">
        {accounts.map(account => {
          const accountName = codexAccountDisplayLabel(accounts, account, t);
          const email = account.email?.trim();
          const accountDetail = email && email !== accountName
            ? email
            : account.isMain ? t("codexAuth.mainAccount") : account.plan ?? "ChatGPT";
          const active = isActive(account);
          const needsReauth = Boolean(account.needsReauth) || account.health?.status === "reauth_required";
          const quotaRows = buildQuotaRows(account.quota, account.plan, t).slice(0, 2);
          return (
            <article key={account.id} className={`desktop-account-card${active ? " is-active" : ""}${needsReauth ? " needs-auth" : ""}`}>
              <div className="desktop-account-card__head">
                <span className={`desktop-account-avatar${needsReauth ? " is-warn" : ""}`} aria-hidden>
                  {(Array.from(accountName)[0] ?? "C").toLocaleUpperCase()}
                </span>
                <div className="desktop-account-card__identity">
                  <strong title={accountName}>{accountName}</strong>
                  <span title={accountDetail}>{accountDetail}</span>
                </div>
                <span className={`desktop-account-state${needsReauth ? " is-warn" : active ? " is-active" : ""}`}>
                  {needsReauth ? t("codexAuth.needsReauth") : active ? t("codexAuth.current") : account.plan ?? "Codex"}
                </span>
              </div>

              <div className="desktop-account-card__quotas">
                {quotaRows.length > 0 ? quotaRows.map(row => (
                  <div className="desktop-account-card__quota" key={row.limitLabel}>
                    <span><span>{row.label}</span><b>{Math.round(row.percent)}%</b></span>
                    <i><i style={{ width: `${Math.max(0, Math.min(100, row.percent))}%` }} /></i>
                  </div>
                )) : (
                  <span className="desktop-account-card__quota-empty">
                    {t(refreshing ? "accounts.quotaPending" : "accounts.quotaUnavailable")}
                  </span>
                )}
              </div>

              <div className="desktop-account-card__actions">
                {needsReauth && !account.isMain ? (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onReauth(account.id)}>
                    {t("codexAuth.reauthenticate")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={active ? "btn btn-sm btn-ghost" : "btn btn-sm btn-primary"}
                    disabled={active || switchingId !== null || account.paused}
                    onClick={() => onSwitch(account)}
                  >
                    {switchingId === account.id ? t("common.loading") : active ? t("codexAuth.current") : t("accounts.select")}
                  </button>
                )}
                {!account.isMain && (
                  <button
                    type="button"
                    className="btn-icon btn-icon-danger"
                    onClick={() => onRemove(account.id)}
                    aria-label={`${t("common.remove")} — ${accountName}`}
                    title={t("common.remove")}
                  >
                    <IconTrash width={14} />
                  </button>
                )}
              </div>
            </article>
          );
        })}

        <button type="button" className="desktop-account-add" onClick={onAdd}>
          <span><IconPlus width={18} /></span>
          <strong>{t("codexAuth.add")}</strong>
          <small>{t("accounts.addHint")}</small>
        </button>
      </div>
    </section>
  );
}
