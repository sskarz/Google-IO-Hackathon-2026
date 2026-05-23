from pathlib import Path

from fastapi.testclient import TestClient

import sys_design_doc_api as api


def reset_api_flow_state():
    if api.flow_task is not None and not api.flow_task.done():
        api.flow_task.cancel()
    api.flow_task = None
    api.flow_state.update(
        {
            "run_id": None,
            "status": "idle",
            "started_at": None,
            "finished_at": None,
            "error": None,
        }
    )


def test_start_flow_requires_design(monkeypatch, tmp_path):
    reset_api_flow_state()
    monkeypatch.setattr(api, "DESIGN_MD", tmp_path / "missing.md")

    with TestClient(api.app) as client:
        response = client.post("/start-flow", json={"reset": True})

    assert response.status_code == 400
    assert response.json()["detail"] == "No system design is available to run."


def test_start_flow_schedules_background_run(monkeypatch, tmp_path):
    reset_api_flow_state()
    design_path = tmp_path / "DESIGN.md"
    design_path.write_text("# Test System\n\nBuild a tiny API.", encoding="utf-8")
    monkeypatch.setattr(api, "DESIGN_MD", design_path)
    monkeypatch.setattr(api, "GENERATED_PROJECT", Path(tmp_path / "generated_project"))

    observed = {}

    async def fake_run_flow_background(run_id: str, design_markdown: str, reset: bool):
        observed["run_id"] = run_id
        observed["design_markdown"] = design_markdown
        observed["reset"] = reset
        api.flow_state.update({"run_id": run_id, "status": "completed"})

    monkeypatch.setattr(api, "run_flow_background", fake_run_flow_background)

    with TestClient(api.app) as client:
        response = client.post("/start-flow", json={"reset": False})

    data = response.json()
    assert response.status_code == 200
    assert data["success"] is True
    assert data["status"] == "running"
    assert data["status_url"] == "/flow-status"
    assert observed["design_markdown"] == "# Test System\n\nBuild a tiny API."
    assert observed["reset"] is False


def test_flow_status_returns_task_snapshot(monkeypatch):
    reset_api_flow_state()
    api.flow_state.update({"run_id": "flow_test", "status": "running"})
    monkeypatch.setattr(
        api,
        "task_snapshot",
        lambda: [
            {
                "id": "task_architect_decomposer",
                "title": "Decompose System Design",
                "assigned_role": "ARCHITECT",
                "status": "DONE",
                "error_msg": None,
            }
        ],
    )

    with TestClient(api.app) as client:
        response = client.get("/flow-status")

    data = response.json()
    assert response.status_code == 200
    assert data["status"] == "completed"
    assert data["tasks"][0]["assigned_role"] == "ARCHITECT"
