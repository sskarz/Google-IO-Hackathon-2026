import sqlite3
import json
import os
from typing import List, Dict, Any, Optional

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DB_DIR, "kanban.db")

def get_db_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Establishes and returns a connection to the SQLite database."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def init_db(db_path: str = DB_PATH) -> None:
    """Initializes the database schema for the Kanban board."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        
        # Create tasks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE')),
                assigned_role TEXT NOT NULL CHECK(assigned_role IN ('ARCHITECT', 'MOCKER', 'TESTER', 'VERIFIER')),
                input_data TEXT,
                output_data TEXT,
                error_msg TEXT
            )
        """)
        
        # Create task dependencies table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS task_dependencies (
                parent_task_id TEXT NOT NULL,
                child_task_id TEXT NOT NULL,
                PRIMARY KEY (parent_task_id, child_task_id),
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (child_task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        """)
        conn.commit()

def add_task(
    task_id: str,
    title: str,
    description: str,
    assigned_role: str,
    status: str = "TODO",
    input_data: Optional[Dict[str, Any]] = None,
    db_path: str = DB_PATH
) -> None:
    """Adds a new task to the database."""
    input_str = json.dumps(input_data) if input_data is not None else None
    with get_db_connection(db_path) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO tasks (id, title, description, status, assigned_role, input_data)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (task_id, title, description, status, assigned_role, input_str)
        )
        conn.commit()

def add_dependency(parent_id: str, child_id: str, db_path: str = DB_PATH) -> None:
    """Establishes a dependency indicating child_id cannot run until parent_id is DONE."""
    with get_db_connection(db_path) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO task_dependencies (parent_task_id, child_task_id)
            VALUES (?, ?)
            """,
            (parent_id, child_id)
        )
        conn.commit()

def get_ready_tasks(db_path: str = DB_PATH) -> List[Dict[str, Any]]:
    """Returns a list of tasks in TODO status whose parent dependencies are all DONE."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        # Query tasks in TODO status that do not have any incomplete parent dependencies
        cursor.execute(
            """
            SELECT * FROM tasks 
            WHERE status = 'TODO'
              AND id NOT IN (
                  SELECT child_task_id 
                  FROM task_dependencies td
                  JOIN tasks parent ON td.parent_task_id = parent.id
                  WHERE parent.status != 'DONE'
              )
            """
        )
        rows = cursor.fetchall()
        
        tasks = []
        for row in rows:
            tasks.append({
                "id": row["id"],
                "title": row["title"],
                "description": row["description"],
                "status": row["status"],
                "assigned_role": row["assigned_role"],
                "input_data": json.loads(row["input_data"]) if row["input_data"] else None,
                "output_data": json.loads(row["output_data"]) if row["output_data"] else None,
                "error_msg": row["error_msg"]
            })
        return tasks

def update_task_status(task_id: str, status: str, error_msg: Optional[str] = None, db_path: str = DB_PATH) -> None:
    """Updates the status and optional error message of a task."""
    with get_db_connection(db_path) as conn:
        conn.execute(
            "UPDATE tasks SET status = ?, error_msg = ? WHERE id = ?",
            (status, error_msg, task_id)
        )
        conn.commit()

def complete_task(task_id: str, output_data: Dict[str, Any], db_path: str = DB_PATH) -> None:
    """Marks a task as DONE and records its structured output."""
    output_str = json.dumps(output_data) if output_data is not None else None
    with get_db_connection(db_path) as conn:
        conn.execute(
            "UPDATE tasks SET status = 'DONE', output_data = ?, error_msg = NULL WHERE id = ?",
            (output_str, task_id)
        )
        conn.commit()

def get_all_tasks(db_path: str = DB_PATH) -> List[Dict[str, Any]]:
    """Retrieves all tasks on the board to display to humans or other agents."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks")
        rows = cursor.fetchall()
        
        tasks = []
        for row in rows:
            tasks.append({
                "id": row["id"],
                "title": row["title"],
                "description": row["description"],
                "status": row["status"],
                "assigned_role": row["assigned_role"],
                "input_data": json.loads(row["input_data"]) if row["input_data"] else None,
                "output_data": json.loads(row["output_data"]) if row["output_data"] else None,
                "error_msg": row["error_msg"]
            })
        return tasks

# =============================================================================
# Agent-Facing Kanban Tools
# =============================================================================

def kanban_show_tasks() -> str:
    """Queries and returns the current state of the entire Kanban board.
    
    Use this tool to see the list of tasks, their current statuses, and any errors
    that have blocked other tasks.
    """
    tasks = get_all_tasks()
    if not tasks:
        return "The Kanban board is currently empty."
    
    output = ["Current Kanban Board Status:"]
    for t in tasks:
        status_line = f"- [{t['status']}] {t['title']} ({t['assigned_role']}) - ID: {t['id']}"
        if t['error_msg']:
            status_line += f" | ERROR: {t['error_msg']}"
        output.append(status_line)
    return "\n".join(output)

def kanban_create_task(
    task_id: str,
    title: str,
    description: str,
    assigned_role: str,
    parent_task_ids: Optional[List[str]] = None
) -> str:
    """Creates a new task on the Kanban board with optional parent dependencies.
    
    Args:
        task_id: A unique identifier for the task (e.g., 'task_verify_users').
        title: Short title of the task.
        description: Detailed instructions for the task executor.
        assigned_role: The role required to run this task ('MOCKER', 'TESTER', 'VERIFIER').
        parent_task_ids: A list of task IDs that must complete BEFORE this task can run.
    """
    try:
        add_task(
            task_id=task_id,
            title=title,
            description=description,
            assigned_role=assigned_role,
            status="TODO"
        )
        if parent_task_ids:
            for pid in parent_task_ids:
                add_dependency(parent_id=pid, child_id=task_id)
        
        dep_str = f" depending on {parent_task_ids}" if parent_task_ids else ""
        return f"Successfully created task '{title}' (ID: {task_id}){dep_str}."
    except Exception as e:
        return f"Failed to create task: {str(e)}"
