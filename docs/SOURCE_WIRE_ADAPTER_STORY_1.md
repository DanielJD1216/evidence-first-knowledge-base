# Source Wire Adapter Story 1

Status: design prepared, implementation not started.

## Outcome

Prove that one owner-controlled, read-only adapter can translate an authorized
knowledge-base retrieval into Source Wire's authoritative
`KnowledgeProvider v1` contract without giving Source Wire, MCP, or an agent
direct database access.

This story prepares the seam and synthetic proof only. It does not connect
private evidence, deploy a service, publish credentials, change ranking, or
approve production use.

## Design Target

The module in scope is the adapter between:

- a runnable knowledge-base retrieval boundary, and
- Source Wire's injected `SourceWireKnowledgeProviderV1` interface.

The callers are Source Wire's provider host for `search_evidence` and
`get_evidence`. The adapter must hide knowledge-base identity, query,
authorization, schema-mapping, deadline, and safe-error decisions from those
callers.

Source Wire remains the authority for caller authentication, owner and
namespace policy, protected-read auditing, evidence release, memory candidates,
and trusted-memory lifecycle.

## Current Interface Burden

The current public retrieval result provides:

- a stable evidence ID,
- score and rank,
- an excerpt,
- citation title and locator,
- source timestamp,
- an answered or abstained state.

That is enough for a citation-first reference response, but not enough for a
Source Wire protected evidence release. The adapter still needs an exact,
authorized snapshot containing:

- source and segment identity,
- source version,
- SHA-256 content digest,
- media type,
- sensitivity,
- freshness,
- truncation state,
- an explicit allowed access decision.

The adapter must not invent missing values or infer authorization from a scope
string.

## Pre-Implementation Blockers

Publishing Source Wire's contract candidate is necessary but not sufficient.
The current `0.2.0` package candidate intentionally excludes the Alpha provider
host, so an external adapter has no stable supported host-composition surface
to inject into.

Before adapter implementation:

1. Source Wire must publish a stable package containing
   `SourceWireKnowledgeProviderV1`.
2. Source Wire must expose a supported immutable provider-host injection
   surface, or publish a separate host package with the same protected-release
   behavior.
3. The host must consume the authoritative public contract directly, or
   document and test an explicit host subset. The current public profile
   includes `providerFamily`, `describe`, and `health`, while the Alpha host
   executes only search and exact fetch.
4. Contract and host identifier bounds must be reconciled. The Alpha runtime
   limits Source Wire identifiers to 64 characters, while this repository's
   public IDs allow longer values.

Depending on an unpublished Alpha workspace or copying its host into the
knowledge-base runtime is not an acceptable compatibility path.

## Chosen Seam

The executable adapter belongs beside the runnable knowledge-base retrieval
boundary. It does not belong inside Source Wire or inside this public
documentation-only repository.

This public repository owns:

- provider-neutral evidence and retrieval contracts,
- an additive authorized-evidence snapshot contract,
- the mapping specification,
- synthetic fixtures,
- publication-safe conformance expectations.

The runnable knowledge-base system owns:

- its query-only credential,
- its authorization identity and entitlement mapping,
- active and deleted evidence filtering,
- exact source and segment snapshots,
- retrieval execution and transport cancellation.

Source Wire owns:

- the `KnowledgeProvider v1` contract,
- provider binding and request policy,
- result validation,
- durable protected-read audit,
- single-use release receipts,
- candidate and trusted-memory lifecycle.

### Alternatives considered

| Option | Result | Decision |
|---|---|---|
| Put the knowledge-base adapter inside Source Wire | Couples Source Wire to one database, credential model, and retrieval implementation | Rejected |
| Add a live adapter directly to this public reference repository | Mixes the publication-safe design surface with private runtime ownership before a runnable public retrieval boundary exists | Rejected for Story 1 |
| Place the adapter beside the runnable knowledge-base boundary and publish only its portable contract and synthetic proof here | Keeps credentials and provider behavior local while preserving Source Wire's neutral port | Selected |

## Recommended Interface

The knowledge-base runtime should expose one narrow, owner-controlled reader to
the adapter. Names below are proposals for implementation, not a replacement
for Source Wire's contract.

```ts
function createKnowledgeProviderV1(options: {
  reader: AuthorizedEvidenceReaderV1;
  binding: ImmutableProviderBindingV1;
  readiness: ProviderReadinessProbeV1;
}): SourceWireKnowledgeProviderV1;

interface AuthorizedEvidenceReaderV1 {
  search(input: AuthorizedEvidenceSearchV1): Promise<AuthorizedEvidenceResultV1>;
  get(input: AuthorizedEvidenceGetV1): Promise<AuthorizedEvidenceResultV1>;
}
```

The adapter factory returns Source Wire's authoritative provider interface.
The reader keeps exactly two evidence operations. The adapter handles
`describe` from its immutable profile and `health` through a separate bounded
readiness probe, so operational checks do not widen the data-retrieval surface.

The internal reader result should be a discriminated union with explicit
`allowed`, `partial`, `empty`, `not_found`, `denied`, and `unavailable`
outcomes. Callers must not infer one outcome from missing fields.

### Search input

- bound runtime principal, supplied by construction rather than an agent,
- bound knowledge scope, mapped from the Source Wire owner and namespace,
- bounded UTF-8 query,
- bounded result limit,
- optional provider-bound cursor,
- absolute deadline.

### Exact-fetch input

- bound runtime principal,
- bound knowledge scope,
- source ID,
- segment ID,
- absolute deadline.

### Result

The result is either a safe failure or an ordered list of zero or more
authorized evidence snapshots. Each released snapshot must contain:

| Knowledge-base field | Source Wire mapping |
|---|---|
| `evidence_id` | `providerRecordId` |
| `source_id` | `sourceId` |
| `segment_id` | `segmentId` |
| `source_version` | `sourceVersion` |
| `content_hash` | `contentDigest`, after strict SHA-256 parsing |
| provenance locator | `citationLocator` |
| title | `title` |
| bounded excerpt | `excerpt` |
| content type | `mediaType` |
| truncation flag | `truncated` |
| sensitivity | `sensitivity` |
| freshness | `freshness` |
| source timestamp | `sourceModifiedAt` |
| successful runtime authorization | `aclDecision: allowed` |

The adapter adds only values it authoritatively owns:

- configured provider ID and provider scope,
- owner and namespace from the immutable Source Wire binding,
- retrieval timestamp from its clock,
- `instructionAuthority: none`,
- literal no-mutation and no-auto-promotion flags.

### Mapping decisions to freeze

The additive snapshot contract must settle these meanings before code:

- `content_hash` covers the complete returned segment, not only its excerpt.
- A citation locator may be safe for an authorized caller without being
  publicly shareable. The adapter must not mark a private locator
  `publicSafe: true` unless Source Wire defines that flag as safe for protected
  release rather than public disclosure.
- IDs that exceed Source Wire's accepted bounds require a deterministic,
  collision-resistant opaque mapping with the original identity retained only
  inside the knowledge boundary.
- Sensitivity comes from explicit governed metadata. It is never inferred from
  content or a project name.
- An authorized empty result maps to a safe no-evidence gap. An authorization
  failure maps to denial and must not be presented as abstention.
- Freshness comes from an explicit source-version or watermark policy, not only
  wall-clock age.

## Invariants And Ordering

The adapter must execute in this order:

1. Validate the exact Source Wire request and deadline.
2. Resolve the immutable owner, namespace, principal, and knowledge-scope
   binding.
3. Invoke only the approved read-only retrieval operation.
4. Require the runtime to authorize before retrieving evidence.
5. Exclude inactive or deleted evidence inside the retrieval boundary.
6. Validate every identity, version, digest, locator, bound, and access field.
7. Preserve the exact result order.
8. Translate only the validated snapshot into
   `SourceWireKnowledgeProviderResultV1`.
9. Return it as `internal_unreleased` for Source Wire's audit and receipt
   coordinator.
10. Clear temporary content buffers.

Any failure before step 8 returns zero evidence.

Provider evidence cannot create, approve, correct, revoke, or promote memory.
Content that resembles instructions remains untrusted data.

## Credential Boundary

- Source Wire receives no knowledge-base credential.
- MCP receives no provider credential, endpoint, SQL, or database identity.
- The adapter receives one out-of-band query-only credential.
- The credential may execute only approved search and exact-fetch surfaces.
- It may not insert, update, delete, synchronize, migrate, administer, or run
  arbitrary SQL.
- A requested scope is a filter, not proof of entitlement.
- Logs and errors omit raw queries, evidence bodies, credentials, endpoints,
  private locators, and hidden result counts.

## Safe Results And Errors

Supported safe outcomes should map to Source Wire's existing vocabulary:

- no evidence,
- partial evidence,
- not found,
- unavailable,
- rate limited,
- deadline exceeded,
- provenance incomplete,
- scope violation,
- provider failure.

Unknown errors, malformed results, database outages, expired deadlines, and
authorization uncertainty fail closed. The adapter must cancel its own
database or network work when practical. Source Wire may discard a late result,
but it does not own the adapter's transport cancellation.

## Synthetic Test Surface

Test observable behavior through the adapter's
`SourceWireKnowledgeProviderV1.execute()` interface.

### Allowed cases

- bounded authorized search returns ordered provider-ready snapshots,
- exact fetch returns one matching source and segment,
- empty search returns no evidence and a safe gap,
- provider output remains `internal_unreleased`,
- prompt-shaped content remains data with `instructionAuthority: none`.

### Fail-closed cases

- wrong principal, owner, namespace, or knowledge scope,
- missing or deleted evidence,
- missing segment or source version,
- invalid digest or unsafe locator,
- denied or missing access decision,
- unsupported sensitivity or freshness,
- oversized query, excerpt, result set, cursor, or response,
- mismatched source or segment on exact fetch,
- timeout, ignored cancellation, database outage, or raw exception,
- mutation flags or attempted write behavior.

### Side-effect proof

The synthetic integration must prove:

- zero knowledge-base writes,
- zero memory candidates,
- zero trusted memories,
- zero credentials or evidence bodies in logs,
- no direct Source Wire or MCP database access.

## Story Slices

Implementation should remain blocked until separately approved. When approved,
use these risk-ordered slices:

1. **Source Wire host compatibility, Source Wire:** publish the provider
   contract and a supported immutable host-composition surface that consumes
   the authoritative contract or a tested explicit subset.
2. **Additive snapshot contract, this repository:** add a new portable
   authorized-evidence snapshot schema and synthetic example. Preserve the
   existing evidence-record and retrieval-response contracts.
3. **Callable reader, runnable knowledge-base repository:** implement bounded
   search and exact fetch behind a query-only identity using synthetic data.
4. **Adapter mapping, runnable knowledge-base repository:** implement
   `SourceWireKnowledgeProviderV1` against the reader with strict mapping and
   safe errors.
5. **Adversarial tests, runnable knowledge-base repository:** prove metadata,
   scope, deadline, bound, deletion, and mutation failures release zero
   evidence.
6. **Cross-repository conformance, private integration harness:** run the
   adapter through Source Wire's provider host and disposable protected-read
   path using synthetic data only.

## Acceptance Gate

Adapter Story 1 is complete only when:

- a stable Source Wire package containing `KnowledgeProvider v1` is available,
- a stable supported Source Wire host-composition surface accepts the adapter,
- the authoritative provider contract and host subset have explicit
  compatibility tests,
- search and exact fetch use one query-only callable retrieval boundary,
- every released result is a complete provider-ready evidence snapshot,
- authorization is bound to a runtime identity and entitlement,
- missing metadata fails closed,
- inactive and deleted evidence never appears,
- Source Wire audits the exact result set before caller release,
- synthetic cross-repository conformance passes,
- no private evidence, endpoint, credential, or deployment detail enters Git,
- no production, hosting, live-data, or automatic-memory-promotion claim is
  made.

## Explicitly Not Approved

- Publishing Source Wire `0.2.0`
- Implementing a private adapter
- Adding runtime credentials or endpoints
- Connecting real evidence
- Deploying a knowledge-base or Source Wire service
- Enabling hosted, HTTP, or SSE MCP
- Production database use
- Automatic trusted-memory promotion
