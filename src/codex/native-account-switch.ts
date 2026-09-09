import { atomicWriteFileAsync } from "../config";
import { extractAccountId, extractEmail } from "../oauth/chatgpt";
import type { CodexAccountCredentials, NxcConfig } from "../types";
import { applyConfirmedMainCodexAccountTransition } from "./account-lifecycle";
import { getCodexAccountCredential } from "./account-store";
import { withNativeMainExclusiveClaim } from "./native-main-claim";
import { probeNativeCodexProcesses, type NativeCodexProcessProbe } from "./native-profile-processes";
import {
  parseNativeEnvelopeBytes,
  probeNativeProfileRecoveryState,
  readNativeEnvelope,
  readNativeProfileVault,
  requireFileCredentialStore,
  resolveNativeProfileContext,
  type NativeEnvelopeSnapshot,
  type NativeProfileContext,
} from "./native-profile-store";
import { NativeProfileError } from "./native-profile-types";
import { extractChatgptPlanType } from "./plan";

export interface NativeAccountCredentialSnapshot {
  accountId: string;
  email?: string;
  plan?: string;
  credential: CodexAccountCredentials;
}

interface NativeAccountSwitchDeps {
  resolveContext: () => NativeProfileContext;
  processProbe: () => Promise<NativeCodexProcessProbe>;
  readEnvelope: (path: string) => NativeEnvelopeSnapshot;
  atomicWrite: (path: string, content: string) => Promise<void>;
  applyTransition: (fromAccountId: string, toAccountId: string) => void;
  now: () => number;
}

const defaultDeps: NativeAccountSwitchDeps = {
  resolveContext: () => resolveNativeProfileContext(),
  processProbe: () => probeNativeCodexProcesses(),
  readEnvelope: readNativeEnvelope,
  atomicWrite: atomicWriteFileAsync,
  applyTransition: (from, to) => { applyConfirmedMainCodexAccountTransition(from, to); },
  now: Date.now,
};

function tokenExpiryMs(idToken: string, accessToken: string, now: number): number {
  for (const token of [accessToken, idToken]) {
    const payload = token.split(".")[1];
    if (!payload) continue;
    try {
      const exp = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown }).exp;
      if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) return exp * 1000;
    } catch { /* use a conservative fallback below */ }
  }
  return now + 60 * 60_000;
}

function credentialSnapshot(envelope: NativeEnvelopeSnapshot, now: number): NativeAccountCredentialSnapshot {
  const parsed = JSON.parse(envelope.text.replace(/^\uFEFF/, "")) as {
    tokens: {
      id_token: string;
      access_token: string;
      refresh_token: string;
      account_id?: string;
    };
  };
  const tokens = parsed.tokens;
  return {
    accountId: envelope.accountId,
    ...(extractEmail(tokens.id_token, tokens.access_token) ? {
      email: extractEmail(tokens.id_token, tokens.access_token),
    } : {}),
    ...(extractChatgptPlanType(tokens.id_token, tokens.access_token) ? {
      plan: extractChatgptPlanType(tokens.id_token, tokens.access_token),
    } : {}),
    credential: {
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokenExpiryMs(tokens.id_token, tokens.access_token, now),
      chatgptAccountId: envelope.accountId,
    },
  };
}

function nativeEnvelopeText(credential: CodexAccountCredentials, now: number): string {
  if (!credential.accessToken || !credential.refreshToken || !credential.chatgptAccountId) {
    throw new NativeProfileError(
      "AUTH_INVALID",
      "The selected account credential is incomplete; reauthenticate it before switching.",
      409,
    );
  }
  // Older NexCode pool records did not retain id_token. The access token carries
  // the same account identity and is accepted as the compatibility identity
  // envelope; every newly added/refreshed account keeps the real id_token.
  const idToken = credential.idToken || credential.accessToken;
  const text = JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: idToken,
      access_token: credential.accessToken,
      refresh_token: credential.refreshToken,
      account_id: credential.chatgptAccountId,
    },
    last_refresh: new Date(now).toISOString(),
  }, null, 2) + "\n";
  const raw = Buffer.from(text, "utf8");
  try {
    const parsed = parseNativeEnvelopeBytes(raw);
    if (parsed.accountId !== credential.chatgptAccountId) {
      throw new NativeProfileError("AUTH_INVALID", "The selected account credential identity does not match.", 409);
    }
  } finally {
    raw.fill(0);
  }
  return text;
}

/** Return the pool row that represents the physical Codex login, if any. */
export function activeNativePoolAccountId(config: Pick<NxcConfig, "codexAccounts">): string | null {
  const tokens = (() => {
    try {
      const envelope = readNativeEnvelope(resolveNativeProfileContext().authPath);
      try { return envelope.accountId; } finally { envelope.raw.fill(0); }
    } catch { return null; }
  })();
  if (!tokens) return null;
  for (const account of config.codexAccounts ?? []) {
    if (account.isMain) continue;
    const credential = getCodexAccountCredential(account.id);
    if (credential?.chatgptAccountId === tokens) return account.id;
  }
  return null;
}

/**
 * Replace Codex's physical auth.json login. The previous native login is
 * durably captured by the caller before the atomic replacement, so switching
 * never strands the account that was active before the operation.
 */
export async function switchNativeCodexAccount(
  targetCredential: CodexAccountCredentials,
  persistSource: (source: NativeAccountCredentialSnapshot) => void,
  deps: NativeAccountSwitchDeps = defaultDeps,
): Promise<{ changed: boolean; accountId: string }> {
  const context = deps.resolveContext();
  requireFileCredentialStore(context);
  return withNativeMainExclusiveClaim(context, async () => {
    const recovery = probeNativeProfileRecoveryState(context);
    if (recovery !== "none") {
      throw new NativeProfileError(
        "RECOVERY_REQUIRED",
        "A native-profile recovery is pending; recover it before switching the Codex login.",
        409,
      );
    }
    if (readNativeProfileVault(context)) {
      throw new NativeProfileError(
        "INVALID_REQUEST",
        "Encrypted native profiles already manage this Codex login; switch it with `nxc account main switch`.",
        409,
      );
    }
    const processes = await deps.processProbe();
    if (processes.status === "busy") {
      throw new NativeProfileError(
        "CODEX_BUSY",
        `Close the ${processes.count} running Codex process${processes.count === 1 ? "" : "es"} before switching accounts.`,
        409,
        true,
      );
    }
    if (processes.status === "unknown") {
      throw new NativeProfileError(
        "CODEX_PROCESS_CHECK_UNAVAILABLE",
        "Codex process state could not be verified; no account was changed.",
        503,
        true,
      );
    }

    const source = deps.readEnvelope(context.authPath);
    try {
      if (source.accountId === targetCredential.chatgptAccountId) {
        return { changed: false, accountId: targetCredential.chatgptAccountId };
      }
      persistSource(credentialSnapshot(source, deps.now()));
      const targetText = nativeEnvelopeText(targetCredential, deps.now());
      try {
        await deps.atomicWrite(context.authPath, targetText);
        const observed = deps.readEnvelope(context.authPath);
        try {
          if (observed.accountId !== targetCredential.chatgptAccountId) throw new Error("identity mismatch");
        } finally {
          observed.raw.fill(0);
        }
      } catch (error) {
        try {
          await deps.atomicWrite(context.authPath, source.text);
        } catch {
          throw new NativeProfileError(
            "AUTH_RESTORE_FAILED",
            "The Codex login switch failed and the previous login could not be restored.",
            500,
          );
        }
        if (error instanceof NativeProfileError) throw error;
        throw new NativeProfileError(
          "SWITCH_ROLLED_BACK",
          "The Codex login switch failed; the previous login was restored.",
          409,
          true,
        );
      }
      deps.applyTransition(source.accountId, targetCredential.chatgptAccountId);
      return { changed: true, accountId: targetCredential.chatgptAccountId };
    } finally {
      source.raw.fill(0);
    }
  }, { waitMs: 5_000 });
}
