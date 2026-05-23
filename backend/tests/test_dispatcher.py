from dispatcher import determine_repair_roles, repair_attempt_count, validate_architect_task_graph


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


def test_repair_roles_are_targeted_from_verifier_failures():
    failure = """
    contract.json declares executable E2E steps: unsupported path '$[0].id'
    static anti-shortcut scan: frontend/src/App.jsx hardcoded display data
    backend Python dependencies are declared: missing requirement: pydantic
    pytest execution: import file mismatch
    """

    roles = determine_repair_roles("VERIFIER", failure)

    assert roles == ["BACKEND", "FRONTEND", "TESTER"]


def test_repair_attempt_count_reads_existing_repair_tasks():
    tasks = [
        {"id": "repair_task_verifier_1_backend"},
        {"id": "repair_task_verifier_1_tester"},
        {"id": "repair_task_verifier_2_frontend"},
        {"id": "task_verifier"},
    ]

    assert repair_attempt_count("task_verifier", tasks) == 2
