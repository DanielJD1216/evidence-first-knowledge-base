import { createHash } from "node:crypto";

import {
  SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_ID,
  SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_VERSION,
  type SourceWireKnowledgeEvidenceV1,
  type SourceWireKnowledgeFreshnessV1,
  type SourceWireKnowledgeProviderErrorCodeV1,
  type SourceWireKnowledgeProviderProfileV1,
  type SourceWireKnowledgeProviderRequestV1,
  type SourceWireKnowledgeProviderResultV1,
  type SourceWireKnowledgeProviderV1,
  type SourceWireKnowledgeSensitivityV1
} from "@source-wire/contracts";

export const EVIDENCE_FIRST_PROVIDER_ID =
  "evidence_first_synthetic" as const;
export const EVIDENCE_FIRST_PROVIDER_SCOPE_ID =
  "scope_evidence_first_synthetic" as const;
export const EVIDENCE_FIRST_SYNTHETIC_OWNER_ID =
  "owner_evidence_first" as const;
export const EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID =
  "ns_evidence_first" as const;
export const EVIDENCE_FIRST_SYNTHETIC_PRINCIPAL_ID =
  "principal_evidence_reader" as const;
export const EVIDENCE_FIRST_SYNTHETIC_KNOWLEDGE_SCOPE_ID =
  "knowledge_scope_public_synthetic" as const;

const MAX_QUERY_BYTES = 4_096;
const MAX_RESULT_COUNT = 10;
const MAX_EXCERPT_BYTES = 8_192;
const SHA256 = /^[a-f0-9]{64}$/u;

export type EvidenceFirstProviderBindingV1 = Readonly<{
  providerId: string;
  providerScopeId: string;
  ownerId: string;
  namespaceId: string;
  runtimePrincipalId: string;
  knowledgeScopeId: string;
}>;

export type EvidenceFirstAuthorizedSearchV1 = Readonly<{
  runtimePrincipalId: string;
  knowledgeScopeId: string;
  query: string;
  maximumResults: number;
  deadlineAt: string;
}>;

export type EvidenceFirstAuthorizedGetV1 = Readonly<{
  runtimePrincipalId: string;
  knowledgeScopeId: string;
  sourceId: string;
  segmentId: string;
  deadlineAt: string;
}>;

export type EvidenceFirstAuthorizedSnapshotV1 = Readonly<{
  evidenceId: string;
  sourceId: string;
  segmentId: string;
  sourceVersion: string;
  contentHash: string;
  citationLocator: string;
  citationPublicSafe: true;
  title: string;
  excerpt: string;
  mediaType: string;
  truncated: boolean;
  sensitivity: SourceWireKnowledgeSensitivityV1;
  freshness: SourceWireKnowledgeFreshnessV1;
  sourceModifiedAt: string;
  active: boolean;
  deleted: boolean;
  accessDecision: "allowed" | "denied";
  runtimePrincipalId: string;
  knowledgeScopeId: string;
}>;

export type EvidenceFirstAuthorizedReaderResultV1 =
  | Readonly<{
      status: "allowed";
      evidence: readonly EvidenceFirstAuthorizedSnapshotV1[];
    }>
  | Readonly<{ status: "empty" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

export interface EvidenceFirstAuthorizedReaderV1 {
  search(
    input: EvidenceFirstAuthorizedSearchV1
  ): Promise<EvidenceFirstAuthorizedReaderResultV1>;
  get(
    input: EvidenceFirstAuthorizedGetV1
  ): Promise<EvidenceFirstAuthorizedReaderResultV1>;
}

export type EvidenceFirstSyntheticScenario =
  | "allowed"
  | "inactive"
  | "deleted"
  | "denied"
  | "incomplete"
  | "oversized"
  | "late"
  | "cross_scope";

export function createEvidenceFirstKnowledgeProvider(input: {
  binding: EvidenceFirstProviderBindingV1;
  reader: EvidenceFirstAuthorizedReaderV1;
  now?: () => Date;
}): SourceWireKnowledgeProviderV1 {
  const binding = Object.freeze({ ...input.binding });
  const now = input.now ?? (() => new Date());
  const profile = createProfile(binding);

  return Object.freeze({
    profile,
    async execute(
      request: SourceWireKnowledgeProviderRequestV1
    ): Promise<SourceWireKnowledgeProviderResultV1> {
      if (!requestMatchesBinding(request, binding)) {
        return denied(request, binding.providerId, "scope_violation");
      }
      if (!deadlineIsLive(request.deadlineAt, now())) {
        return denied(request, binding.providerId, "deadline_exceeded");
      }
      if (
        request.operation === "describe" ||
        request.operation === "health"
      ) {
        return allowed(request, binding.providerId, []);
      }
      if (request.operation === "search_evidence") {
        if (
          !request.search ||
          !boundedText(request.search.query, MAX_QUERY_BYTES) ||
          !Number.isInteger(request.search.maximumResults) ||
          request.search.maximumResults < 1 ||
          request.search.maximumResults > profile.maximumResultCount
        ) {
          return denied(request, binding.providerId, "invalid_request");
        }
        const result = await input.reader.search({
          runtimePrincipalId: binding.runtimePrincipalId,
          knowledgeScopeId: binding.knowledgeScopeId,
          query: request.search.query,
          maximumResults: request.search.maximumResults,
          deadlineAt: request.deadlineAt
        });
        return translateReaderResult({
          request,
          result,
          binding,
          now,
          maximumResults: request.search.maximumResults
        });
      }
      if (request.operation === "get_evidence") {
        if (
          !request.get ||
          !boundedText(request.get.sourceId, 1_024) ||
          !boundedText(request.get.segmentId, 1_024)
        ) {
          return denied(request, binding.providerId, "invalid_request");
        }
        const result = await input.reader.get({
          runtimePrincipalId: binding.runtimePrincipalId,
          knowledgeScopeId: binding.knowledgeScopeId,
          sourceId: request.get.sourceId,
          segmentId: request.get.segmentId,
          deadlineAt: request.deadlineAt
        });
        return translateReaderResult({
          request,
          result,
          binding,
          now,
          maximumResults: 1,
          exact: request.get
        });
      }
      return denied(request, binding.providerId, "unsupported_operation");
    }
  });
}

export function createEvidenceFirstSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "allowed"
  });
}

export function createEvidenceFirstSyntheticProviderForConformance(input: {
  scenario: EvidenceFirstSyntheticScenario;
}): SourceWireKnowledgeProviderV1 {
  let nowCalls = 0;
  const startedAt = Date.now();
  return createEvidenceFirstKnowledgeProvider({
    binding: syntheticBinding(),
    reader: createSyntheticAuthorizedReader(input.scenario),
    now: () => {
      nowCalls += 1;
      return new Date(
        input.scenario === "late" && nowCalls > 1
          ? startedAt + 60_000
          : Date.now()
      );
    }
  });
}

export function createEvidenceFirstInactiveSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "inactive"
  });
}

export function createEvidenceFirstDeletedSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "deleted"
  });
}

export function createEvidenceFirstDeniedSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "denied"
  });
}

export function createEvidenceFirstIncompleteSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "incomplete"
  });
}

export function createEvidenceFirstOversizedSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "oversized"
  });
}

export function createEvidenceFirstLateSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "late"
  });
}

export function createEvidenceFirstCrossScopeSyntheticProvider(): SourceWireKnowledgeProviderV1 {
  return createEvidenceFirstSyntheticProviderForConformance({
    scenario: "cross_scope"
  });
}

function createProfile(
  binding: EvidenceFirstProviderBindingV1
): SourceWireKnowledgeProviderProfileV1 {
  return Object.freeze({
    contractId: SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_ID,
    contractVersion: SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_VERSION,
    providerId: binding.providerId,
    providerScopeId: binding.providerScopeId,
    providerFamily: "document_index",
    accessMode: "read_only",
    credentialMode: "out_of_band",
    capabilities: Object.freeze([
      {
        capability: "describe",
        requirement: "required",
        supported: true
      },
      {
        capability: "health",
        requirement: "required",
        supported: true
      },
      {
        capability: "search_evidence",
        requirement: "required",
        supported: true
      },
      {
        capability: "get_evidence",
        requirement: "required",
        supported: true
      }
    ]) as SourceWireKnowledgeProviderProfileV1["capabilities"],
    requiredProvenance: true,
    noAutoPromotion: true,
    arbitraryTableMappingSupported: false,
    maximumResultCount: MAX_RESULT_COUNT,
    maximumExcerptBytes: MAX_EXCERPT_BYTES
  });
}

function requestMatchesBinding(
  request: SourceWireKnowledgeProviderRequestV1,
  binding: EvidenceFirstProviderBindingV1
): boolean {
  return (
    request.contractId === SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_ID &&
    request.contractVersion ===
      SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_VERSION &&
    request.providerId === binding.providerId &&
    request.providerScopeId === binding.providerScopeId &&
    request.ownerId === binding.ownerId &&
    request.namespaceId === binding.namespaceId
  );
}

function translateReaderResult(input: {
  request: SourceWireKnowledgeProviderRequestV1;
  result: EvidenceFirstAuthorizedReaderResultV1;
  binding: EvidenceFirstProviderBindingV1;
  now: () => Date;
  maximumResults: number;
  exact?: Readonly<{ sourceId: string; segmentId: string }>;
}): SourceWireKnowledgeProviderResultV1 {
  if (!deadlineIsLive(input.request.deadlineAt, input.now())) {
    return denied(
      input.request,
      input.binding.providerId,
      "deadline_exceeded"
    );
  }
  if (input.result.status === "empty") {
    return {
      ...allowed(input.request, input.binding.providerId, []),
      gaps: [
        {
          code: "no_evidence",
          message: "No authorized evidence matched the request.",
          retryable: false
        }
      ]
    };
  }
  if (input.result.status === "not_found") {
    return denied(input.request, input.binding.providerId, "not_found");
  }
  if (input.result.status === "denied") {
    return denied(input.request, input.binding.providerId, "scope_violation");
  }
  if (input.result.status === "unavailable") {
    return unavailable(
      input.request,
      input.binding.providerId,
      "temporarily_unavailable"
    );
  }
  if (
    input.result.evidence.length > input.maximumResults ||
    input.result.evidence.length > MAX_RESULT_COUNT
  ) {
    return denied(
      input.request,
      input.binding.providerId,
      "provenance_incomplete"
    );
  }
  const evidence: SourceWireKnowledgeEvidenceV1[] = [];
  for (const snapshot of input.result.evidence) {
    const mapped = mapSnapshot(snapshot, input.binding, input.now(), input.exact);
    if (!mapped) {
      evidence.length = 0;
      return denied(
        input.request,
        input.binding.providerId,
        "provenance_incomplete"
      );
    }
    evidence.push(mapped);
  }
  return allowed(input.request, input.binding.providerId, evidence);
}

function mapSnapshot(
  snapshot: EvidenceFirstAuthorizedSnapshotV1,
  binding: EvidenceFirstProviderBindingV1,
  retrievedAt: Date,
  exact?: Readonly<{ sourceId: string; segmentId: string }>
): SourceWireKnowledgeEvidenceV1 | undefined {
  if (
    snapshot.active !== true ||
    snapshot.deleted !== false ||
    snapshot.accessDecision !== "allowed" ||
    snapshot.runtimePrincipalId !== binding.runtimePrincipalId ||
    snapshot.knowledgeScopeId !== binding.knowledgeScopeId ||
    !boundedText(snapshot.evidenceId, 1_024) ||
    !boundedText(snapshot.sourceId, 1_024) ||
    !boundedText(snapshot.segmentId, 1_024) ||
    !boundedText(snapshot.sourceVersion, 256) ||
    !SHA256.test(snapshot.contentHash) ||
    !boundedText(snapshot.citationLocator, 2_048) ||
    snapshot.citationPublicSafe !== true ||
    !boundedText(snapshot.title, 1_024) ||
    !boundedText(snapshot.excerpt, MAX_EXCERPT_BYTES) ||
    !boundedText(snapshot.mediaType, 128) ||
    !Number.isFinite(Date.parse(snapshot.sourceModifiedAt)) ||
    new Date(snapshot.sourceModifiedAt).toISOString() !==
      snapshot.sourceModifiedAt ||
    (exact !== undefined &&
      (snapshot.sourceId !== exact.sourceId ||
        snapshot.segmentId !== exact.segmentId))
  ) {
    return undefined;
  }
  return {
    providerId: binding.providerId,
    providerRecordId: snapshot.evidenceId,
    sourceId: snapshot.sourceId,
    segmentId: snapshot.segmentId,
    ownerId: binding.ownerId,
    namespaceId: binding.namespaceId,
    aclDecision: "allowed",
    sourceVersion: snapshot.sourceVersion,
    contentDigest: {
      algorithm: "sha256",
      value: snapshot.contentHash
    },
    citationLocator: {
      value: snapshot.citationLocator,
      publicSafe: true
    },
    title: snapshot.title,
    excerpt: snapshot.excerpt,
    mediaType: snapshot.mediaType,
    truncated: snapshot.truncated,
    sensitivity: snapshot.sensitivity,
    freshness: snapshot.freshness,
    retrievedAt: retrievedAt.toISOString(),
    sourceModifiedAt: snapshot.sourceModifiedAt,
    instructionAuthority: "none"
  };
}

function createSyntheticAuthorizedReader(
  scenario: EvidenceFirstSyntheticScenario
): EvidenceFirstAuthorizedReaderV1 {
  const baseEvidence = syntheticSnapshots();
  const evidence = scenarioEvidence(baseEvidence, scenario);
  return Object.freeze({
    async search(
      input: EvidenceFirstAuthorizedSearchV1
    ): Promise<EvidenceFirstAuthorizedReaderResultV1> {
      if (
        input.runtimePrincipalId !==
          EVIDENCE_FIRST_SYNTHETIC_PRINCIPAL_ID ||
        input.knowledgeScopeId !==
          EVIDENCE_FIRST_SYNTHETIC_KNOWLEDGE_SCOPE_ID
      ) {
        return { status: "denied" };
      }
      if (scenario === "denied") {
        return { status: "denied" };
      }
      return {
        status: "allowed",
        evidence:
          scenario === "oversized"
            ? evidence
            : evidence.slice(0, input.maximumResults)
      };
    },
    async get(
      input: EvidenceFirstAuthorizedGetV1
    ): Promise<EvidenceFirstAuthorizedReaderResultV1> {
      if (
        input.runtimePrincipalId !==
          EVIDENCE_FIRST_SYNTHETIC_PRINCIPAL_ID ||
        input.knowledgeScopeId !==
          EVIDENCE_FIRST_SYNTHETIC_KNOWLEDGE_SCOPE_ID
      ) {
        return { status: "denied" };
      }
      if (scenario === "denied") {
        return { status: "denied" };
      }
      const match = evidence.find(
        (item) =>
          item.sourceId === input.sourceId &&
          item.segmentId === input.segmentId
      );
      return match
        ? { status: "allowed", evidence: [match] }
        : { status: "not_found" };
    }
  });
}

function scenarioEvidence(
  evidence: readonly EvidenceFirstAuthorizedSnapshotV1[],
  scenario: EvidenceFirstSyntheticScenario
): readonly EvidenceFirstAuthorizedSnapshotV1[] {
  const first = evidence[0] as EvidenceFirstAuthorizedSnapshotV1;
  if (scenario === "inactive") {
    return [{ ...first, active: false }];
  }
  if (scenario === "deleted") {
    return [{ ...first, deleted: true }];
  }
  if (scenario === "incomplete") {
    return [{ ...first, contentHash: "invalid" }];
  }
  if (scenario === "cross_scope") {
    return [{ ...first, knowledgeScopeId: "knowledge_scope_other" }];
  }
  if (scenario === "oversized") {
    return Array.from({ length: MAX_RESULT_COUNT + 1 }, (_, index) => ({
      ...first,
      evidenceId: `${first.evidenceId}_${index}`
    }));
  }
  return evidence;
}

function syntheticBinding(): EvidenceFirstProviderBindingV1 {
  return {
    providerId: EVIDENCE_FIRST_PROVIDER_ID,
    providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
    ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
    namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
    runtimePrincipalId: EVIDENCE_FIRST_SYNTHETIC_PRINCIPAL_ID,
    knowledgeScopeId: EVIDENCE_FIRST_SYNTHETIC_KNOWLEDGE_SCOPE_ID
  };
}

function syntheticSnapshots(): readonly EvidenceFirstAuthorizedSnapshotV1[] {
  return Object.freeze([
    createSnapshot({
      evidenceId: "record_release_review",
      sourceId: "source_release_runbook",
      segmentId: "segment_owner_gate",
      sourceVersion: "release-runbook-v3",
      title: "Synthetic release review",
      excerpt:
        "Synthetic evidence: a release requires an explicit owner review before distribution.",
      citationLocator: "synthetic://evidence-first/release-review",
      sourceModifiedAt: "2026-07-23T10:00:00.000Z"
    }),
    createSnapshot({
      evidenceId: "record_recovery_review",
      sourceId: "source_recovery_runbook",
      segmentId: "segment_restore_gate",
      sourceVersion: "recovery-runbook-v2",
      title: "Synthetic recovery review",
      excerpt:
        "Synthetic evidence: recovery requires an isolated restore and owner review.",
      citationLocator: "synthetic://evidence-first/recovery-review",
      sourceModifiedAt: "2026-07-22T10:00:00.000Z"
    })
  ]);
}

function createSnapshot(input: {
  evidenceId: string;
  sourceId: string;
  segmentId: string;
  sourceVersion: string;
  title: string;
  excerpt: string;
  citationLocator: string;
  sourceModifiedAt: string;
}): EvidenceFirstAuthorizedSnapshotV1 {
  return Object.freeze({
    ...input,
    contentHash: createHash("sha256")
      .update(input.excerpt, "utf8")
      .digest("hex"),
    citationPublicSafe: true,
    mediaType: "text/markdown",
    truncated: false,
    sensitivity: "internal",
    freshness: "fresh",
    active: true,
    deleted: false,
    accessDecision: "allowed",
    runtimePrincipalId: EVIDENCE_FIRST_SYNTHETIC_PRINCIPAL_ID,
    knowledgeScopeId: EVIDENCE_FIRST_SYNTHETIC_KNOWLEDGE_SCOPE_ID
  });
}

function allowed(
  request: SourceWireKnowledgeProviderRequestV1,
  providerId: string,
  evidence: readonly SourceWireKnowledgeEvidenceV1[]
): SourceWireKnowledgeProviderResultV1 {
  return {
    ...resultBase(request, providerId),
    status: "allowed",
    evidence: [...evidence],
    gaps: []
  };
}

function denied(
  request: SourceWireKnowledgeProviderRequestV1,
  providerId: string,
  code: SourceWireKnowledgeProviderErrorCodeV1
): SourceWireKnowledgeProviderResultV1 {
  return {
    ...resultBase(request, providerId),
    status: "denied",
    evidence: [],
    gaps: [],
    error: safeError(request.traceId, code, false)
  };
}

function unavailable(
  request: SourceWireKnowledgeProviderRequestV1,
  providerId: string,
  code: SourceWireKnowledgeProviderErrorCodeV1
): SourceWireKnowledgeProviderResultV1 {
  return {
    ...resultBase(request, providerId),
    status: "unavailable",
    evidence: [],
    gaps: [
      {
        code: "provider_unavailable",
        message: "Source evidence is temporarily unavailable.",
        retryable: true
      }
    ],
    error: safeError(request.traceId, code, true)
  };
}

function safeError(
  traceId: string,
  code: SourceWireKnowledgeProviderErrorCodeV1,
  retryable: boolean
) {
  return {
    code,
    message: "The provider could not release evidence.",
    traceId,
    retryable,
    detailsRedacted: true as const
  };
}

function resultBase(
  request: SourceWireKnowledgeProviderRequestV1,
  providerId: string
) {
  return {
    requestId: request.requestId,
    traceId: request.traceId,
    providerId,
    contractVersion: SOURCE_WIRE_KNOWLEDGE_PROVIDER_CONTRACT_VERSION,
    providerMutationAttempted: false as const,
    memoryMutationAttempted: false as const,
    trustedMemoryCreated: false as const,
    noAutoPromotion: true as const,
    readAuditRequired: true as const,
    releaseState: "internal_unreleased" as const
  };
}

function deadlineIsLive(deadlineAt: string, now: Date): boolean {
  const deadline = Date.parse(deadlineAt);
  return (
    Number.isFinite(deadline) &&
    deadline > now.getTime() &&
    new Date(deadline).toISOString() === deadlineAt
  );
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    Buffer.byteLength(value, "utf8") <= maximumBytes
  );
}
