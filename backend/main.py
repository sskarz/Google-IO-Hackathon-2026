import argparse
import asyncio
import os
import shutil
import time
import dotenv

# Load environment variables from the current directory and the parent directory
dotenv.load_dotenv()
dotenv.load_dotenv("../.env")

from db import init_db, add_task, DB_PATH
from dispatcher import run_orchestrator

DEFAULT_DESIGN = """# User Profile Service Design

This microservice handles user profile storage and retrieval.

## Data Schema
A user profile consists of:
- `user_id`: unique string identifier (e.g. "user_123")
- `username`: string, non-empty (e.g. "alice")
- `email`: valid email string (e.g. "alice@example.com")
- `created_at`: timestamp string

## API Endpoints

### 1. GET /profile/{user_id}
- Response Code: 200 OK
- Response Body: JSON object matching user profile
- Error Codes: 404 Not Found if user_id doesn't exist

### 2. POST /profile
- Request Body: JSON object with `user_id`, `username`, `email`
- Response Code: 201 Created
- Response Body: JSON object matching user profile
- Error Codes: 400 Bad Request if missing fields or invalid email
"""

def prepare_design_doc(path: str) -> str:
    """Reads the design doc, or creates a default sample if it doesn't exist."""
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w") as f:
            f.write(DEFAULT_DESIGN)
        print(f"Created default system design document at: {path}")
    
    with open(path, "r") as f:
        return f.read()

ARCHITECT_TASK_ID = "task_architect_decomposer"

ARCHITECT_TASK_DESCRIPTION = (
    "Read the system design document content provided in the input context. "
    "Identify the endpoints, requirements, schemas, and decompose them into: "
    "1) BACKEND task to implement database integration and API endpoints. "
    "2) FRONTEND task to build a responsive React/Vite/Tailwind UI dashboard. "
    "3) TESTER task to write a comprehensive automated test suite. "
    "4) VERIFIER task to run and verify the test suite. "
    "5) E2E_VERIFIER task to launch frontend and backend services, check their integration, and verify against design document."
)

def reset_flow_state(workspace_path: str) -> None:
    """Clears the orchestration database and generated workspace."""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    if os.path.exists(workspace_path):
        for attempt in range(3):
            try:
                shutil.rmtree(workspace_path)
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(0.2)

def initialize_flow(design_content: str, workspace_path: str, reset: bool = False) -> None:
    """Initializes the Kanban board and seeds the architect task."""
    if reset:
        reset_flow_state(workspace_path)

    os.makedirs(workspace_path, exist_ok=True)
    init_db()
    add_task(
        task_id=ARCHITECT_TASK_ID,
        title="Decompose System Design",
        description=ARCHITECT_TASK_DESCRIPTION,
        assigned_role="ARCHITECT",
        status="TODO",
        input_data={"design_doc_content": design_content}
    )

async def run_full_flow(design_content: str, workspace_path: str, reset: bool = False) -> None:
    """Seeds and runs the complete agent generation flow."""
    initialize_flow(design_content=design_content, workspace_path=workspace_path, reset=reset)
    await run_orchestrator(workspace_path=workspace_path)

def main():
    parser = argparse.ArgumentParser(description="Multi-Agent Kanban Orchestrator MVP")
    parser.add_argument(
        "--design", 
        default="docs/sample_design.md",
        help="Path to the system design document (markdown)."
    )
    parser.add_argument(
        "--workspace", 
        default="generated_project",
        help="Path to the target workspace folder where mocks and tests are generated."
    )
    parser.add_argument(
        "--reset", 
        action="store_true",
        help="Reset and wipe existing database and workspace folder before running."
    )
    
    args = parser.parse_args()
    
    # 1. Reset if requested
    if args.reset:
        print("Resetting database and workspace...")
        reset_flow_state(args.workspace)
    
    # 3. Read/prepare design document
    design_content = prepare_design_doc(args.design)
    
    # 4. Seed the initial Architect task to decompose the design
    initialize_flow(design_content=design_content, workspace_path=args.workspace)
    print("Kanban database initialized.")
    print("Seed task 'Decompose System Design' added to Kanban board.")
    
    # 5. Start the dispatcher orchestration loop
    asyncio.run(run_orchestrator(workspace_path=args.workspace))

if __name__ == "__main__":
    main()
