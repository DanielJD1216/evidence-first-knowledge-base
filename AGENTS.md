# AGENTS.md

## Purpose

This repository is the public design surface for the DOO MADE Knowledge Base. It explains a governed, evidence-first retrieval architecture for humans and AI agents.

It is not a mirror of the private production runtime.

## Read order

Before changing files, read:

1. `README.md`
2. `docs/SECURITY_MODEL.md`
3. `docs/ARCHITECTURE.md`
4. The relevant schema and synthetic example

For Source Wire adapter work, also read
`docs/SOURCE_WIRE_ADAPTER_STORY_1.md`.

## Non-negotiable invariants

1. **No private evidence in Git.** All examples must be synthetic.
2. **Source systems remain authoritative.** The index is a retrieval layer.
3. **Authorization is not filtering.** Access must be tied to an explicit runtime identity and entitlement.
4. **Invalid metadata fails closed.** Do not invent defaults that broaden access.
5. **Deletion must affect active retrieval immediately.** Retention and retrieval are separate concerns.
6. **Answers require citations.** Weak evidence must produce abstention.
7. **Evaluation data stays separate.** Never tune directly against protected holdout questions.
8. **Public contracts must be portable.** Do not bake private endpoints, account IDs, role names, or provider-specific credentials into examples.
9. **Source Wire contracts stay authoritative.** Do not redefine `KnowledgeProvider v1`, `MemoryStore v1`, or Source Wire policy contracts here.

## Public/private boundary

Allowed:

- Generic architecture
- Public interface contracts
- Synthetic fixtures
- Validation scripts
- Documentation and diagrams

Forbidden:

- Real documents, messages, transcripts, or meeting notes
- Credentials or infrastructure identifiers
- Production database dumps or schema ownership receipts
- Private corpus manifests, embeddings, caches, or reports
- Real evaluation questions or expected evidence
- Paths copied from an operator's private machine

When uncertain, leave data out and explain the interface instead.

## Repository map

- `assets/`: publication-safe visual assets
- `docs/`: architecture and security reasoning
- `docs/SOURCE_WIRE_ADAPTER_STORY_1.md`: prepared read-only adapter seam,
  mapping, and synthetic acceptance gate
- `src/`: publication-safe synthetic Source-Wire adapter implementation
- `tests/`: public-interface adapter and fail-closed behavior tests
- `schemas/authorized-evidence-snapshot.schema.json`: complete provider-owned
  snapshot required before Source-Wire mapping
- `schemas/`: public JSON contracts
- `examples/`: synthetic instances of those contracts
- `scripts/validate_repo.py`: zero-dependency repository validation

## Change workflow

1. Identify the affected trust boundary.
2. Name the invariant that protects it.
3. Update the smallest relevant contract or document.
4. Add or update a synthetic example.
5. Run `python3 scripts/validate_repo.py` and the independent gates in `CONTRIBUTING.md`.
6. Run `npm test` for Source-Wire adapter changes.
7. Inspect every staged path before commit.
8. Confirm no private data, generated state, or credentials are staged.

## Definition of done

A change is complete only when:

- Local links resolve.
- JSON examples parse and match their declared schema IDs.
- SVG files parse as XML and contain accessible `title` and `desc` elements.
- The repository validator passes.
- Independent JSON Schema, lint, security, and secret-scanning gates pass.
- The public/private boundary remains explicit.
- A first-time reader can explain the changed component without private context.

## Style

- Use simple words and precise logic.
- State the security boundary before implementation detail.
- Prefer diagrams and contracts over vague prose.
- Avoid provider marketing language.
- Do not claim production behavior that public artifacts cannot prove.
- Never use private metrics as a substitute for a reproducible public test.
