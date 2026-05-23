import json
import os
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


EXCLUDED_DIRS = {
    ".git",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
}


@dataclass
class VerificationReport:
    success: bool
    test_summary: str
    stdout: str = ""
    stderr: str = ""
    reasons_for_failure: str | None = None

    def model_dump(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "test_summary": self.test_summary,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "reasons_for_failure": self.reasons_for_failure,
        }


def verify_generated_project(workspace_path: str, role: str) -> VerificationReport:
    """Run non-agentic verification gates for generated workspaces."""
    workspace = Path(workspace_path).resolve()
    checks: list[VerificationReport] = [
        verify_workspace_layout(workspace),
        verify_no_external_file_references(workspace),
        verify_contract_exists(workspace),
        scan_for_shortcuts(workspace),
        verify_generated_tests(workspace),
    ]

    if role == "E2E_VERIFIER":
        checks.extend(
            [
                verify_frontend_build(workspace),
                verify_contract_e2e(workspace),
            ]
        )

    failures = [check for check in checks if not check.success]
    stdout = "\n\n".join(
        f"## {check.test_summary}\n{check.stdout}".strip() for check in checks if check.stdout
    )
    stderr = "\n\n".join(check.stderr for check in checks if check.stderr)

    if failures:
        reasons = "\n".join(
            f"- {failure.test_summary}: {failure.reasons_for_failure or failure.stderr}"
            for failure in failures
        )
        return VerificationReport(
            success=False,
            test_summary=f"{len(failures)} deterministic verification gate(s) failed",
            stdout=stdout,
            stderr=stderr,
            reasons_for_failure=reasons,
        )

    return VerificationReport(
        success=True,
        test_summary=f"All {len(checks)} deterministic verification gates passed",
        stdout=stdout,
        stderr=stderr,
    )


def verify_no_external_file_references(workspace: Path) -> VerificationReport:
    findings: list[str] = []
    workspace_text = str(workspace)

    for path in iter_generated_text_files(workspace):
        rel = path.relative_to(workspace)
        text = path.read_text(errors="ignore")

        if "../.." in text or "..\\.." in text:
            findings.append(f"{rel}: contains a parent-directory escape beyond generated_project")

        for match in re.finditer(r"(?P<path>/Users/[^\s\"'`),;]+)", text):
            referenced_path = match.group("path")
            if not referenced_path.startswith(workspace_text):
                findings.append(f"{rel}: references absolute path outside generated_project: {referenced_path}")

    if findings:
        return VerificationReport(
            success=False,
            test_summary="generated project does not reference files outside generated_project",
            stdout="\n".join(findings),
            reasons_for_failure="Generated project code must not depend on files outside generated_project.",
        )

    return VerificationReport(
        success=True,
        test_summary="generated project does not reference files outside generated_project",
    )


def verify_workspace_layout(workspace: Path) -> VerificationReport:
    backend_dir = workspace / "backend"
    frontend_dir = workspace / "frontend"
    findings: list[str] = []

    if not backend_dir.is_dir():
        findings.append("missing generated_project/backend directory")
    if not frontend_dir.is_dir():
        findings.append("missing generated_project/frontend directory")
    if (workspace / "main.py").exists():
        findings.append("backend FastAPI files must not be written at generated_project/main.py")
    if (workspace / "package.json").exists():
        findings.append("frontend package.json must not be written at generated_project/package.json")
    if backend_dir.is_dir() and not (backend_dir / "main.py").exists():
        findings.append("generated_project/backend/main.py is required for uvicorn main:app")
    if frontend_dir.is_dir() and not (frontend_dir / "package.json").exists():
        findings.append("generated_project/frontend/package.json is required for the Vite app")

    if findings:
        return VerificationReport(
            success=False,
            test_summary="generated workspace uses dedicated backend/frontend folders",
            stdout="\n".join(findings),
            reasons_for_failure="Generated code must be split into generated_project/backend and generated_project/frontend.",
        )

    return VerificationReport(
        success=True,
        test_summary="generated workspace uses dedicated backend/frontend folders",
    )


def verify_contract_exists(workspace: Path) -> VerificationReport:
    contract_path = workspace / "contract.json"
    if not contract_path.exists():
        return VerificationReport(
            success=False,
            test_summary="contract.json exists",
            reasons_for_failure="Missing generated_project/contract.json. The design must be converted into an executable contract before verification.",
        )

    try:
        contract = json.loads(contract_path.read_text())
    except json.JSONDecodeError as exc:
        return VerificationReport(
            success=False,
            test_summary="contract.json is valid JSON",
            reasons_for_failure=str(exc),
        )

    endpoints = contract.get("endpoints")
    if not isinstance(endpoints, list) or not endpoints:
        return VerificationReport(
            success=False,
            test_summary="contract.json declares endpoint contracts",
            reasons_for_failure="contract.json must include a non-empty 'endpoints' array.",
        )

    has_post = any(str(endpoint.get("method", "")).upper() == "POST" for endpoint in endpoints)
    has_get = any(str(endpoint.get("method", "")).upper() == "GET" for endpoint in endpoints)
    if not has_post or not has_get:
        return VerificationReport(
            success=False,
            test_summary="contract.json includes create and read/list flows",
            reasons_for_failure="The contract must include at least one POST endpoint and one GET endpoint for round-trip verification.",
        )

    return VerificationReport(
        success=True,
        test_summary="contract.json exists and declares executable flows",
        stdout=json.dumps({"endpoint_count": len(endpoints)}, indent=2),
    )


def scan_for_shortcuts(workspace: Path) -> VerificationReport:
    findings: list[str] = []

    for path in iter_source_files(workspace):
        rel = path.relative_to(workspace)
        text = path.read_text(errors="ignore")
        normalized = text.replace("\n", " ")

        if path.suffix == ".py":
            if re.search(r"\bDB_PATH\s*=\s*[\"'][^/\\\"']+\.db[\"']", text):
                findings.append(f"{rel}: SQLite DB_PATH is a plain relative path")
            if re.search(r"SELECT\s+COUNT\(\*\).*?INSERT\s+INTO", normalized, re.IGNORECASE | re.DOTALL):
                findings.append(f"{rel}: application appears to seed data when a table is empty")
            if "pytest.skip" in text or "@pytest.mark.skip" in text:
                findings.append(f"{rel}: test suite contains skipped pytest tests")

        if path.suffix in {".js", ".jsx", ".ts", ".tsx"}:
            if re.search(r"useState\s*\(\s*\[\s*[{\"'`0-9]", normalized):
                findings.append(f"{rel}: React state appears to start with hardcoded display data")
            if re.search(r"\b(?:test|it|describe)\.skip\s*\(", text):
                findings.append(f"{rel}: frontend tests contain skipped test blocks")

    frontend_files = [
        path for path in iter_source_files(workspace) if path.suffix in {".js", ".jsx", ".ts", ".tsx"}
    ]
    if frontend_files and not any("fetch(" in path.read_text(errors="ignore") for path in frontend_files):
        findings.append("frontend: no fetch() call found; UI must retrieve data from the generated backend")

    if findings:
        return VerificationReport(
            success=False,
            test_summary="static anti-shortcut scan",
            stdout="\n".join(findings),
            reasons_for_failure="Generated project contains shortcuts that can make verification pass without real functionality.",
        )

    return VerificationReport(success=True, test_summary="static anti-shortcut scan")


def verify_generated_tests(workspace: Path) -> VerificationReport:
    backend = backend_dir(workspace)
    test_files = [
        path for path in iter_source_files(backend) if path.name.startswith("test_") and path.suffix == ".py"
    ]
    if not test_files:
        return VerificationReport(
            success=False,
            test_summary="pytest suite exists",
            reasons_for_failure="No backend pytest files named test_*.py were generated.",
        )

    text = "\n".join(path.read_text(errors="ignore") for path in test_files)
    required_patterns = {
        "POST create flow": r"\.post\s*\(",
        "GET read/list flow": r"\.get\s*\(",
        "round-trip assertions": r"assert\s+.*\[\s*[\"'](?:id|user_id|email|username|name)[\"']\s*\]",
        "validation/error assertions": r"assert\s+.*status_code\s*==\s*4\d\d",
    }
    missing = [name for name, pattern in required_patterns.items() if not re.search(pattern, text)]
    if missing:
        return VerificationReport(
            success=False,
            test_summary="pytest suite covers required data flows",
            reasons_for_failure="Missing test coverage for: " + ", ".join(missing),
        )

    result = run_command([sys.executable, "-m", "pytest", "-q"], cwd=backend, timeout=120)
    return VerificationReport(
        success=result.returncode == 0,
        test_summary="pytest execution",
        stdout=result.stdout,
        stderr=result.stderr,
        reasons_for_failure=None if result.returncode == 0 else f"pytest exited with {result.returncode}",
    )


def verify_frontend_build(workspace: Path) -> VerificationReport:
    frontend = frontend_dir(workspace)
    if not (frontend / "package.json").exists():
        return VerificationReport(success=True, test_summary="frontend build skipped; no package.json")

    result = run_command(["npm", "run", "build"], cwd=frontend, timeout=180)
    return VerificationReport(
        success=result.returncode == 0,
        test_summary="frontend production build",
        stdout=result.stdout,
        stderr=result.stderr,
        reasons_for_failure=None if result.returncode == 0 else f"npm run build exited with {result.returncode}",
    )


def verify_contract_e2e(workspace: Path) -> VerificationReport:
    contract = json.loads((workspace / "contract.json").read_text())
    config = read_config(workspace)
    backend = backend_dir(workspace)
    frontend = frontend_dir(workspace)
    backend_port = int(config.get("backend_port", 8000))
    frontend_port = int(config.get("frontend_port", 5173))
    backend_base = f"http://127.0.0.1:{backend_port}"
    frontend_base = f"http://127.0.0.1:{frontend_port}"
    processes: list[subprocess.Popen[str]] = []
    transcript: list[str] = []

    try:
        if not wait_for_url(f"{backend_base}/docs", timeout=1):
            processes.append(
                subprocess.Popen(
                    [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(backend_port)],
                    cwd=backend,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            )
        if not wait_for_url(f"{backend_base}/docs", timeout=20):
            return VerificationReport(
                success=False,
                test_summary="backend starts for contract E2E",
                stdout="\n".join(transcript),
                reasons_for_failure=f"Backend did not serve /docs on port {backend_port}.",
            )

        if (frontend / "package.json").exists() and not wait_for_url(frontend_base, timeout=1):
            processes.append(
                subprocess.Popen(
                    ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(frontend_port)],
                    cwd=frontend,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            )

        created_payload, sentinel = run_create_flow(contract, backend_base, transcript)
        run_get_flows(contract, backend_base, created_payload, sentinel, transcript)

        if (frontend / "package.json").exists():
            if not wait_for_url(frontend_base, timeout=25):
                return VerificationReport(
                    success=False,
                    test_summary="frontend starts for contract E2E",
                    stdout="\n".join(transcript),
                    reasons_for_failure=f"Frontend did not serve / on port {frontend_port}.",
                )
            status, body = http_request("GET", frontend_base)
            transcript.append(f"GET {frontend_base} -> HTTP {status}\n{body[:500]}")
            if status != 200:
                raise AssertionError(f"Frontend root returned HTTP {status}")

    except Exception as exc:
        return VerificationReport(
            success=False,
            test_summary="contract-driven black-box E2E",
            stdout="\n".join(transcript),
            reasons_for_failure=str(exc),
        )
    finally:
        for process in processes:
            process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()

    return VerificationReport(
        success=True,
        test_summary="contract-driven black-box E2E",
        stdout="\n".join(transcript),
    )


def run_create_flow(contract: dict[str, Any], backend_base: str, transcript: list[str]) -> tuple[dict[str, Any], str]:
    create_endpoint = next(
        (
            endpoint
            for endpoint in contract["endpoints"]
            if str(endpoint.get("method", "")).upper() == "POST"
        ),
        None,
    )
    if not create_endpoint:
        raise AssertionError("No POST endpoint in contract.")

    sentinel = f"contract_{uuid.uuid4().hex[:10]}"
    payload = inject_sentinel(dict(create_endpoint.get("valid_payload") or create_endpoint.get("payload") or {}), sentinel)
    if not payload:
        raise AssertionError("POST endpoint contract must include valid_payload or payload.")

    status, body = http_request("POST", backend_base + create_endpoint["path"], payload)
    transcript.append(f"POST {create_endpoint['path']} {json.dumps(payload)} -> HTTP {status}\n{body}")
    expected = create_endpoint.get("expected_status")
    if expected is not None:
        if status != int(expected):
            raise AssertionError(f"POST {create_endpoint['path']} returned HTTP {status}, expected {expected}.")
    elif status < 200 or status >= 300:
        raise AssertionError(f"POST {create_endpoint['path']} returned HTTP {status}.")
    if sentinel not in body:
        raise AssertionError("Create response did not contain the random sentinel value.")
    return payload, sentinel


def run_get_flows(
    contract: dict[str, Any],
    backend_base: str,
    created_payload: dict[str, Any],
    sentinel: str,
    transcript: list[str],
) -> None:
    get_endpoints = [
        endpoint for endpoint in contract["endpoints"] if str(endpoint.get("method", "")).upper() == "GET"
    ]
    if not get_endpoints:
        raise AssertionError("No GET endpoint in contract.")

    saw_sentinel = False
    for endpoint in get_endpoints:
        path = fill_path_params(endpoint["path"], created_payload)
        status, body = http_request("GET", backend_base + path)
        transcript.append(f"GET {path} -> HTTP {status}\n{body}")
        if status != int(endpoint.get("expected_status", 200)):
            raise AssertionError(f"GET {path} returned HTTP {status}.")
        if sentinel in body:
            saw_sentinel = True

    if not saw_sentinel:
        raise AssertionError("No GET endpoint returned the random record created during E2E verification.")


def inject_sentinel(payload: dict[str, Any], sentinel: str) -> dict[str, Any]:
    for key, value in list(payload.items()):
        lowered = key.lower()
        if isinstance(value, dict):
            payload[key] = inject_sentinel(value, sentinel)
        elif isinstance(value, str):
            if "email" in lowered:
                payload[key] = f"{sentinel}@example.com"
            elif lowered in {"id", "user_id", "profile_id"} or lowered.endswith("_id"):
                payload[key] = sentinel
            elif any(token in lowered for token in ["name", "title", "username"]):
                payload[key] = sentinel
    return payload


def fill_path_params(path: str, payload: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in payload:
            return str(payload[key])
        if key == "id":
            for candidate in ("id", "user_id", "profile_id"):
                if candidate in payload:
                    return str(payload[candidate])
        raise AssertionError(f"Cannot fill path parameter {{{key}}} from created payload.")

    return re.sub(r"{([^}]+)}", replace, path)


def read_config(workspace: Path) -> dict[str, Any]:
    path = workspace / "config.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def backend_dir(workspace: Path) -> Path:
    return workspace / "backend"


def frontend_dir(workspace: Path) -> Path:
    return workspace / "frontend"


def http_request(method: str, url: str, payload: dict[str, Any] | None = None) -> tuple[int, str]:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, response.read().decode("utf-8", errors="replace")
    except URLError as exc:
        if hasattr(exc, "code") and hasattr(exc, "read"):
            return int(exc.code), exc.read().decode("utf-8", errors="replace")
        raise


def wait_for_url(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            status, _ = http_request("GET", url)
            if 200 <= status < 500:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def run_command(command: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def iter_source_files(workspace: Path) -> list[Path]:
    files: list[Path] = []
    for root, dirs, names in os.walk(workspace):
        dirs[:] = [name for name in dirs if name not in EXCLUDED_DIRS]
        for name in names:
            path = Path(root) / name
            if path.suffix in {".py", ".js", ".jsx", ".ts", ".tsx"}:
                files.append(path)
    return files


def iter_generated_text_files(workspace: Path) -> list[Path]:
    allowed_suffixes = {
        ".css",
        ".html",
        ".js",
        ".jsx",
        ".json",
        ".md",
        ".mjs",
        ".py",
        ".sh",
        ".ts",
        ".tsx",
        ".txt",
        ".yaml",
        ".yml",
    }
    files: list[Path] = []
    for root, dirs, names in os.walk(workspace):
        dirs[:] = [name for name in dirs if name not in EXCLUDED_DIRS]
        for name in names:
            path = Path(root) / name
            if path.suffix in allowed_suffixes:
                files.append(path)
    return files
