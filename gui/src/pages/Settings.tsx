import { useCallback, useEffect, useState } from "react";
import type { AppTheme } from "../App";
import { IconGlobe, IconInfo, IconKey, IconMonitor } from "../icons";
import { LOCALES, localeDisplayName, useI18n, type Locale } from "../i18n/shared";
import { Select, Switch } from "../ui";

interface DesktopSettingsState {
  codexAutoStart: boolean;
  codexAccountPickerEnabled: boolean;
  requestUserInput: boolean;
  codexRuntimeVersion: string | null;
}

export default function Settings({
  apiBase,
  theme,
  onThemeChange,
}: {
  apiBase: string;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const [settings, setSettings] = useState<DesktopSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<keyof DesktopSettingsState | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResponse, featureResponse] = await Promise.all([
        fetch(`${apiBase}/api/settings`),
        fetch(`${apiBase}/api/codex-auth/features/default-mode-request-user-input`),
      ]);
      if (!settingsResponse.ok || !featureResponse.ok) throw new Error();
      const base = await settingsResponse.json() as {
        codexAutoStart?: unknown;
        codexAccountPickerEnabled?: unknown;
        codexRuntime?: { version?: unknown };
      };
      const feature = await featureResponse.json() as { enabled?: unknown };
      setSettings({
        codexAutoStart: base.codexAutoStart === true,
        codexAccountPickerEnabled: base.codexAccountPickerEnabled === true,
        requestUserInput: feature.enabled === true,
        codexRuntimeVersion: typeof base.codexRuntime?.version === "string" ? base.codexRuntime.version : null,
      });
      setFeedback(null);
    } catch {
      setFeedback({ tone: "err", text: t("settings.loadFailed") });
    } finally {
      setLoading(false);
    }
  }, [apiBase, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const updateBaseSetting = async (
    field: "codexAutoStart" | "codexAccountPickerEnabled",
    value: boolean,
  ) => {
    if (!settings || saving) return;
    const previous = settings;
    setSaving(field);
    setSettings({ ...settings, [field]: value });
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: unknown };
      if (!response.ok || payload.ok !== true) throw new Error();
      setFeedback({ tone: "ok", text: t("settings.saved") });
    } catch {
      setSettings(previous);
      setFeedback({ tone: "err", text: t("settings.saveFailed") });
    } finally {
      setSaving(null);
    }
  };

  const updateRequestInput = async (value: boolean) => {
    if (!settings || saving) return;
    const previous = settings;
    setSaving("requestUserInput");
    setSettings({ ...settings, requestUserInput: value });
    setFeedback(null);
    try {
      const response = await fetch(`${apiBase}/api/codex-auth/features/default-mode-request-user-input`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: value }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: unknown };
      if (!response.ok || payload.ok !== true) throw new Error();
      setFeedback({ tone: "ok", text: t("settings.savedRestart") });
    } catch {
      setSettings(previous);
      setFeedback({ tone: "err", text: t("settings.saveFailed") });
    } finally {
      setSaving(null);
    }
  };

  const themeOptions: Array<{ value: AppTheme; label: string }> = [
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
    { value: "system", label: t("theme.system") },
  ];

  return (
    <div className="desktop-settings-page">
      <div className="desktop-section-toolbar">
        <div><h2>{t("nav.settings")}</h2><p>{t("settings.subtitle")}</p></div>
      </div>

      {feedback && <div className={`desktop-inline-status is-${feedback.tone}`} role="status">{feedback.text}</div>}

      <div className="desktop-settings-columns">
        <section className="desktop-settings-group">
          <div className="desktop-settings-group__title"><IconMonitor aria-hidden /><span><strong>{t("settings.appearance")}</strong><small>{t("settings.appearanceDesc")}</small></span></div>
          <div className="desktop-setting-row">
            <div><strong>{t("theme.label")}</strong><small>{t("settings.themeDesc")}</small></div>
            <div className="desktop-theme-segments" role="radiogroup" aria-label={t("theme.label")}>
              {themeOptions.map(option => (
                <button key={option.value} type="button" role="radio" aria-checked={theme === option.value} className={theme === option.value ? "is-active" : ""} onClick={() => onThemeChange(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="desktop-setting-row">
            <div><strong>{t("lang.label")}</strong><small>{t("settings.languageDesc")}</small></div>
            <Select
              value={locale}
              options={LOCALES.map(item => ({ value: item.code, label: localeDisplayName(item.code) }))}
              onChange={value => setLocale(value as Locale)}
              label={t("lang.label")}
              align="right"
              style={{ width: 148 }}
            />
          </div>
        </section>

        <section className="desktop-settings-group desktop-settings-group--codex">
          <div className="desktop-settings-group__title"><IconKey aria-hidden /><span><strong>{t("settings.codex")}</strong><small>{t("settings.codexDesc")}</small></span></div>
          {loading && !settings ? (
            <div className="desktop-settings-loading">{t("common.loading")}</div>
          ) : settings ? (
            <>
              <div className="desktop-setting-row">
                <div><strong>{t("settings.autoStart")}</strong><small>{t("settings.autoStartDesc")}</small></div>
                <Switch on={settings.codexAutoStart} disabled={saving !== null} onClick={() => { void updateBaseSetting("codexAutoStart", !settings.codexAutoStart); }} label={t("settings.autoStart")} />
              </div>
              <div className="desktop-setting-row">
                <div><strong>{t("settings.accountPicker")}</strong><small>{t("settings.accountPickerDesc")}</small></div>
                <Switch on={settings.codexAccountPickerEnabled} disabled={saving !== null} onClick={() => { void updateBaseSetting("codexAccountPickerEnabled", !settings.codexAccountPickerEnabled); }} label={t("settings.accountPicker")} />
              </div>
              <div className="desktop-setting-row">
                <div><strong>{t("settings.requestInput")}</strong><small>{t("settings.requestInputDesc")}</small></div>
                <Switch on={settings.requestUserInput} disabled={saving !== null} onClick={() => { void updateRequestInput(!settings.requestUserInput); }} label={t("settings.requestInput")} />
              </div>
            </>
          ) : (
            <div className="desktop-page-error"><span>{t("settings.loadFailed")}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => { void load(); }}>{t("common.retry")}</button></div>
          )}
        </section>

        <section className="desktop-settings-group desktop-settings-group--about">
          <div className="desktop-settings-group__title"><IconInfo aria-hidden /><span><strong>{t("settings.about")}</strong><small>{t("settings.aboutDesc")}</small></span></div>
          <div className="desktop-setting-row"><div><strong>NexCode</strong><small>{t("settings.scope")}</small></div><code>v{__APP_VERSION__}</code></div>
          <div className="desktop-setting-row"><div><strong>Codex</strong><small>{t("settings.runtime")}</small></div><code>{settings?.codexRuntimeVersion ?? "—"}</code></div>
        </section>

        <section className="desktop-settings-group desktop-settings-group--language-note">
          <div className="desktop-settings-group__title"><IconGlobe aria-hidden /><span><strong>{t("settings.localOnly")}</strong><small>{t("settings.localOnlyDesc")}</small></span></div>
        </section>
      </div>
    </div>
  );
}
