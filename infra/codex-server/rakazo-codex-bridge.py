#!/usr/bin/env python3
"""Forced-command bridge used by Rakazo's worker to run Codex jobs.

The SSH key that reaches this program is restricted to this command.  The
worker sends only base64-encoded data, so no model prompt is interpreted by a
shell.  Job state lives outside the Codex home and is intentionally boring:
one directory per idempotency key, one detached runner, and small metadata
files that can be inspected/reconciled after a worker restart.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


BASE_DIR = Path("/srv/rakazo-bridge/jobs")
CODEX_HOME = Path("/home/codex/.codex")
MAX_PROMPT_BYTES = 100_000
MAX_REPOSITORY_BYTES = 2_000
MAX_RESULT_BYTES = 100_000
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
GIT_AUTH_HELPER = "!/usr/bin/gh auth git-credential"


def die(message: str, code: int = 2) -> None:
    # Keep request errors deliberately generic. Detailed command/clone errors
    # remain in the job directory and never become chat content or SSH output.
    print(json.dumps({"error": message}, separators=(",", ":")))
    raise SystemExit(code)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        die("invalid bridge state", 2)
    if not isinstance(value, dict):
        die("invalid bridge state", 2)
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def decode(value: str, maximum: int) -> str:
    try:
        raw = base64.b64decode(value.encode("ascii"), validate=True)
        if not raw or len(raw) > maximum:
            raise ValueError
        return raw.decode("utf-8")
    except (UnicodeDecodeError, ValueError, base64.binascii.Error):
        die("invalid request payload", 2)


def validate_id(value: str) -> str:
    if not ID_RE.fullmatch(value):
        die("invalid operation id", 2)
    return value


def validate_repository(value: str) -> str:
    if len(value.encode("utf-8")) > MAX_REPOSITORY_BYTES:
        die("invalid repository", 2)
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.username or parsed.password or not parsed.hostname:
        die("repository must be an HTTPS URL without credentials", 2)
    if parsed.fragment or parsed.query:
        die("repository URL must not contain query or fragment", 2)
    return value


def job_dir(operation_id: str) -> Path:
    return BASE_DIR / operation_id


def metadata_path(job: Path) -> Path:
    return job / "metadata.json"


def cleanup_old_jobs() -> None:
    try:
        BASE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        now = time.time()
        for candidate in BASE_DIR.iterdir():
            if not candidate.is_dir() or now - candidate.stat().st_mtime < 30 * 24 * 3600:
                continue
            metadata = candidate / "metadata.json"
            try:
                state = json.loads(metadata.read_text(encoding="utf-8"))
                pid = int(state.get("pid", 0))
                if pid > 0:
                    os.kill(pid, 0)
                    continue
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pass
            subprocess.run(["/bin/rm", "-rf", "--", str(candidate)], check=False)
    except OSError:
        # A normal command below will report a useful error if the directory
        # cannot be created; cleanup itself is best effort.
        return


def local_repository(slug: str) -> Path | None:
    if not SLUG_RE.fullmatch(slug):
        return None
    candidate = Path("/home/codex/Proyectos") / slug
    return candidate if (candidate / ".git").is_dir() else None


def repository_slug(repository: str) -> str:
    path = urlparse(repository).path.rstrip("/")
    slug = path.rsplit("/", 1)[-1].removesuffix(".git")
    if not SLUG_RE.fullmatch(slug):
        die("repository name is not supported", 2)
    return slug


def prepare_repository(job: Path, repository: str) -> tuple[Path, str]:
    slug = repository_slug(repository)
    target = job / "repo"
    clone_log = job / "clone.log"
    source = local_repository(slug)
    if source is not None:
        command = ["/usr/bin/git", "clone", "--local", str(source), str(target)]
    else:
        # Use the Codex LXC's existing gh login only for this subprocess.  The
        # helper never writes credentials into the clone URL or into the job
        # files, and the bot/worker never receives the token.
        command = [
            "/usr/bin/git",
            "-c",
            f"credential.helper={GIT_AUTH_HELPER}",
            "clone",
            "--depth=1",
            repository,
            str(target),
        ]
    with clone_log.open("wb") as log:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            timeout=180,
            check=False,
        )
    if result.returncode != 0:
        die("repository checkout failed", 2)
    branch = f"rakazo/{job.name}"
    checkout = subprocess.run(
        ["/usr/bin/git", "-C", str(target), "checkout", "-b", branch],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        check=False,
    )
    if checkout.returncode != 0:
        die("repository branch creation failed", 2)
    return target, branch


def current_status(state: dict[str, Any]) -> str:
    if state.get("cancel_requested"):
        return "cancelled" if not process_alive(state) else "running"
    if process_alive(state):
        return "running"
    exit_code = state.get("exit_code")
    if exit_code is None:
        return "failed"
    return "finished" if int(exit_code) == 0 else "failed"


def process_alive(state: dict[str, Any]) -> bool:
    try:
        pid = int(state.get("pid", 0))
        if pid <= 0:
            return False
        os.kill(pid, 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


def final_result(job: Path, state: dict[str, Any], status: str) -> str | None:
    if status not in ("finished", "failed"):
        return None
    run_id = state.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        return None
    try:
        raw = (job / f"last-message-{run_id}.txt").read_bytes()
    except OSError:
        return None
    if not raw:
        return None
    truncated = len(raw) > MAX_RESULT_BYTES
    if truncated:
        raw = raw[:MAX_RESULT_BYTES]
    result = raw.decode("utf-8", errors="replace")
    # The final response is intentionally returned to the authenticated worker,
    # but never forward common credential forms if a task printed one by mistake.
    result = re.sub(
        r"gh(?:p|o|s|r|u)_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+",
        "[redacted]",
        result,
    )
    result = re.sub(r"Bearer\s+[^\s\"',;&]+", "Bearer [redacted]", result, flags=re.IGNORECASE)
    result = re.sub(
        r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
        "[redacted]",
        result,
    )
    result = re.sub(
        r"(-----BEGIN [^-]*PRIVATE KEY-----)[\s\S]*?(-----END [^-]*PRIVATE KEY-----)",
        "[redacted private key]",
        result,
    )
    result = re.sub(
        r"((?:api[_-]?key|access[_-]?token|password|secret|token|authorization|auth)\s*[=:]\s*)[^\s\"',;&]+",
        r"\1[redacted]",
        result,
        flags=re.IGNORECASE,
    )
    if truncated:
        result += "\n[output truncated]"
    return result


def response(job: Path, state: dict[str, Any]) -> None:
    status = current_status(state)
    state["status"] = status
    write_json(job / "metadata.json", state)
    payload = {
        "id": state["id"],
        "title": state["title"],
        "status": status,
        "latestRunId": state["run_id"],
        "branch": state.get("branch"),
    }
    result = final_result(job, state, status)
    if result is not None:
        payload["result"] = result
    print(json.dumps(payload, separators=(",", ":")))


def run_worker(operation_id: str) -> None:
    job = job_dir(validate_id(operation_id))
    state = read_json(metadata_path(job))
    run_id = str(state["run_id"])
    prompt_path = job / f"prompt-{run_id}.txt"
    output_path = job / f"events-{run_id}.jsonl"
    stderr_path = job / f"stderr-{run_id}.log"
    last_message = job / f"last-message-{run_id}.txt"
    try:
        repository_path = state.get("repo")
        if (
            not isinstance(repository_path, str)
            or not repository_path
            or not Path(repository_path).is_dir()
        ):
            raise RuntimeError("repository checkout unavailable")
        command = [
            "/usr/bin/codex",
            "-a",
            "never",
            "-s",
            "workspace-write",
            "exec",
            "--json",
            "-C",
            repository_path,
            "-o",
            str(last_message),
        ]
        environment = {
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "CODEX_HOME": str(CODEX_HOME),
            "HOME": "/home/codex",
            "LANG": "C.UTF-8",
        }
        with prompt_path.open("rb") as prompt, output_path.open("wb") as output, stderr_path.open(
            "wb"
        ) as stderr:
            result = subprocess.run(
                command,
                stdin=prompt,
                stdout=output,
                stderr=stderr,
                env=environment,
                cwd=repository_path,
                check=False,
            )
        state = read_json(metadata_path(job))
        state["exit_code"] = result.returncode
        state["finished_at"] = int(time.time())
        write_json(metadata_path(job), state)
    except Exception as error:  # pragma: no cover - defensive process boundary
        (job / "runner-error.log").write_text(str(error), encoding="utf-8")
        state = read_json(metadata_path(job))
        state["exit_code"] = 1
        state["finished_at"] = int(time.time())
        write_json(metadata_path(job), state)


def start_run(job: Path, state: dict[str, Any], prompt: str) -> None:
    run_id = f"run-{uuid.uuid4().hex}"
    (job / f"prompt-{run_id}.txt").write_text(prompt, encoding="utf-8")
    state.update(
        {
            "run_id": run_id,
            "pid": 0,
            "exit_code": None,
            "cancel_requested": False,
            "status": "running",
            "started_at": int(time.time()),
        }
    )
    write_json(metadata_path(job), state)
    child = subprocess.Popen(
        [sys.executable, __file__, "--worker", str(state["id"])],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    state["pid"] = child.pid
    write_json(metadata_path(job), state)


def launch(operation_id: str, prompt: str, repository: str) -> None:
    operation_id = validate_id(operation_id)
    repository = validate_repository(repository)
    if not prompt.strip():
        die("prompt is required", 2)
    job = job_dir(operation_id)
    if metadata_path(job).exists():
        response(job, read_json(metadata_path(job)))
        return
    job.mkdir(mode=0o700, parents=True, exist_ok=False)
    title = prompt.splitlines()[0].strip()[:80] or "Codex task"
    state: dict[str, Any] = {
        "id": operation_id,
        "title": title,
        "repository": repository,
        "status": "preparing",
        "run_id": "",
        "pid": 0,
        "branch": None,
        "created_at": int(time.time()),
    }
    write_json(metadata_path(job), state)
    try:
        repo, branch = prepare_repository(job, repository)
    except SystemExit:
        state.update({"status": "failed", "exit_code": 1, "finished_at": int(time.time())})
        write_json(metadata_path(job), state)
        raise
    except Exception:
        state.update({"status": "failed", "exit_code": 1, "finished_at": int(time.time())})
        write_json(metadata_path(job), state)
        raise
    state["repo"] = str(repo)
    state["branch"] = branch
    start_run(job, state, prompt)
    response(job, state)


def status(operation_id: str) -> None:
    operation_id = validate_id(operation_id)
    job = job_dir(operation_id)
    if not metadata_path(job).exists():
        die("unknown operation", 2)
    response(job, read_json(metadata_path(job)))


def reply(operation_id: str, prompt: str) -> None:
    operation_id = validate_id(operation_id)
    if not prompt.strip():
        die("prompt is required", 2)
    job = job_dir(operation_id)
    state = read_json(metadata_path(job)) if metadata_path(job).exists() else None
    if state is None:
        die("unknown operation", 2)
    if current_status(state) == "running":
        die("operation is still running", 2)
    repository_path = state.get("repo")
    if (
        not isinstance(repository_path, str)
        or not repository_path
        or not Path(repository_path).is_dir()
    ):
        die("repository checkout unavailable", 2)
    state["cancel_requested"] = False
    start_run(job, state, prompt)
    response(job, state)


def cancel(operation_id: str) -> None:
    operation_id = validate_id(operation_id)
    job = job_dir(operation_id)
    if not metadata_path(job).exists():
        die("unknown operation", 2)
    state = read_json(metadata_path(job))
    if current_status(state) == "running":
        state["cancel_requested"] = True
        write_json(metadata_path(job), state)
        try:
            pid = int(state.get("pid", 0))
            if pid > 0:
                os.killpg(pid, signal.SIGTERM)
        except (OSError, ValueError, TypeError):
            pass
    response(job, state)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        run_worker(sys.argv[2])
        return
    cleanup_old_jobs()
    try:
        tokens = shlex.split(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError:
        die("invalid bridge command", 2)
    if not tokens:
        die("bridge command required", 2)
    if tokens[0] in ("rakazo-codex-bridge", "/usr/local/sbin/rakazo-codex-bridge"):
        tokens = tokens[1:]
    if not tokens:
        die("bridge command required", 2)
    command = tokens[0]
    if command == "launch" and len(tokens) == 4:
        launch(tokens[1], decode(tokens[2], MAX_PROMPT_BYTES), decode(tokens[3], MAX_REPOSITORY_BYTES))
    elif command == "status" and len(tokens) == 2:
        status(tokens[1])
    elif command == "reply" and len(tokens) == 3:
        reply(tokens[1], decode(tokens[2], MAX_PROMPT_BYTES))
    elif command == "cancel" and len(tokens) == 2:
        cancel(tokens[1])
    else:
        die("unsupported bridge command", 2)


if __name__ == "__main__":
    main()
