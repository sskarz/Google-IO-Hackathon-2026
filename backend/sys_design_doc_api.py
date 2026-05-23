import os
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.antigravity import Agent, LocalAgentConfig
from pydantic import BaseModel

from db import get_all_tasks
from main import run_full_flow

load_dotenv(Path(__file__).parent.parent / ".env")

BACKEND_ROOT = Path(__file__).parent
PROJECT_ROOT = BACKEND_ROOT.parent
DESIGN_MD = PROJECT_ROOT / "DESIGN.md"
GENERATED_PROJECT = BACKEND_ROOT / "generated_project"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

SYSTEM_PROMPT = """\
You are a senior software architect. The user has verbally described a system they want to build.
Convert their transcript into a structured DESIGN.md with exactly these sections:

# Overview
## Goals
## Architecture
## Components
## Data Flow
## Open Questions

Be concrete. Infer reasonable defaults where the user was vague. Flag ambiguities under Open Questions.
Output only the markdown — no preamble, no code fences around the whole document.
"""


class TranscriptRequest(BaseModel):
    transcript: str


class StartFlowRequest(BaseModel):
    reset: bool = True
    design_markdown: str | None = None


flow_state: dict[str, Any] = {
    "run_id": None,
    "status": "idle",
    "started_at": None,
    "finished_at": None,
    "error": None,
}
flow_task: asyncio.Task | None = None


async def generate_markdown(transcript: str) -> str:
    config = LocalAgentConfig(system_instructions=SYSTEM_PROMPT)
    async with Agent(config) as agent:
        response = await agent.chat(transcript)
        return await response.text()


@app.get("/design-md")
async def get_design():
    if not DESIGN_MD.exists():
        return {"content": ""}
    return {"content": DESIGN_MD.read_text(encoding="utf-8")}


@app.post("/generate-design")
async def generate_design(body: TranscriptRequest):
    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="Transcript is empty.")
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set.")

    try:
        markdown = await generate_markdown(body.transcript.strip())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Antigravity error: {e}")

    DESIGN_MD.write_text(markdown, encoding="utf-8")

    preview = markdown[:300] + ("…" if len(markdown) > 300 else "")
    return {"success": True, "preview": preview}


def read_current_design() -> str:
    if not DESIGN_MD.exists():
        return ""
    return DESIGN_MD.read_text(encoding="utf-8")


def task_snapshot() -> list[dict[str, Any]]:
    try:
        return get_all_tasks()
    except Exception:
        return []


def derive_flow_status(tasks: list[dict[str, Any]]) -> str:
    if not tasks:
        return flow_state["status"]
    if any(t["status"] == "BLOCKED" for t in tasks):
        return "blocked"
    if all(t["status"] == "DONE" for t in tasks):
        return "completed"
    if any(t["status"] == "IN_PROGRESS" for t in tasks):
        return "running"
    return "queued"


async def run_flow_background(run_id: str, design_markdown: str, reset: bool) -> None:
    flow_state.update(
        {
            "run_id": run_id,
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "error": None,
        }
    )
    try:
        await run_full_flow(
            design_content=design_markdown,
            workspace_path=str(GENERATED_PROJECT),
            reset=reset,
        )
        flow_state["status"] = derive_flow_status(task_snapshot())
    except Exception as e:
        flow_state["status"] = "failed"
        flow_state["error"] = str(e)
    finally:
        flow_state["finished_at"] = datetime.now(timezone.utc).isoformat()


@app.post("/start-flow")
async def start_flow(body: StartFlowRequest):
    global flow_task

    if flow_task is not None and not flow_task.done():
        raise HTTPException(status_code=409, detail="A generation flow is already running.")

    design_markdown = (body.design_markdown or read_current_design()).strip()
    if not design_markdown:
        raise HTTPException(status_code=400, detail="No system design is available to run.")

    run_id = datetime.now(timezone.utc).strftime("flow_%Y%m%d%H%M%S")
    flow_task = asyncio.create_task(
        run_flow_background(
            run_id=run_id,
            design_markdown=design_markdown,
            reset=body.reset,
        )
    )

    return {
        "success": True,
        "run_id": run_id,
        "status": "running",
        "workspace": str(GENERATED_PROJECT),
        "status_url": "/flow-status",
    }


@app.get("/flow-status")
async def get_flow_status():
    tasks = task_snapshot()
    status = derive_flow_status(tasks)
    if flow_task is not None and not flow_task.done():
        status = "running"

    return {
        **flow_state,
        "status": status,
        "workspace": str(GENERATED_PROJECT),
        "tasks": tasks,
    }
