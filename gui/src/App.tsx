import { useEffect, useRef, useState } from "react";
import { useKeyedClientResource } from "./client-resource";
import ErrorBoundary from "./components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import CodexAuth from "./pages/CodexAuth";
import Threads from "./pages/Threads";
import DesktopUsage from "./pages/DesktopUsage";
import Skills from "./pages/Skills";
import Maintenance from "./pages/Maintenance";
import Settings from "./pages/Settings";
import {
  IconActivity,
  IconGrid,
  IconKey,
  IconMenu,
  IconMessageSquare,
  IconSettings,
  IconSparkles,
  IconWrench,
  IconX,
} from "./icons";
import { useI18n, type TKey } from "./i18n/shared";
import { installApiAuthFetch } from "./api";
import { type Page } from "./app-routing";
import { useAppRouteState } from "./use-app-route-state";

installApiAuthFetch();

const API_BASE = import.meta.env.VITE_API_BASE || "";

const PAGE_TKEY: Record<Page, TKey> = {
  dashboard: "nav.dashboard",
  "codex-auth": "nav.codexAuth",
  threads: "nav.threads",
  usage: "nav.usage",
  skills: "nav.skills",
  maintenance: "nav.maintenance",
  settings: "nav.settings",
};

type NavEntry = {
  id: Page;
  tkey: TKey;
  Icon: typeof IconGrid;
};

const NAV: NavEntry[] = [
  { id: "dashboard", tkey: "nav.dashboard", Icon: IconGrid },
  { id: "codex-auth", tkey: "nav.codexAuth", Icon: IconKey },
  { id: "threads", tkey: "nav.threads", Icon: IconMessageSquare },
  { id: "usage", tkey: "nav.usage", Icon: IconActivity },
  { id: "skills", tkey: "nav.skills", Icon: IconSparkles },
  { id: "maintenance", tkey: "nav.maintenance", Icon: IconWrench },
  { id: "settings", tkey: "nav.settings", Icon: IconSettings },
];

function readRuntimeVersion(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("version" in data)) return null;
  const version = (data as { version?: unknown }).version;
  return typeof version === "string" && version.length > 0 ? version : null;
}

export default function App() {
  const { page, navigateToPage } = useAppRouteState();
  const { t } = useI18n();
  const [navOpen, setNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const close = () => setNavOpen(false);
    window.addEventListener("hashchange", close);
    window.addEventListener("popstate", close);
    return () => {
      window.removeEventListener("hashchange", close);
      window.removeEventListener("popstate", close);
    };
  }, []);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const health = useKeyedClientResource(
    `desktop-health:${API_BASE}`,
    [API_BASE],
    async signal => {
      const response = await fetch(`${API_BASE}/healthz`, { signal });
      if (!response.ok) return null;
      return readRuntimeVersion(await response.json());
    },
    { pollMs: 30_000 },
  );

  const displayedVersion = health.data ?? __APP_VERSION__;
  const CurrentIcon = NAV.find(entry => entry.id === page)?.Icon ?? IconGrid;

  const brand = (
    <div className="brand">
      <span className="brand-logo" role="img" aria-label={t("app.logoAria")} />
      <span className="name">NexCode</span>
    </div>
  );

  return (
    <div className="app app--desktop">
      <header className="mobile-topbar" inert={navOpen}>
        <button
          ref={menuButtonRef}
          type="button"
          className="menu-toggle"
          onClick={() => setNavOpen(open => !open)}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          aria-label={t(navOpen ? "nav.closeMenu" : "nav.openMenu")}
        >
          <IconMenu />
        </button>
        {brand}
      </header>

      {navOpen && <button type="button" className="drawer-scrim" onClick={() => setNavOpen(false)} aria-label={t("nav.closeMenu")} />}

      <aside id="app-sidebar" className={`sidebar${navOpen ? " open" : ""}`} ref={sidebarRef} tabIndex={-1}>
        <div className="drawer-head">
          {brand}
          <button type="button" className="menu-toggle drawer-close" onClick={() => setNavOpen(false)} aria-label={t("nav.closeMenu")}>
            <IconX />
          </button>
        </div>
        <nav aria-label={t("desktop.primaryNav")}>
          {NAV.map(({ id, tkey, Icon }) => {
            const active = id === page;
            return (
              <div key={id} className={`nav-entry${id === "settings" ? " nav-entry--settings" : ""}`}>
                <button
                  type="button"
                  className={`nav-item${active ? " active" : ""}`}
                  onClick={() => {
                    navigateToPage(id);
                    setNavOpen(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  aria-label={t(tkey)}
                  title={t(tkey)}
                >
                  <Icon />
                  <span className="nav-label">{t(tkey)}</span>
                </button>
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="main" inert={navOpen}>
        <header className="desktop-titlebar">
          <div className="desktop-titlebar__title">
            <CurrentIcon aria-hidden />
            <span>{t(PAGE_TKEY[page])}</span>
          </div>
          <div className="desktop-titlebar__status" aria-label={t("dash.status")}>
            <span className={`dot ${health.data ? "dot-green" : "dot-amber"}`} aria-hidden />
            <span>{health.data ? t("dash.online") : t("common.loading")}</span>
            <span className="desktop-titlebar__version">v{displayedVersion}</span>
          </div>
        </header>

        <div className="main-inner">
          <ErrorBoundary
            key={page}
            pageName={t(PAGE_TKEY[page])}
            title={t("errorBoundary.title")}
            message={t("errorBoundary.message")}
            detailsLabel={t("errorBoundary.details")}
            reloadLabel={t("errorBoundary.reload")}
          >
            {page === "dashboard" && <Dashboard apiBase={API_BASE} simple />}
            {page === "codex-auth" && <CodexAuth apiBase={API_BASE} simple />}
            {page === "threads" && <Threads apiBase={API_BASE} />}
            {page === "usage" && <DesktopUsage apiBase={API_BASE} />}
            {page === "skills" && <Skills apiBase={API_BASE} />}
            {page === "maintenance" && <Maintenance apiBase={API_BASE} />}
            {page === "settings" && <Settings apiBase={API_BASE} />}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
