# Google I/O Hackathon 2026

---

## Repository Structure

```text
Google-IO-Hackathon-2026/
├── frontend/                  # React + TypeScript (Vite)
│   └── src/
│       ├── App.tsx            # Main UI — voice capture + generate trigger
│       └── hooks/
│           └── useSpeechRecognition.ts
├── backend/
│   └── sys_design_doc_api.py  # FastAPI — receives transcript, writes DESIGN.md
├── DESIGN.md                  # Auto-generated system design (do not edit by hand)
├── .env                       # API keys (not committed)
└── README.md
```

---

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Python 3.12, FastAPI, uvicorn, Google Antigravity SDK
- **AI**: Google Antigravity (`google-antigravity`) powered by Gemini via `GEMINI_API_KEY`

---

## Prerequisites

- Node.js v18+
- Python 3.12+
- [uv](https://github.com/astral-sh/uv)

---

## Environment Setup

`.env` lives at the **project root**:

```
GEMINI_API_KEY=your_key_here
```

---

## Running

Open two terminals.

### Terminal 1 — Backend

```bash
cd backend
uv add fastapi "uvicorn[standard]" python-dotenv google-antigravity
uvicorn sys_design_doc_api:app --reload --port 8000
```

Runs at `http://localhost:8000`.

### Terminal 2 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`.

---

## Usage

1. Open `http://localhost:5173`
2. Click **Record**, speak your system design aloud, click **Stop**
3. Click **Generate DESIGN.md**
4. `DESIGN.md` at the project root is written with structured markdown:
   - Overview, Goals, Architecture, Components, Data Flow, Open Questions
