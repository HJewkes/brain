# Agent Completion Protocol

Workers report task completion to the coordinator via SendMessage using a structured text format.

## Message Format

### Success

```
DONE <TASK_ID> <summary of changes>
```

Example:
```
DONE VNM-12.02 Added render-prompt subcommand with template-renderer.ts. 17 tests passing.
```

### Failure

```
FAILED <TASK_ID> <reason for failure>
```

Example:
```
FAILED VNM-12.03 Could not resolve merge conflict in file-ownership.ts. Manual intervention needed.
```

## Coordinator Handling

On receiving **DONE**:
1. Mark the task as done via `brain pm task done <TASK_ID>`
2. Query newly eligible tasks via `brain pm next --json`
3. Dispatch any newly eligible tasks to workers

On receiving **FAILED**:
1. Mark the task as blocked via `brain pm task block <TASK_ID>`
2. Log the failure reason
3. Optionally reset the task for retry: `brain pm task reset <TASK_ID> --force`
4. Continue dispatching other eligible tasks

## Timeout Handling

If a worker has been active for over 30 minutes without sending a message:
1. Consider the task stalled
2. Check the task's git activity for recent commits
3. If no activity, reset the task and re-dispatch

## Error Recovery

| Scenario | Action |
|----------|--------|
| DONE but tests fail on verify | Reset task, re-dispatch |
| FAILED with merge conflict | Reset, re-dispatch with updated context |
| FAILED with blocked dependency | Log as blocked, wait for dependency |
| Worker timeout (no message) | Reset after stall threshold |
| Unrecognized message format | Log warning, do not change task state |
