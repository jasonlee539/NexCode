import { createHash } from "node:crypto";
import { join } from "node:path";
import { atomicWriteFileAsync } from "../config";
import type { CodexAccountCredentialRecord, CodexAccountCredentials } from "../types";
import { markNativeProfileCredentialGeneration, readCodexAccountRecord } from "./account-store";
import { MAIN_CODEX_ACCOUNT_ID } from "./account-id";
import { NativeProfileManager } from "./native-profile-manager";
import { NativeProfileError, type NativeProfilePublic } from "./native-profile-types";

const MANAGED_POOL_LABEL_PREFIX = "nxc-pool-";
const MANAGED_MAIN_LABEL = "nxc-original-login";

interface ManagedProfileManager {
  list(): Promise<{ activeProfileId: string | null; profiles: NativeProfilePublic[] }>;
  register(label: string): Promise<{ profile: NativeProfilePublic }>;
  prepareStage(): Promise<{
    stageId: string;
    writerToken: string;
    stagingCodexHome: string;
  }>;
  finishStage(stageId: string, writerToken: string, label: string): Promise<{ profile: NativeProfilePublic }>;
  cancelStage(stageId: string, writerToken: string): Promise<unknown>;
  replaceInactive(target: string, content: string): Promise<{ profile: NativeProfilePublic }>;
  replaceActive(
    target: string,
    content: string,
    confirmedStopped?: boolean,
  ): Promise<{ profile: NativeProfilePublic; restartRequired: true }>;
  switch(target: string, confirmedStopped?: boolean): Promise<Record<string, unknown>>;
}

export interface ManagedAccountSwitchDeps {
  manager?: ManagedProfileManager;
  getCredentialRecord?: (accountId: string) => CodexAccountCredentialRecord | null;
  markCredentialGeneration?: (accountId: string, generation: number) => boolean;
  writeAuthFile?: (path: string, content: string) => Promise<void>;
}

export function managedPoolProfileLabel(accountId: string): string {
  const digest = createHash("sha256").update(`nexcode-codex-account:${accountId}`).digest("hex");
  return `${MANAGED_POOL_LABEL_PREFIX}${digest.slice(0, 32)}`;
}

function nativeAuthEnvelope(credential: CodexAccountCredentials): string {
  if (!credential.idToken) {
    throw new NativeProfileError(
      "AUTH_INVALID",
      "This account was added by an older NexCode version. Reauthenticate it once before switching.",
      409,
    );
  }
  return `${JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: credential.idToken,
      access_token: credential.accessToken,
      refresh_token: credential.refreshToken,
      account_id: credential.chatgptAccountId,
    },
    last_refresh: new Date().toISOString(),
  }, null, 2)}\n`;
}

function originalProfile(profiles: readonly NativeProfilePublic[]): NativeProfilePublic | null {
  const explicit = profiles.find(profile => profile.label === MANAGED_MAIN_LABEL);
  if (explicit) return explicit;
  const unmanaged = profiles.filter(profile => !profile.label.startsWith(MANAGED_POOL_LABEL_PREFIX));
  if (unmanaged.length === 1) return unmanaged[0] ?? null;
  if (profiles.length === 0) return null;
  throw new NativeProfileError(
    "VAULT_INVALID",
    "NexCode cannot identify the original Codex login among multiple native profiles.",
    409,
  );
}

/**
 * Materialize a pool credential into the encrypted native-profile vault, then
 * atomically replace the canonical CODEX_HOME/auth.json. Configuration state is
 * changed by the caller only after this operation succeeds.
 */
export async function switchManagedCodexAccount(
  accountId: string,
  confirmedStopped: boolean,
  deps: ManagedAccountSwitchDeps = {},
): Promise<Record<string, unknown>> {
  const manager = deps.manager ?? new NativeProfileManager();
  const getCredentialRecord = deps.getCredentialRecord ?? readCodexAccountRecord;
  const markCredentialGeneration = deps.markCredentialGeneration ?? markNativeProfileCredentialGeneration;
  const writeAuthFile = deps.writeAuthFile ?? atomicWriteFileAsync;
  const noteMaterializedGeneration = (id: string, generation: number): boolean => {
    try { return markCredentialGeneration(id, generation); } catch { return false; }
  };
  const requireMaterializedGeneration = (id: string, generation: number): void => {
    if (noteMaterializedGeneration(id, generation)) return;
    throw new NativeProfileError(
      "CREDENTIAL_CHANGED",
      "The selected account credential changed during the native switch; retry the switch.",
      409,
      true,
    );
  };

  let listing = await manager.list();
  if (listing.profiles.length === 0) {
    await manager.register(MANAGED_MAIN_LABEL);
    listing = await manager.list();
  }

  let target = accountId === MAIN_CODEX_ACCOUNT_ID
    ? originalProfile(listing.profiles)
    : listing.profiles.find(profile => profile.label === managedPoolProfileLabel(accountId)) ?? null;
  const targetWasRegistered = target !== null;

  const credentialRecord = accountId === MAIN_CODEX_ACCOUNT_ID ? null : getCredentialRecord(accountId);
  const credential = credentialRecord?.credential ?? null;
  if (!target && accountId !== MAIN_CODEX_ACCOUNT_ID) {
    if (!credential) {
      throw new NativeProfileError("AUTH_MISSING", "The selected Codex account has no stored credential.", 409);
    }
    const stage = await manager.prepareStage();
    try {
      await writeAuthFile(join(stage.stagingCodexHome, "auth.json"), nativeAuthEnvelope(credential));
      target = (await manager.finishStage(
        stage.stageId,
        stage.writerToken,
        managedPoolProfileLabel(accountId),
      )).profile;
      if (credentialRecord) requireMaterializedGeneration(accountId, credentialRecord.generation);
    } catch (error) {
      try { await manager.cancelStage(stage.stageId, stage.writerToken); } catch { /* finish may already own cleanup */ }
      throw error;
    }
  }

  // The vault captures Codex's own token refreshes whenever a profile switches
  // out. Replace that payload only when the pool credential has advanced since
  // it was last materialized, otherwise a stale pool copy could roll it back.
  const credentialAdvanced = credential
    && credentialRecord?.nativeProfileCredentialGeneration !== credentialRecord?.generation;
  if (
    targetWasRegistered
    && target?.state === "inactive"
    && credentialAdvanced
  ) {
    target = (await manager.replaceInactive(target.id, nativeAuthEnvelope(credential))).profile;
    if (credentialRecord) requireMaterializedGeneration(accountId, credentialRecord.generation);
  }

  if (!target) {
    throw new NativeProfileError("PROFILE_NOT_FOUND", "The original Codex login is not registered.", 404);
  }
  if (target.state === "active") {
    if (targetWasRegistered && credentialAdvanced) {
      const refreshed = await manager.replaceActive(target.id, nativeAuthEnvelope(credential), confirmedStopped);
      // The physical active login is already correct at this point. A concurrent
      // newer pool generation is left unmarked so the next confirmed switch
      // materializes it; it must not turn this completed switch into a UI failure.
      if (credentialRecord) noteMaterializedGeneration(accountId, credentialRecord.generation);
      return { ok: true, activeProfile: refreshed.profile, restartRequired: true };
    }
    return { ok: true, activeProfile: target, restartRequired: false };
  }
  return manager.switch(target.id, confirmedStopped);
}
