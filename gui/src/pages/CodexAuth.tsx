import CodexAccountPool from "../components/CodexAccountPool";

/** Codex/GPT account manager. Generic provider configuration is not mounted. */
export default function CodexAuth({ apiBase, simple: _simple = true }: { apiBase: string; simple?: boolean }) {
  return (
    <div className="desktop-accounts">
      <CodexAccountPool
        apiBase={apiBase}
        simple
        accountModeState="pool"
      />
    </div>
  );
}
