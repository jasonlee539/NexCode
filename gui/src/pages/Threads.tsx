import { useDeferredValue, useState } from "react";
import { useKeyedClientResource } from "../client-resource";
import { MarkdownDocument } from "../components/MarkdownDocument";
import type { DesktopThreadSummary } from "../desktop-types";
import { formatCompactTokens } from "../format-tokens";
import { IconChevron, IconDownload, IconFileText, IconRefresh, IconSearch, IconStar } from "../icons";
import { useI18n } from "../i18n/shared";

type ThreadFilter = "all" | "active" | "archived";

interface ThreadListResponse {
  total: number;
  counts: { all: number; active: number; archived: number };
  threads: DesktopThreadSummary[];
}

interface ThreadDocument {
  fileName: string;
  markdown: string;
}

async function fetchThreads(apiBase: string, status: ThreadFilter, query: string, signal: AbortSignal): Promise<ThreadListResponse> {
  const params = new URLSearchParams({ status, limit: "500" });
  if (query.trim()) params.set("q", query.trim());
  const response = await fetch(`${apiBase}/api/desktop/threads?${params}`, { signal });
  if (!response.ok) throw new Error("threads unavailable");
  return response.json() as Promise<ThreadListResponse>;
}

export default function Threads({ apiBase }: { apiBase: string }) {
  const { locale, t } = useI18n();
  const [filter, setFilter] = useState<ThreadFilter>("all");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ thread: DesktopThreadSummary; document: ThreadDocument } | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: "ok" | "err" } | null>(null);
  const deferredQuery = useDeferredValue(query);
  const resource = useKeyedClientResource(
    `desktop-threads:${apiBase}:${filter}:${deferredQuery}:${reload}`,
    [apiBase, filter, deferredQuery, reload],
    signal => fetchThreads(apiBase, filter, deferredQuery, signal),
  );

  const formatWhen = (value: number | null) => {
    if (!value) return "—";
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
  };

  const fetchThreadDocument = async (thread: DesktopThreadSummary): Promise<ThreadDocument> => {
    const response = await fetch(`${apiBase}/api/desktop/threads/${encodeURIComponent(thread.id)}/export`);
    if (!response.ok) throw new Error();
    const payload = await response.json() as Partial<ThreadDocument>;
    if (!payload.markdown || !payload.fileName) throw new Error();
    return payload as ThreadDocument;
  };

  const downloadDocument = (thread: DesktopThreadSummary) => {
    const anchor = window.document.createElement("a");
    anchor.href = `${apiBase}/api/desktop/threads/${encodeURIComponent(thread.id)}/export?download=1`;
    anchor.download = "";
    anchor.hidden = true;
    window.document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
    }, 1_000);
  };

  const exportThread = (thread: DesktopThreadSummary) => {
    setExportingId(thread.id);
    setFeedback(null);
    try {
      downloadDocument(thread);
      setFeedback({ message: t("threads.exportDone"), tone: "ok" });
    } catch {
      setFeedback({ message: t("threads.exportFailed"), tone: "err" });
    } finally {
      setExportingId(null);
    }
  };

  const viewThread = async (thread: DesktopThreadSummary) => {
    setViewingId(thread.id);
    setFeedback(null);
    try {
      setViewer({ thread, document: await fetchThreadDocument(thread) });
    } catch {
      setFeedback({ message: t("threads.viewFailed"), tone: "err" });
    } finally {
      setViewingId(null);
    }
  };

  if (viewer) {
    return (
      <div className="desktop-thread-view">
        <div className="desktop-thread-view__toolbar">
          <button type="button" className="btn btn-ghost btn-sm desktop-thread-view__back" onClick={() => { setViewer(null); setFeedback(null); }}>
            <IconChevron width={13} /> {t("threads.back")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={exportingId !== null} onClick={() => { exportThread(viewer.thread); }}>
            <IconDownload width={13} /> {exportingId === viewer.thread.id ? t("common.loading") : t("threads.export")}
          </button>
        </div>
        <header className="desktop-thread-view__head">
          <div>
            <span>{viewer.thread.projectName || t("threads.unknownProject")}</span>
            <h2>{viewer.thread.title}</h2>
          </div>
          <time>{formatWhen(viewer.thread.updatedAt)}</time>
        </header>
        {feedback && <div className={`desktop-inline-status is-${feedback.tone}`} role="status">{feedback.message}</div>}
        <section className="desktop-thread-document" aria-label={t("threads.document")}>
          <MarkdownDocument source={viewer.document.markdown} />
        </section>
      </div>
    );
  }

  const counts = resource.data?.counts ?? { all: 0, active: 0, archived: 0 };
  const filters: Array<{ id: ThreadFilter; label: string; count: number }> = [
    { id: "all", label: t("threads.filterAll"), count: counts.all },
    { id: "active", label: t("threads.filterActive"), count: counts.active },
    { id: "archived", label: t("threads.filterArchived"), count: counts.archived },
  ];

  return (
    <div className="desktop-list-page desktop-threads-page">
      <div className="desktop-section-toolbar desktop-list-toolbar">
        <div>
          <h2>{t("nav.threads")}</h2>
          <p>{t("threads.subtitle")}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload(value => value + 1)} disabled={resource.loading}>
          <IconRefresh width={14} /> {t("threads.refresh")}
        </button>
      </div>

      <div className="desktop-list-controls">
        <label className="desktop-search-field">
          <IconSearch aria-hidden />
          <span className="sr-only">{t("threads.search")}</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("threads.searchPlaceholder")} />
        </label>
        <div className="desktop-filter-pills" role="tablist" aria-label={t("threads.filterLabel")}>
          {filters.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? "is-active" : ""}
              onClick={() => setFilter(item.id)}
            >
              {item.label}<span>{item.count}</span>
            </button>
          ))}
        </div>
      </div>

      {feedback && <div className={`desktop-inline-status is-${feedback.tone}`} role="status">{feedback.message}</div>}

      {resource.loading && !resource.data ? (
        <div className="desktop-page-loading">{t("common.loading")}</div>
      ) : resource.error && !resource.data ? (
        <div className="desktop-page-error" role="alert">
          <span>{t("threads.loadFailed")}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload(value => value + 1)}>{t("common.retry")}</button>
        </div>
      ) : (resource.data?.threads.length ?? 0) === 0 ? (
        <div className="desktop-page-empty">
          <IconSearch aria-hidden />
          <strong>{t(query ? "threads.noResults" : "threads.empty")}</strong>
          <span>{t(query ? "threads.noResultsHint" : "threads.emptyHint")}</span>
        </div>
      ) : (
        <div className="desktop-thread-list">
          {resource.data?.threads.map(thread => (
            <article key={thread.id} className="desktop-thread-row">
              <span className={`desktop-thread-row__state${thread.archived ? " is-archived" : ""}`} aria-hidden />
              <div className="desktop-thread-row__main">
                <div className="desktop-thread-row__title">
                  <strong>{thread.title}</strong>
                  {thread.pinned && <span className="desktop-thread-badge"><IconStar width={11} />{t("threads.pinned")}</span>}
                  <span className={`desktop-thread-badge${thread.archived ? " is-muted" : " is-active"}`}>
                    {thread.archived ? t("threads.archived") : t("threads.active")}
                  </span>
                </div>
                <p>{thread.preview || thread.cwd || thread.id}</p>
                <div className="desktop-thread-row__details">
                  <span>{thread.projectName || t("threads.unknownProject")}</span>
                  {thread.model && <span>{thread.model}{thread.reasoningEffort ? ` · ${thread.reasoningEffort}` : ""}</span>}
                  <span>{formatCompactTokens(thread.tokensUsed)} {t("threads.tokens")}</span>
                </div>
              </div>
              <div className="desktop-thread-row__side">
                <time>{formatWhen(thread.updatedAt)}</time>
                <div className="desktop-thread-row__actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={viewingId !== null} onClick={() => { void viewThread(thread); }}>
                    <IconFileText width={13} /> {viewingId === thread.id ? t("common.loading") : t("threads.view")}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={exportingId !== null} onClick={() => { exportThread(thread); }}>
                    <IconDownload width={13} /> {exportingId === thread.id ? t("common.loading") : t("threads.export")}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
