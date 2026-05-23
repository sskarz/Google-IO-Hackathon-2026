import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.antigravity import Agent, LocalAgentConfig
from pydantic import BaseModel

load_dotenv(Path(__file__).parent.parent / ".env")

PROJECT_ROOT = Path(__file__).parent.parent
DESIGN_MD = PROJECT_ROOT / "DESIGN.md"

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
