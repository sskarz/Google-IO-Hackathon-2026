import asyncio
import base64
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
import traceback
from dataclasses import dataclass, field
from google.antigravity import Agent, LocalAgentConfig

logging.basicConfig(level=logging.INFO)

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

from db import get_all_tasks
from main import run_full_flow

load_dotenv(Path(__file__).parent.parent / ".env")

BACKEND_ROOT = Path(__file__).parent
PROJECT_ROOT = BACKEND_ROOT.parent
DESIGN_MD = PROJECT_ROOT / "DESIGN.md"
GENERATED_PROJECT = BACKEND_ROOT / "generated_project"
SPEC_MODEL = os.getenv("GEMINI_SPEC_MODEL", "gemini-2.5-pro")
AUDITOR_MODEL = "gemini-3.5-flash"
TTS_MODEL = "gemini-2.5-flash-preview-tts"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Spec models (untouched) ────────────────────────────────────────────────────

SPEC_SYSTEM_PROMPT = """\
You are a system architecture interpreter. You read system design
descriptions and produce a structured JSON spec describing the
components and their relationships. The spec drives a 3D visualization.

Output only valid JSON matching the response schema. No prose, no
markdown, no code fences.

Use these exact values for `type`:
- client: browsers, mobile apps, IoT, third-party API consumers
- cdn: content delivery networks
- load_balancer: load balancers, reverse proxies
- api_gateway: API gateways, BFFs
- service: application services, microservices, monoliths
- worker: background workers, job processors
- database: SQL or NoSQL persistent stores
- cache: in-memory caches
- queue: point-to-point message queues
- stream: event streams, pub/sub topics
- object_store: blob storage
- search_index: search engines, vector DBs
- external: third-party services

Use `subtype` when the doc names a specific technology:
"postgres", "mysql", "mongodb", "dynamodb", "redis", "memcached",
"kafka", "kinesis", "sqs", "rabbitmq", "s3", "gcs", etc.

Use these exact values for edge `kind`:
- sync: blocking request/response (HTTP, gRPC, SQL)
- async: fire-and-forget (queue publish, webhook)
- replication: data sync between stores
- data_flow: ETL, batch jobs

Edges go FROM caller/producer TO callee/consumer.

IDs are snake_case slugs, unique within the spec. Edge IDs follow
the pattern "{from}_to_{to}" unless multiple edges exist between
the same pair.

Only include components the input explicitly describes. Do not add
"obviously needed" infrastructure (monitoring, auth, logging) unless
the input mentions it. Use `groups` only when the input explicitly
mentions a boundary (VPC, region, AZ, cluster). When ambiguous about
a connection, omit it rather than guess.
"""

NodeType = Literal[
    "client", "cdn", "load_balancer", "api_gateway",
    "service", "worker", "database", "cache", "queue",
    "stream", "object_store", "search_index", "external",
]
EdgeKind = Literal["sync", "async", "replication", "data_flow"]
GroupType = Literal["vpc", "region", "az", "cluster", "boundary"]


class SpecNode(BaseModel):
    id: str
    type: NodeType
    subtype: str | None = None
    label: str
    replicas: int | None = None
    groupId: str | None = None


class SpecEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    from_: str = Field(alias="from")
    to: str
    kind: EdgeKind
    protocol: str | None = None
    label: str | None = None


class SpecGroup(BaseModel):
    id: str
    type: GroupType
    label: str
    childIds: list[str]


class SpecMetadata(BaseModel):
    name: str | None = None
    description: str | None = None


class Spec(BaseModel):
    nodes: list[SpecNode]
    edges: list[SpecEdge]
    groups: list[SpecGroup] | None = None
    metadata: SpecMetadata | None = None


def validate_spec_integrity(spec: Spec) -> list[str]:
    issues: list[str] = []
    node_ids = {n.id for n in spec.nodes}
    if len(node_ids) != len(spec.nodes):
        issues.append("duplicate node ids")

    seen_edges: set[str] = set()
    for i, e in enumerate(spec.edges):
        if e.id in seen_edges:
            issues.append(f"edges[{i}]: duplicate id '{e.id}'")
        seen_edges.add(e.id)
        if e.from_ not in node_ids:
            issues.append(f"edges[{i}]: unknown from '{e.from_}'")
        if e.to not in node_ids:
            issues.append(f"edges[{i}]: unknown to '{e.to}'")
        if e.from_ == e.to:
            issues.append(f"edges[{i}]: self-loop on '{e.from_}'")

    group_ids: set[str] = set()
    for gi, g in enumerate(spec.groups or []):
        if g.id in group_ids:
            issues.append(f"groups[{gi}]: duplicate id '{g.id}'")
        group_ids.add(g.id)
        for ci, cid in enumerate(g.childIds):
            if cid not in node_ids:
                issues.append(f"groups[{gi}].childIds[{ci}]: unknown node '{cid}'")
    for ni, n in enumerate(spec.nodes):
        if n.groupId and n.groupId not in group_ids:
            issues.append(f"nodes[{ni}].groupId: unknown group '{n.groupId}'")
    return issues


def call_gemini_for_spec(prompt: str, api_key: str) -> Spec:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=SPEC_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SPEC_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=Spec,
            temperature=0.2,
        ),
    )
    text = response.text or ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini returned non-JSON: {e}; got: {text[:200]}",
        )
    return Spec.model_validate(data)


# ── Auditor ────────────────────────────────────────────────────────────────────

DESIGN_SECTIONS = ["goals", "architecture", "components", "data_flow"]

AUDITOR_SYSTEM_PROMPT = """\
You are a senior software architect conducting a voice interview to build a system design document.
Work through these four sections strictly in order:
  1. goals        — what the system does, the problem it solves, key goals and non-goals
  2. architecture — high-level approach: monolith/microservices, sync/async, main patterns
  3. components   — individual services/components and their responsibilities
  4. data_flow    — how requests and data move through the system, external integrations

Rules:
- Focus on ONE section at a time — the one listed as current_section in your context.
- Ask 1–2 targeted questions per turn to build understanding of that section.
- Only confirm a section when you have CONCRETE, specific detail — not vague generalities.
- When you have enough to write a complete, well-scoped section:
    - Set section_confirmed to that section's key (e.g. "goals")
    - Set section_content to well-written markdown for that section (include the ## heading)
- After confirming a section, naturally introduce the next one in your response.
- When all four sections are confirmed (all_sections_done: true in context), set all_done: true
  and populate full_design with the complete integrated document.

Section content format:
  goals:        "## Goals\n- <bullet per goal>\n\n### Non-Goals\n- <bullet if mentioned>"
  architecture: "## Architecture\n<paragraph describing high-level approach and key decisions>"
  components:   "## Components\n### ComponentName\n<role and responsibilities>"
  data_flow:    "## Data Flow\n1. <numbered steps of key request/data flows>"

Response rules:
1. response is 2–3 sentences max — it is spoken aloud, keep it natural and conversational, no lists.
2. transcript must be verbatim transcription of what the user said in the audio.
3. full_design (only when all_done=true) uses exactly this structure:
   # <System Name>
   ## Overview
   <one concise paragraph>
   ## Goals
   <content>
   ## Architecture
   <content>
   ## Components
   <content>
   ## Data Flow
   <content>
4. Output only valid JSON matching the schema. No prose outside the JSON.
"""

DESIGN_WRITER_PROMPT = """\
You are a senior software architect. Based on the conversation history provided,
write a complete system design document. Use exactly these sections:
# <System Name>
## Overview
## Goals
## Architecture
## Components
## Data Flow
Be concrete. Output only the markdown — no preamble, no code fences.
"""


class AuditorTurnResponse(BaseModel):
    transcript: str
    response: str
    section_confirmed: str | None = None
    section_content: str | None = None
    all_done: bool = False
    full_design: str | None = None


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


@dataclass
class AuditSession:
    history: list[dict] = field(default_factory=list)
    sections_confirmed: dict[str, str] = field(default_factory=dict)
    design_saved: bool = False


_session = AuditSession()


def _build_system_prompt() -> str:
    confirmed = list(_session.sections_confirmed.keys())
    remaining = [s for s in DESIGN_SECTIONS if s not in _session.sections_confirmed]
    current = remaining[0] if remaining else None
    all_done = len(remaining) == 0

    state = (
        "\n---\nCurrent session state:\n"
        f"- Sections confirmed so far: {', '.join(confirmed) if confirmed else 'none yet'}\n"
        f"- Current section to discuss: {current if current else 'all confirmed'}\n"
        f"- all_sections_done: {str(all_done).lower()}\n"
    )
    return AUDITOR_SYSTEM_PROMPT + state


def _write_sections_to_design() -> None:
    parts = []
    for key in DESIGN_SECTIONS:
        content = _session.sections_confirmed.get(key)
        if content:
            parts.append(content.strip())
    DESIGN_MD.write_text("\n\n".join(parts), encoding="utf-8")


def _call_auditor(ogg_bytes: bytes, api_key: str) -> AuditorTurnResponse:
    client = genai.Client(api_key=api_key)

    contents: list[types.Content] = []
    for msg in _session.history:
        contents.append(
            types.Content(role=msg["role"], parts=[types.Part.from_text(msg["text"])])
        )
    contents.append(
        types.Content(
            role="user",
            parts=[types.Part(inline_data=types.Blob(data=ogg_bytes, mime_type="audio/ogg"))],
        )
    )

    response = client.models.generate_content(
        model=AUDITOR_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=_build_system_prompt(),
            thinking_config=types.ThinkingConfig(thinking_budget=2048),
            response_mime_type="application/json",
            response_schema=AuditorTurnResponse,
            temperature=0.3,
        ),
    )
    data = json.loads(response.text or "{}")
    return AuditorTurnResponse.model_validate(data)


def _call_tts(text: str, api_key: str) -> tuple[bytes, str]:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=TTS_MODEL,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["audio"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
                )
            ),
        ),
    )
    part = response.candidates[0].content.parts[0]
    raw = part.inline_data.data
    audio_bytes = base64.b64decode(raw) if isinstance(raw, str) else raw
    return audio_bytes, part.inline_data.mime_type


def _force_write_design(api_key: str) -> None:
    client = genai.Client(api_key=api_key)
    history_text = "\n\n".join(
        f"{m['role'].upper()}: {m['text']}" for m in _session.history
    )
    response = client.models.generate_content(
        model=AUDITOR_MODEL,
        contents=history_text,
        config=types.GenerateContentConfig(
            system_instruction=DESIGN_WRITER_PROMPT,
            temperature=0.2,
        ),
    )
    DESIGN_MD.write_text(response.text or "", encoding="utf-8")
    _session.design_saved = True


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.post("/auditor/turn")
async def auditor_turn(audio: UploadFile = File(...)):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set.")
    if _session.design_saved:
        raise HTTPException(status_code=400, detail="Design already saved. Reset to start over.")

    ogg_bytes = await audio.read()
    if not ogg_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    try:
        result = _call_auditor(ogg_bytes, api_key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auditor error: {e}")

    _session.history.append({"role": "user", "text": result.transcript})
    _session.history.append({"role": "model", "text": result.response})

    # Write section immediately when confirmed for the first time
    if (
        result.section_confirmed
        and result.section_content
        and result.section_confirmed in DESIGN_SECTIONS
        and result.section_confirmed not in _session.sections_confirmed
    ):
        _session.sections_confirmed[result.section_confirmed] = result.section_content
        _write_sections_to_design()

    if result.all_done and result.full_design and not _session.design_saved:
        DESIGN_MD.write_text(result.full_design, encoding="utf-8")
        _session.design_saved = True

    remaining = [s for s in DESIGN_SECTIONS if s not in _session.sections_confirmed]
    current_section = remaining[0] if remaining else None
    sections_progress = {s: s in _session.sections_confirmed for s in DESIGN_SECTIONS}

    audio_b64: str | None = None
    audio_mime = "audio/pcm;rate=24000"
    tts_error: str | None = None
    try:
        audio_bytes, audio_mime = _call_tts(result.response, api_key)
        audio_b64 = base64.b64encode(audio_bytes).decode()
    except Exception as e:
        tts_error = str(e)

    return {
        "sections_progress": sections_progress,
        "current_section": current_section,
        "design_saved": _session.design_saved,
        "audio": audio_b64,
        "audio_mime": audio_mime,
        "tts_error": tts_error,
    }


@app.post("/auditor/done")
async def auditor_done():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set.")
    if not _session.history:
        raise HTTPException(status_code=400, detail="No conversation to finalize.")

    if not _session.design_saved:
        try:
            _force_write_design(api_key)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Design write error: {e}")

    return {"design_saved": True}


@app.post("/auditor/reset")
async def auditor_reset():
    global _session
    _session = AuditSession()
    return {"reset": True}


@app.get("/design-md")
async def get_design():
    if not DESIGN_MD.exists():
        return {"content": ""}
    return {"content": DESIGN_MD.read_text(encoding="utf-8")}


@app.post("/generate-spec")
async def generate_spec():
    if not DESIGN_MD.exists():
        raise HTTPException(
            status_code=404,
            detail="DESIGN.md not found. Run /generate-design first.",
        )
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set.")

    markdown = DESIGN_MD.read_text(encoding="utf-8")
    if not markdown.strip():
        raise HTTPException(status_code=400, detail="DESIGN.md is empty.")

    # Run the blocking Gemini call in a thread so the asyncio event loop stays
    # free to service the auditor WebSocket (audio in/out + tool calls). Without
    # this, generate-spec freezes the conversation for the duration of the call.
    try:
        spec = await asyncio.to_thread(call_gemini_for_spec, markdown, api_key)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini error: {e}")

    issues = validate_spec_integrity(spec)
    if issues:
        retry_prompt = (
            f"{markdown}\n\n"
            f"Previous attempt failed validation:\n- "
            + "\n- ".join(issues)
            + "\nProduce a corrected spec."
        )
        try:
            spec = await asyncio.to_thread(call_gemini_for_spec, retry_prompt, api_key)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Gemini retry error: {e}")
        issues = validate_spec_integrity(spec)
        if issues:
            raise HTTPException(
                status_code=422,
                detail={"message": "Spec validation failed after retry", "issues": issues},
            )

    return spec.model_dump(by_alias=True, exclude_none=True)


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


# ── Gemini Live API ────────────────────────────────────────────────────────────

LIVE_MODEL = "gemini-3.1-flash-live-preview"

LIVE_SYSTEM_PROMPT = """\
You are a senior software architect conducting a voice interview that builds AND
hardens a system design document. You are constructive in the discuss phase and
ADVERSARIAL in the red-team phase. Speak naturally — responses are played as
audio. Keep each turn to 1–2 short sentences. Ask ONE question per turn — never
chain multiple questions together.

Work through these four sections IN ORDER. Only move to the next section after
the current one is confirmed AND hardened:
  1. goals        — what the system does, key goals and non-goals
  2. architecture — high-level approach (monolith/microservices, sync/async)
  3. components   — individual services/components and their responsibilities
  4. data_flow    — how data and requests move through the system

For each section, follow this 5-phase loop strictly:

Phase 1 — DISCUSS:
- Ask ONE focused question per turn. Never chain ("X and also Y?"). One question.
- DO NOT confirm prematurely. You must NOT call confirm_section until you have at
  least this much coverage:
    goals:        2+ specific goals the user named, plus any non-goals they mentioned
    architecture: the monolith/services decision PLUS at least one key pattern
                  (sync vs async, caching strategy, sharding, etc.)
    components:   3+ named components with their responsibilities, OR the user has
                  explicitly said the list is complete
    data_flow:    at least one COMPLETE end-to-end flow described step by step
- If you don't have that yet, ask the NEXT question instead of confirming.
- After each user turn, ask yourself: "Did the user actually answer my question
  with concrete detail, or did they wave at it?" If they waved, dig in further
  before moving on. Resist the urge to confirm early just to reach the red-team phase.

Phase 2 — CONFIRM:
- Re-read every user turn for this section in your head before composing section_content.
- The section_content MUST include EVERY specific detail the user has stated for this
  section. Do not drop, paraphrase away, or condense out goals, components, or flows
  the user named. If the user said "five services: orders, inventory, payments,
  shipping, notifications", all five must appear in section_content.
- Call confirm_section with the complete markdown for that section.
- In your spoken reply, briefly acknowledge it ("Got it — orders service writes to
  Postgres, kafka for events…").

Phase 3 — RED-TEAM (exactly ONE sharp critique, specific to the section just confirmed):
- Immediately after confirm_section, raise the SINGLE most important weakness for
  that section's domain. Phrase it as a concrete, pointed question.
- Pick from the section's risk surface:
    goals:        ambiguity, conflicting goals, missing non-goals, scope creep
    architecture: failure modes, scaling cliffs, coordination overhead, tech mismatch
    components:   single points of failure, missing infra (auth, monitoring), ownership
    data_flow:    race conditions, consistency gaps, security (auth/encryption), exactly-once
- Examples of good red-team prompts:
    "What happens to in-flight orders when the Postgres primary dies?"
    "If traffic spikes 10x overnight, where does this architecture break first?"
    "How do you stop a malicious client from replaying the same purchase event?"
- ONE critique only. Be sharp, not exhaustive.

Phase 4 — HARDEN:
- Listen to the user's answer.
- If the answer materially changes the section (adds a component, changes a flow,
  introduces a mitigation), call confirm_section AGAIN with the UPDATED content for
  the same section_key. Re-confirming overwrites the previous content — that is
  intentional. The diagram updates to reflect the hardened design.
- If the user just clarifies without changing substance, accept the answer and
  do NOT re-call confirm_section.

Phase 5 — TRANSITION:
- Only after the red-team round, move to the next section with a natural handoff
  ("Alright, that covers components. Let's talk about data flow — …").

When all four sections are confirmed AND hardened, call finalize_design with
the complete integrated markdown document.

CRITICAL — Final wrap-up message:
- The spoken response that accompanies finalize_design MUST clearly say, near the end:
    "Your system design is ready. You're good to go."
- This is the user's signal that the conversation is complete. Do not skip it.

Section content format for confirm_section (include the ## heading):
  goals:        "## Goals\n- <goal bullets>\n\n### Non-Goals\n- <if mentioned>"
  architecture: "## Architecture\n<clear paragraph on high-level approach>"
  components:   "## Components\n### Name\n<role and responsibilities per component>"
  data_flow:    "## Data Flow\n1. <numbered steps of key flows>"

Start immediately: greet the user warmly and ask what system they want to build.
"""

LIVE_TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="confirm_section",
                description="Call when you have enough concrete information to write a complete design section",
                parameters={
                    "type": "object",
                    "properties": {
                        "section_key": {
                            "type": "string",
                            "description": "One of: goals, architecture, components, data_flow",
                        },
                        "section_content": {
                            "type": "string",
                            "description": "Complete markdown for the section including its ## heading",
                        },
                    },
                    "required": ["section_key", "section_content"],
                },
            ),
            types.FunctionDeclaration(
                name="finalize_design",
                description="Call when all four sections are confirmed to write the complete design document",
                parameters={
                    "type": "object",
                    "properties": {
                        "full_design": {
                            "type": "string",
                            "description": "Complete DESIGN.md markdown with all sections",
                        },
                    },
                    "required": ["full_design"],
                },
            ),
        ]
    )
]


async def _handle_live_tool(name: str, args: dict, websocket: WebSocket) -> str:
    global _session
    if name == "confirm_section":
        key = args.get("section_key", "")
        content = args.get("section_content", "")
        if key in DESIGN_SECTIONS and content:
            # Allow re-confirm so the hardened post-red-team content overwrites
            # the first confirm. The frontend will refetch the spec and the
            # diagram updates to reflect the harder design.
            was_update = key in _session.sections_confirmed
            _session.sections_confirmed[key] = content
            _write_sections_to_design()
            remaining = [s for s in DESIGN_SECTIONS if s not in _session.sections_confirmed]
            await websocket.send_text(json.dumps({
                "type": "progress",
                "sections_progress": {s: s in _session.sections_confirmed for s in DESIGN_SECTIONS},
                "current_section": remaining[0] if remaining else None,
            }))
            return "updated" if was_update else "saved"
        return "saved"

    if name == "finalize_design":
        full = args.get("full_design", "")
        if full and not _session.design_saved:
            DESIGN_MD.write_text(full, encoding="utf-8")
            _session.design_saved = True
            await websocket.send_text(json.dumps({
                "type": "design_saved",
                "sections_progress": {s: True for s in DESIGN_SECTIONS},
                "current_section": None,
            }))
        return "saved"

    return "unknown tool"


@app.websocket("/auditor/ws")
async def auditor_ws(websocket: WebSocket):
    await websocket.accept()

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        await websocket.send_text(json.dumps({"type": "error", "message": "GEMINI_API_KEY not set"}))
        await websocket.close()
        return

    global _session
    _session = AuditSession()

    client = genai.Client(api_key=api_key)
    stop = asyncio.Event()
    user_done = False

    live_config = {
        "response_modalities": ["AUDIO"],
        "system_instruction": LIVE_SYSTEM_PROMPT,
        "tools": LIVE_TOOLS,
        "speech_config": types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
        "context_window_compression": types.ContextWindowCompressionConfig(
            sliding_window=types.SlidingWindow()
        ),
    }

    try:
        logging.info("opening gemini live session (single session for this browser ws)")
        async with client.aio.live.connect(model=LIVE_MODEL, config=live_config) as session:
            # Greet ONCE per session
            await session.send_client_content(
                turns=[types.Content(role="user", parts=[types.Part(text="Hello")])],
                turn_complete=True,
            )

            async def recv_from_browser():
                nonlocal user_done
                try:
                    while not stop.is_set():
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            logging.info("recv_from_browser: client disconnected")
                            stop.set()
                            return
                        if "bytes" in msg and msg["bytes"]:
                            try:
                                await session.send_realtime_input(
                                    audio=types.Blob(data=msg["bytes"], mime_type="audio/pcm;rate=16000")
                                )
                            except Exception as e:
                                logging.warning(f"send_realtime_input failed: {e}")
                                stop.set()
                                return
                        elif "text" in msg:
                            try:
                                data = json.loads(msg["text"])
                                t = data.get("type")
                                if t == "done":
                                    user_done = True
                                    stop.set()
                                    return
                                elif t == "mute":
                                    # Per docs: flush cached audio when stream pauses
                                    try:
                                        await session.send_realtime_input(audio_stream_end=True)
                                        logging.info("sent audio_stream_end (mute)")
                                    except Exception as e:
                                        logging.warning(f"audio_stream_end failed: {e}")
                            except Exception:
                                pass
                except WebSocketDisconnect:
                    stop.set()
                except Exception as e:
                    logging.error(f"recv_from_browser error: {e}\n{traceback.format_exc()}")
                    stop.set()

            # When finalize_design fires, we don't close the session immediately —
            # we want Gemini to speak its "you're good to go" wrap-up turn first.
            # We close once Gemini emits turn_complete after the tool response,
            # with a safety timer in case the model never produces one.
            wrap_up_pending = False
            WRAP_UP_TIMEOUT = 15.0

            async def _safety_close_after_wrap_up():
                await asyncio.sleep(WRAP_UP_TIMEOUT)
                if wrap_up_pending and not stop.is_set():
                    logging.warning("wrap-up safety timeout reached; closing session")
                    stop.set()

            async def recv_from_gemini():
                """
                Wraps session.receive() in an outer while loop. The SDK's receive()
                iterator may end at turn_complete even though the WS stays open —
                we re-enter and call receive() again. Only an actual exception
                (ConnectionClosedError) means the session truly ended.
                """
                nonlocal wrap_up_pending
                try:
                    logging.info("recv_from_gemini: started")
                    while not stop.is_set():
                        got_any = False
                        async for msg in session.receive():
                            got_any = True
                            if stop.is_set():
                                break

                            go_away = getattr(msg, "go_away", None)
                            if go_away:
                                logging.warning(
                                    f"GoAway received, time_left={getattr(go_away, 'time_left', None)}"
                                )

                            sc = getattr(msg, "server_content", None)
                            if sc and getattr(sc, "turn_complete", False):
                                if wrap_up_pending:
                                    # Gemini just finished speaking the wrap-up. Close.
                                    logging.info("wrap-up turn_complete received, closing session")
                                    stop.set()
                                    return
                                logging.info("turn_complete received (session stays open)")

                            if hasattr(msg, "data") and msg.data:
                                raw = msg.data
                                audio = base64.b64decode(raw) if isinstance(raw, str) else raw
                                try:
                                    await websocket.send_bytes(audio)
                                except Exception:
                                    stop.set()
                                    return

                            tc = getattr(msg, "tool_call", None)
                            if tc:
                                responses = []
                                for fc in getattr(tc, "function_calls", None) or []:
                                    result = await _handle_live_tool(fc.name, fc.args or {}, websocket)
                                    responses.append(types.FunctionResponse(
                                        id=fc.id, name=fc.name, response={"result": result}
                                    ))
                                if responses:
                                    await session.send_tool_response(function_responses=responses)
                                # Design finalized — keep the session alive so
                                # Gemini's "you're good to go" wrap-up can stream
                                # back to the user. The next turn_complete (or
                                # the safety timer) will close us.
                                if _session.design_saved and not wrap_up_pending:
                                    wrap_up_pending = True
                                    logging.info("design saved, awaiting wrap-up speech")
                                    asyncio.create_task(_safety_close_after_wrap_up())
                        # Iterator ended. If we got nothing, brief sleep to avoid spin.
                        if not got_any:
                            await asyncio.sleep(0.05)
                    logging.info("recv_from_gemini: exiting (stop set)")
                except Exception as e:
                    logging.error(f"recv_from_gemini error: {e}\n{traceback.format_exc()}")
                finally:
                    stop.set()

            browser_task = asyncio.create_task(recv_from_browser())
            gemini_task = asyncio.create_task(recv_from_gemini())

            await asyncio.wait(
                [browser_task, gemini_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            stop.set()
            for t in (browser_task, gemini_task):
                if not t.done():
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logging.error(f"auditor_ws outer error: {e}\n{traceback.format_exc()}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
    finally:
        if not _session.design_saved:
            _write_sections_to_design()
        if user_done:
            try:
                await websocket.send_text(json.dumps({
                    "type": "design_saved",
                    "sections_progress": {s: s in _session.sections_confirmed for s in DESIGN_SECTIONS},
                    "current_section": None,
                }))
            except Exception:
                pass
