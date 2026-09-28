import { mock } from "bun:test";

// These management-contract tests do not exercise real DNS. Keep fixture hosts
// unresolved, including on VPN/fake-IP resolvers that answer for .test domains.
// Config-time checks intentionally allow offline hostnames; outbound resolution
// still fails closed. DNS classification is covered by destination-policy-resolved.
// Import before the runtime modules so their lookup binding uses this fixture.
mock.module("node:dns/promises", () => ({
  lookup: async () => [] as { address: string; family: number }[],
}));
