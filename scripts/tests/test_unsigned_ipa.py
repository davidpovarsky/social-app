import importlib.util
import pathlib
import plistlib
import struct
import tempfile
import unittest
import warnings
import zipfile


SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "verify-unsigned-ipa.py"
SPEC = importlib.util.spec_from_file_location("verify_unsigned_ipa", SCRIPT)
ipa_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ipa_tool)
APP = "Payload/TorahSocial.app"
TARGETS = (
    APP + "/PlugIns/BlueskyNSE.appex/Info.plist",
    APP + "/PlugIns/Share-with-Bluesky.appex/Info.plist",
)


def device_binary(signed=False, platform=2):
    commands = struct.pack("<IIIIII", 0x32, 24, platform, 0x100400, 0x1A0500, 0)
    if signed:
        commands += struct.pack("<IIII", 0x1D, 16, 72, 0)
    return struct.pack("<IIIIIIII", 0xFEEDFACF, 0x0100000C, 0, 2,
                       2 if signed else 1, len(commands), 0x200085, 0) + commands + b"\x00immutable executable\xff"


def fixture_entries(build="1", broken=True):
    entries = {APP + "/main.jsbundle": b"immutable JS\x00\xff", APP + "/asset.png": b"\x89PNG\x00unchanged"}
    bundles = [
        (APP, "TorahSocial", ipa_tool.MAIN_BUNDLE_ID, build),
        (APP + "/PlugIns/BlueskyNSE.appex", "BlueskyNSE", ipa_tool.MAIN_BUNDLE_ID + ".BlueskyNSE", "undefined" if broken else build),
        (APP + "/PlugIns/Share-with-Bluesky.appex", "Share-with-Bluesky", ipa_tool.MAIN_BUNDLE_ID + ".Share-with-Bluesky", "undefined" if broken else build),
        (APP + "/PlugIns/ExpoWidgetsTarget.appex", "ExpoWidgetsTarget", ipa_tool.MAIN_BUNDLE_ID + ".TorahWidgets", build),
        (APP + "/Frameworks/hermesvm.framework", "hermesvm", "dev.hermesengine.iphoneos", "1.0.0"),
    ]
    for bundle, executable, identifier, bundle_build in bundles:
        value = {"CFBundleIdentifier": identifier, "CFBundleExecutable": executable,
                 "CFBundleShortVersionString": "1.0.0" if bundle.endswith(".framework") else "1.139.0",
                 "CFBundleVersion": bundle_build, "MinimumOSVersion": "16.4",
                 "SentinelUnchangedValue": ["keep", 42, True]}
        entries[bundle + "/Info.plist"] = plistlib.dumps(value, fmt=plistlib.FMT_BINARY, sort_keys=False)
        entries[bundle + "/" + executable] = device_binary()
    return entries


def write_fixture(path, entries):
    with zipfile.ZipFile(path, "w") as archive:
        archive.comment = b"preserved archive comment"
        for index, (name, data) in enumerate(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 22, 5, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED if index % 2 else zipfile.ZIP_STORED
            info.external_attr = (0o100755 if not name.endswith((".plist", ".png")) else 0o100644) << 16
            info.comment = b"preserved entry comment"
            archive.writestr(info, data)


class UnsignedIpaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / "source.ipa"
        self.output = self.root / "repaired.ipa"
        self.entries = fixture_entries()

    def tearDown(self):
        self.temp.cleanup()

    def write(self):
        write_fixture(self.source, self.entries)
        return ipa_tool.file_digest(self.source)

    def repair(self):
        return ipa_tool.repair_ipa(self.source, self.output, self.write())

    def assert_repair_refused(self, message):
        source_hash = self.write()
        with self.assertRaisesRegex(ipa_tool.VerificationError, message):
            ipa_tool.repair_ipa(self.source, self.output, source_hash)
        self.assertFalse(self.output.exists())
        self.assertEqual(ipa_tool.file_digest(self.source), source_hash)

    def edit_plist(self, path, key, value):
        data = plistlib.loads(self.entries[path])
        data[key] = value
        self.entries[path] = plistlib.dumps(data, fmt=plistlib.FMT_BINARY, sort_keys=False)

    def test_repair_changes_only_two_values_and_preserves_original(self):
        original_hash = self.write()
        report = ipa_tool.repair_ipa(self.source, self.output, original_hash)
        self.assertEqual(ipa_tool.file_digest(self.source), original_hash)
        self.assertEqual({change["path"] for change in report["changes"]}, set(TARGETS))
        with zipfile.ZipFile(self.source) as before, zipfile.ZipFile(self.output) as after:
            self.assertEqual(before.namelist(), after.namelist())
            self.assertEqual(before.comment, after.comment)
            for name in before.namelist():
                for attr in ipa_tool.ZIP_ATTRIBUTES:
                    self.assertEqual(getattr(before.getinfo(name), attr), getattr(after.getinfo(name), attr))
                old, new = before.read(name), after.read(name)
                if name not in TARGETS:
                    self.assertEqual(old, new)
                else:
                    self.assertTrue(new.startswith(b"bplist00"))
                    expected = plistlib.loads(old)
                    expected["CFBundleVersion"] = "1"
                    self.assertEqual(plistlib.loads(new), expected)
        self.assertTrue(report["proof"]["all_executable_bytes_unchanged"])
        self.assertEqual(report["result"]["pending_repairs"], [])

    def test_repair_is_deterministic_for_same_input(self):
        sha = self.write()
        ipa_tool.repair_ipa(self.source, self.output, sha)
        second = self.root / "second.ipa"
        ipa_tool.repair_ipa(self.source, second, sha)
        self.assertEqual(self.output.read_bytes(), second.read_bytes())

    def test_repair_uses_explicit_containing_app_build(self):
        self.entries = fixture_entries(build="42.7")
        report = self.repair()
        self.assertEqual({change["after"] for change in report["changes"]}, {"42.7"})
        self.assertEqual(report["result"]["build_version"], "42.7")

    def test_verify_rejects_known_bad_metadata_instead_of_repairing_it(self):
        sha = self.write()
        with self.assertRaisesRegex(ipa_tool.VerificationError, "Extension build differs"):
            ipa_tool.inspect_ipa(self.source)
        self.assertEqual(ipa_tool.file_digest(self.source), sha)

    def test_verify_accepts_consistent_app_and_extensions(self):
        self.entries = fixture_entries(broken=False)
        self.write()
        report = ipa_tool.inspect_ipa(self.source)
        self.assertTrue(report["unsigned"])
        self.assertEqual(len(report["binaries"]), 5)

    def test_wrong_source_hash_is_refused(self):
        self.write()
        with self.assertRaisesRegex(ipa_tool.VerificationError, "SHA-256 does not match"):
            ipa_tool.repair_ipa(self.source, self.output, "0" * 64)
        self.assertFalse(self.output.exists())

    def test_existing_output_and_in_place_repair_are_refused(self):
        sha = self.write()
        with self.assertRaisesRegex(ipa_tool.VerificationError, "must differ"):
            ipa_tool.repair_ipa(self.source, self.source, sha)
        self.output.write_bytes(b"keep existing output")
        with self.assertRaisesRegex(ipa_tool.VerificationError, "already exists"):
            ipa_tool.repair_ipa(self.source, self.output, sha)
        self.assertEqual(self.output.read_bytes(), b"keep existing output")

    def test_valid_but_different_extension_build_is_not_normalized(self):
        self.edit_plist(TARGETS[0], "CFBundleVersion", "2")
        self.assert_repair_refused("Extension build differs")

    def test_unrelated_bad_extension_is_not_normalized(self):
        self.edit_plist(APP + "/PlugIns/ExpoWidgetsTarget.appex/Info.plist", "CFBundleVersion", "undefined")
        self.assert_repair_refused("Extension build differs")

    def test_extension_marketing_version_and_id_are_preserved_requirements(self):
        for key, value, message in [("CFBundleShortVersionString", "2.0.0", "app version differs"),
                                    ("CFBundleIdentifier", "other.bundle", "Unexpected repair target")]:
            with self.subTest(key=key):
                self.entries = fixture_entries()
                self.edit_plist(TARGETS[0], key, value)
                self.assert_repair_refused(message)

    def test_main_app_metadata_must_be_valid(self):
        self.edit_plist(APP + "/Info.plist", "CFBundleVersion", "undefined")
        self.assert_repair_refused("positive numeric release version")

    def test_known_targets_must_both_be_broken_before_repair(self):
        self.edit_plist(TARGETS[0], "CFBundleVersion", "1")
        self.assert_repair_refused("exactly the two known")

    def test_signing_material_is_refused(self):
        for name in [APP + "/_CodeSignature/CodeResources", APP + "/embedded.mobileprovision"]:
            with self.subTest(name=name):
                self.entries = fixture_entries()
                self.entries[name] = b"signing material"
                self.assert_repair_refused("Signing material")

    def test_embedded_macho_signature_is_refused(self):
        self.entries[APP + "/TorahSocial"] = device_binary(signed=True)
        self.assert_repair_refused("LC_CODE_SIGNATURE")

    def test_simulator_binary_is_refused(self):
        self.entries[APP + "/TorahSocial"] = device_binary(platform=7)
        self.assert_repair_refused("arm64 for iOS devices")

    def test_unsafe_and_duplicate_zip_entries_are_refused(self):
        self.entries["Payload/../outside"] = b"unexpected"
        self.assert_repair_refused("Unsafe or unexpected")
        self.entries = fixture_entries()
        self.write()
        with zipfile.ZipFile(self.source, "a") as archive:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                archive.writestr(APP + "/TorahSocial", device_binary())
        with self.assertRaisesRegex(ipa_tool.VerificationError, "Duplicate ZIP entry"):
            ipa_tool.repair_ipa(self.source, self.output, ipa_tool.file_digest(self.source))

    def test_comparison_rejects_an_unapproved_byte_change(self):
        self.repair()
        before = ipa_tool.inspect_ipa(self.source, allow_known_undefined=True)
        with zipfile.ZipFile(self.output) as archive:
            tampered = {info.filename: archive.read(info) for info in archive.infolist()}
        tampered[APP + "/main.jsbundle"] += b"changed"
        modified = self.root / "modified.ipa"
        write_fixture(modified, tampered)
        after = ipa_tool.inspect_ipa(modified)
        with self.assertRaisesRegex(ipa_tool.VerificationError, "unapproved entry"):
            ipa_tool.compare_repair(self.source, modified, before, after)


if __name__ == "__main__":
    unittest.main()
