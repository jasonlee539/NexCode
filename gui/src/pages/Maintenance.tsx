import { useState } from "react";
import { requestCodexRestart } from "../codex-restart";
import type { DesktopDiagnosticsResponse } from "../desktop-types";
import { formatBytes } from "../format-bytes";
import { IconActivity, IconHardDrive, IconPower, IconRefresh } from "../icons";
import { useI18n } from "../i18n/shared";

interface CleanupPreview {
  percent: number;
  count: number;
  bytes: number;
  digest: string;
}

type MaintenanceAction = "diagnostics" | "cleanup" | "forceQuit" | "restart";

export default function Maintenance({ apiBase }: { apiBase: string }) {
  const { locale, t } = useI18n();
  const [busy, setBusy] = useState<MaintenanceAction | null>(null);
  const [diagnostics, setDiagnostics] = useState<DesktopDiagnosticsResponse | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  const runDiagnostics = async () => {
    setBusy("diagnostics");
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/desktop/diagnostics`);
      if (!response.ok) throw new Error();
      const result = await response.json() as DesktopDiagnosticsResponse;
      setDiagnostics(result);
      setFeedback({ tone: result.ok ? "ok" : "warn", text: t(result.ok ? "maintenance.diagnosticsPassed" : "maintenance.diagnosticsWarning") });
    } catch {
      setFeedback({ tone: "err", text: t("maintenance.actionFailed") });
    } finally {
      setBusy(null);
    }
  };

  const previewCleanup = async () => {
    setBusy("cleanup");
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/storage/cleanup/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ percent: 25 }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as CleanupPreview;
      if (result.count === 0) {
        setFeedback({ tone: "ok", text: t("maintenance.nothingToClean") });
      } else {
        setPreview(result);
      }
    } catch {
      setFeedback({ tone: "err", text: t("maintenance.cleanupPreviewFailed") });
    } finally {
      setBusy(null);
    }
  };

  const runCleanup = async () => {
    if (!preview) return;
    setBusy("cleanup");
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/storage/cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          percent: preview.percent,
          mode: "quarantine",
          digest: preview.digest,
        }),
      });
      const result = await response.json().catch(() => ({})) as { ok?: boolean; count?: number; bytes?: number; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message);
      setPreview(null);
      setFeedback({
        tone: "ok",
        text: t("maintenance.cleanupDone", {
          count: String(result.count ?? 0),
          size: formatBytes(result.bytes ?? 0, locale),
        }),
      });
      setDiagnostics(null);
    } catch {
      setFeedback({ tone: "err", text: t("maintenance.cleanupFailed") });
    } finally {
      setBusy(null);
    }
  };

  const forceQuit = async () => {
    if (!window.confirm(t("maintenance.forceQuitConfirm"))) return;
    setBusy("forceQuit");
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/desktop/codex/force-quit`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as {
        stopped?: number;
        surviving?: number;
        error?: string;
      };
      if (!response.ok || result.error || (result.surviving ?? 0) > 0) throw new Error();
      setFeedback({
        tone: "ok",
        text: (result.stopped ?? 0) > 0
          ? t("maintenance.forceQuitDone", { count: String(result.stopped ?? 0) })
          : t("maintenance.noCodexProcesses"),
      });
      setDiagnostics(null);
    } catch {
      setFeedback({ tone: "err", text: t("maintenance.forceQuitFailed") });
    } finally {
      setBusy(null);
    }
  };

  const restartCodex = async () => {
    if (!window.confirm(t("maintenance.restartConfirm"))) return;
    setBusy("restart");
    setFeedback(null);
    const outcome = await requestCodexRestart(apiBase, {
      formatFailure: () => t("maintenance.restartFailed"),
      formatUnreachable: () => t("maintenance.restartFailed"),
      formatMalformed: () => t("maintenance.restartFailed"),
      formatTimeout: () => t("maintenance.restartTimeout"),
    });
    if (!outcome.ok || !outcome.result) {
      setFeedback({ tone: "err", text: outcome.message ?? t("maintenance.restartFailed") });
    } else if (outcome.result.code === "stopped") {
      setFeedback({ tone: "ok", text: t("maintenance.restartDone", { count: String(outcome.result.stopped.length) }) });
    } else if (outcome.result.code === "nothing_running") {
      setFeedback({ tone: "ok", text: t("maintenance.noCodexProcesses") });
    } else if (outcome.result.code === "enumeration_unavailable") {
      setFeedback({ tone: "warn", text: t("maintenance.enumerationUnavailable") });
    } else {
      setFeedback({ tone: "warn", text: t("maintenance.restartPartial") });
    }
    setBusy(null);
    setDiagnostics(null);
  };

  const cards = [
    {
      id: "diagnostics" as const,
      Icon: IconActivity,
      tone: "blue",
      title: t("maintenance.diagnostics"),
      description: t("maintenance.diagnosticsDesc"),
      button: t("maintenance.runDiagnostics"),
      action: runDiagnostics,
    },
    {
      id: "cleanup" as const,
      Icon: IconHardDrive,
      tone: "green",
      title: t("maintenance.cleanup"),
      description: t("maintenance.cleanupDesc"),
      button: t("maintenance.previewCleanup"),
      action: previewCleanup,
    },
    {
      id: "forceQuit" as const,
      Icon: IconPower,
      tone: "red",
      title: t("maintenance.forceQuit"),
      description: t("maintenance.forceQuitDesc"),
      button: t("maintenance.forceQuitAction"),
      action: forceQuit,
    },
    {
      id: "restart" as const,
      Icon: IconRefresh,
      tone: "purple",
      title: t("maintenance.restart"),
      description: t("maintenance.restartDesc"),
      button: t("maintenance.restartAction"),
      action: restartCodex,
    },
  ];

  const diagnosticChecks = diagnostics ? [
    ["runtime", t("maintenance.checkRuntime"), diagnostics.checks.runtime],
    ["home", t("maintenance.checkCodexHome"), diagnostics.checks.codexHome],
    ["database", t("maintenance.checkDatabase"), diagnostics.checks.stateDatabase],
    ["process", t("maintenance.checkProcesses"), diagnostics.checks.processEnumeration],
    ["skills", t("maintenance.checkSkills"), diagnostics.checks.skillsDirectory],
  ] as const : [];

  return (
    <div className="desktop-maintenance-page">
      <div className="desktop-section-toolbar">
        <div>
          <h2>{t("nav.maintenance")}</h2>
          <p>{t("maintenance.subtitle")}</p>
        </div>
      </div>

      {feedback && <div className={`desktop-inline-status is-${feedback.tone}`} role="status">{feedback.text}</div>}

      <section className="desktop-maintenance-grid">
        {cards.map(card => (
          <article key={card.id} className={`desktop-maintenance-card is-${card.tone}`}>
            <span className="desktop-maintenance-card__icon"><card.Icon aria-hidden /></span>
            <div className="desktop-maintenance-card__copy"><h3>{card.title}</h3><p>{card.description}</p></div>
            <button type="button" className={card.id === "forceQuit" ? "btn btn-sm btn-danger" : "btn btn-sm btn-ghost"} disabled={busy !== null} onClick={() => { void card.action(); }}>
              {busy === card.id ? t("maintenance.running") : card.button}
            </button>
          </article>
        ))}
      </section>

      {diagnostics && (
        <section className="desktop-diagnostics-panel">
          <div className="desktop-dashboard-card__head">
            <div><h3>{t("maintenance.diagnosticsResult")}</h3><p>{t("maintenance.diagnosticsGenerated")}</p></div>
            <span className={`desktop-status-chip ${diagnostics.ok ? "is-ok" : "is-warn"}`}>
              <span className={`dot ${diagnostics.ok ? "dot-green" : "dot-amber"}`} />
              {diagnostics.ok ? t("maintenance.normal") : t("maintenance.attention")}
            </span>
          </div>
          <div className="desktop-diagnostic-checks">
            {diagnosticChecks.map(([id, label, ok]) => (
              <div key={id}><span className={`dot ${ok ? "dot-green" : "dot-amber"}`} /><span>{label}</span><strong>{ok ? t("maintenance.passed") : t("maintenance.failed")}</strong></div>
            ))}
          </div>
          <div className="desktop-diagnostic-stats">
            <div><span>{t("nav.threads")}</span><strong>{diagnostics.counts.threads}</strong></div>
            <div><span>{t("nav.skills")}</span><strong>{diagnostics.counts.skills}</strong></div>
            <div><span>{t("maintenance.codexProcesses")}</span><strong>{diagnostics.counts.codexProcesses ?? "—"}</strong></div>
            <div><span>{t("maintenance.storage")}</span><strong>{formatBytes(diagnostics.counts.storageBytes, locale)}</strong></div>
          </div>
        </section>
      )}

      {preview && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-cleanup-title" onClick={() => busy === null && setPreview(null)}>
          <div className="modal-card desktop-cleanup-dialog" onClick={event => event.stopPropagation()}>
            <h3 id="desktop-cleanup-title">{t("maintenance.cleanupConfirmTitle")}</h3>
            <p>{t("maintenance.cleanupConfirmBody", { count: String(preview.count), size: formatBytes(preview.bytes, locale) })}</p>
            <div className="desktop-cleanup-safety">{t("maintenance.cleanupSafety")}</div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => setPreview(null)}>{t("common.cancel")}</button>
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => { void runCleanup(); }}>
                {busy === "cleanup" ? t("maintenance.running") : t("maintenance.confirmCleanup")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
