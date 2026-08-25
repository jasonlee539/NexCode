import { join } from "node:path";
import { readFileSync } from "node:fs";
import { getConfigDir } from "../config";

export function serviceApiTokenFilePath(): string {
  return join(getConfigDir(), "service-api-token");
}

/**
 * App-side service token loading (WinSW native mode has no batch wrapper to read the
 * token file into the environment). Pure: returns the token or null — the CALLER
 * assigns it to process.env.NEXCODE_API_AUTH_TOKEN. Loads only when the env token
 * is empty and NXC_API_TOKEN_FILE names a readable file.
 */
export function loadServiceTokenFromFile(env: Record<string, string | undefined>): string | null {
  if (env.NEXCODE_API_AUTH_TOKEN?.trim()) return null;
  const file = env.NXC_API_TOKEN_FILE?.trim();
  if (!file) return null;
  try {
    const token = readFileSync(file, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
}
