// AUTO-SPLIT barrel: src/types.ts re-exports every historical name; bodies live in src/types/*.
// Values (runtime): tools + wire. Types (erased): request + config + provider + accounts.

export type { NxcTool, NxcToolChoice } from "./types/tools";
export {
  namespacedToolName,
  toolChoiceAliases,
  toolChoiceCandidates,
  toolAllowedByChoice,
  resolveToolChoiceWireName,
  modelInList,
  isAllowedToolChoice,
  toolChoiceToolPredicate,
} from "./types/tools";

export type { UpstreamHttpVersion, ReasoningSummaryDelivery, CodexAccountMode } from "./types/wire";
export {
  UPSTREAM_HTTP_VERSION_VALUES,
  REASONING_SUMMARY_DELIVERY_VALUES,
  OPENAI_PROVIDER_TIER_VERSION,
  MODEL_ADAPTER_OVERRIDE_ALLOWED,
  captureWireAdapterHardPins,
  isWirePinnedModel,
  pinnedWireAdapter,
} from "./types/wire";

export type {
  NxcReasoningReplayIdentity,
  NxcReasoningReplayScopeRef,
  NxcParsedRequest,
  NxcContext,
  NxcMessage,
  NxcUserMessage,
  NxcAssistantMessage,
  NxcDeveloperMessage,
  NxcToolResultMessage,
  NxcTextContent,
  NxcImageContent,
  NxcContentPart,
  NxcThinkingContent,
  NxcToolCall,
  NxcProviderOpaqueToolCallMetadata,
  NxcAssistantContentPart,
  NxcRequestOptions,
  NxcMessagePhase,
  NxcProviderContinuationOwner,
  NxcProviderContinuationState,
  AdapterEvent,
  NxcUrlCitation,
  NxcUsage,
} from "./types/request";

export type {
  NxcClaudeCodeConfig,
  NxcClaudeDesktopFamily,
  NxcClaudeDesktopAssignment,
  NxcClaudeDesktopProfile,
  StorageCleanupPolicy,
  NxcCustomModel,
  NxcApiKeyEntry,
  NxcClientIntegrationsConfig,
  NxcConfig,
  NxcAccountPoolRotationStrategy,
  NxcComboStrategy,
  NxcComboDefaultEffort,
  NxcComboTarget,
  NxcComboConfig,
  NxcRoutingUnknownEvidenceMode,
  NxcRoutingProfileCandidate,
  NxcRoutingProfileRequirements,
  NxcRoutingProfileOptimize,
  NxcRoutingUnknownCostCapMode,
  NxcRoutingProfileLimits,
  NxcRoutingProfileUnknownEvidence,
  NxcRoutingProfileCompatibilitySuite,
  NxcRoutingProfileCompatibility,
  NxcRoutingProfileConfig,
  NxcTokenGuardianConfig,
  NxcImagesConfig,
  NxcSearchConfig,
  NxcVisionSidecarConfig,
  NxcWebSearchSidecarConfig,
} from "./types/config";

export type {
  RefreshPolicy,
  OpenRouterProviderRouting,
  ResponsesItemIdRepairConfig,
  RateLimitRetryPolicy,
  ProviderCostOverlay,
  RequestPacingRule,
  ProviderRequestPacingConfig,
  FastWire,
  AttemptTierOutcome,
  TierObservationContext,
  TierDecision,
  NxcProviderConfig,
} from "./types/provider";

export type {
  CodexAccount,
  CodexAccountCredentials,
  CodexAccountCredentialRecord,
} from "./types/accounts";

