#!/usr/bin/env python3
"""Run logged-out native QA against one Release build on two fresh simulators.

No credentials, account creation, posts, storage injection or mocked APIs.
The device starts in Hebrew; subsequent language changes use the app's UI.
Maestro 2.12.1 hierarchy JSON is used for measured input/header bounds.
Screenshots remain necessary for glyph, clipping and typography review.
"""

import json
import os
import plistlib
import re
import subprocess
import sys
import time
from pathlib import Path


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


def run(args, log, timeout=120):
    """Capture every command, retain its output, and propagate nonzero exits."""
    log.parent.mkdir(parents=True, exist_ok=True)
    print("Running:", " ".join(map(str, args)), flush=True)
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run(
            list(map(str, args)), stdout=stream, stderr=subprocess.STDOUT,
            timeout=timeout, check=False, cwd=REPO,
        )
    output = log.read_text(encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(
            f"Command exited {result.returncode}: {' '.join(map(str, args))}\n"
            f"{output[-6000:]}"
        )
    return output


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


def exercise_device(family, device_type, runtime, app, executable):
    folder = OUT / family.lower()
    folder.mkdir(parents=True, exist_ok=True)
    result = {"family": family, "type": device_type["name"], "phases": [], "status": "failed"}
    udid = None
    try:
        udid = run([
            "xcrun", "simctl", "create", f"TorahRepair-{family}-{os.getpid()}",
            device_type["identifier"], runtime["identifier"],
        ], folder / "create.log").strip()
        result["udid"] = udid
        run(["xcrun", "simctl", "boot", udid], folder / "boot.log")
        run(["xcrun", "simctl", "bootstatus", udid, "-b"], folder / "bootstatus.log", 240)
        run(["xcrun", "simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLanguages", "-array", "he", "en"], folder / "set-languages.log")
        run(["xcrun", "simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLocale", "-string", "he_IL"], folder / "set-locale.log")
        # Restart SpringBoard with the language configured before the first app launch.
        run(["xcrun", "simctl", "shutdown", udid], folder / "locale-shutdown.log")
        run(["xcrun", "simctl", "boot", udid], folder / "locale-boot.log")
        run(["xcrun", "simctl", "bootstatus", udid, "-b"], folder / "locale-bootstatus.log", 240)
        run(["xcrun", "simctl", "spawn", udid, "defaults", "read", "NSGlobalDomain", "AppleLanguages"], folder / "device-languages.log")
        run(["xcrun", "simctl", "install", udid, app], folder / "install.log")
        for name, language in PHASES:
            phase = {"name": name, "language": language, "status": "failed"}
            result["phases"].append(phase)
            phase_dir = folder / name
            run([
                "maestro", "--device", udid, "test", "--format", "junit",
                "--output", phase_dir / "junit.xml",
                "--debug-output", phase_dir / "debug",
                "--test-output-dir", phase_dir / "artifacts",
                "-e", f"APP_ID={APP_ID}", FLOWS / f"{name}.yml",
            ], phase_dir / "maestro.log", 300)
            # hierarchy writes JSON to stdout; keep stderr separate for valid parsing.
            with (phase_dir / "hierarchy.json").open("w") as stdout, (phase_dir / "hierarchy-stderr.log").open("w") as stderr:
                subprocess.run(
                    ["maestro", "--device", udid, "hierarchy", "--no-reinstall-driver"],
                    stdout=stdout, stderr=stderr, timeout=120, check=True,
                )
            tree = json.loads((phase_dir / "hierarchy.json").read_text())
            layout = assert_login_layout(tree, language)
            (phase_dir / "layout-bounds.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2))
            run(["xcrun", "simctl", "io", udid, "screenshot", phase_dir / "verified-login.png"], phase_dir / "screenshot.log")
            phase["status"] = "passed"
        result["status"] = "passed"
    except (AssertionError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        result["error"] = str(error)
        print(f"::error::{family} native QA failed: {error}", flush=True)
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
                    result.setdefault("diagnostic_errors", []).append(str(error))
                    result["status"] = "failed"
        (folder / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
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
    report = {"sha": os.environ.get("GITHUB_SHA"), "runtime": runtime["name"], "app_id": APP_ID, "started": time.time(), "devices": results}
    for family in ("iPhone", "iPad"):
        results.append(exercise_device(family, select_device_type(inventory, runtime, family), runtime, app, info["CFBundleExecutable"]))
        (OUT / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write("## Native repair QA\n\n")
            summary.write(f"Source: `{report['sha']}`; runtime: {runtime['name']}; Maestro 2.12.1.\n\n")
            for result in results:
                summary.write(f"- **{result['family']} ({result['type']}): {result['status']}**\n")
            summary.write("\nLogged-out launch, actual in-app Hebrew/English selection, auth navigation, relaunch persistence, field bounds and back-button side are checked. Screenshots and logs are in the artifact. Typography still requires screenshot review. Authenticated feeds, posting and physical-device behavior are outside this suite.\n")
    return 0 if all(result["status"] == "passed" for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
