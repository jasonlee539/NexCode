export type DesktopAppEnvironment = {
  search?: string;
  userAgent?: string;
};

/** Detect the bundled macOS client without coupling the browser dashboard to it. */
export function isNexCodeDesktopApp(environment?: DesktopAppEnvironment): boolean {
  const search = environment?.search
    ?? (typeof window !== "undefined" ? window.location.search : "");
  const userAgent = environment?.userAgent
    ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return new URLSearchParams(search).get("desktop") === "1"
    || /(?:^|\s)NexCode\/\d/i.test(userAgent);
}

/** Detect a packaged desktop edition that owns the native Codex login. */
export function isNexCodeNativeAccountApp(environment?: DesktopAppEnvironment): boolean {
  const search = environment?.search
    ?? (typeof window !== "undefined" ? window.location.search : "");
  const platform = new URLSearchParams(search).get("platform");
  return isNexCodeDesktopApp(environment)
    && (platform === "ubuntu" || platform === "macos");
}
