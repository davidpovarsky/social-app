#!/usr/bin/env python3
"""Exercise build provenance, runtime differences and hostile archive refusal."""

import copy
import importlib.util
import io
import json
import os
import plistlib
import shutil
import struct
import subprocess
import tarfile
import tempfile
import unittest
import warnings
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError


SPEC = importlib.util.spec_from_file_location("native_artifact", Path(__file__).with_name("torah-native-artifact.py"))
artifact = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(artifact)
TOOLCHAIN = {"system": "Darwin", "architecture": "arm64", "xcode": "Xcode 26.6\nBuild version fixture", "sdk": "26.6"}


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="torah-artifact-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "QA Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.write("src/app.ts", "export const app = 'runtime'\n")
        self.write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        self.write("app.config.js", "module.exports = {}\n")
        self.write(".github/scripts/torah-repair-native.py", "# original harness\n")
        self.write(artifact.WORKFLOW, "name: fixture\njobs:\n  simulator:\n    runs-on: macos-26\n"
                   "    steps:\n      - run: xcodebuild ARCHS=arm64\n")
        self.commit()
        self.sha = self.git("rev-parse", "HEAD")
        self.app = self.root / "TorahSocial.app"
        self.app.mkdir()
        self.info = {
            "CFBundleIdentifier": artifact.APP_ID, "CFBundleExecutable": "TorahSocial",
            "CFBundleVersion": "1", "CFBundleShortVersionString": "1.139.0",
            "UIDeviceFamily": [1, 2], "CFBundleSupportedPlatforms": ["iPhoneSimulator"],
            "DTPlatformName": "iphonesimulator",
        }
        self.save_info()
        binary = struct.pack("<8I", 0xFEEDFACF, 0x0100000C, 0, 2, 1, 24, 0, 0)
        binary += struct.pack("<6I", 0x32, 24, 7, 0x100400, 0x1A0600, 0)
        (self.app / "TorahSocial").write_bytes(binary)
        (self.app / "TorahSocial").chmod(0o755)
        (self.app / "main.jsbundle").write_bytes(b"embedded Release fixture")
        self.env = {key: "fixture-" + key for key in artifact.PUBLIC_ENV}
        self.env.update({
            "GITHUB_REPOSITORY": artifact.TRUSTED_REPOSITORY, "GITHUB_SHA": self.sha,
            "GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_EVENT_NAME": "workflow_dispatch",
            "EXPO_PUBLIC_BUNDLE_IDENTIFIER": self.sha, "QA_ARTIFACTS": str(self.root / "qa"),
            "GITHUB_ENV": str(self.root / "github-env"), "GITHUB_OUTPUT": str(self.root / "github-output"),
            "SIMULATOR_BUILD_RUN_ID": "42", "SIMULATOR_BUILD_ARTIFACT_ID": "7", "GH_TOKEN": "fixture-token",
        })
        with patch.dict(os.environ, self.env), patch.object(artifact, "toolchain", return_value=TOOLCHAIN), \
             redirect_stdout(io.StringIO()):
            artifact.pack(self.repo, self.app, self.root / "build")
        self.manifest = json.loads((self.root / "build" / artifact.MANIFEST).read_text())
        self.zip = self.root / "artifact.zip"
        with zipfile.ZipFile(self.zip, "w") as archive:
            for name in (artifact.ARCHIVE, artifact.MANIFEST):
                archive.write(self.root / "build" / name, name)
        self.run = {
            "id": 42, "workflow_id": 9, "head_sha": self.sha, "run_attempt": 1,
            "repository": {"full_name": artifact.TRUSTED_REPOSITORY},
            "head_repository": {"full_name": artifact.TRUSTED_REPOSITORY},
            "event": "push", "head_branch": "codex/torah-social-repair-20261122",
            "status": "completed", "conclusion": "failure",
        }
        self.metadata = {
            "id": 7, "workflow_run": {"id": 42}, "expired": False,
            "name": f"torah-social-native-build-{self.sha}-1", "digest": "sha256:" + artifact.digest(self.zip),
        }
        self.jobs = [{"name": "Hebrew and English on iPhone and iPad", "steps": [
            {"name": "Build Release simulator app once", "conclusion": "success"},
            {"name": "Upload compiled Release simulator app", "conclusion": "success"},
            {"name": "Run language, real login, feed and unsaved composer flows on both devices", "conclusion": "failure"},
        ]}]

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, capture_output=True,
                              text=True, check=True, timeout=20).stdout.strip()

    def write(self, name, text):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Fixture")

    def save_info(self):
        (self.app / "Info.plist").write_bytes(plistlib.dumps(self.info))

    def validate_manifest(self, manifest=None, environment=None, toolchain=None):
        return artifact.validate_manifest(manifest or self.manifest, self.run, self.repo,
                                          toolchain or TOOLCHAIN, environment or self.env)

    def mock_api(self, path):
        if "/jobs?" in path:
            return {"jobs": self.jobs}
        if "/runs/" in path:
            return self.run
        if "/artifacts/" in path:
            return self.metadata
        if "/workflows/" in path:
            return {"id": 9}
        raise AssertionError(path)

    def reuse(self):
        with patch.dict(os.environ, self.env), patch.object(artifact, "api_json", side_effect=self.mock_api), \
             patch.object(artifact, "toolchain", return_value=TOOLCHAIN), \
             patch.object(artifact, "download_zip", side_effect=lambda _, target: shutil.copyfile(self.zip, target)):
            artifact.reuse(self.repo, self.root / "restored")

    def test_failed_ui_run_can_reuse_its_successful_compiled_build(self):
        self.reuse()
        restored = self.root / "restored" / self.app.name
        self.assertEqual(artifact.app_identity(restored), self.manifest["app"])
        self.assertTrue((restored / "TorahSocial").stat().st_mode & 0o111)
        self.assertIn("reused=true", (self.root / "github-output").read_text())
        self.assertEqual(json.loads((self.root / "qa/build-provenance.json").read_text())["source_sha"], self.sha)

    def test_harness_only_commit_preserves_compiled_runtime_identity(self):
        self.write(".github/scripts/torah-repair-native.py", "# changed harness\n")
        self.write("__e2e__/flows/torah-repair/flow.yml", "# extra QA assertion\n")
        self.commit()
        self.assertNotEqual(self.git("rev-parse", "HEAD"), self.sha)
        self.assertEqual(self.validate_manifest(), self.git("rev-parse", "HEAD"))

    def test_runtime_source_change_requires_rebuild(self):
        self.write("src/app.ts", "export const app = 'changed'\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "Runtime source"):
            self.validate_manifest()

    def test_app_build_config_change_requires_rebuild(self):
        self.write("app.config.js", "module.exports = {changed: true}\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "Runtime source"):
            self.validate_manifest()

    def test_native_workflow_build_changes_require_rebuild(self):
        self.write(artifact.WORKFLOW, "name: fixture\n# changed prebuild command or compiler flag\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "Runtime source"):
            self.validate_manifest()

    def test_dependency_lock_change_requires_rebuild(self):
        self.write("pnpm-lock.yaml", "changed-lock\n")
        with self.assertRaisesRegex(ValueError, "Dependency lock"):
            self.validate_manifest()

    def test_uncommitted_runtime_change_is_refused(self):
        self.write("src/app.ts", "uncommitted runtime\n")
        with self.assertRaisesRegex(ValueError, "uncommitted"):
            self.validate_manifest()

    def test_endpoint_configuration_change_requires_rebuild(self):
        env = {**self.env, "EXPO_PUBLIC_TORAH_PDS_HOST": "https://different.invalid"}
        with self.assertRaisesRegex(ValueError, "Runtime configuration"):
            self.validate_manifest(environment=env)

    def test_new_public_runtime_variable_requires_rebuild(self):
        env = {**self.env, "EXPO_PUBLIC_NEW_FEATURE": "changed"}
        with self.assertRaisesRegex(ValueError, "Runtime configuration"):
            self.validate_manifest(environment=env)

    def test_sdk_or_architecture_change_requires_rebuild(self):
        for key, value in (("sdk", "27.0"), ("architecture", "x86_64"), ("xcode", "different")):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "Xcode, SDK or architecture"):
                self.validate_manifest(toolchain={**TOOLCHAIN, key: value})

    def test_arm64_toolchain_host_is_required(self):
        with patch.object(artifact.platform, "system", return_value="Darwin"), \
             patch.object(artifact.platform, "machine", return_value="arm64"), \
             patch.object(artifact, "command", side_effect=[TOOLCHAIN["xcode"], TOOLCHAIN["sdk"]]):
            self.assertEqual(artifact.toolchain(), TOOLCHAIN)
        for system, architecture in (("Darwin", "x86_64"), ("Darwin", "unknown"), ("Linux", "arm64")):
            with self.subTest(system=system, architecture=architecture), \
                 patch.object(artifact.platform, "system", return_value=system), \
                 patch.object(artifact.platform, "machine", return_value=architecture), \
                 patch.object(artifact, "command") as run_command:
                with self.assertRaises(ValueError):
                    artifact.toolchain()
                run_command.assert_not_called()

    def test_old_intel_manifest_cannot_be_reused_on_arm64(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["toolchain"]["architecture"] = "x86_64"
        manifest["app"]["architecture"] = "x86_64"
        with self.assertRaisesRegex(ValueError, "Xcode, SDK or architecture"):
            self.validate_manifest(manifest=manifest)

    def test_native_workflow_architecture_changes_require_rebuild(self):
        original = (self.repo / artifact.WORKFLOW).read_text()
        for old, new in (("runs-on: macos-26", "runs-on: macos-26-intel"),
                         ("ARCHS=arm64", "ARCHS=x86_64")):
            with self.subTest(changed_input=old):
                self.write(artifact.WORKFLOW, original.replace(old, new))
                self.commit()
                with self.assertRaisesRegex(ValueError, "Runtime source"):
                    self.validate_manifest()

    def test_source_and_run_provenance_must_match(self):
        for key, value in (("source_sha", "a" * 40), ("run_id", 99), ("run_attempt", 2), ("source_tree", "b" * 40),
                           ("bundle_source_identifier", "c" * 40), ("runtime_fingerprint", "d" * 64)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate_manifest(manifest={**self.manifest, key: value})

    def test_untrusted_repo_event_branch_or_workflow_is_refused(self):
        changes = [
            {"workflow_id": 10}, {"event": "pull_request"}, {"head_branch": "unreviewed-branch"},
            {"head_repository": {"full_name": "someone/fork"}},
            {"repository": {"full_name": "someone/fork"}}, {"status": "in_progress"}, {"conclusion": "cancelled"},
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(ValueError):
                artifact.validate_run({**self.run, **change}, self.metadata, self.jobs, 9, 42, 7)

    def test_wrong_or_expired_artifact_is_refused(self):
        for change in ({"id": 8}, {"workflow_run": {"id": 99}}, {"expired": True},
                       {"name": "different-build"}, {"digest": None}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                artifact.validate_run(self.run, {**self.metadata, **change}, self.jobs, 9, 42, 7)

    def test_compile_or_early_upload_failure_cannot_be_reused(self):
        for index in (0, 1):
            jobs = copy.deepcopy(self.jobs)
            jobs[0]["steps"][index]["conclusion"] = "failure"
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "successful compile"):
                artifact.validate_run(self.run, self.metadata, jobs, 9, 42, 7)

    def test_changed_outer_zip_digest_is_refused_before_extraction(self):
        self.metadata["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "ZIP digest"):
            self.reuse()
        self.assertFalse((self.root / "restored" / self.app.name).exists())

    def test_changed_inner_archive_digest_is_refused(self):
        self.manifest["archive"]["sha256"] = "0" * 64
        with zipfile.ZipFile(self.zip, "w") as archive:
            archive.write(self.root / "build" / artifact.ARCHIVE, artifact.ARCHIVE)
            archive.writestr(artifact.MANIFEST, json.dumps(self.manifest))
        self.metadata["digest"] = "sha256:" + artifact.digest(self.zip)
        with self.assertRaisesRegex(ValueError, "archive checksum"):
            self.reuse()

    def test_duplicate_or_extra_zip_entries_are_refused(self):
        for name in (artifact.MANIFEST, "../escape", "unexpected.txt"):
            target = self.root / "invalid.zip"
            shutil.copyfile(self.zip, target)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with zipfile.ZipFile(target, "a") as archive:
                    archive.writestr(name, "extra")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "ZIP entries"):
                artifact.read_archive(target, self.root)

    def test_tar_traversal_links_and_special_files_are_refused(self):
        bad = [
            ("/absolute", tarfile.REGTYPE, ""),
            ("TorahSocial.app/../../escape", tarfile.REGTYPE, ""),
            ("TorahSocial.app/link", tarfile.SYMTYPE, "../../escape"),
            ("TorahSocial.app/link", tarfile.LNKTYPE, "../escape"),
            ("TorahSocial.app/socket", tarfile.CHRTYPE, ""),
        ]
        for name, kind, link in bad:
            target = self.root / "bad.tar.gz"
            with tarfile.open(target, "w:gz") as archive:
                item = tarfile.TarInfo(name)
                item.type, item.linkname = kind, link
                archive.addfile(item)
            with self.subTest(name=name, kind=kind), self.assertRaises(ValueError):
                artifact.validate_tar(target, "TorahSocial.app")

    def test_internal_framework_symlink_is_allowed(self):
        target = self.root / "links.tar.gz"
        with tarfile.open(target, "w:gz") as archive:
            item = tarfile.TarInfo("TorahSocial.app/Frameworks/Test.framework/Versions/Current")
            item.type, item.linkname = tarfile.SYMTYPE, "A"
            archive.addfile(item)
        artifact.validate_tar(target, "TorahSocial.app")

    def test_device_binary_or_wrong_cpu_is_refused(self):
        original = (self.app / "TorahSocial").read_bytes()
        cases = (("old Intel simulator", 4, 0x01000007, "thin arm64"),
                 ("ARM64 device", 40, 2, "iOS Simulator"),
                 ("unknown CPU", 4, 0xDEADBEEF, "thin arm64"))
        for name, offset, value, message in cases:
            data = bytearray(original)
            struct.pack_into("<I", data, offset, value)
            (self.app / "TorahSocial").write_bytes(data)
            with self.subTest(case=name), self.assertRaisesRegex(ValueError, message):
                artifact.app_identity(self.app)
        (self.app / "TorahSocial").write_bytes(original)

    def test_wrong_bundle_family_or_version_is_refused(self):
        original = dict(self.info)
        for key, value in (("CFBundleIdentifier", "other.app"), ("UIDeviceFamily", [1]),
                           ("CFBundleVersion", "undefined"), ("DTPlatformName", "iphoneos")):
            self.info = {**original, key: value}
            self.save_info()
            with self.subTest(key=key), self.assertRaises(ValueError):
                artifact.app_identity(self.app)

    def test_missing_release_bundle_is_refused(self):
        (self.app / "main.jsbundle").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "embedded Release"):
            artifact.app_identity(self.app)

    def test_only_one_reuse_input_is_refused_without_network(self):
        with patch.dict(os.environ, {**self.env, "SIMULATOR_BUILD_ARTIFACT_ID": ""}), \
             patch.object(artifact, "api_json") as api:
            with self.assertRaisesRegex(ValueError, "Both explicit"):
                artifact.reuse(self.repo, self.root / "unused")
            api.assert_not_called()

    def test_no_inputs_keeps_default_fresh_build_without_network(self):
        with patch.dict(os.environ, {**self.env, "SIMULATOR_BUILD_RUN_ID": "", "SIMULATOR_BUILD_ARTIFACT_ID": ""}), \
             patch.object(artifact, "api_json") as api:
            artifact.reuse(self.repo, self.root / "unused")
            api.assert_not_called()
        self.assertIn("reused=false", (self.root / "github-output").read_text())

    def test_storage_redirect_does_not_receive_github_token(self):
        error = HTTPError("https://api.github.com/example", 302, "Found",
                          {"Location": "https://storage.example.invalid/signed"}, None)
        with patch.dict(os.environ, self.env), patch.object(artifact, "build_opener") as opener, \
             patch.object(artifact, "urlopen", return_value=io.BytesIO(b"artifact")) as storage:
            opener.return_value.open.side_effect = error
            artifact.download_zip(7, self.root / "download.zip")
            request = storage.call_args.args[0]
            self.assertFalse(request.has_header("Authorization"))
            self.assertNotIn("fixture-token", str(request.headers))


class ColdBootBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="torah-driver-budget-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        spec = importlib.util.spec_from_file_location("native_driver", Path(__file__).with_name("torah-repair-native.py"))
        self.driver = importlib.util.module_from_spec(spec)
        with patch.dict(os.environ, {"QA_ARTIFACTS": str(self.root)}):
            spec.loader.exec_module(self.driver)

    def test_only_first_test_after_each_actual_boot_receives_startup_allowance(self):
        budgets = []

        def process(args, **kwargs):
            if args[0] == "maestro":
                budgets.append(kwargs["timeout"])
            return subprocess.CompletedProcess(args, 0, "")

        with patch.object(self.driver.subprocess, "run", side_effect=process), redirect_stdout(io.StringIO()):
            self.driver.run(["xcrun", "simctl", "boot", "device"], self.root / "boot.log")
            self.driver.run_maestro(["maestro", "test"], "device", self.root / "fresh-first", 300)
            self.driver.run(["xcrun", "simctl", "bootstatus", "device", "-b"], self.root / "status.log")
            self.driver.run_maestro(["maestro", "test"], "device", self.root / "fresh-next", 300)
            self.driver.run(["xcrun", "simctl", "boot", "device"], self.root / "legacy-boot.log")
            self.driver.run_maestro(["maestro", "test"], "device", self.root / "legacy-first", 300)
            self.driver.run_maestro(["maestro", "test"], "device", self.root / "auth-warm", 360)
            self.driver.run(["xcrun", "simctl", "boot", "device"], self.root / "auth-boot.log")
            self.driver.run_maestro(["maestro", "test"], "device", self.root / "auth-cold", 360)
        self.assertEqual(budgets, [600, 300, 600, 360, 660])
        timing = json.loads((self.root / "auth-cold/process-timing.json").read_text())
        self.assertEqual(timing["flow_process_budget_seconds"], 360)
        self.assertEqual(timing["cold_start_allowance_seconds"], 300)
        self.assertTrue(timing["first_test_after_boot"])

    def test_failed_boot_does_not_create_a_cold_start_allowance(self):
        with patch.object(self.driver.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "boot failed")), \
             redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                self.driver.run(["xcrun", "simctl", "boot", "device"], self.root / "failed.log")
        self.assertNotIn("device", self.driver.COLD_BOOT_DEVICES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
