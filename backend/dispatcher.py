import asyncio
import os
from typing import Dict, Any, Set
from google.antigravity import Agent, LocalAgentConfig
from google.antigravity.hooks import policy
from db import get_ready_tasks, update_task_status, complete_task, get_all_tasks, kanban_show_tasks, add_task, add_dependency, find_available_port as persist_available_port
from deterministic_verifier import verify_generated_project
from agents import (
    ARCHITECT_INSTRUCTIONS,
    BACKEND_INSTRUCTIONS,
    FRONTEND_INSTRUCTIONS,
    TESTER_INSTRUCTIONS,
    VERIFIER_INSTRUCTIONS,
    E2E_VERIFIER_INSTRUCTIONS,
    DecompositionOutput,
    TaskExecutionOutput,
    TaskVerificationOutput
)

REQUIRED_TASK_ROLES = {"BACKEND", "FRONTEND", "TESTER", "VERIFIER", "E2E_VERIFIER"}


def validate_architect_task_graph(tasks_list: list[dict[str, Any]]) -> list[str]:
    """Return deterministic architect task/dependency validation findings."""
    findings: list[str] = []
    role_to_id = {task.get("assigned_role"): task.get("id") for task in tasks_list}
    missing_roles = REQUIRED_TASK_ROLES - set(role_to_id)
    if missing_roles:
        findings.append(f"Missing required task roles: {sorted(missing_roles)}")
        return findings

    def deps_for(role: str) -> set[str]:
        task = next(task for task in tasks_list if task.get("assigned_role") == role)
        return set(task.get("dependencies") or [])

    required_edges = {
        "TESTER": {"BACKEND"},
        "VERIFIER": {"BACKEND", "TESTER"},
        "E2E_VERIFIER": {"BACKEND", "FRONTEND", "VERIFIER"},
    }
    for role, parent_roles in required_edges.items():
        expected_parent_ids = {role_to_id[parent_role] for parent_role in parent_roles}
        missing_parent_ids = expected_parent_ids - deps_for(role)
        if missing_parent_ids:
            findings.append(
                f"{role} task must depend on {sorted(parent_roles)} "
                f"via task IDs {sorted(expected_parent_ids)}"
            )

    return findings


async def execute_task(task: Dict[str, Any], workspace_path: str) -> None:
    """Executes a single ready task by spawning the appropriate Antigravity Agent."""
    task_id = task["id"]
    role = task["assigned_role"]
    print(f"\n>>> [DISPATCH] Launching agent for task: '{task['title']}' (Role: {role}, ID: {task_id})")
    
    # Update task to IN_PROGRESS
    update_task_status(task_id, "IN_PROGRESS")
    
    # Configure schemas and policies based on role
    abs_workspace = os.path.abspath(workspace_path)
    os.makedirs(abs_workspace, exist_ok=True)
    
    if role == "ARCHITECT":
        instructions = ARCHITECT_INSTRUCTIONS
        schema = DecompositionOutput
        policies = policy.confirm_run_command()
    elif role == "MOCKER" or role == "BACKEND":
        instructions = BACKEND_INSTRUCTIONS
        schema = TaskExecutionOutput
        policies = policy.confirm_run_command()
    elif role == "FRONTEND":
        instructions = FRONTEND_INSTRUCTIONS
        schema = TaskExecutionOutput
        policies = policy.confirm_run_command()
    elif role == "TESTER":
        instructions = TESTER_INSTRUCTIONS
        schema = TaskExecutionOutput
        policies = policy.confirm_run_command()
    elif role == "VERIFIER":
        instructions = VERIFIER_INSTRUCTIONS
        schema = TaskVerificationOutput
        policies = [
            policy.allow(
                "run_command",
                when=lambda args: "pytest" in args.get("CommandLine", ""),
                name="allow_pytest"
            )
        ] + policy.confirm_run_command()
    elif role == "E2E_VERIFIER":
        instructions = E2E_VERIFIER_INSTRUCTIONS
        schema = TaskVerificationOutput
        # Allow starting uvicorn/vite servers in background
        policies = [
            policy.allow(
                "run_command",
                when=lambda args: any(cmd in args.get("CommandLine", "") for cmd in [
                    "uvicorn", "npm", "vite", "pytest", "curl", "bun",
                    "nohup", "sleep", "kill", "bash", "sh", "chmod", "cat", "echo"
                ]),
                name="allow_e2e_commands"
            )
        ] + policy.confirm_run_command()
    else:
        raise ValueError(f"Unknown assigned role: {role}")
    
    # Configure Agent
    def find_available_port(role: str, start_port: int = 8000) -> int:
        """Find an available port and save it to this generated_project/config.json."""
        return persist_available_port(role=role, start_port=start_port, workspace_path=abs_workspace)

    config = LocalAgentConfig(
        system_instructions=instructions,
        response_schema=schema,
        workspaces=[abs_workspace],
        policies=policies,
        tools=[kanban_show_tasks, find_available_port]
    )
    
    try:
        async with Agent(config) as agent:
            prompt = (
                f"Your task is: {task['description']}\n"
                f"Task ID: {task_id}\n"
                f"Workspace: {abs_workspace}\n"
                f"Input context for this task: {task['input_data']}\n\n"
                f"Please implement the changes in the workspace and output the required structured response matching your schema."
            )
            response = await agent.chat(prompt)
            result = await response.structured_output()
            
            if result is None:
                raise ValueError("Agent completed turn but did not produce valid structured output.")
            
            # Normalize to dict
            if hasattr(result, "model_dump"):
                result_dict = result.model_dump()
            elif hasattr(result, "dict"):
                result_dict = result.dict()
            else:
                result_dict = dict(result)
                
            # For verification tasks, the agent report is advisory. The
            # dispatcher must independently verify the generated workspace.
            if role in ("VERIFIER", "E2E_VERIFIER"):
                agent_success = result_dict.get("success", False)
                deterministic_report = verify_generated_project(abs_workspace, role)
                result_dict = {
                    **deterministic_report.model_dump(),
                    "agent_report": result_dict,
                }
                if not agent_success:
                    result_dict["success"] = False
                    result_dict["reasons_for_failure"] = (
                        f"Verifier agent reported failure.\n"
                        f"{result_dict.get('reasons_for_failure') or ''}"
                    ).strip()

                if not result_dict["success"]:
                    error_msg = (
                        f"Deterministic verification failed.\n"
                        f"Summary: {result_dict.get('test_summary')}\n"
                        f"Stdout: {result_dict.get('stdout')}\n"
                        f"Stderr: {result_dict.get('stderr')}\n"
                        f"Failure Reason: {result_dict.get('reasons_for_failure')}"
                    )
                    print(f"xxx [FAILED] Verification failed for task: '{task['title']}'")
                    update_task_status(task_id, "BLOCKED", error_msg=error_msg)
                    return
            
            # If it is the Architect task, register the new tasks on the board
            if role == "ARCHITECT":
                tasks_list = result_dict.get("tasks", [])
                graph_findings = validate_architect_task_graph(tasks_list)
                contract_path = os.path.join(abs_workspace, "contract.json")
                if graph_findings or not os.path.exists(contract_path):
                    error_parts = []
                    error_parts.extend(graph_findings)
                    if not os.path.exists(contract_path):
                        error_parts.append(f"Missing executable contract: {contract_path}")
                    error_msg = "Architect output failed deterministic gating. " + " ".join(error_parts)
                    print(f"xxx [FAILED] {error_msg}")
                    update_task_status(task_id, "BLOCKED", error_msg=error_msg)
                    return

                for t_info in tasks_list:
                    # Register new task
                    add_task(
                        task_id=t_info["id"],
                        title=t_info["title"],
                        description=t_info["description"],
                        assigned_role=t_info["assigned_role"],
                        status="TODO",
                        input_data={
                            "design_reference": task.get("input_data"),
                            "contract_path": os.path.join(abs_workspace, "contract.json"),
                        }
                    )
                    # Add parent dependencies
                    for parent_id in t_info.get("dependencies", []):
                        add_dependency(parent_id=parent_id, child_id=t_info["id"])
                print(f"+++ [ARCHITECT] Successfully registered {len(tasks_list)} tasks on the board.")
            
            # Task succeeded
            print(f"+++ [COMPLETED] Task successfully completed: '{task['title']}'")
            complete_task(task_id, result_dict)
            
    except Exception as e:
        print(f"xxx [SYSTEM ERROR] Execution failed for task '{task['title']}': {e}")
        update_task_status(task_id, "BLOCKED", error_msg=str(e))

async def run_orchestrator(workspace_path: str, max_concurrency: int = 3) -> None:
    """The central async dispatcher loop.
    
    Checks the SQLite database for ready tasks and runs them concurrently.
    Exits when all tasks are either completed or blocked.
    """
    print("\n==============================================")
    print(f"Starting Multi-Agent Kanban Dispatcher Engine")
    print(f"Target Workspace: {os.path.abspath(workspace_path)}")
    print("==============================================\n")
    
    running_tasks: Set[str] = set()
    semaphore = asyncio.Semaphore(max_concurrency)
    
    async def worker_wrapper(task: Dict[str, Any]):
        async with semaphore:
            running_tasks.add(task["id"])
            try:
                await execute_task(task, workspace_path)
            finally:
                running_tasks.remove(task["id"])
                
    while True:
        all_tasks = get_all_tasks()
        if not all_tasks:
            print("No tasks registered on the Kanban board yet. Waiting...")
            await asyncio.sleep(2)
            continue
            
        # Count statuses
        statuses = {status: 0 for status in ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]}
        for t in all_tasks:
            statuses[t["status"]] = statuses.get(t["status"], 0) + 1
            
        print(f"Board Status Summary -> Todo: {statuses['TODO']} | Running: {statuses['IN_PROGRESS']} | Blocked: {statuses['BLOCKED']} | Done: {statuses['DONE']}")
        
        # Check if everything is DONE
        if statuses["DONE"] == len(all_tasks):
            print("\n*** SUCCESS: All tasks on the Kanban board have completed successfully! ***\n")
            break
            
        # Find ready tasks
        ready_tasks = get_ready_tasks()
        
        # Check for deadlock (no ready tasks, no tasks running, but some are not DONE)
        if not ready_tasks and len(running_tasks) == 0:
            if statuses["BLOCKED"] > 0:
                print("\nxxx ORCHESTRATION BLOCKED: Some tasks failed and are blocking progress. Check database logs. xxx\n")
            else:
                print("\nxxx ORCHESTRATION DEADLOCKED: Unresolved dependencies prevent further progress. xxx\n")
            break
            
        # Spawn tasks that aren't already running
        tasks_to_spawn = [t for t in ready_tasks if t["id"] not in running_tasks]
        
        if tasks_to_spawn:
            # Start execution tasks asynchronously
            for task in tasks_to_spawn:
                asyncio.create_task(worker_wrapper(task))
                
        # Wait before next polling tick
        await asyncio.sleep(3)
