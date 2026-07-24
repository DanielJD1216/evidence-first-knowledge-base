#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import re
import sys
from typing import Any

# Repository SVGs are bounded and reject DTD/entity declarations before parsing.
import xml.etree.ElementTree as ET  # nosec B405

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "schemas"
EXAMPLE_DIR = ROOT / "examples"
SKIP_PARTS = {".git", ".ruff_cache", ".venv", "__pycache__"}
EXPECTED_SCHEMAS = {"evidence-record.schema.json", "retrieval-response.schema.json"}
EXPECTED_EXAMPLES = {"evidence-record.json", "retrieval-response.json"}
EXPECTED_SVGS = {"retrieval-flow.svg", "system-architecture.svg", "trust-boundaries.svg"}
REQUIRED_PATHS = {
    ".github/SECURITY.md",
    ".github/workflows/validate.yml",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "requirements-validation.txt",
    "assets/knowledge-hero.webp",
    "docs/ARCHITECTURE.md",
    "docs/SECURITY_MODEL.md",
    "scripts/validate_repo.py",
    *(f"assets/{name}" for name in EXPECTED_SVGS),
    *(f"examples/{name}" for name in EXPECTED_EXAMPLES),
    *(f"schemas/{name}" for name in EXPECTED_SCHEMAS),
}
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "API key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "Slack token": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "operator home path": re.compile(r"(?:/home/[A-Za-z0-9._-]+/|/Users/[A-Za-z0-9._-]+/)"),
}
TYPE_MAP = {
    "object": dict,
    "array": list,
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "null": type(None),
}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def validate_value(value: object, schema: dict[str, Any], path: str, errors: list[str]) -> None:
    expected = schema.get("type")
    if expected is not None:
        allowed = expected if isinstance(expected, list) else [expected]
        valid = False
        for item in allowed:
            python_type = TYPE_MAP.get(str(item))
            if python_type is None:
                fail(errors, f"{path}: unsupported schema type {item!r}")
                return
            if item in {"integer", "number"} and isinstance(value, bool):
                continue
            if isinstance(value, python_type):
                valid = True
                break
        if not valid:
            fail(errors, f"{path}: expected {allowed}, got {type(value).__name__}")
            return

    if "const" in schema and value != schema["const"]:
        fail(errors, f"{path}: expected constant {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        fail(errors, f"{path}: value {value!r} is outside enum")

    for child_schema in schema.get("allOf", []):
        if isinstance(child_schema, dict):
            validate_value(value, child_schema, path, errors)
    condition = schema.get("if")
    if isinstance(condition, dict):
        condition_errors: list[str] = []
        validate_value(value, condition, path, condition_errors)
        branch_name = "then" if not condition_errors else "else"
        branch = schema.get(branch_name)
        if isinstance(branch, dict):
            validate_value(value, branch, path, errors)

    if isinstance(value, dict):
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                fail(errors, f"{path}: missing required property {key!r}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                fail(errors, f"{path}: unexpected properties {extra}")
        for key, child in value.items():
            child_schema = properties.get(key)
            if isinstance(child_schema, dict):
                validate_value(child, child_schema, f"{path}.{key}", errors)

    if isinstance(value, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_value(item, item_schema, f"{path}[{index}]", errors)
        if schema.get("uniqueItems"):
            encoded = [json.dumps(item, sort_keys=True) for item in value]
            if len(encoded) != len(set(encoded)):
                fail(errors, f"{path}: array values must be unique")
        if "minItems" in schema and len(value) < int(schema["minItems"]):
            fail(errors, f"{path}: array is shorter than minItems")
        if "maxItems" in schema and len(value) > int(schema["maxItems"]):
            fail(errors, f"{path}: array is longer than maxItems")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < int(schema["minLength"]):
            fail(errors, f"{path}: string is shorter than minLength")
        if "maxLength" in schema and len(value) > int(schema["maxLength"]):
            fail(errors, f"{path}: string is longer than maxLength")
        if "pattern" in schema and re.fullmatch(str(schema["pattern"]), value) is None:
            fail(errors, f"{path}: value does not match required pattern")
        if schema.get("format") == "date-time":
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                fail(errors, f"{path}: invalid date-time")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            fail(errors, f"{path}: value is below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            fail(errors, f"{path}: value is above maximum")


def validate_repository_shape(errors: list[str]) -> int:
    missing = sorted(path for path in REQUIRED_PATHS if not (ROOT / path).is_file())
    for path in missing:
        fail(errors, f"required repository file is missing: {path}")
    return len(REQUIRED_PATHS) - len(missing)


def validate_contracts(errors: list[str]) -> int:
    schemas: dict[str, dict[str, Any]] = {}
    checked = 0
    schema_paths = sorted(SCHEMA_DIR.glob("*.schema.json"))
    schema_names = {path.name for path in schema_paths}
    if schema_names != EXPECTED_SCHEMAS:
        fail(errors, f"schemas: expected {sorted(EXPECTED_SCHEMAS)}, found {sorted(schema_names)}")
    for path in schema_paths:
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            fail(errors, f"{path.relative_to(ROOT)}: invalid JSON: {exc}")
            continue
        schema_id = schema.get("$id")
        if not isinstance(schema_id, str) or not schema_id:
            fail(errors, f"{path.relative_to(ROOT)}: missing $id")
            continue
        schemas[schema_id] = schema
        checked += 1

    example_paths = sorted(EXAMPLE_DIR.glob("*.json"))
    example_names = {path.name for path in example_paths}
    if example_names != EXPECTED_EXAMPLES:
        fail(errors, f"examples: expected {sorted(EXPECTED_EXAMPLES)}, found {sorted(example_names)}")
    for path in example_paths:
        try:
            example = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            fail(errors, f"{path.relative_to(ROOT)}: invalid JSON: {exc}")
            continue
        if set(example) != {"contract", "payload"}:
            fail(errors, f"{path.relative_to(ROOT)}: expected only contract and payload")
            continue
        contract = example.get("contract")
        schema = schemas.get(str(contract))
        if schema is None:
            fail(errors, f"{path.relative_to(ROOT)}: unknown contract {contract!r}")
            continue
        validate_value(example.get("payload"), schema, str(path.relative_to(ROOT)), errors)
        checked += 1
    return checked


def validate_svgs(errors: list[str]) -> int:
    checked = 0
    namespace = "{http://www.w3.org/2000/svg}"
    svg_paths = sorted((ROOT / "assets").glob("*.svg"))
    svg_names = {path.name for path in svg_paths}
    if svg_names != EXPECTED_SVGS:
        fail(errors, f"assets: expected SVGs {sorted(EXPECTED_SVGS)}, found {sorted(svg_names)}")
    for path in svg_paths:
        try:
            text = path.read_text(encoding="utf-8")
            if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
                fail(errors, f"{path.relative_to(ROOT)}: DTD and entity declarations are not allowed")
                continue
            root = ET.fromstring(text)  # nosec B314
        except (OSError, ET.ParseError) as exc:
            fail(errors, f"{path.relative_to(ROOT)}: invalid SVG XML: {exc}")
            continue
        if root.tag != f"{namespace}svg":
            fail(errors, f"{path.relative_to(ROOT)}: root element is not SVG")
        title = root.find(f"{namespace}title")
        desc = root.find(f"{namespace}desc")
        if title is None or not (title.text or "").strip():
            fail(errors, f"{path.relative_to(ROOT)}: missing accessible title")
        if desc is None or not (desc.text or "").strip():
            fail(errors, f"{path.relative_to(ROOT)}: missing accessible description")
        for element in root.iter():
            for attribute, value in element.attrib.items():
                local_name = attribute.rsplit("}", 1)[-1].lower()
                if local_name.startswith("on"):
                    fail(errors, f"{path.relative_to(ROOT)}: event handlers are not allowed in SVG")
                if local_name == "href" and not value.startswith("#"):
                    fail(errors, f"{path.relative_to(ROOT)}: external SVG references are not allowed")
        if root.findall(f".//{namespace}script"):
            fail(errors, f"{path.relative_to(ROOT)}: scripts are not allowed in SVG")
        checked += 1
    return checked


def validate_markdown_links(errors: list[str]) -> int:
    checked = 0
    link_pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
    html_image_pattern = re.compile(r"\bsrc=[\"']([^\"']+)[\"']")
    for path in sorted(ROOT.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        targets = link_pattern.findall(text) + html_image_pattern.findall(text)
        for target in targets:
            clean = target.strip().split("#", 1)[0].split("?", 1)[0]
            if not clean or clean.startswith(("http://", "https://", "mailto:", "#")):
                continue
            destination = (path.parent / clean).resolve()
            try:
                destination.relative_to(ROOT)
            except ValueError:
                fail(errors, f"{path.relative_to(ROOT)}: link escapes repository: {target}")
                continue
            if not destination.exists():
                fail(errors, f"{path.relative_to(ROOT)}: missing local target {target}")
            checked += 1
    return checked


def validate_publication_safety(errors: list[str]) -> int:
    checked = 0
    for path in sorted(ROOT.rglob("*")):
        skipped = any(part in SKIP_PARTS or part.startswith(".venv") for part in path.parts)
        if not path.is_file() or skipped:
            continue
        relative = path.relative_to(ROOT)
        try:
            data = path.read_bytes()
        except OSError as exc:
            fail(errors, f"{relative}: could not read file: {exc}")
            continue
        if len(data) > 2_000_000:
            fail(errors, f"{relative}: public artifact exceeds 2 MB")
        if b"\x00" in data[:8192]:
            checked += 1
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            checked += 1
            continue
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                fail(errors, f"{relative}: possible {label}")
        checked += 1
    return checked


def main() -> int:
    errors: list[str] = []
    counts = {
        "required_files": validate_repository_shape(errors),
        "contracts_and_examples": validate_contracts(errors),
        "svg_assets": validate_svgs(errors),
        "local_links": validate_markdown_links(errors),
        "public_files": validate_publication_safety(errors),
    }
    if errors:
        print("Repository validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    summary = ", ".join(f"{name}={count}" for name, count in counts.items())
    print(f"Repository validation passed: {summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
