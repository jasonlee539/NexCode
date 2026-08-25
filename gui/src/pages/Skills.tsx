import { useDeferredValue, useState } from "react";
import { useKeyedClientResource } from "../client-resource";
import type { DesktopSkillLocation, DesktopSkillSummary } from "../desktop-types";
import { IconEdit, IconPlus, IconRefresh, IconSearch, IconSparkles, IconTrash } from "../icons";
import { useI18n, type TKey } from "../i18n/shared";

interface SkillListResponse { skills: DesktopSkillSummary[]; locations: DesktopSkillLocation[] }
interface SkillDetailResponse { skill: DesktopSkillSummary & { content: string } }

type SkillEditor = {
  mode: "create" | "edit" | "view";
  id?: string;
  locationId?: string;
  name: string;
  content: string;
};

async function fetchSkills(apiBase: string, signal: AbortSignal): Promise<SkillListResponse> {
  const response = await fetch(`${apiBase}/api/desktop/skills`, { signal });
  if (!response.ok) throw new Error("skills unavailable");
  return response.json() as Promise<SkillListResponse>;
}

export default function Skills({ apiBase }: { apiBase: string }) {
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<SkillEditor | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const resource = useKeyedClientResource(
    `desktop-skills:${apiBase}:${reload}`,
    [apiBase, reload],
    signal => fetchSkills(apiBase, signal),
  );
  const skills = (resource.data?.skills ?? []).filter(skill => (
    !deferredQuery || [skill.name, skill.description, skill.relativePath]
      .some(value => value.toLocaleLowerCase().includes(deferredQuery))
  ));

  const newSkill = () => {
    setFeedback(null);
    setEditor({
      mode: "create",
      locationId: resource.data?.locations[0]?.id,
      name: "",
      content: t("skills.template"),
    });
  };

  const openSkill = async (skill: DesktopSkillSummary) => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/desktop/skills/${encodeURIComponent(skill.id)}`);
      if (!response.ok) throw new Error();
      const detail = await response.json() as SkillDetailResponse;
      setEditor({
        mode: skill.readOnly ? "view" : "edit",
        id: skill.id,
        name: skill.name,
        content: detail.skill.content,
      });
    } catch {
      setFeedback({ tone: "err", text: t("skills.readFailed") });
    } finally {
      setBusy(false);
    }
  };

  const saveSkill = async () => {
    if (!editor || editor.mode === "view") return;
    if (editor.mode === "create" && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(editor.name)) {
      setFeedback({ tone: "err", text: t("skills.invalidName") });
      return;
    }
    if (!editor.content.trim()) {
      setFeedback({ tone: "err", text: t("skills.contentRequired") });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const endpoint = editor.mode === "create"
        ? `${apiBase}/api/desktop/skills`
        : `${apiBase}/api/desktop/skills/${encodeURIComponent(editor.id ?? "")}`;
      const response = await fetch(endpoint, {
        method: editor.mode === "create" ? "POST" : "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editor.mode === "create"
          ? { locationId: editor.locationId, name: editor.name, content: editor.content }
          : { content: editor.content }),
      });
      if (!response.ok) throw new Error();
      setEditor(null);
      setReload(value => value + 1);
      setFeedback({ tone: "ok", text: t(editor.mode === "create" ? "skills.created" : "skills.saved") });
    } catch {
      setFeedback({ tone: "err", text: t("skills.saveFailed") });
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (skill: DesktopSkillSummary) => {
    if (skill.readOnly || !window.confirm(t("skills.removeConfirm", { name: skill.name }))) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/desktop/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      setReload(value => value + 1);
      setFeedback({ tone: "ok", text: t("skills.removed") });
    } catch {
      setFeedback({ tone: "err", text: t("skills.removeFailed") });
    } finally {
      setBusy(false);
    }
  };

  const formatWhen = (value: number) => new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
  const scopeKeys: Record<DesktopSkillSummary["scope"], TKey> = {
    user: "skills.scopeUser",
    project: "skills.scopeProject",
    legacy: "skills.scopeLegacy",
    admin: "skills.scopeAdmin",
    system: "skills.scopeSystem",
  };

  return (
    <div className="desktop-list-page desktop-skills-page">
      <div className="desktop-section-toolbar desktop-list-toolbar">
        <div>
          <h2>{t("nav.skills")}</h2>
          <p>{t("skills.subtitle")}</p>
        </div>
        <div className="desktop-toolbar-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={resource.loading || busy} onClick={() => setReload(value => value + 1)}>
            <IconRefresh width={14} /> {t("skills.refresh")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={newSkill}>
            <IconPlus width={14} /> {t("skills.add")}
          </button>
        </div>
      </div>

      <label className="desktop-search-field desktop-skills-search">
        <IconSearch aria-hidden />
        <span className="sr-only">{t("skills.search")}</span>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("skills.searchPlaceholder")} />
      </label>

      {feedback && <div className={`desktop-inline-status is-${feedback.tone}`} role="status">{feedback.text}</div>}

      {resource.loading && !resource.data ? (
        <div className="desktop-page-loading">{t("common.loading")}</div>
      ) : resource.error && !resource.data ? (
        <div className="desktop-page-error" role="alert">
          <span>{t("skills.loadFailed")}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload(value => value + 1)}>{t("common.retry")}</button>
        </div>
      ) : skills.length === 0 ? (
        <div className="desktop-page-empty">
          <IconSparkles aria-hidden />
          <strong>{t(query ? "skills.noResults" : "skills.empty")}</strong>
          <span>{t(query ? "skills.noResultsHint" : "skills.emptyHint")}</span>
        </div>
      ) : (
        <div className="desktop-skill-grid">
          {skills.map(skill => (
            <article key={skill.id} className="desktop-skill-card">
              <div className="desktop-skill-card__head">
                <span className="desktop-skill-icon"><IconSparkles width={16} /></span>
                <div><strong>{skill.name}</strong><code>{skill.relativePath}</code></div>
                <span className="desktop-skill-badges">
                  <span className={`desktop-skill-scope is-${skill.scope}`}>{t(scopeKeys[skill.scope])}</span>
                  {skill.readOnly && <span className="desktop-skill-readonly">{t("skills.readOnly")}</span>}
                </span>
              </div>
              <p>{skill.description || t("skills.noDescription")}</p>
              <div className="desktop-skill-card__foot">
                <time>{t("skills.updated", { date: formatWhen(skill.updatedAt) })}</time>
                <span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void openSkill(skill); }}>
                    <IconEdit width={13} /> {skill.readOnly ? t("skills.view") : t("skills.edit")}
                  </button>
                  {!skill.readOnly && (
                    <button type="button" className="btn-icon btn-icon-danger" disabled={busy} onClick={() => { void removeSkill(skill); }} aria-label={t("common.remove")}>
                      <IconTrash width={13} />
                    </button>
                  )}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {editor && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-skill-editor-title" onClick={() => !busy && setEditor(null)}>
          <div className="modal-card desktop-skill-editor" onClick={event => event.stopPropagation()}>
            <div className="desktop-skill-editor__head">
              <div>
                <h3 id="desktop-skill-editor-title">{t(editor.mode === "create" ? "skills.createTitle" : editor.mode === "view" ? "skills.viewTitle" : "skills.editTitle")}</h3>
                <p>{t(editor.mode === "view" ? "skills.readOnlyHint" : "skills.editorHint")}</p>
              </div>
            </div>
            {editor.mode === "create" && (
              <>
                <label className="desktop-field">
                  <span>{t("skills.location")}</span>
                  <select className="input mono" value={editor.locationId ?? ""} onChange={event => setEditor(current => current ? { ...current, locationId: event.target.value } : current)}>
                    {(resource.data?.locations ?? []).map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
                  </select>
                  <small>{t("skills.locationHint")}</small>
                </label>
                <label className="desktop-field">
                  <span>{t("skills.folderName")}</span>
                  <input className="input mono" value={editor.name} onChange={event => setEditor(current => current ? { ...current, name: event.target.value.toLocaleLowerCase() } : current)} placeholder={t("skills.folderPlaceholder")} />
                  <small>{t("skills.folderHint")}</small>
                </label>
              </>
            )}
            <label className="desktop-field desktop-skill-content-field">
              <span>{t("skills.content")}</span>
              <textarea className="input mono" value={editor.content} readOnly={editor.mode === "view"} onChange={event => setEditor(current => current ? { ...current, content: event.target.value } : current)} spellCheck={false} />
            </label>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditor(null)}>{t("common.close")}</button>
              {editor.mode !== "view" && (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void saveSkill(); }}>
                  {busy ? t("common.saving") : t("common.save")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
