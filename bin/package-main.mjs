export const packageName = "nexcode-desktop";
export const cliCommand = "nxc";

export async function loadBunApi() {
  if (typeof Bun === "undefined") {
    throw new Error("The nexcode programmatic API requires the Bun runtime. Use `nxc` for the CLI entrypoint.");
  }
  return import("../src/index.ts");
}
