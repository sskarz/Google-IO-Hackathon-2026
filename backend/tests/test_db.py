import os
import pytest
from db import init_db, add_task, add_dependency, get_ready_tasks, update_task_status, complete_task, get_all_tasks

TEST_DB_PATH = "test_kanban.db"

@pytest.fixture(autouse=True)
def setup_teardown_db():
    # Cleanup database before each test
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
    
    init_db(TEST_DB_PATH)
    
    yield
    
    # Cleanup database after each test
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)

def test_add_and_get_tasks():
    # Add a task
    add_task(
        task_id="t1",
        title="Task 1",
        description="Desc 1",
        assigned_role="ARCHITECT",
        status="TODO",
        db_path=TEST_DB_PATH
    )
    
    tasks = get_all_tasks(TEST_DB_PATH)
    assert len(tasks) == 1
    assert tasks[0]["id"] == "t1"
    assert tasks[0]["title"] == "Task 1"
    assert tasks[0]["status"] == "TODO"

def test_ready_tasks_respect_dependencies():
    # Task 1: Mocker task (no dependencies)
    add_task(
        task_id="t_mocker",
        title="Mock API",
        description="Implement mock APIs",
        assigned_role="MOCKER",
        status="TODO",
        db_path=TEST_DB_PATH
    )
    
    # Task 2: Tester task (no dependencies)
    add_task(
        task_id="t_tester",
        title="Write Tests",
        description="Write API tests",
        assigned_role="TESTER",
        status="TODO",
        db_path=TEST_DB_PATH
    )
    
    # Task 3: Verifier task (depends on Task 1 and Task 2)
    add_task(
        task_id="t_verifier",
        title="Verify Tests",
        description="Run API verification tests",
        assigned_role="VERIFIER",
        status="TODO",
        db_path=TEST_DB_PATH
    )
    add_dependency(parent_id="t_mocker", child_id="t_verifier", db_path=TEST_DB_PATH)
    add_dependency(parent_id="t_tester", child_id="t_verifier", db_path=TEST_DB_PATH)
    
    # Initially, only t_mocker and t_tester should be ready
    ready = get_ready_tasks(TEST_DB_PATH)
    ready_ids = {t["id"] for t in ready}
    assert ready_ids == {"t_mocker", "t_tester"}
    
    # Complete t_mocker
    complete_task(task_id="t_mocker", output_data={"files_created": ["mock.py"]}, db_path=TEST_DB_PATH)
    
    # Now only t_tester should be ready (t_verifier is still waiting on t_tester)
    ready = get_ready_tasks(TEST_DB_PATH)
    ready_ids = {t["id"] for t in ready}
    assert ready_ids == {"t_tester"}
    
    # Complete t_tester
    complete_task(task_id="t_tester", output_data={"files_created": ["test_mock.py"]}, db_path=TEST_DB_PATH)
    
    # Now t_verifier should be ready
    ready = get_ready_tasks(TEST_DB_PATH)
    ready_ids = {t["id"] for t in ready}
    assert ready_ids == {"t_verifier"}
