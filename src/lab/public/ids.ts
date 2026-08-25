import { domainHash, jcsStringify } from "../digest";

export type PublicEvidenceIdKind =
  | "subject"
  | "record"
  | "bundle"
  | "bundle_digest"
  | "artifact"
  | "publisher_key"
  | "revocation"
  | "route_registry";

const PUBLIC_EVIDENCE_DOMAIN: Record<PublicEvidenceIdKind, string> = {
  subject: "nxc-lab-public:subject:v1",
  record: "nxc-lab-public:record:v1",
  bundle: "nxc-lab-public:bundle:v1",
  bundle_digest: "nxc-lab-public:bundle-digest:v1",
  artifact: "nxc-lab-public:artifact:v1",
  publisher_key: "nxc-lab-public:publisher-key:v1",
  revocation: "nxc-lab-public:revocation:v1",
  route_registry: "nxc-lab-public:route-registry:v1",
};

export function publicEvidenceId(kind: PublicEvidenceIdKind, payload: unknown): string {
  return domainHash(PUBLIC_EVIDENCE_DOMAIN[kind], jcsStringify(payload));
}
