import { projectCatalogOnlyOutcome } from "../../src/codex/management-convergence";
import type { CatalogDisposition, ConvergeCodex } from "../../src/codex/convergence-types";
import type { NxcConfig } from "../../src/types";

export function catalogConvergenceFactory(
  run: () => Promise<void> | void = () => {},
  catalogRefresh: CatalogDisposition = {
    status: "committed",
    changed: false,
    degraded: false,
    notices: [],
  },
): (config: Readonly<NxcConfig>) => ConvergeCodex {
  return () => async () => {
    await run();
    return projectCatalogOnlyOutcome({
      changed: false,
      catalogRefresh,
    });
  };
}
