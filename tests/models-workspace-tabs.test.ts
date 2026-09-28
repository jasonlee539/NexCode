/**
 * Models workspace tabs — routing contract.
 *
 * Desktop redirects retired Models, Combos, Routing, and Lab bookmarks to Dashboard.
 * The reusable Models tab helpers retain their independent legacy contract.
 */
import { expect, test, describe } from "bun:test";
import {
  MODELS_TAB_HASHES,
  hashBelongsToPage,
  readPageFromHash,
  resolveAppHashChange,
} from "../gui/src/app-routing";
import {
  MODELS_TABS,
  modelsPanelDomId,
  modelsTabDomId,
  modelsTabHash,
  readModelsTab,
  type ModelsTab,
} from "../gui/src/pages/models-tab";

describe("retired Models hashes in Desktop", () => {
  test("no Models tab is registered as a desktop destination", () => {
    expect([...MODELS_TAB_HASHES]).toEqual([]);
  });

  test.each(["models", "models/nope", "models/combos", "models/routing", "models/compatibility"])(
    "%s redirects to Dashboard without rendering a retired page", hash => {
      expect(readPageFromHash(hash)).toBe("dashboard");
      expect(hashBelongsToPage(hash, "dashboard")).toBe(false);
      expect(resolveAppHashChange(hash)).toEqual({ page: "dashboard", replaceTo: "dashboard" });
    },
  );
});

describe("readModelsTab", () => {
  test("maps every nested hash to its tab", () => {
    expect(readModelsTab("#models")).toBe("catalog");
    expect(readModelsTab("#models/combos")).toBe("combos");
    expect(readModelsTab("#models/routing")).toBe("routing");
    expect(readModelsTab("#models/compatibility")).toBe("compatibility");
  });

  test("accepts the bare and slash-prefixed hash forms", () => {
    expect(readModelsTab("models/combos")).toBe("combos");
    expect(readModelsTab("#/models/routing")).toBe("routing");
  });

  test("resolves legacy top-level hashes so a cold load lands on the right tab", () => {
    expect(readModelsTab("#combos")).toBe("combos");
    expect(readModelsTab("#routing")).toBe("routing");
    expect(readModelsTab("#combos/anything")).toBe("combos");
    expect(readModelsTab("#routing/anything")).toBe("routing");
  });

  test("anything unrecognised falls back to the catalog", () => {
    expect(readModelsTab("#dashboard")).toBe("catalog");
    expect(readModelsTab("#")).toBe("catalog");
    expect(readModelsTab("")).toBe("catalog");
  });

  test("legacy matching is delimiter-aware, not prefix-aware", () => {
    expect(readModelsTab("#combosomething")).toBe("catalog");
    expect(readModelsTab("#routings")).toBe("catalog");
    expect(readModelsTab("#routingthing")).toBe("catalog");
    expect(readModelsTab("#combos-legacy")).toBe("catalog");
  });

  test("a deeper nested hash is not mistaken for a tab", () => {
    expect(readModelsTab("#models/combos/extra")).toBe("catalog");
    expect(readModelsTab("#models/routing/extra")).toBe("catalog");
  });
});

describe("modelsTabHash", () => {
  test("round-trips every tab", () => {
    for (const tab of MODELS_TABS) expect(readModelsTab(`#${modelsTabHash(tab)}`)).toBe(tab);
  });

  test("the catalog owns the bare page hash", () => {
    expect(modelsTabHash("catalog")).toBe("models");
    expect(modelsTabHash("combos")).toBe("models/combos");
    expect(modelsTabHash("routing")).toBe("models/routing");
    expect(modelsTabHash("compatibility")).toBe("models/compatibility");
  });

  test("every non-catalog helper hash redirects out of the desktop", () => {
    const nested = MODELS_TABS.filter((tab): tab is Exclude<ModelsTab, "catalog"> => tab !== "catalog");
    for (const tab of nested) {
      expect(resolveAppHashChange(modelsTabHash(tab))).toEqual({ page: "dashboard", replaceTo: "dashboard" });
    }
  });
});

test("tab and panel dom ids are distinct per tab, so aria-controls cannot collide", () => {
  const ids = MODELS_TABS.flatMap(tab => [modelsTabDomId(tab), modelsPanelDomId(tab)]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(modelsTabDomId("combos")).toBe("models-tab-combos");
  expect(modelsPanelDomId("combos")).toBe("models-panel-combos");
});

test("an unregistered deep hash redirects to Dashboard while the helper defaults to catalog", () => {
  for (const stray of ["models/combos/extra", "models/routing/extra"]) {
    expect(hashBelongsToPage(stray, "dashboard")).toBe(false);
    expect(resolveAppHashChange(stray)).toEqual({ page: "dashboard", replaceTo: "dashboard" });
    expect(readModelsTab(`#${stray}`)).toBe("catalog");
  }
});

describe("legacy lab hash", () => {
  test("#lab redirects to Dashboard", () => {
    expect(resolveAppHashChange("lab")).toEqual({ page: "dashboard", replaceTo: "dashboard" });
    expect(readModelsTab("#lab")).toBe("compatibility");
    expect(readPageFromHash("#lab")).toBe("dashboard");
  });

  test("the nested legacy form keeps its destination", () => {
    expect(resolveAppHashChange("lab/anything")).toEqual({ page: "dashboard", replaceTo: "dashboard" });
    expect(readModelsTab("#lab/anything")).toBe("compatibility");
    expect(readPageFromHash("#lab/anything")).toBe("dashboard");
  });

  test("legacy lab matching is delimiter-aware, not prefix-aware", () => {
    expect(readModelsTab("#labs")).toBe("catalog");
    expect(readModelsTab("#label")).toBe("catalog");
    expect(readModelsTab("#lab-legacy")).toBe("catalog");
    expect(resolveAppHashChange("labs")).toEqual({ page: "dashboard", replaceTo: "dashboard" });
  });
});
