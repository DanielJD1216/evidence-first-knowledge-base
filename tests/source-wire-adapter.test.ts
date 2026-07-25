import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceFirstKnowledgeProvider,
  createEvidenceFirstSyntheticProvider,
  createEvidenceFirstSyntheticProviderForConformance,
  EVIDENCE_FIRST_PROVIDER_ID,
  EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
  EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
  EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID
} from "../src/index.js";

function futureDeadline(): string {
  return new Date(Date.now() + 10_000).toISOString();
}

test("authorized search returns bounded evidence in provider order", async () => {
  const provider = createEvidenceFirstSyntheticProvider();
  const result = await provider.execute({
    contractId: "source-wire.knowledge-provider",
    contractVersion: "knowledge-provider.v1",
    requestId: "request_authorized_search",
    traceId: "trace_authorized_search",
    providerId: EVIDENCE_FIRST_PROVIDER_ID,
    ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
    namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
    providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
    operation: "search_evidence",
    requiredCapabilities: [
      {
        capability: "search_evidence",
        requirement: "required"
      }
    ],
    deadlineAt: futureDeadline(),
    search: {
      query: "owner review",
      maximumResults: 2
    }
  });

  assert.equal(result.status, "allowed");
  assert.deepEqual(
    result.evidence.map((item) => item.providerRecordId),
    [
      "record_release_review",
      "record_recovery_review"
    ]
  );
  assert.equal(result.evidence.every((item) => item.aclDecision === "allowed"), true);
  assert.equal(result.evidence.every((item) => item.instructionAuthority === "none"), true);
  assert.equal(result.releaseState, "internal_unreleased");
  assert.equal(result.providerMutationAttempted, false);
  assert.equal(result.memoryMutationAttempted, false);
  assert.equal(result.trustedMemoryCreated, false);
  assert.equal(result.noAutoPromotion, true);
});

test("exact fetch returns only the matching source and segment", async () => {
  const provider = createEvidenceFirstSyntheticProvider();
  const result = await provider.execute({
    contractId: "source-wire.knowledge-provider",
    contractVersion: "knowledge-provider.v1",
    requestId: "request_exact_fetch",
    traceId: "trace_exact_fetch",
    providerId: EVIDENCE_FIRST_PROVIDER_ID,
    ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
    namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
    providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
    operation: "get_evidence",
    requiredCapabilities: [
      {
        capability: "get_evidence",
        requirement: "required"
      }
    ],
    deadlineAt: futureDeadline(),
    get: {
      sourceId: "source_recovery_runbook",
      segmentId: "segment_restore_gate"
    }
  });

  assert.equal(result.status, "allowed");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.sourceId, "source_recovery_runbook");
  assert.equal(result.evidence[0]?.segmentId, "segment_restore_gate");
  assert.equal(
    result.evidence[0]?.providerRecordId,
    "record_recovery_review"
  );
});

test("health check exposes readiness without releasing evidence", async () => {
  const provider = createEvidenceFirstSyntheticProvider();
  const result = await provider.execute({
    contractId: "source-wire.knowledge-provider",
    contractVersion: "knowledge-provider.v1",
    requestId: "request_health",
    traceId: "trace_health",
    providerId: EVIDENCE_FIRST_PROVIDER_ID,
    ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
    namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
    providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
    operation: "health",
    requiredCapabilities: [
      {
        capability: "health",
        requirement: "required"
      }
    ],
    deadlineAt: futureDeadline()
  });

  assert.equal(result.status, "allowed");
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.releaseState, "internal_unreleased");
});

test("adapter passes only provider-owned identity and scope to the reader", async () => {
  let observedInput: Record<string, unknown> | undefined;
  const provider = createEvidenceFirstKnowledgeProvider({
    binding: {
      providerId: EVIDENCE_FIRST_PROVIDER_ID,
      providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
      ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
      namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
      runtimePrincipalId: "principal_evidence_reader",
      knowledgeScopeId: "knowledge_scope_public_synthetic"
    },
    reader: {
      async search(input) {
        observedInput = { ...input };
        return { status: "empty" };
      },
      async get() {
        return { status: "not_found" };
      }
    },
    now: () => new Date("2026-07-25T12:00:00.000Z")
  });

  const result = await provider.execute({
    contractId: "source-wire.knowledge-provider",
    contractVersion: "knowledge-provider.v1",
    requestId: "request_reader_boundary",
    traceId: "trace_reader_boundary",
    providerId: EVIDENCE_FIRST_PROVIDER_ID,
    ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
    namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
    providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
    operation: "search_evidence",
    requiredCapabilities: [
      {
        capability: "search_evidence",
        requirement: "required"
      }
    ],
    deadlineAt: "2026-07-25T12:00:10.000Z",
    search: {
      query: "owner review",
      maximumResults: 2
    }
  });

  assert.deepEqual(observedInput, {
    runtimePrincipalId: "principal_evidence_reader",
    knowledgeScopeId: "knowledge_scope_public_synthetic",
    query: "owner review",
    maximumResults: 2,
    deadlineAt: "2026-07-25T12:00:10.000Z"
  });
  assert.equal(result.status, "allowed");
  assert.deepEqual(result.evidence, []);
  assert.equal(result.gaps[0]?.code, "no_evidence");
  assert.equal("ownerCredential" in (observedInput ?? {}), false);
  assert.equal("actorContext" in (observedInput ?? {}), false);
  assert.equal("auditStore" in (observedInput ?? {}), false);
  assert.equal("processSecret" in (observedInput ?? {}), false);
  assert.equal("memoryMutation" in (observedInput ?? {}), false);
});

test("unsafe lifecycle, scope, provenance, bounds, and timing release zero evidence", async () => {
  for (const scenario of [
    "inactive",
    "deleted",
    "denied",
    "incomplete",
    "oversized",
    "late",
    "cross_scope"
  ] as const) {
    const provider = createEvidenceFirstSyntheticProviderForConformance({
      scenario
    });
    const result = await provider.execute({
      contractId: "source-wire.knowledge-provider",
      contractVersion: "knowledge-provider.v1",
      requestId: `request_${scenario}`,
      traceId: `trace_${scenario}`,
      providerId: EVIDENCE_FIRST_PROVIDER_ID,
      ownerId: EVIDENCE_FIRST_SYNTHETIC_OWNER_ID,
      namespaceId: EVIDENCE_FIRST_SYNTHETIC_NAMESPACE_ID,
      providerScopeId: EVIDENCE_FIRST_PROVIDER_SCOPE_ID,
      operation: "search_evidence",
      requiredCapabilities: [
        {
          capability: "search_evidence",
          requirement: "required"
        }
      ],
      deadlineAt: futureDeadline(),
      search: {
        query: "owner review",
        maximumResults: 2
      }
    });

    assert.notEqual(result.status, "allowed", scenario);
    assert.deepEqual(result.evidence, [], scenario);
    assert.equal(result.releaseState, "internal_unreleased", scenario);
    assert.equal(result.providerMutationAttempted, false, scenario);
    assert.equal(result.memoryMutationAttempted, false, scenario);
    assert.equal(result.trustedMemoryCreated, false, scenario);
  }
});
