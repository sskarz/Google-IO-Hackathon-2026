"""Smoke test for the Gemini integration. Run with:

    cd backend && uv run python _smoke_test.py

Verifies: key is loaded, model responds, structured output with our Spec
schema parses cleanly, integrity validator passes. Never prints the key.
Safe to delete after running.
"""

import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

# Reuse the production schema + validator.
sys.path.insert(0, str(Path(__file__).parent))
from sys_design_doc_api import (  # noqa: E402
    SPEC_MODEL,
    SPEC_SYSTEM_PROMPT,
    Spec,
    validate_spec_integrity,
)


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"PASS: {msg}")


def main() -> None:
    load_dotenv(Path(__file__).parent.parent / ".env")
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        fail("GEMINI_API_KEY not set in environment")
    ok(f"key loaded ({len(key)} chars)")

    client = genai.Client(api_key=key)

    # 1. Basic round-trip. Note: 2.5-pro is a reasoning model — thinking
    # tokens count against max_output_tokens, so leave plenty of headroom.
    t0 = time.time()
    try:
        resp = client.models.generate_content(
            model=SPEC_MODEL,
            contents="Reply with the single word: pong",
            config=types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=512,
            ),
        )
    except Exception as e:
        fail(f"basic call to {SPEC_MODEL} raised: {type(e).__name__}: {e}")
    elapsed = time.time() - t0
    text = (resp.text or "").strip()
    if not text:
        finish = None
        try:
            finish = resp.candidates[0].finish_reason if resp.candidates else None
        except Exception:
            pass
        feedback = getattr(resp, "prompt_feedback", None)
        fail(
            f"basic call returned empty text; finish_reason={finish}, "
            f"prompt_feedback={feedback}"
        )
    if "pong" not in text.lower():
        fail(f"basic call returned unexpected text: {text!r}")
    ok(f"basic call to {SPEC_MODEL} returned {text!r} in {elapsed:.2f}s")

    # 2. Structured output with the production spec schema.
    t0 = time.time()
    try:
        resp = client.models.generate_content(
            model=SPEC_MODEL,
            contents="a postgres database",
            config=types.GenerateContentConfig(
                system_instruction=SPEC_SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=Spec,
                temperature=0.2,
            ),
        )
    except Exception as e:
        fail(f"structured call raised: {type(e).__name__}: {e}")
    elapsed = time.time() - t0
    raw = resp.text or ""
    if not raw.strip():
        fail("structured call returned empty text")
    ok(f"structured call returned {len(raw)} chars in {elapsed:.2f}s")

    # 3. Pydantic parse.
    try:
        spec = Spec.model_validate_json(raw)
    except Exception as e:
        fail(f"Spec.model_validate_json failed: {e}\nraw: {raw[:300]}")
    ok(f"Spec parsed: {len(spec.nodes)} nodes, {len(spec.edges)} edges")

    # 4. Integrity validator.
    issues = validate_spec_integrity(spec)
    if issues:
        fail("integrity validator returned issues:\n  - " + "\n  - ".join(issues))
    ok("integrity validator clean")

    # 5. Sanity: postgres prompt should produce at least one database node.
    has_db = any(n.type == "database" for n in spec.nodes)
    if not has_db:
        fail(
            "spec for 'a postgres database' contains no database-typed node; "
            f"got types: {[n.type for n in spec.nodes]}"
        )
    ok("spec contains a database node as expected")

    print("\nALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    main()
