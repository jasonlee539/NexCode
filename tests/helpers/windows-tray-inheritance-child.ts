import { writeFileSync } from "node:fs";

const pidPath = process.env.NXC_TRAY_TEST_PID_FILE;
if (!pidPath) throw new Error("Missing NXC_TRAY_TEST_PID_FILE.");

writeFileSync(pidPath, String(process.pid));
await Bun.sleep(30_000);
