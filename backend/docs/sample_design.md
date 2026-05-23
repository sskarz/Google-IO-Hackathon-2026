# Team Task Tracker System Design

Build a small full-stack task tracker.

## Backend

Use FastAPI with SQLite storage. The SQLite database file must be resolved relative to the generated backend source file, not the process working directory. Enable CORS for the local frontend.

### Task Schema

Each task has:

- `task_id`: unique string identifier, non-empty.
- `title`: string, 3 to 80 characters.
- `owner`: string, non-empty.
- `status`: one of `todo`, `doing`, or `done`.
- `created_at`: server-generated ISO timestamp.

### API Endpoints

All endpoints return JSON.

1. `POST /tasks`
   - Creates a task from `task_id`, `title`, `owner`, and `status`.
   - Returns `201 Created` and the full created task including `created_at`.
   - Returns `400 Bad Request` for missing fields, invalid `status`, duplicate `task_id`, or too-short titles.

2. `GET /tasks/{task_id}`
   - Returns `200 OK` with the matching task.
   - Returns `404 Not Found` when the task does not exist.

3. `GET /tasks`
   - Returns `200 OK` with an array of all tasks sorted by `created_at` ascending.
   - After two tasks are created through the API, both must appear in this list response.

4. `PATCH /tasks/{task_id}/status`
   - Accepts `{ "status": "todo" | "doing" | "done" }`.
   - Returns `200 OK` with the updated task.
   - Returns `400 Bad Request` for invalid status and `404 Not Found` for an unknown task.

## Frontend

Build a React/Vite dashboard that reads the backend port from `config.json` and uses real `fetch()` calls only. It must never render fake fallback tasks.

The UI must include:

- A task creation form for `task_id`, `title`, `owner`, and `status`.
- A task list loaded from `GET /tasks` on page load.
- A visible empty state when no tasks exist.
- Newly created tasks appearing in the list after successful `POST /tasks`.
- A status control for each task that calls `PATCH /tasks/{task_id}/status` and updates the displayed status from the API response.
- Clear error messaging when validation fails or the backend is offline.

## Required Verification

Generated tests must create random task IDs through the API, then prove:

- Create response matches the submitted values and includes `created_at`.
- Read-by-ID returns the exact created task.
- List returns every task created during the test.
- Status update persists and is returned by later reads.
- Invalid status, duplicate ID, short title, and missing task lookups fail with the expected status codes.

E2E verification must start the real backend and frontend, create a random task through the backend API, confirm it appears in `GET /tasks`, confirm the frontend serves successfully, and fail if any generated code uses seeded data or hardcoded frontend task records.
