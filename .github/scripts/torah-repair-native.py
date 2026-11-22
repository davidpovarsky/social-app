#!/usr/bin/env python3
"""Run native QA against one Release build on two fresh simulators.

Reuse an existing test account for read-only feed and unsaved composer checks.
Never create accounts, publish posts, save drafts, react, reply or send messages.
The device starts in Hebrew; language changes use the app's UI.
Maestro 2.12.1 hierarchy JSON is used for measured input/header bounds.
Screenshots remain necessary for glyph, clipping and typography review.
"""

import html
import json
import os
import plistlib
import re
import subprocess
import sys
import time
from contextlib import contextmanager, nullcontext
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import urlopen


APP_ID = "com.davidpovarsky.torahsocial"
APP_DISPLAY_NAME = "Torah Social"
REPO = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["QA_ARTIFACTS"])
FLOWS = REPO / "__e2e__/flows/torah-repair"
PHASES = [
    ("01-hebrew-login", "he"),
    ("02-english-login", "en"),
    ("03-hebrew-return", "he"),
    ("04-hebrew-persistence", "he"),
]
# LeftNav accessibility label from the Hebrew catalog; FABs are hidden at 800pt.
TABLET_COMPOSE_LABEL = "כתוב פוסט חדש"
NATIVE_SIDEBAR_MIN_WIDTH = 800
AUTH_PHASES = [
    ("05-authenticated-home", "home"),
    ("06-draft-composer", "composer"),
    ("07-source-picker", "source"),
    ("08-discard-draft", "home"),
]
SECRETS = set()
COLD_BOOT_DEVICES = set()
OWNED_SIMULATOR_DEVICES = set()
COLD_START_ALLOWANCE_SECONDS = 300
SIMULATOR_BOOT_TIMEOUT_SECONDS = 900
# Auxiliary hierarchy starts its own CLI/session. Pinned Maestro 2.12.1 allows
# 180s configured readiness and a 200s snapshot HTTP request. The additional
# 60s is our finite CLI/device-selection/serialization policy, not an upstream
# guarantee that every nested operation receives its full maximum.
HIERARCHY_DRIVER_STARTUP_TIMEOUT_MS = 180_000
HIERARCHY_REQUEST_TIMEOUT_SECONDS = 200
HIERARCHY_CLI_OVERHEAD_SECONDS = 60
HIERARCHY_PROCESS_TIMEOUT_SECONDS = (
    HIERARCHY_DRIVER_STARTUP_TIMEOUT_MS // 1000
    + HIERARCHY_REQUEST_TIMEOUT_SECONDS
    + HIERARCHY_CLI_OVERHEAD_SECONDS
)

# Controlled full-matrix comparison: these exact values were available in the 098
# artifact inventory. Never silently fall back to another runtime or device.
CONTROLLED_RUNTIME = {
    "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-4",
    "version": "26.4.1",
    "buildversion": "23E254a",
}
CONTROLLED_DEVICE_TYPES = {
    "iPhone": {
        "name": "iPhone 17 Pro",
        "identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    },
    "iPad": {
        "name": "iPad Pro 11-inch (M5)",
        "identifier": "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M5-12GB",
    },
}

JWT = re.compile(r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
# Pinned Maestro logs both whole input and separate first-character/rest payloads.
# Redact these records, not each password character throughout unrelated output.
TEXT_INPUT_MARKER = "[REDACTED_TEXT_INPUT]"
DRIVER_INPUT_FRAGMENT = re.compile(
    r"(\[TextInputHelper\][ \t]+(?:first character|remaining text):)[^\r\n]*"
)
MAESTRO_INPUT_TEXT = re.compile(
    r"(maestro\.Maestro\.inputText:[ \t]+Inputting text:)[^\r\n]*"
)
MAESTRO_INPUT_DESCRIPTION = re.compile(
    r"(?m)(maestro\.cli\.runner\.CliConsoleListener\.[A-Za-z]+:[ \t]+Input text )[^\r\n]*?"
    r"([ \t]+(?:RUNNING|COMPLETED|FAILED|SKIPPED|WARNED|PENDING))(?=\r?$)"
)


def register_secret(password):
    SECRETS.update((password, json.dumps(password)[1:-1], quote(password, safe=""), html.escape(password), password.replace("'", "''")))


def redact_text(text):
    text = DRIVER_INPUT_FRAGMENT.sub(lambda match: match[1] + " " + TEXT_INPUT_MARKER, text)
    text = MAESTRO_INPUT_TEXT.sub(lambda match: match[1] + " " + TEXT_INPUT_MARKER, text)
    text = MAESTRO_INPUT_DESCRIPTION.sub(lambda match: match[1] + TEXT_INPUT_MARKER + match[2], text)
    if text.startswith("Input text "):
        text = "Input text " + TEXT_INPUT_MARKER
    # Fail closed if the pinned input-record shapes change. Never echo a payload.
    for line in text.splitlines():
        if "[TextInputHelper]" in line or "maestro.Maestro.inputText:" in line:
            if not line.endswith(TEXT_INPUT_MARKER):
                raise RuntimeError("Unknown Maestro input log format; artifact upload blocked")
        if "maestro.cli.runner.CliConsoleListener." in line and "Input text " in line:
            if not MAESTRO_INPUT_DESCRIPTION.search(line):
                raise RuntimeError("Unknown Maestro input description format; artifact upload blocked")
    if "inputTextCommand" in text or "InputTextCommand(" in text:
        raise RuntimeError("Unstructured Maestro input command; artifact upload blocked")
    for secret in sorted(SECRETS, key=len, reverse=True):
        text = text.replace(secret, "[REDACTED_TEST_PASSWORD]")
    return JWT.sub("[REDACTED_JWT]", text)


def redact_json(value):
    """Keep command metadata/timings and JSON escaping intact while removing input."""
    if isinstance(value, dict):
        if value.get("resource-id") == "loginPasswordInput":
            for name in ("text", "value"):
                field = value.get(name, "")
                if not isinstance(field, str) or (field and not re.fullmatch(r"[\u2022\u25cf]+", field)):
                    raise RuntimeError("Password accessibility value is not fully masked; artifact upload blocked")
        result = {}
        for key, item in value.items():
            if key == "inputTextCommand" and item is not None:
                if (not isinstance(item, dict) or not isinstance(item.get("text"), str)
                        or set(item) - {"text", "label", "optional", "description", "originalDescription"}):
                    raise RuntimeError("Unknown Maestro input command shape; artifact upload blocked")
                result[key] = {
                    name: TEXT_INPUT_MARKER if name == "text" else redact_json(field)
                    for name, field in item.items()
                }
            else:
                result[key] = redact_json(item)
        return result
    if isinstance(value, list):
        return [redact_json(item) for item in value]
    return redact_text(value) if isinstance(value, str) else value


def redact(value, *, json_required=False):
    text = value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value)
    if json_required or text.lstrip().startswith(("{", "[")):
        try:
            document = json.loads(text)
        except json.JSONDecodeError:
            if json_required or "inputTextCommand" in text:
                raise RuntimeError("Cannot safely parse JSON artifact; upload blocked") from None
        else:
            scrubbed = redact_json(document)
            return json.dumps(scrubbed, indent=2, ensure_ascii=False) if scrubbed != document else text
    return redact_text(text)



def require_owned_simulator(udid):
    if udid not in OWNED_SIMULATOR_DEVICES or not re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", udid
    ):
        raise RuntimeError("Pasteboard access requires this run's owned simulator")


class SimulatorPasteboardCommandError(RuntimeError):
    """A fixed message and coarse status; never retain command output here."""

    def __init__(self, status):
        if status not in ("timeout", "nonzero_exit", "os_error", "contract_error"):
            raise ValueError("Unsupported pasteboard failure status")
        super().__init__("Owned simulator pasteboard command failed")
        self.status = status


def simulator_pasteboard_command(udid, operation, payload=None, *, stage, attempt, operations):
    """Keep pasteboard contents out of argv, logs and exception messages."""
    require_owned_simulator(udid)
    stages = {
        "setup_copy": "pbcopy", "setup_readback": "pbpaste",
        "cleanup_clear": "pbcopy", "cleanup_verify": "pbpaste",
    }
    if operation not in ("pbcopy", "pbpaste") or stages.get(stage) != operation:
        raise ValueError("Unsupported simulator pasteboard operation or stage")
    if (operation == "pbcopy" and not isinstance(payload, bytes)) or (
        operation == "pbpaste" and payload is not None
    ):
        raise ValueError("Pasteboard payload must be private copy stdin or absent for readback")
    if type(attempt) is not int or attempt not in (1, 2) or (
        stage.startswith("cleanup_") and attempt != 1
    ) or not isinstance(operations, list):
        raise ValueError("Unsupported pasteboard attempt or telemetry container")
    event = {
        "stage": stage, "operation": operation, "attempt": attempt,
        "timeout_seconds": 60, "status": "contract_error",
        "returncode": None, "errno": None,
    }
    started = time.monotonic()
    try:
        try:
            process = subprocess.run(
                ["xcrun", "simctl", operation, udid],
                input=payload,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
                check=False,
            )
        except subprocess.TimeoutExpired:
            event["status"] = "timeout"
            raise SimulatorPasteboardCommandError("timeout") from None
        except OSError as error:
            event["status"] = "os_error"
            event["errno"] = error.errno if type(error.errno) is int else None
            raise SimulatorPasteboardCommandError("os_error") from None
        except subprocess.SubprocessError:
            raise SimulatorPasteboardCommandError("contract_error") from None
        code = getattr(process, "returncode", None)
        event["returncode"] = code if type(code) is int else None
        if type(code) is not int:
            raise SimulatorPasteboardCommandError("contract_error")
        if code != 0:
            event["status"] = "nonzero_exit"
            raise SimulatorPasteboardCommandError("nonzero_exit")
        if not isinstance(process.stdout, bytes):
            raise SimulatorPasteboardCommandError("contract_error")
        event["status"] = "passed"
        return process.stdout
    finally:
        event["elapsed_seconds"] = round(time.monotonic() - started, 3)
        operations.append(event)


@contextmanager
def simulator_password_pasteboard(udid, password, folder):
    """Verify private input; allow one failed setup-command recovery, always clear."""
    require_owned_simulator(udid)
    if not isinstance(password, str) or not password:
        raise ValueError("A nonempty existing fixture password is required")
    folder.mkdir(parents=True, exist_ok=True)
    encoded = password.encode("utf-8")
    audit = {
        "expected_length": len(password),
        "expected_utf8_bytes": len(encoded),
        "readback_utf8_bytes": None,
        "readback_matches": False,
        "cleanup_attempted": False,
        "cleanup_verified": False,
        "setup_recovery_limit": 1,
        "setup_recoveries_used": 0,
        "setup_status": "failed",
        "body_status": "not_started",
        "cleanup_status": "not_started",
        "operations": [],
    }

    def setup_command(operation, payload=None):
        stage = "setup_copy" if operation == "pbcopy" else "setup_readback"
        try:
            return simulator_pasteboard_command(
                udid, operation, payload, stage=stage, attempt=1, operations=audit["operations"]
            )
        except SimulatorPasteboardCommandError as error:
            if error.status not in ("timeout", "nonzero_exit") or audit["setup_recoveries_used"]:
                raise
            # Repeat only this idempotent command, once across the entire setup.
            # No UI/login command has started, and semantic failures never retry.
            audit["setup_recoveries_used"] = 1
            return simulator_pasteboard_command(
                udid, operation, payload, stage=stage, attempt=2, operations=audit["operations"]
            )

    try:
        setup_command("pbcopy", encoded)
        readback = setup_command("pbpaste")
        audit["readback_utf8_bytes"] = len(readback)
        audit["readback_matches"] = readback == encoded
        if not audit["readback_matches"]:
            raise RuntimeError("Owned simulator pasteboard readback did not match")
        del readback
        audit["setup_status"] = "passed"
        audit["body_status"] = "running"
        try:
            yield
        except BaseException:
            audit["body_status"] = "failed"
            raise
        else:
            audit["body_status"] = "passed"
    finally:
        audit["cleanup_attempted"] = True
        audit["cleanup_status"] = "failed"
        try:
            simulator_pasteboard_command(
                udid, "pbcopy", b"", stage="cleanup_clear", attempt=1, operations=audit["operations"]
            )
            audit["cleanup_verified"] = simulator_pasteboard_command(
                udid, "pbpaste", stage="cleanup_verify", attempt=1, operations=audit["operations"]
            ) == b""
            if not audit["cleanup_verified"]:
                raise RuntimeError("Owned simulator pasteboard cleanup did not verify")
            audit["cleanup_status"] = "passed"
        finally:
            (folder / "password-pasteboard.json").write_text(
                json.dumps(audit, indent=2), encoding="utf-8"
            )

def fixture_password(handle):
    match = re.fullmatch(r"e2e-a-([0-9]+)\.[A-Za-z0-9.-]+", handle)
    if not match:
        raise ValueError("Only an existing project e2e-a fixture can be used")
    script = (REPO / ".github/scripts/run-torah-e2e.sh").read_text()
    recipe = re.search(r'''^E2E_USER_A_PASSWORD=(["'])([^\r\n]+)\1$''', script, re.MULTILINE)
    if not recipe:
        raise ValueError("Existing fixture credential recipe must be a quoted literal")
    password = recipe[2].replace("${E2E_RUN_ID}", match[1]).replace("$E2E_RUN_ID", match[1])
    if not password or re.search(r"[`$]", password):
        raise ValueError("Fixture credential recipe must not require shell evaluation")
    return password


def existing_fixture():
    pds = os.environ["EXPO_PUBLIC_TORAH_PDS_HOST"].rstrip("/")
    appview = os.environ["EXPO_PUBLIC_TORAH_APPVIEW_HOST"].rstrip("/")
    if any(urlparse(url).scheme != "https" or urlparse(url).username for url in (pds, appview)):
        raise ValueError("Fixture discovery requires the configured HTTPS Torah endpoints")
    with urlopen(appview + "/xrpc/app.bsky.actor.getSuggestions?limit=100", timeout=20) as response:
        actors = json.load(response).get("actors", [])
    suffix = "." + urlparse(pds).hostname
    actor = next((item for item in actors if re.match(r"^e2e-a-[0-9]+\.", item.get("handle", "")) and item["handle"].endswith(suffix)), None)
    if actor is None:
        raise RuntimeError("An existing local e2e-a account is required; this suite never creates one")
    password = fixture_password(actor["handle"])
    register_secret(password)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print("::add-mask::" + password.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"), flush=True)
    # Only public fixture metadata is saved. No session API is called by Python.
    metadata = {"handle": actor["handle"], "did": actor["did"], "pds": pds}
    (OUT / "fixture.json").write_text(json.dumps(metadata, indent=2))
    return {**metadata, "password": password}


def sanitize_artifacts():
    """Gate artifact upload even when the simulator test step fails or times out."""
    fixture = OUT / "fixture.json"
    if fixture.exists():
        register_secret(fixture_password(json.loads(fixture.read_text())["handle"]))
    checked, rewritten = 0, 0
    for path in OUT.rglob("*"):
        if not path.is_file():
            continue
        raw = path.read_bytes()
        if raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff"):
            continue  # App password fields are secure; no unmasked credential screenshot is taken.
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise RuntimeError(f"Cannot safely scan binary artifact {path.relative_to(OUT)}; upload blocked") from None
        scrubbed = redact(text, json_required=path.suffix.lower() == ".json")
        checked += 1
        if scrubbed != text:
            path.write_text(scrubbed, encoding="utf-8")
            rewritten += 1
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sanitization.json").write_text(json.dumps({"text_files_checked": checked, "redacted_files": rewritten, "jwt_filter": True, "password_filter": fixture.exists(), "driver_fragment_filter": True, "input_command_filter": True}, indent=2))


def run(args, log, timeout=120, env=None):
    """Capture every command, retain its output, and propagate nonzero exits."""
    log.parent.mkdir(parents=True, exist_ok=True)
    args = list(map(str, args))
    command = " ".join(args)
    print("Running:", redact(command), flush=True)
    try:
        result = subprocess.run(
            args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            timeout=timeout, check=False, cwd=REPO, env=env,
        )
    except subprocess.TimeoutExpired as error:
        log.write_text(redact(error.stdout or ""), encoding="utf-8")
        raise RuntimeError(f"Command timed out after {timeout}s: {redact(command)}") from None
    output = redact(result.stdout)
    log.write_text(output, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(
            f"Command exited {result.returncode}: {redact(command)}\n"
            f"{output[-6000:]}"
        )
    if args[:3] == ["xcrun", "simctl", "boot"] and len(args) == 4:
        # Every successful new boot invalidates the driver's warm state, even
        # when a future authenticated phase introduces another reboot.
        COLD_BOOT_DEVICES.add(args[3])
    return output


def wait_for_boot(udid, log, phase, timeout=SIMULATOR_BOOT_TIMEOUT_SECONDS):
    """Keep OS migration readiness separate from app/UI process budgets."""
    log.parent.mkdir(parents=True, exist_ok=True)
    timing_path = log.with_name(log.stem + "-timing.json")
    timing = {
        "category": "simulator-setup", "phase": phase, "status": "running",
        "timeout_seconds": timeout,
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    started = time.monotonic()
    timing_path.write_text(json.dumps(timing, indent=2))
    print(f"Waiting for {phase} simulator boot readiness (budget {timeout}s)", flush=True)
    try:
        output = run(["xcrun", "simctl", "bootstatus", udid, "-b"], log, timeout)
        timing["status"] = "passed"
        return output
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        timing.update({"status": "failed", "error": redact(error)})
        raise
    finally:
        timing["elapsed_seconds"] = round(time.monotonic() - started, 3)
        if log.is_file():
            timing["progress_tail"] = redact(log.read_text(encoding="utf-8"))[-2000:]
        timing_path.write_text(json.dumps(timing, indent=2))
        print("Simulator boot readiness:", json.dumps(timing), flush=True)


def run_maestro(args, udid, folder, flow_budget):
    """Keep cold CLI/XCTest startup separate from unchanged UI assertions."""
    folder.mkdir(parents=True, exist_ok=True)
    cold = udid in COLD_BOOT_DEVICES
    COLD_BOOT_DEVICES.discard(udid)
    allowance = COLD_START_ALLOWANCE_SECONDS if cold else 0
    # Maestro's own readiness deadline must allow the existing cold-start
    # budget; warm runs retain the caller's environment and normal deadline.
    subprocess_env = {
        **os.environ,
        "MAESTRO_DRIVER_STARTUP_TIMEOUT": str(COLD_START_ALLOWANCE_SECONDS * 1000),
    } if cold else None
    driver_startup_timeout = (subprocess_env or os.environ).get("MAESTRO_DRIVER_STARTUP_TIMEOUT", "120000")
    timing = {
        "flow_process_budget_seconds": flow_budget,
        "cold_start_allowance_seconds": allowance,
        "process_timeout_seconds": flow_budget + allowance,
        "first_test_after_boot": cold,
        "driver_startup_timeout_ms": driver_startup_timeout,
        "status": "failed",
    }
    started = time.monotonic()
    try:
        output = run(args, folder / "maestro.log", flow_budget + allowance, env=subprocess_env)
        timing["status"] = "passed"
        return output
    finally:
        timing["elapsed_seconds"] = round(time.monotonic() - started, 3)
        (folder / "process-timing.json").write_text(json.dumps(timing, indent=2))


def hierarchy(udid, folder):
    """Collect raw geometry with a bounded CLI budget and safe failure evidence."""
    folder.mkdir(parents=True, exist_ok=True)
    subprocess_env = {
        **os.environ,
        "MAESTRO_DRIVER_STARTUP_TIMEOUT": str(HIERARCHY_DRIVER_STARTUP_TIMEOUT_MS),
    }
    # Pin and record the effective child value; a changed parent env cannot
    # silently invalidate this auxiliary process budget.
    timing = {
        "category": "auxiliary-hierarchy",
        "driver_startup_timeout_ms": subprocess_env["MAESTRO_DRIVER_STARTUP_TIMEOUT"],
        "snapshot_request_timeout_seconds": HIERARCHY_REQUEST_TIMEOUT_SECONDS,
        "cli_overhead_allowance_seconds": HIERARCHY_CLI_OVERHEAD_SECONDS,
        "process_timeout_seconds": HIERARCHY_PROCESS_TIMEOUT_SECONDS,
        "status": "failed",
        "failure_stage": "process",
        "timed_out": False,
        "returncode": None,
    }

    def sanitized_capture(value):
        text = value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value)
        stripped = text.lstrip()
        # Do not reinterpret truncated JSON/AX output as an ordinary log.
        # A partial secure-field value may not contain the full registered secret.
        structured = stripped.startswith(("{", "[")) or re.search(
            r'"[^"\r\n]*"\s*:|loginPasswordInput|inputTextCommand|XCUIElementTypeSecureTextField',
            text,
        )
        return redact(text, json_required=bool(structured))

    stdout = stderr = ""
    started = time.monotonic()
    try:
        try:
            result = subprocess.run(
                ["maestro", "--device", udid, "hierarchy", "--no-reinstall-driver"],
                capture_output=True, text=True,
                timeout=HIERARCHY_PROCESS_TIMEOUT_SECONDS, check=False,
                env=subprocess_env,
            )
        except subprocess.TimeoutExpired as error:
            stdout, stderr = error.stdout or "", error.stderr or ""
            timing["timed_out"] = True
            raise RuntimeError(
                f"Maestro hierarchy timed out after {HIERARCHY_PROCESS_TIMEOUT_SECONDS}s"
            ) from None
        stdout, stderr = result.stdout or "", result.stderr or ""
        timing["returncode"] = result.returncode
        timing["failure_stage"] = "output-sanitization"
        safe_stdout, safe_stderr = sanitized_capture(stdout), sanitized_capture(stderr)
        timing["failure_stage"] = "process-exit"
        if result.returncode:
            raise RuntimeError(
                f"Maestro hierarchy failed ({result.returncode}): {safe_stderr[-3000:]}"
            )
        timing["failure_stage"] = "json-parse"
        tree = json.loads(safe_stdout)
        timing["failure_stage"] = "application-root"
        root = application_root(tree)
        timing["status"] = "passed"
        timing.pop("failure_stage")
        return root
    finally:
        timing["elapsed_seconds"] = round(time.monotonic() - started, 3)
        capture_refused = False
        try:
            captures = {}
            for stream, value in (("stdout", stdout), ("stderr", stderr)):
                timing[f"{stream}_bytes"] = (
                    len(value) if isinstance(value, bytes) else len(str(value).encode("utf-8"))
                )
                try:
                    captures[stream] = sanitized_capture(value)
                    timing[f"{stream}_capture_status"] = "retained"
                except (RuntimeError, ValueError):
                    # Withhold uncertain payloads, never their parser input/error.
                    captures[stream] = "[WITHHELD_UNSAFE_HIERARCHY_CAPTURE]\n"
                    timing[f"{stream}_capture_status"] = "withheld"
                    capture_refused = True
            timing["capture_refused"] = capture_refused
            (folder / "hierarchy-stdout.log").write_text(captures["stdout"], encoding="utf-8")
            (folder / "hierarchy-stderr.log").write_text(captures["stderr"], encoding="utf-8")
            timing["stdout_complete_json"] = False
            if timing["stdout_capture_status"] == "retained":
                try:
                    json.loads(captures["stdout"])
                except json.JSONDecodeError:
                    pass
                else:
                    timing["stdout_complete_json"] = True
                    (folder / "hierarchy.json").write_text(captures["stdout"], encoding="utf-8")
            if capture_refused:
                timing["status"] = "failed"
                timing["failure_stage"] = "capture-sanitization"
                raise RuntimeError("Cannot safely retain hierarchy capture; payload withheld") from None
        except Exception:
            timing["status"] = "failed"
            if not capture_refused:
                timing["failure_stage"] = "artifact-output"
            raise
        finally:
            # A distinct filename preserves the existing flow/cold aggregates.
            (folder / "hierarchy-timing.json").write_text(
                json.dumps(timing, indent=2), encoding="utf-8"
            )


def version(value):
    return tuple(int(part) for part in re.findall(r"\d+", value))


def tree_nodes(node):
    yield node
    for child in node.get("children", []):
        yield from tree_nodes(child)


def bounds(node):
    value = node.get("attributes", {}).get("bounds", "")
    match = re.fullmatch(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", value)
    if not match:
        raise AssertionError(f"Missing or unexpected Maestro bounds: {value!r}")
    return tuple(int(part) for part in match.groups())


def application_root(tree):
    """Resolve the app beneath Maestro's zero-bounds synthetic iOS root."""
    candidates = [
        node for node in (tree, *tree.get("children", []))
        if node.get("attributes", {}).get("accessibilityText") == APP_DISPLAY_NAME
    ]
    if len(candidates) != 1:
        raise AssertionError(f"Expected one {APP_DISPLAY_NAME!r} app root; found {len(candidates)}")
    app = candidates[0]
    if app.get("enabled", app.get("attributes", {}).get("enabled")) not in (True, "true"):
        raise AssertionError("Torah app root is not enabled")
    left, top, right, bottom = bounds(app)
    if right <= left or bottom <= top:
        raise AssertionError(f"Degenerate Torah app viewport: {(left, top, right, bottom)}")
    return app


def assert_login_layout(tree, language):
    """Check visible controls, rather than offscreen scroll-view descendants."""
    nodes = list(tree_nodes(tree))
    screen = bounds(tree)
    left, top, right, bottom = screen
    if right - left < 300 or bottom - top < 400:
        raise AssertionError(f"Unexpected app viewport: {screen}")
    checks = {}
    for identifier in ("loginUsernameInput", "loginPasswordInput"):
        matches = [
            node for node in nodes
            if node.get("attributes", {}).get("resource-id") == identifier
        ]
        if len(matches) != 1:
            raise AssertionError(f"Expected one {identifier}; found {len(matches)}")
        rect = bounds(matches[0])
        x1, y1, x2, y2 = rect
        if not (left - 2 <= x1 < x2 <= right + 2 and top - 2 <= y1 < y2 <= bottom + 2):
            raise AssertionError(f"{identifier} exceeds viewport: {rect} vs {screen}")
        if x2 - x1 < 40 or y2 - y1 < 12:
            raise AssertionError(f"{identifier} is collapsed: {rect}")
        checks[identifier] = rect
    back_label = "חזור" if language == "he" else "Go back"
    matches = [
        node for node in nodes
        if back_label in (
            node.get("attributes", {}).get("text"),
            node.get("attributes", {}).get("accessibilityText"),
        )
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one {back_label!r} button; found {len(matches)}")
    back = bounds(matches[0])
    if not (left - 2 <= back[0] < back[2] <= right + 2):
        raise AssertionError(f"Back button exceeds viewport: {back}")
    center = (back[0] + back[2]) / 2
    midpoint = (left + right) / 2
    if (language == "he" and center <= midpoint) or (language == "en" and center >= midpoint):
        raise AssertionError(f"Back button is on the wrong side for {language}: {back}")
    return {"language": language, "viewport": screen, "inputs": checks, "back": back}


def element_text(node):
    return " ".join(
        str(value)
        for child in tree_nodes(node)
        for key, value in child.get("attributes", {}).items()
        if key in ("text", "accessibilityText", "value") and value
    )


def one_element(tree, identifier):
    matches = [node for node in tree_nodes(tree) if node.get("attributes", {}).get("resource-id") == identifier]
    if len(matches) != 1:
        raise AssertionError(f"Expected one {identifier}; found {len(matches)}")
    return matches[0]


def assert_default_provider(tree, account):
    provider = one_element(tree, "selectServiceButton")
    # Upstream's idle indicator says only "Hosting provider"; its automatic
    # dialog does not expose the default URL. A bare username cannot trigger
    # PDS autodetection: successful auth below must use defaultService and the
    # domain from its describeServer response. Never set a manual override.
    return {
        "expected_provider": account["pds"],
        "displayed_provider": element_text(provider),
        "provider_bounds": bounds(provider),
        "default_service_gate": "mandatory bare-username login without manual override",
        "bare_username": account["handle"].split(".", 1)[0],
    }


def uses_native_sidebar(tree, family):
    left, _, right, _ = bounds(tree)
    return family == "iPad" and right - left >= NATIVE_SIDEBAR_MIN_WIDTH


def assert_authenticated_layout(tree, screen_name, family):
    """Check actual visible native frames and content, without triggering actions."""
    screen = bounds(tree)
    left, top, right, bottom = screen
    if right - left < 300 or bottom - top < 400:
        raise AssertionError(f"Unexpected app viewport: {screen}")
    checks = {}

    def inside(node, identifier, horizontal_only=False):
        rect = bounds(node)
        x1, y1, x2, y2 = rect
        if not (left - 2 <= x1 < x2 <= right + 2):
            raise AssertionError(f"{identifier} exceeds viewport width: {rect} vs {screen}")
        if not horizontal_only and not (top - 2 <= y1 < y2 <= bottom + 2):
            raise AssertionError(f"{identifier} exceeds viewport height: {rect} vs {screen}")
        if x2 - x1 < 12 or y2 - y1 < 12:
            raise AssertionError(f"{identifier} is collapsed: {rect}")
        checks[identifier] = rect

    if screen_name == "home":
        inside(one_element(tree, "HomeScreen"), "HomeScreen")
        if uses_native_sidebar(tree, family):
            matches = [
                node for node in tree_nodes(tree)
                if TABLET_COMPOSE_LABEL in (
                    node.get("attributes", {}).get("text"),
                    node.get("attributes", {}).get("accessibilityText"),
                )
            ]
            if len(matches) != 1:
                raise AssertionError(f"Expected one tablet compose button; found {len(matches)}")
            inside(matches[0], "tabletComposeButton")
        else:
            inside(one_element(tree, "composeFAB"), "composeFAB")
        posts = [
            node for node in tree_nodes(tree)
            if node.get("attributes", {}).get("resource-id") == "postText"
            and bounds(node)[3] > top and bounds(node)[1] < bottom
            and element_text(node).strip()
        ]
        if not posts:
            raise AssertionError("Authenticated timeline has no visible nonempty post text")
        for index, post in enumerate(posts):
            inside(post, f"visible-post-{index}", horizontal_only=True)
    elif screen_name == "composer":
        inside(one_element(tree, "composePostView"), "composePostView")
        inside(one_element(tree, "composerPublishBtn"), "composerPublishBtn")
        editor = one_element(tree, "composerTextInput")
        inside(editor, "composerTextInput", horizontal_only=True)
        if "Torah QA" not in element_text(editor):
            raise AssertionError("The unsaved mixed-language draft is missing from the composer")
    elif screen_name == "source":
        query = one_element(tree, "torahSourceQueryInput")
        inside(query, "torahSourceQueryInput")
        if "Genesis 1" not in element_text(query):
            raise AssertionError("Source picker did not retain the typed query")
    else:
        raise ValueError(f"Unknown authenticated screen {screen_name}")
    return {"screen": screen_name, "viewport": screen, "elements": checks}



def select_runtime(inventory, *, controlled_comparison=False, minimum_os_version=None):
    """Keep normal selection unchanged; pin the full-matrix runtime comparison."""
    runtimes = [item for item in inventory["runtimes"] if item.get("isAvailable") and ".iOS-" in item["identifier"] and version(item["version"]) >= (26, 4)]
    if not runtimes:
        raise RuntimeError("No available iOS simulator runtime >= 26.4")
    if not controlled_comparison:
        return max(runtimes, key=lambda item: version(item["version"]))

    matches = [
        item for item in inventory["runtimes"]
        if item.get("identifier") == CONTROLLED_RUNTIME["identifier"]
    ]
    if len(matches) != 1:
        raise RuntimeError("Expected exactly one explicitly selected controlled-comparison runtime")
    runtime = matches[0]
    if runtime.get("isAvailable") is not True or any(
        runtime.get(key) != value for key, value in CONTROLLED_RUNTIME.items()
    ):
        raise RuntimeError("Controlled-comparison runtime availability, version or build differs")
    if runtime not in runtimes:
        raise RuntimeError("Controlled-comparison runtime does not satisfy the existing iOS >= 26.4 policy")
    if not isinstance(minimum_os_version, str) or re.fullmatch(
        r"[0-9]+(?:\.[0-9]+){0,2}", minimum_os_version
    ) is None:
        raise RuntimeError("App MinimumOSVersion is missing or invalid")
    minimum = version(minimum_os_version)
    minimum += (0,) * (3 - len(minimum))
    if minimum > version(runtime["version"]):
        raise RuntimeError("Selected controlled-comparison runtime is below the app MinimumOSVersion")

    supported = runtime.get("supportedDeviceTypes")
    types = inventory.get("devicetypes")
    if not isinstance(supported, list) or not isinstance(types, list):
        raise RuntimeError("Controlled-comparison runtime device-support metadata is missing")
    for family, expected in CONTROLLED_DEVICE_TYPES.items():
        for collection in (types, supported):
            matching_types = [
                item for item in collection
                if isinstance(item, dict) and item.get("identifier") == expected["identifier"]
            ]
            if len(matching_types) != 1 or matching_types[0].get("name") != expected["name"]:
                raise RuntimeError(f"Exact controlled-comparison {family} device type is missing or ambiguous")
        if select_device_type(inventory, runtime, family)["identifier"] != expected["identifier"]:
            raise RuntimeError(f"Controlled-comparison {family} selection changed unexpectedly")
    return runtime


def select_device_type(inventory, runtime, family):
    # Use types supported by the installed runtime when Xcode supplies that list.
    supported = runtime.get("supportedDeviceTypes", [])
    allowed = {item["identifier"] for item in supported}
    types = [
        item for item in inventory["devicetypes"]
        if item["name"].startswith(family + " ")
        and (not allowed or item["identifier"] in allowed)
    ]
    preferred = (
        ["iPhone 17 Pro", "iPhone 17", "iPhone 16 Pro", "iPhone 16"]
        if family == "iPhone"
        else ["iPad Pro 11-inch (M5)", "iPad Pro 11-inch (M4)", "iPad Air 11-inch (M4)"]
    )
    if not types:
        raise RuntimeError(f"No {family} device type for {runtime['name']}")
    return min(types, key=lambda item: (
        preferred.index(item["name"]) if item["name"] in preferred else len(preferred),
        item["name"],
    ))


def seed_legacy_flags(udid, folder):
    """Simulate upgrading an installation that persisted old RN RTL overrides."""
    run(["xcrun", "simctl", "terminate", udid, APP_ID], folder / "terminate.log")
    container = Path(run(["xcrun", "simctl", "get_app_container", udid, APP_ID, "data"], folder / "data-container.log").strip())
    # Stop cfprefsd as part of shutdown before editing the actual app sandbox.
    # Global simulator defaults are a different domain and cannot seed this bug.
    run(["xcrun", "simctl", "shutdown", udid], folder / "shutdown.log")
    preferences = container / "Library/Preferences" / f"{APP_ID}.plist"
    values = plistlib.loads(preferences.read_bytes()) if preferences.exists() else {}
    legacy = {
        "RCTI18nUtil_forceRTL": True,
        "RCTI18nUtil_makeRTLFlipLeftAndRightStyles": True,
    }
    values.update(legacy)
    preferences.parent.mkdir(parents=True, exist_ok=True)
    preferences.write_bytes(plistlib.dumps(values, fmt=plistlib.FMT_BINARY))
    fixture = {key: plistlib.loads(preferences.read_bytes())[key] for key in legacy}
    if fixture != legacy:
        raise AssertionError("Legacy RTL preferences were not persisted")
    (folder / "seeded-rtl-flags.json").write_text(json.dumps(fixture, indent=2))
    run(["xcrun", "simctl", "boot", udid], folder / "boot.log")
    wait_for_boot(udid, folder / "bootstatus.log", "legacy", timeout=240)


def exercise_device(family, device_type, runtime, app, executable, account):
    folder = OUT / family.lower()
    folder.mkdir(parents=True, exist_ok=True)
    result = {"family": family, "type": device_type["name"], "phases": [], "status": "failed"}
    started = time.monotonic()
    udid = None
    try:
        udid = run([
            "xcrun", "simctl", "create", f"TorahRepair-{family}-{os.getpid()}",
            device_type["identifier"], runtime["identifier"],
        ], folder / "create.log").strip()
        result["udid"] = udid
        OWNED_SIMULATOR_DEVICES.add(udid)
        run(["xcrun", "simctl", "boot", udid], folder / "boot.log")
        wait_for_boot(udid, folder / "bootstatus.log", "initial")
        run(["xcrun", "simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLanguages", "-array", "he", "en"], folder / "set-languages.log")
        run(["xcrun", "simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLocale", "-string", "he_IL"], folder / "set-locale.log")
        # Restart SpringBoard with the language configured before the first app launch.
        run(["xcrun", "simctl", "shutdown", udid], folder / "locale-shutdown.log")
        run(["xcrun", "simctl", "boot", udid], folder / "locale-boot.log")
        wait_for_boot(udid, folder / "locale-bootstatus.log", "locale")
        run(["xcrun", "simctl", "spawn", udid, "defaults", "read", "NSGlobalDomain", "AppleLanguages"], folder / "device-languages.log")
        run(["xcrun", "simctl", "install", udid, app], folder / "install.log")
        for fixture in ("fresh", "legacy"):
            if fixture == "legacy":
                seed_legacy_flags(udid, folder / "legacy-fixture")
            for name, language in PHASES:
                phase = {"name": name, "fixture": fixture, "language": language, "status": "failed"}
                result["phases"].append(phase)
                phase_dir = folder / fixture / name
                flow_name = "01-legacy-hebrew-login" if fixture == "legacy" and name == "01-hebrew-login" else name
                run_maestro([
                    "maestro", "--device", udid, "test", "--no-reinstall-driver", "--format", "junit",
                    "--output", phase_dir / "junit.xml",
                    "--debug-output", phase_dir / "debug",
                    "--test-output-dir", phase_dir / "artifacts",
                    "-e", f"APP_ID={APP_ID}", FLOWS / f"{flow_name}.yml",
                ], udid, phase_dir, 300)
                tree = hierarchy(udid, phase_dir)
                layout = assert_login_layout(tree, language)
                (phase_dir / "layout-bounds.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2))
                run(["xcrun", "simctl", "io", udid, "screenshot", phase_dir / "verified-login.png"], phase_dir / "screenshot.log")
                phase["status"] = "passed"
        # Retain the initial indicator before testing the actual default through
        # a bare-username login. No phase changes the selected hosting provider.
        provider_dir = folder / "authenticated/default-provider"
        provider_dir.mkdir(parents=True, exist_ok=True)
        provider_tree = hierarchy(udid, provider_dir)
        provider = assert_default_provider(provider_tree, account)
        native_sidebar = uses_native_sidebar(provider_tree, family)
        (provider_dir / "default-provider.json").write_text(json.dumps(provider, indent=2))
        run(["xcrun", "simctl", "io", udid, "screenshot", provider_dir / "initial-provider.png"], provider_dir / "screenshot.log")
        for name, screen_name in AUTH_PHASES:
            phase = {"name": name, "fixture": "existing-account", "screen": screen_name, "status": "failed"}
            result["phases"].append(phase)
            phase_dir = folder / "authenticated" / name
            args = [
                "maestro", "--device", udid, "test", "--no-reinstall-driver", "--format", "junit",
                "--output", phase_dir / "junit.xml",
                "--debug-output", phase_dir / "debug",
                "--test-output-dir", phase_dir / "artifacts",
                "-e", f"APP_ID={APP_ID}",
                "-e", f"NATIVE_SIDEBAR={str(native_sidebar).lower()}",
            ]
            # Only the public username and expected length go to Maestro.
            # The secret uses the owned simulator pasteboard through private stdin.
            # Authentication still happens through the real secure field and UI.
            is_login_phase = screen_name == "home" and name.startswith("05-")
            if is_login_phase:
                for key, value in {
                    "FIXTURE_USERNAME": account["handle"].split(".", 1)[0],
                    "FIXTURE_PASSWORD_LENGTH": len(account["password"]),
                }.items():
                    args.extend(["-e", f"{key}={value}"])
            args.append(FLOWS / f"{name}.yml")
            try:
                pasteboard = (
                    simulator_password_pasteboard(udid, account["password"], phase_dir)
                    if is_login_phase else nullcontext()
                )
                with pasteboard:
                    run_maestro(args, udid, phase_dir, 360)
            finally:
                # Maestro's own debug JSON may include resolved env values.
                sanitize_artifacts()
            layout = assert_authenticated_layout(hierarchy(udid, phase_dir), screen_name, family)
            (phase_dir / "layout-bounds.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2))
            run(["xcrun", "simctl", "io", udid, "screenshot", phase_dir / "verified-screen.png"], phase_dir / "screenshot.log")
            phase["status"] = "passed"
        result["status"] = "passed"
    except (AssertionError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result["error"] = redact(error)
        print(f"::error::{family} native QA failed: {redact(error)}", flush=True)
    finally:
        if udid:
            # Diagnostic failures are recorded separately and also fail the job.
            diagnostics = [
                ("final-screenshot", ["xcrun", "simctl", "io", udid, "screenshot", folder / "final-screen.png"]),
                ("app-log", ["xcrun", "simctl", "spawn", udid, "log", "show", "--last", "15m", "--style", "compact", "--predicate", f'process == "{executable}"']),
                ("shutdown", ["xcrun", "simctl", "shutdown", udid]),
                ("delete", ["xcrun", "simctl", "delete", udid]),
            ]
            for label, command in diagnostics:
                try:
                    run(command, folder / f"{label}.log", 60)
                except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                    result.setdefault("diagnostic_errors", []).append(redact(error))
                    result["status"] = "failed"
        if udid:
            OWNED_SIMULATOR_DEVICES.discard(udid)
        result["elapsed_seconds"] = round(time.monotonic() - started, 3)
        (folder / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
        sanitize_artifacts()
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    account = existing_fixture()
    app = Path(os.environ["TORAH_SIMULATOR_APP"])
    with (app / "Info.plist").open("rb") as stream:
        info = plistlib.load(stream)
    if info.get("CFBundleIdentifier") != APP_ID or not {1, 2}.issubset(info.get("UIDeviceFamily", [])):
        raise RuntimeError("Release build must have the Torah bundle ID and support both iPhone and iPad")
    if not (app / "main.jsbundle").is_file():
        raise RuntimeError("Release app is missing its embedded JavaScript bundle")
    inventory = json.loads(run(["xcrun", "simctl", "list", "-j"], OUT / "runtime-inventory.json"))
    runtime = select_runtime(inventory, controlled_comparison=True, minimum_os_version=info.get("MinimumOSVersion"))
    results = []
    report = {
        "sha": os.environ.get("TORAH_SIMULATOR_SOURCE_SHA", os.environ.get("GITHUB_SHA")),
        "harness_sha": os.environ.get("GITHUB_SHA"),
        "runtime": runtime["name"], "app_id": APP_ID,
        "mode": "full-native-matrix-controlled-runtime-comparison",
        "expected_flow_executions": 24,
        "controlled_runtime_comparison": {
            "target": {**CONTROLLED_RUNTIME, "isAvailable": True},
            "actual": {key: runtime[key] for key in ("identifier", "version", "buildversion", "isAvailable")},
            "app_minimum_os_version": info["MinimumOSVersion"],
            "required_device_types": CONTROLLED_DEVICE_TYPES,
        },
        "started": time.time(), "devices": results,
    }
    for family in ("iPhone", "iPad"):
        results.append(exercise_device(family, select_device_type(inventory, runtime, family), runtime, app, info["CFBundleExecutable"], account))
        timings = [json.loads(path.read_text()) for path in OUT.glob("*/**/process-timing.json")]
        report["elapsed_seconds"] = round(time.time() - report["started"], 3)
        report["cold_start_allowances_used"] = sum(item["first_test_after_boot"] for item in timings)
        report["maestro_process_seconds"] = round(sum(item["elapsed_seconds"] for item in timings), 3)
        (OUT / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write("## Native repair QA\n\n")
            summary.write(f"Compiled app source: `{report['sha']}`; harness source: `{report['harness_sha']}`; runtime: {runtime['name']}; Maestro 2.12.1.\n\n")
            for result in results:
                summary.write(f"- **{result['family']} ({result['type']}): {result['status']}**\n")
            summary.write("\nBoth fresh installation and persisted legacy RTL flags are exercised on each device. Logged-out launch, actual in-app Hebrew/English selection, auth navigation, relaunch persistence, field bounds and back-button side are checked. An existing project test account must then authenticate, load visible feed text, open an unsaved mixed-language composer, open the source picker and discard the draft. The default provider is exercised by using a bare username (no handle autodetection and no manual provider override); its initial indicator is also captured. Composer and source field bounds are measured. Screenshots and sanitized logs are in the artifact; typography still requires screenshot review. Publishing, saved drafts, replies, reactions, messages and physical-device behavior are outside this suite.\n")
    return 0 if all(result["status"] == "passed" for result in results) else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--sanitize-artifacts"]:
        sanitize_artifacts()
    elif sys.argv[1:]:
        raise SystemExit("Usage: torah-repair-native.py [--sanitize-artifacts]")
    else:
        sys.exit(main())
