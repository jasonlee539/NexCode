import type { NxcProviderConfig } from "../types";

export const XAI_RESPONSES_OPT_IN_MODELS = ["grok-4.6", "grok-4.5"] as const;

export type XaiResponsesOptInState = boolean | "mixed";

/** Derived dashboard/API state for the two modelAdapters entries owned by the xAI opt-in. */
export function xaiResponsesOptInState(provider: NxcProviderConfig): XaiResponsesOptInState {
  const enabled = XAI_RESPONSES_OPT_IN_MODELS.map(
    model => provider.modelAdapters?.[model] === "openai-responses",
  );
  if (enabled.every(Boolean)) return true;
  if (enabled.some(Boolean)) return "mixed";
  return false;
}
