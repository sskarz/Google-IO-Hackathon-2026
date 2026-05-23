import json
import textwrap

from db import find_available_port
from deterministic_verifier import (
    scan_for_shortcuts,
    verify_generated_project,
    verify_no_external_file_references,
    verify_workspace_layout,
)


def write_valid_contract(workspace):
    (workspace / "contract.json").write_text(
        json.dumps(
            {
                "endpoints": [
                    {
                        "method": "POST",
                        "path": "/profiles",
                        "valid_payload": {
                            "user_id": "sample_id",
                            "username": "sample_user",
                            "email": "sample@example.com",
                        },
                        "expected_status": 201,
                    },
                    {
                        "method": "GET",
                        "path": "/profiles/{user_id}",
                        "expected_status": 200,
                    },
                    {
                        "method": "GET",
                        "path": "/profiles",
                        "expected_status": 200,
                    },
                ],
                "frontend_requirements": ["fetch profiles from GET /profiles"],
            }
        )
    )


def write_contract_covered_test(workspace):
    backend = workspace / "backend"
    backend.mkdir(exist_ok=True)
    (backend / "main.py").write_text("app = None\n")
    (backend / "test_generated_contract.py").write_text(
        textwrap.dedent(
            """
            class Response:
                def __init__(self, status_code, body):
                    self.status_code = status_code
                    self.body = body

                def json(self):
                    return self.body


            class Client:
                def post(self, path, json):
                    return Response(201, json)

                def get(self, path):
                    if path == "/missing":
                        return Response(400, {"detail": "invalid"})
                    return Response(200, {"email": "sample@example.com"})


            def test_create_read_list_and_validation_flow():
                client = Client()
                create_response = client.post("/profiles", json={"email": "sample@example.com"})
                assert create_response.status_code == 201
                data = create_response.json()
                assert data["email"] == "sample@example.com"

                read_response = client.get("/profiles/sample_id")
                assert read_response.status_code == 200
                read_data = read_response.json()
                assert read_data["email"] == "sample@example.com"

                list_response = client.get("/profiles")
                assert list_response.status_code == 200

                invalid_response = client.get("/missing")
                assert invalid_response.status_code == 400
            """
        )
    )


def test_deterministic_verifier_fails_without_contract(tmp_path):
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "package.json").write_text("{}")
    write_contract_covered_test(tmp_path)

    report = verify_generated_project(str(tmp_path), "VERIFIER")

    assert not report.success
    assert "contract.json" in report.reasons_for_failure


def test_static_scan_catches_seed_data_and_relative_db_path(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "main.py").write_text(
        textwrap.dedent(
            '''
            DB_PATH = "profiles.db"

            def init_db(cursor):
                cursor.execute("SELECT COUNT(*) FROM profiles")
                cursor.execute("INSERT INTO profiles VALUES ('demo')")
            '''
        )
    )

    report = scan_for_shortcuts(tmp_path)

    assert not report.success
    assert "plain relative path" in report.stdout
    assert "seed data" in report.stdout


def test_workspace_layout_rejects_root_level_apps(tmp_path):
    (tmp_path / "main.py").write_text("app = None\n")
    (tmp_path / "package.json").write_text("{}")

    report = verify_workspace_layout(tmp_path)

    assert not report.success
    assert "backend directory" in report.stdout
    assert "generated_project/main.py" in report.stdout
    assert "generated_project/package.json" in report.stdout


def test_external_reference_gate_rejects_paths_outside_generated_project(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "main.py").write_text(
        "open('/Users/sanskarthapa/Documents/GitHub/google-io-hackathon/backend/db.py')\n"
    )

    report = verify_no_external_file_references(tmp_path)

    assert not report.success
    assert "outside generated_project" in report.stdout


def test_external_reference_gate_allows_parent_reference_to_generated_root(tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / "main.py").write_text("open('../contract.json')\nopen('../config.json')\n")

    report = verify_no_external_file_references(tmp_path)

    assert report.success


def test_find_available_port_writes_config_inside_workspace(tmp_path, monkeypatch):
    outside = tmp_path / "outside"
    workspace = tmp_path / "generated_project"
    outside.mkdir()
    monkeypatch.chdir(outside)

    port = find_available_port("BACKEND", start_port=8765, workspace_path=str(workspace))

    assert isinstance(port, int)
    assert (workspace / "config.json").exists()
    assert not (outside / "config.json").exists()


def test_deterministic_verifier_passes_valid_synthetic_workspace(tmp_path):
    write_valid_contract(tmp_path)
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / "package.json").write_text("{}")
    write_contract_covered_test(tmp_path)

    report = verify_generated_project(str(tmp_path), "VERIFIER")

    assert report.success, report.model_dump()
