# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Python backend and a Vite/React frontend.
- **Backend (`backend/`)**:
  - `main.py`: Entrypoint for running the static multi-agent code-generation flow.
  - `dispatcher.py`: Task dispatcher utilizing Google Antigravity. Features an **auto-repair retry engine** (`schedule_repair_cycle`) that intercepts verifier failures, analyzes logs, creates targeted coding repairs for `BACKEND`, `FRONTEND`, or `TESTER` agents, and schedules them as blockers to resolve code bugs dynamically (budgeted at 2 cycles max).
  - `agents.py`: Holds agent prompt templates and persona setup.
  - `sys_design_doc_api.py`: FastAPI server exposing `/start-flow`, `/flow-status`, `/generate-design`, `/generate-spec`, and the real-time bidirectional audio WebSocket route `/auditor/ws` (using Gemini Live API).
  - `db.py`: SQLite db helpers.
  - `tests/`: Unit tests (such as test suites for dispatcher repair-tracking logic).
- **Frontend (`frontend/`)**:
  - `src/App.tsx`: Central dashboard interface.
  - `src/components/`: Modular widgets including `AuditorPanel.tsx` (real-time voice interface) and `SpecCanvas.tsx` (Three.js 3D diagram renderer).
  - `src/hooks/`: Reusable react hooks including `useLiveAudio.ts` and `useSpeechRecognition.ts`.
  - Generated files such as `DESIGN.md`, `DESIGN_AUTH.md`, local databases, credentials, and workspaces should not be treated as source.

## Build, Test, and Development Commands

- `cd backend && uv run pytest -q`: run backend unit tests.
- `cd backend && uvicorn sys_design_doc_api:app --reload --port 8000`: run the design-generation API locally.
- `cd backend && uv run python main.py --reset`: run the multi-agent orchestrator from a clean local DB/workspace.
- `cd frontend && npm run dev`: start the Vite development server, usually on `http://localhost:5173`.
- `cd frontend && npm run build`: type-check and build the frontend.
- `cd frontend && npm run lint`: run ESLint over TypeScript/React files.

## Coding Style & Naming Conventions

Use Python 3.12 for backend code. Follow PEP 8 naming: `snake_case` for functions and variables, `UPPER_CASE` for constants, and descriptive test names such as `test_ready_tasks_respect_dependencies`. Keep filesystem paths configurable and prefer absolute paths for generated workspaces or SQLite files when an agent process may run from another directory. Frontend code uses TypeScript, React function components, single quotes, and extension-specific names like `DesignViewer.tsx` and `useSpeechRecognition.ts`.

## Testing Guidelines

Backend tests use `pytest` and should live under `backend/tests/` as `test_*.py`. Add focused tests for database state transitions, dispatcher behavior, and API contracts when changing orchestration logic. The frontend currently has lint/build validation but no test runner; at minimum run `npm run lint` and `npm run build` before submitting UI changes.

## Commit & Pull Request Guidelines

Recent history uses short imperative or Conventional Commit-style subjects, for example `fix: ...`, `feat: ...`, and `chore: ...`. Keep commits scoped to one concern. Pull requests should describe the behavior change, list validation commands run, call out generated artifacts or local config changes, and include screenshots or screen recordings for visible frontend changes.

## Security & Configuration Tips

Keep `.env`, `gcp-credentials.json`, SQLite databases, generated workspaces, and API keys out of commits. The root `.env` should provide `GEMINI_API_KEY` for backend AI calls.
