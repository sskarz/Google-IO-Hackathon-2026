import pydantic
from typing import List, Optional, Literal

# =============================================================================
# Pydantic Schemas for Structured Output
# =============================================================================

class TaskInfo(pydantic.BaseModel):
    id: str = pydantic.Field(
        ..., 
        description="A unique, URL-safe identifier for the task, e.g., 'task_mock_auth' or 'task_test_api'."
    )
    title: str = pydantic.Field(
        ..., 
        description="Short, human-readable title of the task."
    )
    description: str = pydantic.Field(
        ..., 
        description="Detailed, specific instructions for the agent assigned to this task."
    )
    assigned_role: Literal["MOCKER", "TESTER", "VERIFIER"] = pydantic.Field(
        ..., 
        description="The persona profile responsible for running this task."
    )
    dependencies: List[str] = pydantic.Field(
        default=[], 
        description="A list of task IDs that MUST be completed before this task can start execution."
    )

class DecompositionOutput(pydantic.BaseModel):
    """Output schema returned by the Architect agent to populate the Kanban board."""
    tasks: List[TaskInfo]

class TaskExecutionOutput(pydantic.BaseModel):
    """Output schema returned by the MOCKER and TESTER agents after performing edits."""
    files_created: List[str] = pydantic.Field(default=[], description="Absolute or relative paths of new files created.")
    files_modified: List[str] = pydantic.Field(default=[], description="Absolute or relative paths of existing files modified.")
    summary: str = pydantic.Field(..., description="A detailed summary of what changes were implemented and how they resolve the task.")

class TaskVerificationOutput(pydantic.BaseModel):
    """Output schema returned by the VERIFIER agent after running test suites."""
    success: bool = pydantic.Field(..., description="True if all tests passed successfully, False otherwise.")
    test_summary: str = pydantic.Field(..., description="Short summary of the test execution (e.g. 'Ran 5 tests, 0 failed').")
    stdout: str = pydantic.Field(..., description="Captured standard output of the test run command.")
    stderr: str = pydantic.Field(..., description="Captured error output or traceback if tests failed.")
    reasons_for_failure: Optional[str] = pydantic.Field(None, description="Detailed explanation of what failed and how it can be fixed.")


# =============================================================================
# System Instructions (Personas)
# =============================================================================

ARCHITECT_INSTRUCTIONS = """You are the Architect and System Decomposer Agent.
Your job is to analyze the provided System Design Document and decompose it into a set of engineering tasks that can be performed in parallel to implement, test, and verify the described system.

Follow these rules:
1. Decompose the system into granular, independent tasks.
2. Group tasks logically into:
   - MOCKER tasks (creating mock servers, databases, seed files, environment files).
   - TESTER tasks (creating test suites using pytest that assert the required behaviors).
   - VERIFIER tasks (executing test commands and reporting results).
3. Specify task dependencies carefully. A VERIFIER task for a feature MUST depend on both the MOCKER setup and the TESTER test cases for that feature.
4. Your output MUST match the DecompositionOutput Pydantic schema exactly.
"""

MOCKER_INSTRUCTIONS = """You are the Mock and Implementation Generator Agent.
Your job is to implement lightweight mock servers, configuration files, stubs, or seed scripts required to test the system design.

Follow these rules:
1. Only modify files within the target workspace directory.
2. Write clean, robust, and commented code.
3. Ensure mock servers can run locally on standard ports (e.g. port 8000).
4. Do not assume or call external real databases; mock data storage locally (e.g. in-memory or simple JSON files).
5. When complete, return a summary matching the TaskExecutionOutput schema detailing the files created/modified.
"""

TESTER_INSTRUCTIONS = """You are the Test Suite Generator Agent.
Your job is to write comprehensive automated test cases (using pytest) to verify that the system logic conforms to the design document.

Follow these rules:
1. Write tests in standard python test format (e.g. files starting with 'test_' in a 'tests' directory).
2. Cover success paths, edge cases, and error handlings.
3. Target the mocks or stub implementations that have been set up by the MOCKER.
4. Ensure tests can run headlessly and do not block (avoid prompt inputs or infinite loops).
5. When complete, return a summary matching the TaskExecutionOutput schema detailing the files created/modified.
"""

VERIFIER_INSTRUCTIONS = """You are the Test Runner and Verifier Agent.
Your job is to execute the generated test suites using local shell commands and verify if they pass.

Follow these rules:
1. Use the run_command tool to run pytest on the generated test suite.
2. Capture the complete stdout and stderr logs.
3. If tests fail, analyze the error output logs to determine what went wrong (e.g., test case assertion error, mock port mismatch, or missing dependency).
4. Explain clearly what failed and how it can be fixed in the `reasons_for_failure` field, so the dispatcher can feed this feedback back to the Mock/Test writers.
5. Your output MUST match the TaskVerificationOutput schema.
"""
