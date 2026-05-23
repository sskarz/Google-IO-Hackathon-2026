import json
import os
import re
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.antigravity import Agent, LocalAgentConfig
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field

load_dotenv(Path(__file__).parent.parent / ".env")

PROJECT_ROOT = Path(__file__).parent.parent
DESIGN_MD = PROJECT_ROOT / "DESIGN.md"
SPEC_MODEL = os.getenv("GEMINI_SPEC_MODEL", "gemini-2.5-pro")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

DESIGN_SYSTEM_PROMPT = """\
You are a senior software architect. The user has verbally described a system they want to build.
Convert their transcript into a structured DESIGN.md with exactly these sections:

# Overview
## Goals
## Architecture
## Components
## Data Flow

Be concrete. Infer reasonable defaults where the user was vague.
Output only the markdown — no preamble, no code fences around the whole document.
"""

AUDIT_SYSTEM_PROMPT = """\
You are a senior software architect auditing a system design document written by a colleague.
Your job is to surface problems and gather missing information.

Identify:
- Critical issues: missing components, inconsistencies, scalability risks, security gaps, unclear ownership
- Follow-up questions: specific questions to ask the designer to clarify intent and fill gaps

Return ONLY a JSON object — no prose, no markdown fences — in this exact shape:
{
  "issues": ["issue 1", "issue 2"],
  "questions": ["question 1", "question 2"]
}

Aim for 3–7 issues and 3–7 questions. Be specific, not generic.
"""

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
    # `from` is a Python keyword; use alias so JSON keeps the spec field name.
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

class TranscriptRequest(BaseModel):
    transcript: str


async def generate_markdown(transcript: str) -> str:
    config = LocalAgentConfig(system_instructions=DESIGN_SYSTEM_PROMPT)
    async with Agent(config) as agent:
        response = await agent.chat(transcript)
        return await response.text()


async def run_audit(design_content: str) -> dict:
    config = LocalAgentConfig(system_instructions=AUDIT_SYSTEM_PROMPT)
    async with Agent(config) as agent:
        response = await agent.chat(design_content)
        raw = await response.text()
    cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", raw).strip()
    return json.loads(cleaned)


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


@app.get("/audit")
async def audit_design():
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set.")
    if not DESIGN_MD.exists():
        raise HTTPException(status_code=404, detail="DESIGN.md not found. Generate a design first.")
    content = DESIGN_MD.read_text(encoding="utf-8").strip()
    if not content:
        raise HTTPException(status_code=400, detail="DESIGN.md is empty.")
    try:
        result = await run_audit(content)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"Auditor returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Antigravity error: {e}")
    return {"issues": result.get("issues", []), "questions": result.get("questions", [])}


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

    try:
        spec = call_gemini_for_spec(markdown, api_key)
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
            spec = call_gemini_for_spec(retry_prompt, api_key)
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
