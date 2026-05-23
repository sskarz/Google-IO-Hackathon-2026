from dispatcher import validate_architect_task_graph


def test_architect_task_graph_requires_verifier_to_wait_for_tester():
    tasks = [
        {"id": "task_backend", "assigned_role": "BACKEND", "dependencies": []},
        {"id": "task_frontend", "assigned_role": "FRONTEND", "dependencies": []},
        {"id": "task_tester", "assigned_role": "TESTER", "dependencies": ["task_backend"]},
        {"id": "task_verifier", "assigned_role": "VERIFIER", "dependencies": ["task_backend"]},
        {
            "id": "task_e2e",
            "assigned_role": "E2E_VERIFIER",
            "dependencies": ["task_backend", "task_frontend", "task_verifier"],
        },
    ]

    findings = validate_architect_task_graph(tasks)

    assert any("VERIFIER task must depend" in finding for finding in findings)


def test_architect_task_graph_accepts_required_role_dependencies():
    tasks = [
        {"id": "task_backend", "assigned_role": "BACKEND", "dependencies": []},
        {"id": "task_frontend", "assigned_role": "FRONTEND", "dependencies": []},
        {"id": "task_tester", "assigned_role": "TESTER", "dependencies": ["task_backend"]},
        {"id": "task_verifier", "assigned_role": "VERIFIER", "dependencies": ["task_backend", "task_tester"]},
        {
            "id": "task_e2e",
            "assigned_role": "E2E_VERIFIER",
            "dependencies": ["task_backend", "task_frontend", "task_verifier"],
        },
    ]

    assert validate_architect_task_graph(tasks) == []
