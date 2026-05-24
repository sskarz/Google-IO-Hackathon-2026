from pathlib import Path
from fastapi.testclient import TestClient
import sys_design_doc_api as api

class FakeResponse:
    def __init__(self, text_val: str, thoughts_val: list[str]):
        self.text_val = text_val
        self.thoughts_val = thoughts_val

    async def text(self) -> str:
        return self.text_val

    @property
    def thoughts(self):
        async def thoughts_generator():
            for thought in self.thoughts_val:
                yield thought
        return thoughts_generator()

class FakeAgent:
    def __init__(self, config=None):
        self.config = config

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass

    async def chat(self, prompt: str) -> FakeResponse:
        return FakeResponse("Mock GCP Deployment Report", ["Thinking...", "Planning..."])


def test_deploy_to_gcp_missing_credentials(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "fake_key")
    monkeypatch.setattr(api, "BACKEND_ROOT", tmp_path)

    with TestClient(api.app) as client:
        response = client.post("/deploy-to-gcp", json={})
    
    assert response.status_code == 400
    assert "gcp-credentials.json not found" in response.json()["detail"]


def test_deploy_to_gcp_success(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "fake_key")
    monkeypatch.setattr(api, "BACKEND_ROOT", tmp_path)
    creds = tmp_path / "gcp-credentials.json"
    creds.write_text("{}", encoding="utf-8")

    # Mock Agent class in sys_design_doc_api module
    monkeypatch.setattr(api, "Agent", FakeAgent)

    with TestClient(api.app) as client:
        response = client.post("/deploy-to-gcp", json={
            "gcp_project_id": "test-project",
            "deploy_backend": True,
            "deploy_frontend": False
        })
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["agent_output"] == "Mock GCP Deployment Report"
    assert data["agent_thoughts"] == "Thinking...Planning..."
