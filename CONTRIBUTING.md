# Contributing

Thanks for helping improve the public DOO MADE Knowledge Base reference architecture.

## Before opening a change

Read:

1. `AGENTS.md`
2. `docs/SECURITY_MODEL.md`
3. `docs/ARCHITECTURE.md`

## Good contributions

- Clarify a trust boundary or invariant
- Improve a public schema without weakening fail-closed behavior
- Add a synthetic edge case
- Improve accessible diagrams or documentation
- Strengthen the repository validator
- Add a portable implementation note backed by evidence

## Do not submit

- Real business evidence or private questions
- Credentials, endpoints, database identities, or deployment output
- Generated embeddings, corpora, caches, or model weights
- Vendor claims without a primary source
- Broad architecture changes without a stated threat model

## Validation

Use Node.js 22.23.1 for the synthetic adapter:

```bash
npm ci
npm test
npm run pack:inspect
```

Run the zero-dependency structural gate first:

```bash
python3 scripts/validate_repo.py
```

Create an isolated validation environment for the independent gates:

```bash
uv venv .venv-validation --python 3.11
uv pip install --python .venv-validation/bin/python -r requirements-validation.txt
.venv-validation/bin/ruff check scripts
.venv-validation/bin/bandit -q -r scripts
```

Validate each example with the full Draft 2020-12 implementation:

```bash
.venv-validation/bin/python - <<'PY'
import json
from pathlib import Path

for path in Path("examples").glob("*.json"):
    example = json.loads(path.read_text(encoding="utf-8"))
    destination = Path("/tmp") / f"{path.stem}.payload.json"
    destination.write_text(json.dumps(example["payload"]), encoding="utf-8")
PY
for example in examples/*.json; do
  name="$(basename "$example" .json)"
  .venv-validation/bin/check-jsonschema \
    --schemafile "schemas/${name}.schema.json" \
    "/tmp/${name}.payload.json"
done
```

Run the independent known-secret scanner:

```bash
.venv-validation/bin/detect-secrets scan --all-files \
  --disable-plugin HexHighEntropyString \
  --disable-plugin Base64HighEntropyString \
  --exclude-files '(^|/)(\.git|\.venv[^/]*|\.ruff_cache|__pycache__)/' \
  > /tmp/detect-secrets.json
.venv-validation/bin/python - <<'PY'
import json
from pathlib import Path

report = json.loads(Path("/tmp/detect-secrets.json").read_text(encoding="utf-8"))
findings = sum(len(items) for items in report.get("results", {}).values())
if findings:
    raise SystemExit(f"detect-secrets found {findings} possible secret(s)")
print("detect-secrets found 0 possible secrets")
PY
```

CI runs the same structural, JSON Schema, lint, security, and secret-scanning gates.

## Pull-request format

Include:

- **Boundary:** What trust boundary changes?
- **Invariant:** What prevents unsafe behavior?
- **Contract:** Which schema, example, or document changes?
- **Verification:** What command proves the change?
- **Privacy:** Why is every added artifact safe to publish?

Small, reviewable pull requests are preferred.
