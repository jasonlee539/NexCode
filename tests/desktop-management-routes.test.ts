import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import type { NxcConfig } from "../src/types";
import { handleManagementAPI } from "../src/server/management-api";
import {
  handleDesktopRoutes,
  type DesktopRoutesDeps,
} from "../src/server/management/desktop-routes";
import type { ManagementContext } from "../src/server/management/context";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const codexHome = mkdtempSync(join(tmpdir(), "nexcode-desktop-routes-"));
  roots.push(codexHome);
  const stateDbPath = join(codexHome, "state_5.sqlite");
  const db = new Database(stateDbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      cwd TEXT,
      title TEXT,
      tokens_used INTEGER,
      archived INTEGER,
      archived_at INTEGER,
      model TEXT,
      reasoning_effort TEXT,
      preview TEXT,
      name TEXT,
      is_pinned INTEGER
    );
  `);
  const rolloutDir = join(codexHome, "sessions");
  mkdirSync(rolloutDir);
  const rollout = join(rolloutDir, "thread-1.jsonl");
  writeFileSync(rollout, [
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Build the feature" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] } }),
    JSON.stringify({
      timestamp: new Date(1_700_000_100_000).toISOString(),
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 1_000,
            cached_input_tokens: 300,
            output_tokens: 234,
            reasoning_output_tokens: 100,
            total_tokens: 1_234,
          },
        },
      },
    }),
  ].join("\n"));
  db.query(`INSERT INTO threads (
    id, rollout_path, created_at, updated_at, source, cwd, title,
    tokens_used, archived, model, reasoning_effort, preview, is_pinned
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("thread-1", rollout, 1_700_000_000, 1_700_000_100, "cli", "/work/demo", "Desktop thread", 1234, 0, "gpt-5", "high", "Build the feature", 1);
  db.close();
  return { codexHome, stateDbPath };
}

const config = { port: 10100, providers: {} } as NxcConfig;

async function requestDesktop(
  path: string,
  options: RequestInit,
  desktopRoutes: DesktopRoutesDeps,
): Promise<Response> {
  const req = new Request(`http://localhost${path}`, options);
  const ctx: ManagementContext = {
    req,
    url: new URL(req.url),
    config,
    deps: { desktopRoutes },
    convergeCodexCatalog: async () => ({
      status: "unchanged",
      reason: "unchanged",
      phase: "commit",
      retryable: false,
      partialWrite: false,
    }),
    syncClaudeAgentDefsBestEffort: async () => {},
  };
  return (await handleDesktopRoutes(ctx))!;
}

describe("desktop management routes", () => {
  test("lists sanitized Codex threads and exports their conversation as Markdown", async () => {
    const fx = fixture();
    const deps = { codexHome: () => fx.codexHome, userHome: () => fx.codexHome, stateDbPath: () => fx.stateDbPath };
    const list = await requestDesktop("/api/desktop/threads?status=active", {}, deps);
    expect(list.status).toBe(200);
    const payload = await list.json() as { total: number; threads: Array<Record<string, unknown>> };
    expect(payload.total).toBe(1);
    expect(payload.threads[0]?.title).toBe("Desktop thread");
    expect(payload.threads[0]?.rolloutPath).toBeUndefined();
    expect(payload.threads[0]?.updatedAt).toBe(1_700_000_100_000);

    const exported = await requestDesktop("/api/desktop/threads/thread-1/export", {}, deps);
    expect(exported.status).toBe(200);
    const body = await exported.json() as { fileName: string; markdown: string };
    expect(body.fileName).toBe("Desktop-thread.md");
    expect(body.markdown).toContain("## User\n\nBuild the feature");
    expect(body.markdown).toContain("## Assistant\n\nDone.");
  });

  test("reports non-zero local Codex thread tokens for the 30-day dashboard", async () => {
    const fx = fixture();
    const deps = {
      codexHome: () => fx.codexHome,
      userHome: () => fx.codexHome,
      stateDbPath: () => fx.stateDbPath,
      now: () => 1_700_000_100_000,
    };
    const response = await requestDesktop("/api/desktop/overview", {}, deps);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      localTokenUsage30d: { totalTokens: number; threadCount: number; since: number };
    };
    expect(payload.localTokenUsage30d.totalTokens).toBe(1234);
    expect(payload.localTokenUsage30d.threadCount).toBe(1);
    expect(payload.localTokenUsage30d.since).toBeLessThanOrEqual(1_700_000_100_000);
  });

  test("builds 1, 3, 7 and 30 day Token analytics from local rollout events", async () => {
    const fx = fixture();
    const deps = {
      codexHome: () => fx.codexHome,
      userHome: () => fx.codexHome,
      stateDbPath: () => fx.stateDbPath,
      now: () => 1_700_000_100_000,
    };
    const response = await requestDesktop("/api/desktop/usage", {}, deps);
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      ranges: Record<string, { totalTokens: number; inputTokens: number; outputTokens: number; threadCount: number }>;
      topThreads: Record<string, Array<{ id: string; totalTokens: number }>>;
      coverage: { scannedThreads: number; fallbackThreads: number };
    };
    for (const range of ["1d", "3d", "7d", "30d"]) {
      expect(payload.ranges[range]).toMatchObject({
        totalTokens: 1_234,
        inputTokens: 1_000,
        outputTokens: 234,
        threadCount: 1,
      });
      expect(payload.topThreads[range]?.[0]).toMatchObject({ id: "thread-1", totalTokens: 1_234 });
    }
    expect(payload.coverage).toMatchObject({ scannedThreads: 1, fallbackThreads: 0 });
  });

  test("creates, updates with a backup, and recoverably trashes a user Skill", async () => {
    const fx = fixture();
    const deps = {
      codexHome: () => fx.codexHome,
      userHome: () => fx.codexHome,
      stateDbPath: () => fx.stateDbPath,
      now: () => 1_800_000_000_000,
    };
    const content = "---\nname: Demo Skill\ndescription: First version\n---\n\n# Demo Skill\n";
    const created = await requestDesktop("/api/desktop/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "demo-skill", content }),
    }, deps);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { skill: { id: string; name: string; readOnly: boolean } };
    expect(createdBody.skill.name).toBe("Demo Skill");
    expect(createdBody.skill.readOnly).toBe(false);

    const updatedContent = content.replace("First version", "Second version");
    const updated = await requestDesktop(`/api/desktop/skills/${createdBody.skill.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: updatedContent }),
    }, deps);
    expect(updated.status).toBe(200);
    expect(readFileSync(join(fx.codexHome, ".agents", "skills", "demo-skill", "SKILL.md"), "utf8")).toContain("Second version");

    const removed = await requestDesktop(`/api/desktop/skills/${createdBody.skill.id}`, { method: "DELETE" }, deps);
    expect(removed.status).toBe(200);
    const after = await requestDesktop("/api/desktop/skills", {}, deps);
    expect((await after.json() as { skills: unknown[] }).skills).toHaveLength(0);
  });

  test("discovers project Skills, recoverably deletes them, and hard-protects built-in Skills", async () => {
    const fx = fixture();
    const project = join(fx.codexHome, "demo-repository");
    const projectSkill = join(project, ".agents", "skills", "project-skill");
    const systemSkill = join(fx.codexHome, "skills", ".system", "built-in-skill");
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(projectSkill, { recursive: true });
    mkdirSync(systemSkill, { recursive: true });
    writeFileSync(join(projectSkill, "SKILL.md"), "---\nname: Project Skill\ndescription: Project scope\n---\n");
    writeFileSync(join(systemSkill, "SKILL.md"), "---\nname: Built-in Skill\ndescription: System scope\n---\n");
    const db = new Database(fx.stateDbPath);
    db.query("UPDATE threads SET cwd = ? WHERE id = ?").run(project, "thread-1");
    db.close();
    const deps: DesktopRoutesDeps = {
      codexHome: () => fx.codexHome,
      userHome: () => fx.codexHome,
      stateDbPath: () => fx.stateDbPath,
      now: () => 1_800_000_000_000,
    };

    const list = await requestDesktop("/api/desktop/skills", {}, deps);
    const payload = await list.json() as {
      skills: Array<{ id: string; name: string; scope: string; readOnly: boolean }>;
      locations: Array<{ scope: string }>;
    };
    const projectEntry = payload.skills.find(skill => skill.name === "Project Skill")!;
    const systemEntry = payload.skills.find(skill => skill.name === "Built-in Skill")!;
    expect(projectEntry).toMatchObject({ scope: "project", readOnly: false });
    expect(systemEntry).toMatchObject({ scope: "system", readOnly: true });
    expect(payload.locations.some(location => location.scope === "project")).toBe(true);

    const blocked = await requestDesktop(`/api/desktop/skills/${systemEntry.id}`, { method: "DELETE" }, deps);
    expect(blocked.status).toBe(403);
    expect(existsSync(join(systemSkill, "SKILL.md"))).toBe(true);

    const removed = await requestDesktop(`/api/desktop/skills/${projectEntry.id}`, { method: "DELETE" }, deps);
    expect(removed.status).toBe(200);
    expect(existsSync(projectSkill)).toBe(false);
    expect(existsSync(join(fx.codexHome, ".nexcode", "skill-trash"))).toBe(true);
  });

  test("force quit revalidates identity and escalates only matching Codex processes", async () => {
    const fx = fixture();
    const processes = new Map([[4321, "/Applications/Codex.app/Contents/MacOS/Codex"]]);
    const signals: string[] = [];
    const deps: DesktopRoutesDeps = {
      codexHome: () => fx.codexHome,
      userHome: () => fx.codexHome,
      stateDbPath: () => fx.stateDbPath,
      settleDelayMs: 0,
      listCodexProcesses: () => ({
        state: "ok",
        processes: [...processes].map(([pid, commandLine]) => ({ pid, commandLine })),
      }),
      signalProcess: (pid, signal) => {
        signals.push(`${pid}:${signal}`);
        if (signal === "SIGKILL") processes.delete(pid);
      },
    };
    const response = await requestDesktop("/api/desktop/codex/force-quit", { method: "POST" }, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, requested: 1, stopped: 1, surviving: 0 });
    expect(signals).toEqual(["4321:SIGTERM", "4321:SIGKILL"]);
  });

  test("generic provider management namespaces return 404", async () => {
    const req = new Request("http://localhost:10100/api/providers", {
      headers: { Host: "localhost:10100" },
    });
    const response = await handleManagementAPI(req, new URL(req.url), config);
    expect(response?.status).toBe(404);
    expect(await response?.json()).toEqual({ error: "management surface removed" });
  });
});
