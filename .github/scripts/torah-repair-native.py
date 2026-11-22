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
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import urlopen


APP_ID = "com.davidpovarsky.torahsocial"
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
COLD_START_ALLOWANCE_SECONDS = 300
SIMULATOR_BOOT_TIMEOUT_SECONDS = 900
JWT = re.compile(r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def register_secret(password):
    SECRETS.update((password, json.dumps(password)[1:-1], quote(password, safe=""), html.escape(password), password.replace("'", "''")))


def redact(value):
    text = value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value)
    for secret in sorted(SECRETS, key=len, reverse=True):
        text = text.replace(secret, "[REDACTED_TEST_PASSWORD]")
    return JWT.sub("[REDACTED_JWT]", text)


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
        scrubbed = redact(text)
        checked += 1
        if scrubbed != text:
            path.write_text(scrubbed, encoding="utf-8")
            rewritten += 1
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sanitization.json").write_text(json.dumps({"text_files_checked": checked, "redacted_files": rewritten, "jwt_filter": True, "password_filter": fixture.exists()}, indent=2))


def run(args, log, timeout=120):
    """Capture every command, retain its output, and propagate nonzero exits."""
    log.parent.mkdir(parents=True, exist_ok=True)
    args = list(map(str, args))
    command = " ".join(args)
    print("Running:", redact(command), flush=True)
    try:
        result = subprocess.run(
            args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            timeout=timeout, check=False, cwd=REPO,
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
    timing = {
        "flow_process_budget_seconds": flow_budget,
        "cold_start_allowance_seconds": allowance,
        "process_timeout_seconds": flow_budget + allowance,
        "first_test_after_boot": cold,
        "status": "failed",
    }
    started = time.monotonic()
    try:
        output = run(args, folder / "maestro.log", flow_budget + allowance)
        timing["status"] = "passed"
        return output
    finally:
        timing["elapsed_seconds"] = round(time.monotonic() - started, 3)
        (folder / "process-timing.json").write_text(json.dumps(timing, indent=2))


def hierarchy(udid, folder):
    result = subprocess.run(
        ["maestro", "--device", udid, "hierarchy", "--no-reinstall-driver"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    stdout, stderr = redact(result.stdout), redact(result.stderr)
    (folder / "hierarchy.json").write_text(stdout, encoding="utf-8")
    (folder / "hierarchy-stderr.log").write_text(stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"Maestro hierarchy failed ({result.returncode}): {stderr[-3000:]}")
    return json.loads(stdout)


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
            # Supply credentials only to the login flow. No shell evaluation and
            # no account/session HTTP request or token persistence in this harness.
            if screen_name == "home" and name.startswith("05-"):
                for key, value in {
                    "FIXTURE_USERNAME": account["handle"].split(".", 1)[0],
                    "FIXTURE_PASSWORD": account["password"],
                }.items():
                    args.extend(["-e", f"{key}={value}"])
            args.append(FLOWS / f"{name}.yml")
            try:
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
    runtimes = [item for item in inventory["runtimes"] if item.get("isAvailable") and ".iOS-" in item["identifier"] and version(item["version"]) >= (26, 4)]
    if not runtimes:
        raise RuntimeError("No available iOS simulator runtime >= 26.4")
    runtime = max(runtimes, key=lambda item: version(item["version"]))
    results = []
    report = {
        "sha": os.environ.get("TORAH_SIMULATOR_SOURCE_SHA", os.environ.get("GITHUB_SHA")),
        "harness_sha": os.environ.get("GITHUB_SHA"),
        "runtime": runtime["name"], "app_id": APP_ID,
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
