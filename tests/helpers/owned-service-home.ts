import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

export interface OwnedServiceHome {
  /** Add this to child-process environments so Linux never reaches the host bus. */
  readonly env: Record<string, string>;
}

/**
 * Seed the same state and service-manager definition that an installed proxy
 * records, scoped entirely to a test home.
 *
 * Linux CI has no user systemd bus. The production probe correctly treats that
 * as unproven ownership, so the fixture supplies a read-only `systemctl show`
 * response on its own PATH together with the unit that response describes.
 */
export function claimOwnedServiceHome(
  codexHome: string,
  nexcodeHome: string,
  home: string,
): OwnedServiceHome {
  writeFileSync(join(nexcodeHome, "service-state.json"), JSON.stringify({
    version: 2,
    codexHome,
    nexcodeHome,
    backend: "scheduler",
  }));

  if (process.platform === "darwin") {
    const launchAgents = join(home, "Library", "LaunchAgents");
    mkdirSync(launchAgents, { recursive: true, mode: 0o700 });
    writeFileSync(join(launchAgents, "com.nexcode.proxy.plist"), [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<plist version=\"1.0\"><dict><key>EnvironmentVariables</key><dict>",
      `<key>CODEX_HOME</key><string>${codexHome}</string>`,
      `<key>NEXCODE_HOME</key><string>${nexcodeHome}</string>`,
      "</dict></dict></plist>",
    ].join("\n"));
  }

  if (process.platform !== "linux") return { env: {} };

  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(unitDir, "nexcode-proxy.service"), [
    "[Service]",
    `Environment=\"CODEX_HOME=${codexHome}\"`,
    `Environment=\"NEXCODE_HOME=${nexcodeHome}\"`,
  ].join("\n"));

  const binDir = join(home, ".nxc-test-bin");
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  const systemctl = join(binDir, "systemctl");
  writeFileSync(systemctl, [
    "#!/bin/sh",
    "if [ \"$1\" != \"--user\" ] || [ \"$2\" != \"show\" ] || [ \"$3\" != \"nexcode-proxy\" ]; then exit 64; fi",
    "printf '%s\\n' 'LoadState=loaded' 'ActiveState=inactive' 'FragmentPath=fixture' 'NeedDaemonReload=no'",
  ].join("\n"));
  chmodSync(systemctl, 0o700);

  return { env: { PATH: [binDir, process.env.PATH ?? ""].filter(Boolean).join(delimiter) } };
}
