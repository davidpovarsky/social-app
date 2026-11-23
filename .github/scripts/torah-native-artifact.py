#!/usr/bin/env python3
"""Archive a simulator build before UI tests, or verify an explicit harness retry."""

import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import shutil
import stat
import struct
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


APP_ID = "com.davidpovarsky.torahsocial"
WORKFLOW = ".github/workflows/torah-social-repair-native.yml"
ARCHIVE = "torah-social-simulator.tar.gz"
MANIFEST = "provenance.json"
TRUSTED_REPOSITORY = "davidpovarsky/social-app"
TRUSTED_BRANCHES = {
    "codex/torah-social-repair-20261122",
    "codex/torah-social-web-repair-20261122",
    "codex/torah-social-upstream-sync-20261110",
    "codex/torah-social-runtime-repair",
}
HARNESS_FILES = {
    ".github/scripts/torah-repair-native.py",
    ".github/scripts/torah-native-artifact.py",
    ".github/scripts/test-torah-native-artifact.py",
}
PUBLIC_ENV = (
    "EXPO_PUBLIC_TORAH_WEB_HOST", "EXPO_PUBLIC_TORAH_APPVIEW_HOST",
    "EXPO_PUBLIC_BLUESKY_PROXY_DID", "EXPO_PUBLIC_CHAT_PROXY_DID",
    "EXPO_PUBLIC_TORAH_PDS_DID", "EXPO_PUBLIC_TORAH_PDS_HOST",
    "EXPO_PUBLIC_TORAH_ISOLATED_NETWORK", "EXPO_PUBLIC_ENV",
)
MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
MAX_APP_BYTES = 2 * MAX_ARCHIVE_BYTES


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def command(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                          check=True, timeout=120).stdout.strip()


def harness_path(path):
    # The workflow also defines compilation and prebuild inputs. Even a
    # workflow-only change requires rebuilding; driver/flow retries do not.
    return path in HARNESS_FILES or path.startswith("__e2e__/flows/torah-repair/")


def public_environment(environment):
    require(all(key in environment for key in PUBLIC_ENV), "Missing mandatory runtime configuration")
    return {key: environment[key] for key in sorted(environment)
            if key.startswith("EXPO_PUBLIC_") and key != "EXPO_PUBLIC_BUNDLE_IDENTIFIER"}


def runtime_fingerprint(repo, sha):
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Expected a full source commit SHA")
    records = subprocess.run(
        ["git", "ls-tree", "-rz", "--full-tree", sha], cwd=repo,
        capture_output=True, check=True, timeout=60,
    ).stdout.split(b"\0")
    runtime = []
    for record in records:
        if record:
            _, path = record.split(b"\t", 1)
            if not harness_path(path.decode("utf-8")):
                runtime.append(record)
    return hashlib.sha256(b"\0".join(sorted(runtime))).hexdigest()


def toolchain():
    require(platform.system() == "Darwin", "Simulator builds require macOS")
    require(platform.machine() == "arm64", "This workflow uses ARM64 simulators")
    return {
        "system": platform.system(), "architecture": platform.machine(),
        "xcode": command("xcodebuild", "-version"),
        "sdk": command("xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"),
    }


def simulator_macho(path):
    """Reject device binaries, other CPU types and malformed load commands."""
    with path.open("rb") as stream:
        header = stream.read(32)
        require(len(header) == 32, "Truncated Mach-O header")
        magic, cpu, _, _, count, size, _, _ = struct.unpack("<8I", header)
        require(magic == 0xFEEDFACF and cpu == 0x0100000C,
                "Expected a thin arm64 simulator executable")
        require(size <= 16 * 1024 * 1024 and count <= 65536, "Invalid Mach-O commands")
        commands = stream.read(size)
    require(len(commands) == size, "Truncated Mach-O commands")
    offset, platforms = 0, []
    for _ in range(count):
        require(offset + 8 <= len(commands), "Invalid Mach-O command bounds")
        kind, length = struct.unpack_from("<2I", commands, offset)
        require(length >= 8 and offset + length <= len(commands), "Invalid Mach-O command size")
        if kind == 0x32:
            require(length >= 24, "Invalid LC_BUILD_VERSION")
            platforms.append(struct.unpack_from("<I", commands, offset + 8)[0])
        offset += length
    require(offset == size and platforms == [7], "Mach-O must target iOS Simulator")


def app_identity(app):
    require(app.is_dir() and app.name.endswith(".app"), "Missing simulator .app")
    require(not app.is_symlink(), "The app root must not be a symlink")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    require(info.get("CFBundleIdentifier") == APP_ID, "Unexpected bundle ID")
    require(set(info.get("UIDeviceFamily", [])) == {1, 2}, "Build must support iPhone and iPad")
    require(info.get("CFBundleSupportedPlatforms") == ["iPhoneSimulator"], "Not a simulator bundle")
    require(info.get("DTPlatformName") == "iphonesimulator", "Wrong build platform")
    executable = info.get("CFBundleExecutable", "")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+", executable), "Unsafe executable name")
    for key in ("CFBundleVersion", "CFBundleShortVersionString"):
        require(isinstance(info.get(key), str) and re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", info[key]),
                "Missing or invalid app version")
    binary, bundle = app / executable, app / "main.jsbundle"
    require(binary.is_file() and not binary.is_symlink(), "Missing app executable")
    require(bundle.is_file() and not bundle.is_symlink() and bundle.stat().st_size > 0,
            "Missing embedded Release JavaScript")
    require(binary.stat().st_mode & 0o111, "App executable lost its executable mode")
    simulator_macho(binary)
    return {
        "root": app.name, "bundle_id": APP_ID, "device_families": [1, 2],
        "architecture": "arm64", "platform": "iphonesimulator",
        "version": info["CFBundleShortVersionString"], "build": info["CFBundleVersion"],
        "executable": executable, "executable_sha256": digest(binary),
        "jsbundle_sha256": digest(bundle),
    }


def emit(name, value, environment=False):
    require("\n" not in str(value) and "\r" not in str(value), "Invalid output value")
    target = os.environ.get("GITHUB_ENV" if environment else "GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as stream:
            stream.write(f"{name}={value}\n")


def pack(repo, app, destination):
    require(os.environ.get("GITHUB_REPOSITORY") == TRUSTED_REPOSITORY, "Wrong repository")
    sha = command("git", "rev-parse", "HEAD", cwd=repo)
    require(sha == os.environ.get("GITHUB_SHA"), "Checkout SHA differs from run SHA")
    identity = app_identity(app)
    destination.mkdir(parents=True, exist_ok=False)
    archive = destination / ARCHIVE
    with tarfile.open(archive, "w:gz", dereference=False) as tar:
        tar.add(app, arcname=app.name)
    validate_tar(archive, identity["root"])
    manifest = {
        "schema": 1, "repository": TRUSTED_REPOSITORY, "workflow": WORKFLOW,
        "source_sha": sha, "source_tree": command("git", "rev-parse", "HEAD^{tree}", cwd=repo),
        "runtime_fingerprint": runtime_fingerprint(repo, sha),
        "run_id": int(os.environ["GITHUB_RUN_ID"]), "run_attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        "toolchain": toolchain(), "app": identity,
        "public_environment": public_environment(os.environ),
        "bundle_source_identifier": os.environ["EXPO_PUBLIC_BUNDLE_IDENTIFIER"],
        "lockfile_sha256": digest(repo / "pnpm-lock.yaml"),
        "archive": {"name": ARCHIVE, "sha256": digest(archive), "bytes": archive.stat().st_size},
    }
    require(manifest["bundle_source_identifier"] == sha, "Bundle identifier must identify its source")
    (destination / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    expose(app, manifest)
    print(json.dumps({"archived_source": sha, "archive_sha256": manifest["archive"]["sha256"],
                      "archive_bytes": manifest["archive"]["bytes"]}))


def validate_tar(archive, root):
    require(re.fullmatch(r"[A-Za-z0-9_.-]+\.app", root), "Invalid app archive root")
    with tarfile.open(archive, "r:gz") as tar:
        seen, total = set(), 0
        for member in tar:
            name = PurePosixPath(member.name)
            require(not name.is_absolute() and ".." not in name.parts and "\\" not in member.name,
                    "Unsafe tar member path")
            require(name.parts and name.parts[0] == root and member.name not in seen,
                    "Unexpected root or duplicate tar member")
            seen.add(member.name)
            require(member.isdir() or member.isfile() or member.issym() or member.islnk(),
                    "Unsupported special tar member")
            require(not member.mode & 0o7000, "Privileged tar mode is not allowed")
            total += member.size
            require(total <= MAX_APP_BYTES, "App archive is too large")
            if member.issym() or member.islnk():
                link = PurePosixPath(member.linkname)
                require(not link.is_absolute() and "\\" not in member.linkname, "Unsafe archive link")
                target = name.parent / link if member.issym() else link
                parts = []
                for part in target.parts:
                    if part == "..":
                        require(len(parts) > 1, "Archive link escapes app")
                        parts.pop()
                    elif part != ".":
                        parts.append(part)
                require(parts and parts[0] == root, "Archive link escapes app")


def validate_run(run, artifact, jobs, workflow_id, run_id, artifact_id):
    require(run.get("id") == run_id and run.get("workflow_id") == workflow_id, "Wrong build workflow/run")
    require(run.get("repository", {}).get("full_name") == TRUSTED_REPOSITORY and
            run.get("head_repository", {}).get("full_name") == TRUSTED_REPOSITORY, "Untrusted build repository")
    require(run.get("event") in ("push", "workflow_dispatch") and run.get("head_branch") in TRUSTED_BRANCHES,
            "Untrusted build event or branch")
    require(run.get("status") == "completed" and run.get("conclusion") in ("success", "failure"),
            "Build run must have completed; UI failure is allowed")
    require(artifact.get("id") == artifact_id and artifact.get("workflow_run", {}).get("id") == run_id,
            "Artifact belongs to another run")
    require(not artifact.get("expired") and artifact.get("name") ==
            f"torah-social-native-build-{run['head_sha']}-{run['run_attempt']}",
            "Unexpected or expired build artifact")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest") or ""), "Artifact digest is missing")
    require(any(job.get("name") == "Hebrew and English on iPhone and iPad" and
                all(any(step.get("name") == name and step.get("conclusion") == "success"
                        for step in (job.get("steps") or [])) for name in
                    ("Build Release simulator app once", "Upload compiled Release simulator app"))
                for job in jobs), "No successful compile and early archive upload in build run")


def validate_manifest(manifest, run, repo, current_toolchain, environment):
    require(manifest.get("schema") == 1 and manifest.get("repository") == TRUSTED_REPOSITORY and
            manifest.get("workflow") == WORKFLOW, "Unsupported build provenance")
    source = manifest.get("source_sha", "")
    require(source == run["head_sha"] and manifest.get("run_id") == run["id"] and
            manifest.get("run_attempt") == run["run_attempt"], "Source/run provenance mismatch")
    require(manifest.get("bundle_source_identifier") == source, "Wrong embedded source identifier")
    require(manifest.get("toolchain") == current_toolchain, "Xcode, SDK or architecture changed; rebuild required")
    require(manifest.get("public_environment") == public_environment(environment),
            "Runtime configuration changed; rebuild required")
    require(manifest.get("lockfile_sha256") == digest(repo / "pnpm-lock.yaml"),
            "Dependency lock changed; rebuild required")
    head = command("git", "rev-parse", "HEAD", cwd=repo)
    require(manifest.get("source_tree") == command("git", "rev-parse", source + "^{tree}", cwd=repo),
            "Source tree does not match provenance")
    require(manifest.get("runtime_fingerprint") == runtime_fingerprint(repo, source) == runtime_fingerprint(repo, head),
            "Runtime source or dependency/config inputs changed; rebuild required")
    dirty = command("git", "diff", "--name-only", "HEAD", cwd=repo).splitlines()
    require(all(harness_path(path) for path in dirty), "Runtime checkout contains uncommitted changes")
    return head


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def api_json(path):
    require(path.startswith("/repos/" + TRUSTED_REPOSITORY + "/"), "Invalid API path")
    request = Request("https://api.github.com" + path, headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "torah-native-artifact",
    })
    with build_opener(NoRedirect).open(request, timeout=30) as response:
        return json.load(response)


def download_zip(artifact_id, destination):
    request = Request(f"https://api.github.com/repos/{TRUSTED_REPOSITORY}/actions/artifacts/{artifact_id}/zip",
                      headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "User-Agent": "torah-native-artifact"})
    try:
        build_opener(NoRedirect).open(request, timeout=30)
    except HTTPError as error:
        require(error.code in (301, 302, 303, 307, 308), "Artifact download did not redirect")
        location = error.headers.get("Location", "")
    else:
        raise ValueError("Expected an expiring artifact redirect")
    url = urlparse(location)
    require(url.scheme == "https" and url.hostname and not url.username and not url.password,
            "Unsafe artifact redirect")
    # Never forward the GitHub bearer token to the signed storage URL.
    with urlopen(Request(location, headers={"User-Agent": "torah-native-artifact"}), timeout=60) as response:
        with destination.open("wb") as stream:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                require(total <= MAX_ARCHIVE_BYTES, "Artifact ZIP is too large")
                stream.write(chunk)


def read_archive(zip_path, destination):
    with zipfile.ZipFile(zip_path) as archive:
        require(archive.namelist() == list(dict.fromkeys(archive.namelist())) and
                set(archive.namelist()) == {ARCHIVE, MANIFEST}, "Unexpected artifact ZIP entries")
        for entry in archive.infolist():
            require(not stat.S_ISLNK(entry.external_attr >> 16) and entry.file_size <= MAX_ARCHIVE_BYTES,
                    "Unsafe artifact ZIP entry")
        require(archive.getinfo(MANIFEST).file_size < 65536, "Provenance file is too large")
        manifest = json.loads(archive.read(MANIFEST))
        for name in (ARCHIVE, MANIFEST):
            with archive.open(name) as source, (destination / name).open("wb") as target:
                shutil.copyfileobj(source, target)
    expected = manifest.get("archive", {})
    actual = destination / ARCHIVE
    require(expected.get("name") == ARCHIVE and expected.get("bytes") == actual.stat().st_size and
            expected.get("sha256") == digest(actual), "Compiled app archive checksum mismatch")
    return manifest


def expose(app, manifest):
    qa = Path(os.environ["QA_ARTIFACTS"])
    qa.mkdir(parents=True, exist_ok=True)
    (qa / "build-provenance.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    emit("TORAH_SIMULATOR_APP", app, environment=True)
    emit("TORAH_SIMULATOR_SOURCE_SHA", manifest["source_sha"], environment=True)


def reuse(repo, destination):
    run_id, artifact_id = os.environ.get("SIMULATOR_BUILD_RUN_ID", ""), os.environ.get("SIMULATOR_BUILD_ARTIFACT_ID", "")
    if not run_id and not artifact_id:
        emit("reused", "false")
        return
    require(re.fullmatch(r"[1-9][0-9]*", run_id) and re.fullmatch(r"[1-9][0-9]*", artifact_id),
            "Both explicit numeric build run and artifact IDs are required")
    require(os.environ.get("GITHUB_REPOSITORY") == TRUSTED_REPOSITORY and
            os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "Reuse requires explicit workflow_dispatch")
    run_id, artifact_id = int(run_id), int(artifact_id)
    base = "/repos/" + TRUSTED_REPOSITORY
    run = api_json(f"{base}/actions/runs/{run_id}")
    artifact = api_json(f"{base}/actions/artifacts/{artifact_id}")
    workflow = api_json(f"{base}/actions/workflows/{Path(WORKFLOW).name}")
    jobs = api_json(f"{base}/actions/runs/{run_id}/jobs?filter=latest&per_page=100")["jobs"]
    validate_run(run, artifact, jobs, workflow["id"], run_id, artifact_id)
    sha = run["head_sha"]
    require(re.fullmatch(r"[0-9a-f]{40}", sha), "Invalid build source SHA")
    present = subprocess.run(["git", "cat-file", "-e", sha + "^{commit}"], cwd=repo, capture_output=True).returncode == 0
    if not present:
        command("git", "fetch", "--no-tags", "--depth=1", "origin", sha, cwd=repo)
    destination.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="torah-build-download-") as temporary:
        temporary = Path(temporary)
        download = temporary / "artifact.zip"
        download_zip(artifact_id, download)
        require("sha256:" + digest(download) == artifact["digest"], "GitHub artifact ZIP digest mismatch")
        manifest = read_archive(download, temporary)
        harness_sha = validate_manifest(manifest, run, repo, toolchain(), os.environ)
        validate_tar(temporary / ARCHIVE, manifest["app"]["root"])
        require(hasattr(tarfile, "data_filter"), "Python data-safe tar extraction is required")
        with tarfile.open(temporary / ARCHIVE, "r:gz") as tar:
            tar.extractall(destination, filter="data")
    app = destination / manifest["app"]["root"]
    require(app_identity(app) == manifest["app"], "Restored app identity or contents differ")
    expose(app, manifest)
    emit("reused", "true")
    print(json.dumps({"compiled_source": sha, "harness_source": harness_sha,
                      "build_run_id": run_id, "artifact_id": artifact_id, "runtime_inputs_match": True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("pack", "reuse"))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    temporary = Path(os.environ["RUNNER_TEMP"])
    if args.mode == "pack":
        pack(repo, Path(os.environ["TORAH_SIMULATOR_APP"]), temporary / "torah-native-build")
    else:
        reuse(repo, temporary / "torah-reused-simulator")


if __name__ == "__main__":
    main()
