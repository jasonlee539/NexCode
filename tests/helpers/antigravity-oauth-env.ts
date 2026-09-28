/** Dummy client metadata for tests that stub every Google OAuth HTTP request. */
export function installAntigravityTestClient(): () => void {
  const keys = ["GOOGLE_ANTIGRAVITY_CLIENT_ID", "GOOGLE_ANTIGRAVITY_CLIENT_SECRET"] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.GOOGLE_ANTIGRAVITY_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_ANTIGRAVITY_CLIENT_SECRET = "test-client-secret";
  return () => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  };
}
