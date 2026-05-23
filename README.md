# Google I/O Hackathon 2026

Voice-driven system design tool. Speak a description aloud; the app produces both a structured `DESIGN.md` and a 3D visualization of the system topology.

---

## Pipeline

```
mic → Web Speech API (browser STT)
        │
        ▼
   POST /generate-design (Antigravity / Gemini)
        │
        ▼
     DESIGN.md  ──────────────┐
        │                     │
        ▼                     ▼
   GET /design-md       POST /generate-spec (google-genai, structured JSON)
        │                     │
        ▼                     ▼
   <DesignViewer>         Zod validate → <SpecCanvas> (Three.js + ELK)
```

Two backends share one source of truth (`DESIGN.md`). The DESIGN.md generator uses `google-antigravity`; the spec generator uses `google-genai` with `response_schema` for strict structured output.

---

## Repository Structure

```text
Google-IO-Hackathon-2026/
├── frontend/                           # React 19 + TypeScript + Vite
│   └── src/
│       ├── App.tsx                     # Voice capture + dual-pipeline trigger
│       ├── hooks/useSpeechRecognition.ts
│       ├── spec/                       # Zod schema, validator, example
│       ├── renderer/                   # Three.js + ELK 3D renderer
│       └── components/
│           ├── DesignViewer.tsx        # Renders DESIGN.md
│           └── SpecCanvas.tsx          # Mounts the 3D viz
├── backend/
│   └── sys_design_doc_api.py           # FastAPI: /generate-design, /generate-spec, /design-md
├── DESIGN.md                           # Auto-generated (do not edit by hand)
├── .env                                # GEMINI_API_KEY (not committed)
└── README.md
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Three.js (`three`), ELK (`elkjs`), Zod, react-markdown, Vitest
- **Backend**: Python 3.12, FastAPI, uvicorn, `google-antigravity` (DESIGN.md) + `google-genai` (spec JSON), Pydantic
- **Browser STT**: Web Speech API (no SDK required)

**Why this stack:** Web Speech API gives zero-dep transcription. `google-antigravity` produces freeform markdown well; `google-genai` enforces strict JSON via `response_schema` for the spec. ELK handles layered graph layout deterministically so the renderer stays a pure function of the spec. Three.js + `OrthographicCamera` keeps the viz light and isometric.

---

## Prerequisites

- Node.js v18+
- Python 3.12+
- [uv](https://github.com/astral-sh/uv)
- A `GEMINI_API_KEY` (Google AI Studio)

---

## Environment Setup

`.env` at the **project root**:

```
GEMINI_API_KEY=your_key_here
# optional override; defaults to gemini-2.5-pro
GEMINI_SPEC_MODEL=gemini-2.5-pro
```

---

## Running

Two terminals.

### Terminal 1 — Backend

```bash
cd backend
uv sync                         # installs from pyproject.toml
uv run uvicorn sys_design_doc_api:app --reload --port 8000
```

Runs at `http://localhost:8000`. CORS is open to `http://localhost:5173`.

### Terminal 2 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`.

---

## Usage

1. Open `http://localhost:5173` in Chrome, Edge, or Safari.
2. Pick **Push-to-talk** or **Continuous**, click **Record**, describe your system, click **Stop**.
3. The frontend chains two calls automatically:
   - `POST /generate-design` → writes `DESIGN.md`. The left panel refreshes.
   - `POST /generate-spec` → reads `DESIGN.md`, returns a validated spec. The right panel renders the 3D scene.
4. In the 3D scene: drag to orbit, scroll to zoom, double-click a node to fly the camera to it.

---

## Development

```bash
cd frontend
npm test            # vitest run (schema + validator unit tests)
npm run build       # tsc -b && vite build
npm run lint
```

The renderer is testable without Gemini: `src/spec/example.ts` exports a hardcoded spec covering all node types and edge kinds. Pass it to `SpecCanvas` directly to iterate on visuals.

---

## Architecture notes

- **Layer separation**: spec schema (`spec/schema.ts`) is the shared contract. The interpreter (backend `/generate-spec`) emits specs; the renderer (`renderer/`) consumes them. Neither knows about the other.
- **Validation**: the backend Pydantic schema enforces shape on Gemini's output and runs an integrity check (no duplicate ids, no self-loops, every reference exists). On failure it retries once with the validation errors appended to the prompt. The frontend re-validates with Zod as a safety net.
- **Deterministic layout**: ELK's `layered` algorithm (direction `RIGHT`) produces stable positions for the same input.
