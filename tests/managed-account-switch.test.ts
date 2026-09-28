import { describe, expect, test } from "bun:test";
import { NativeProfileError, type NativeProfilePublic } from "../src/codex/native-profile-types";
import {
  managedPoolProfileLabel,
  switchManagedCodexAccount,
} from "../src/codex/managed-account-switch";

function fakeManager() {
  let profiles: NativeProfilePublic[] = [];
  let activeProfileId: string | null = null;
  let switchedTo: string | null = null;
  let cancelled = 0;
  let replaced = 0;
  let activeReplaced = 0;
  const markedGenerations: number[] = [];
  return {
    manager: {
      async list() { return { activeProfileId, profiles: profiles.map(profile => ({ ...profile })) }; },
      async register(label: string) {
        const profile: NativeProfilePublic = { id: "main-id", label, identityHint: "main", state: "active" };
        profiles = [profile];
        activeProfileId = profile.id;
        return { profile };
      },
      async prepareStage() {
        return { stageId: "stage", writerToken: "writer", stagingCodexHome: "C:/stage" };
      },
      async finishStage(_stageId: string, _writerToken: string, label: string) {
        const profile: NativeProfilePublic = { id: "pool-id", label, identityHint: "pool", state: "inactive" };
        profiles.push(profile);
        return { profile };
      },
      async cancelStage() { cancelled += 1; },
      async replaceInactive(target: string) {
        replaced += 1;
        const profile = profiles.find(item => item.id === target)!;
        return { profile };
      },
      async replaceActive(target: string) {
        activeReplaced += 1;
        const profile = profiles.find(item => item.id === target)!;
        return { profile, restartRequired: true as const };
      },
      async switch(target: string) {
        switchedTo = target;
        profiles = profiles.map(profile => ({
          ...profile,
          state: profile.id === target ? "active" : "inactive",
        }));
        activeProfileId = target;
        return { ok: true, restartRequired: true };
      },
    },
    switchedTo: () => switchedTo,
    cancelled: () => cancelled,
    replaced: () => replaced,
    activeReplaced: () => activeReplaced,
    markedGenerations,
  };
}

describe("managed Codex account switching", () => {
  test("imports the complete OAuth envelope and performs a physical profile switch", async () => {
    const fake = fakeManager();
    let writtenPath = "";
    let written = "";
    const result = await switchManagedCodexAccount("account-a", true, {
      manager: fake.manager,
      getCredentialRecord: () => ({
        generation: 1,
        credential: {
          idToken: "id-secret",
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
          expiresAt: Date.now() + 60_000,
          chatgptAccountId: "chatgpt-account-a",
        },
      }),
      markCredentialGeneration: (_id, generation) => {
        fake.markedGenerations.push(generation);
        return true;
      },
      writeAuthFile: async (path, content) => {
        writtenPath = path;
        written = content;
      },
    });

    expect(result.ok).toBe(true);
    expect(fake.switchedTo()).toBe("pool-id");
    expect(fake.markedGenerations).toEqual([1]);
    expect(writtenPath.replaceAll("\\", "/")).toEndWith("/stage/auth.json");
    expect(JSON.parse(written)).toEqual({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "id-secret",
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        account_id: "chatgpt-account-a",
      },
      last_refresh: expect.any(String),
    });
  });

  test("legacy credentials fail without pretending the UI selection changed", async () => {
    const fake = fakeManager();
    await expect(switchManagedCodexAccount("legacy", true, {
      manager: fake.manager,
      getCredentialRecord: () => ({
        generation: 1,
        credential: {
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
          expiresAt: Date.now() + 60_000,
          chatgptAccountId: "legacy-account",
        },
      }),
      writeAuthFile: async () => {},
    })).rejects.toMatchObject<Partial<NativeProfileError>>({ code: "AUTH_INVALID" });
    expect(fake.switchedTo()).toBeNull();
    expect(fake.cancelled()).toBe(1);
  });

  test("uses a stable opaque profile label instead of persisting the account id as a label", () => {
    expect(managedPoolProfileLabel("account-a")).toMatch(/^nxc-pool-[a-f0-9]{32}$/);
    expect(managedPoolProfileLabel("account-a")).not.toContain("account-a");
  });

  test("refreshes an existing inactive native profile before switching it", async () => {
    const fake = fakeManager();
    await fake.manager.register("nxc-original-login");
    await fake.manager.finishStage("stage", "writer", managedPoolProfileLabel("account-a"));

    await switchManagedCodexAccount("account-a", true, {
      manager: fake.manager,
      getCredentialRecord: () => ({
        generation: 2,
        nativeProfileCredentialGeneration: 1,
        credential: {
          idToken: "new-id-secret",
          accessToken: "new-access-secret",
          refreshToken: "new-refresh-secret",
          expiresAt: Date.now() + 60_000,
          chatgptAccountId: "chatgpt-account-a",
        },
      }),
      markCredentialGeneration: (_id, generation) => {
        fake.markedGenerations.push(generation);
        return true;
      },
    });

    expect(fake.replaced()).toBe(1);
    expect(fake.switchedTo()).toBe("pool-id");
    expect(fake.markedGenerations).toEqual([2]);
  });

  test("preserves Codex-refreshed vault credentials when the pool generation is unchanged", async () => {
    const fake = fakeManager();
    await fake.manager.register("nxc-original-login");
    await fake.manager.finishStage("stage", "writer", managedPoolProfileLabel("account-a"));

    await switchManagedCodexAccount("account-a", true, {
      manager: fake.manager,
      getCredentialRecord: () => ({
        generation: 2,
        nativeProfileCredentialGeneration: 2,
        credential: {
          idToken: "pool-id-secret",
          accessToken: "pool-access-secret",
          refreshToken: "pool-refresh-secret",
          expiresAt: Date.now() + 60_000,
          chatgptAccountId: "chatgpt-account-a",
        },
      }),
    });

    expect(fake.replaced()).toBe(0);
    expect(fake.switchedTo()).toBe("pool-id");
  });

  test("materializes a reauthenticated credential when its native profile is already active", async () => {
    const fake = fakeManager();
    await fake.manager.register("nxc-original-login");
    await fake.manager.finishStage("stage", "writer", managedPoolProfileLabel("account-a"));
    await fake.manager.switch("pool-id");

    const result = await switchManagedCodexAccount("account-a", true, {
      manager: fake.manager,
      getCredentialRecord: () => ({
        generation: 3,
        nativeProfileCredentialGeneration: 2,
        credential: {
          idToken: "reauth-id-secret",
          accessToken: "reauth-access-secret",
          refreshToken: "reauth-refresh-secret",
          expiresAt: Date.now() + 60_000,
          chatgptAccountId: "chatgpt-account-a",
        },
      }),
      markCredentialGeneration: (_id, generation) => {
        fake.markedGenerations.push(generation);
        return true;
      },
    });

    expect(result.restartRequired).toBe(true);
    expect(fake.activeReplaced()).toBe(1);
    expect(fake.markedGenerations).toEqual([3]);
  });

  test("does not switch an inactive profile when its pool credential changes mid-materialization", async () => {
    const fake = fakeManager();
    await fake.manager.register("nxc-original-login");
    await fake.manager.finishStage("stage", "writer", managedPoolProfileLabel("account-a"));

    await expect(switchManagedCodexAccount("account-a", true, {
      manager: fake.manager,
      getCredentialRecord: () => ({
        generation: 4,
        nativeProfileCredentialGeneration: 3,
        credential: {
          idToken: "changing-id-secret",
          accessToken: "changing-access-secret",
          refreshToken: "changing-refresh-secret",
          expiresAt: Date.now() + 60_000,
          chatgptAccountId: "chatgpt-account-a",
        },
      }),
      markCredentialGeneration: () => false,
    })).rejects.toMatchObject<Partial<NativeProfileError>>({ code: "CREDENTIAL_CHANGED", retryable: true });

    expect(fake.switchedTo()).toBeNull();
  });
});
