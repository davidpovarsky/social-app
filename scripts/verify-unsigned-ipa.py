#!/usr/bin/env python3
"""Verify an unsigned Torah IPA, or repair its two known undefined build values."""

import argparse
import copy
import hashlib
import json
import pathlib
import plistlib
import re
import struct
import sys
import zipfile
import zlib


MAIN_BUNDLE_ID = "com.davidpovarsky.torahsocial"
REPAIR_EXTENSIONS = ("BlueskyNSE", "Share-with-Bluesky")
ZIP_ATTRIBUTES = (
    "date_time", "compress_type", "comment", "extra", "create_system",
    "create_version", "extract_version", "reserved", "flag_bits",
    "volume", "internal_attr", "external_attr",
)
MACH_MAGICS = {
    b"\xcf\xfa\xed\xfe": ("<", 32),
    b"\xfe\xed\xfa\xcf": (">", 32),
    b"\xce\xfa\xed\xfe": ("<", 28),
    b"\xfe\xed\xfa\xce": (">", 28),
}
FAT_MAGICS = {
    b"\xca\xfe\xba\xbe": (">", False),
    b"\xbe\xba\xfe\xca": ("<", False),
    b"\xca\xfe\xba\xbf": (">", True),
    b"\xbf\xba\xfe\xca": ("<", True),
}


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    hasher = hashlib.sha256()
    with pathlib.Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def numeric_version(value, label):
    require(
        isinstance(value, str)
        and re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", value) is not None
        and int(value.split(".")[0]) > 0,
        f"{label} must be a positive numeric release version, got {value!r}",
    )
    return value


def macho_slices(data, label):
    """Read architecture/load commands only; never execute or alter a binary."""
    if data[:4] in FAT_MAGICS:
        endian, fat64 = FAT_MAGICS[data[:4]]
        require(len(data) >= 8, f"Truncated fat Mach-O: {label}")
        count = struct.unpack_from(endian + "I", data, 4)[0]
        stride = 32 if fat64 else 20
        require(0 < count <= 32 and 8 + count * stride <= len(data),
                f"Invalid fat Mach-O table: {label}")
        slices = []
        for index in range(count):
            values = struct.unpack_from(
                endian + ("IIQQII" if fat64 else "IIIII"), data, 8 + index * stride
            )
            offset, size = values[2:4]
            require(size > 0 and offset + size <= len(data),
                    f"Invalid fat Mach-O slice: {label}")
            require(data[offset:offset + 4] in MACH_MAGICS,
                    f"Unrecognized fat Mach-O slice: {label}")
            slices.extend(macho_slices(data[offset:offset + size], label))
        return slices
    if data[:4] not in MACH_MAGICS:
        return []
    endian, header_size = MACH_MAGICS[data[:4]]
    require(len(data) >= header_size, f"Truncated Mach-O: {label}")
    _, cpu, subtype, filetype, count, command_bytes, _ = struct.unpack_from(
        endian + "IIIIIII", data, 0
    )
    end = header_size + command_bytes
    require(end <= len(data) and count <= command_bytes // 8,
            f"Invalid Mach-O commands: {label}")
    offset = header_size
    platforms = []
    for _ in range(count):
        require(offset + 8 <= end, f"Truncated Mach-O command: {label}")
        command, size = struct.unpack_from(endian + "II", data, offset)
        require(size >= 8 and offset + size <= end,
                f"Invalid Mach-O command length: {label}")
        require(command != 0x1D, f"Signed Mach-O (LC_CODE_SIGNATURE): {label}")
        if command == 0x32:
            require(size >= 24, f"Truncated LC_BUILD_VERSION: {label}")
            platforms.append(struct.unpack_from(endian + "I", data, offset + 8)[0])
        elif command == 0x25:
            platforms.append(2)
        offset += size
    require(offset == end, f"Mach-O command size mismatch: {label}")
    return [{"cpu_type": cpu, "cpu_subtype": subtype,
             "file_type": filetype, "platforms": platforms}]


def checked_entries(archive):
    infos = archive.infolist()
    names = [info.filename for info in infos]
    require(len(names) == len(set(names)), "Duplicate ZIP entry")
    for info in infos:
        name = info.filename
        parts = pathlib.PurePosixPath(name).parts
        require(
            bool(parts) and parts[0] == "Payload" and not name.startswith("/")
            and ".." not in parts and "\\" not in name
            and str(pathlib.PurePosixPath(name)) == name.rstrip("/"),
            f"Unsafe or unexpected ZIP entry: {name}",
        )
        require(not info.flag_bits & 1, f"Encrypted ZIP entry: {name}")
        require(((info.external_attr >> 16) & 0o170000) != 0o120000,
                f"Symlink ZIP entry is unsupported: {name}")
        require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                f"Unsupported compression: {name}")
        require("_CodeSignature" not in parts and parts[-1] != "embedded.mobileprovision",
                f"Signing material is present: {name}")
    require(archive.testzip() is None, "IPA ZIP CRC check failed")
    return infos


def inspect_ipa(path, allow_known_undefined=False):
    path = pathlib.Path(path)
    before_hash = file_digest(path)
    with zipfile.ZipFile(path) as archive:
        infos = checked_entries(archive)
        names = [info.filename for info in infos]
        main_paths = [name for name in names
                      if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        require(len(main_paths) == 1, "Expected exactly one containing application")
        main_path = main_paths[0]
        app = pathlib.PurePosixPath(main_path).parent
        main = plistlib.loads(archive.read(main_path))
        require(main.get("CFBundleIdentifier") == MAIN_BUNDLE_ID,
                "Unexpected containing app bundle identifier")
        app_version = numeric_version(main.get("CFBundleShortVersionString"), "App version")
        build_version = numeric_version(main.get("CFBundleVersion"), "App build")
        repair_paths = {
            str(app / "PlugIns" / (extension + ".appex") / "Info.plist"):
                MAIN_BUNDLE_ID + "." + extension
            for extension in REPAIR_EXTENSIONS
        }
        entries, binaries, bundles, pending = {}, {}, [], []
        for info in infos:
            data = archive.read(info)
            name = info.filename
            entries[name] = {"bytes": len(data), "sha256": digest(data)}
            slices = macho_slices(data, name)
            if slices:
                binaries[name] = {"sha256": digest(data), "slices": slices}
            if not name.endswith((".app/Info.plist", ".appex/Info.plist", ".framework/Info.plist")):
                continue
            plist = plistlib.loads(data)
            identifier = plist.get("CFBundleIdentifier")
            require(isinstance(identifier, str) and identifier,
                    f"Missing bundle identifier: {name}")
            if name in repair_paths:
                require(identifier == repair_paths[name], f"Unexpected repair target: {name}")
            is_extension = name.endswith(".appex/Info.plist")
            if is_extension:
                require(identifier.startswith(MAIN_BUNDLE_ID + "."),
                        f"Extension is outside the containing app: {name}")
                require(plist.get("CFBundleShortVersionString") == app_version,
                        f"Extension app version differs: {name}")
                if allow_known_undefined and name in repair_paths and plist.get("CFBundleVersion") == "undefined":
                    pending.append(name)
                else:
                    require(plist.get("CFBundleVersion") == build_version,
                            f"Extension build differs: {name}")
            if name not in pending:
                numeric_version(plist.get("CFBundleVersion"), f"Bundle build in {name}")
            executable = plist.get("CFBundleExecutable")
            require(isinstance(executable, str) and executable
                    and pathlib.PurePosixPath(executable).name == executable
                    and "\\" not in executable,
                    f"Invalid bundle executable: {name}")
            executable_path = str(pathlib.PurePosixPath(name).parent / executable)
            require(executable_path in names, f"Missing bundle executable: {name}")
            bundle_slices = macho_slices(archive.read(executable_path), executable_path)
            require(bundle_slices and all(s["cpu_type"] == 0x0100000C
                                         and s["platforms"] and set(s["platforms"]) == {2}
                                         for s in bundle_slices),
                    f"Bundle executable must be arm64 for iOS devices: {name}")
            bundles.append({"info_plist": name, "bundle_id": identifier,
                            "version": plist.get("CFBundleShortVersionString"),
                            "build": plist.get("CFBundleVersion"),
                            "executable": executable_path})
        require(file_digest(path) == before_hash, "Input changed during inspection")
        return {"path": str(path.resolve()), "bytes": path.stat().st_size,
                "sha256": before_hash, "main_info_plist": main_path,
                "app_version": app_version, "build_version": build_version,
                "bundles": bundles, "binaries": binaries, "entries": entries,
                "unsigned": True, "pending_repairs": sorted(pending),
                "repair_paths": sorted(repair_paths)}


def compare_repair(source_path, output_path, before, after):
    changed = []
    with zipfile.ZipFile(source_path) as source, zipfile.ZipFile(output_path) as output:
        left, right = source.infolist(), output.infolist()
        require([i.filename for i in left] == [i.filename for i in right],
                "Repair changed the ZIP entry set or order")
        require(source.comment == output.comment, "Repair changed the ZIP comment")
        for original, repaired in zip(left, right):
            name = original.filename
            require(all(getattr(original, key) == getattr(repaired, key)
                        for key in ZIP_ATTRIBUTES), f"Repair changed ZIP attributes: {name}")
            old, new = source.read(original), output.read(repaired)
            if name not in before["pending_repairs"]:
                require(old == new, f"Repair changed an unapproved entry: {name}")
                continue
            require(old.startswith(b"bplist00") == new.startswith(b"bplist00"),
                    f"Repair changed plist format: {name}")
            old_plist, new_plist = plistlib.loads(old), plistlib.loads(new)
            expected = dict(old_plist)
            expected["CFBundleVersion"] = before["build_version"]
            require(old_plist["CFBundleVersion"] == "undefined" and new_plist == expected,
                    f"Repair changed an unapproved plist value: {name}")
            changed.append({"path": name, "key": "CFBundleVersion", "before": "undefined",
                            "after": before["build_version"], "before_sha256": digest(old),
                            "after_sha256": digest(new)})
    require(sorted(c["path"] for c in changed) == before["repair_paths"],
            "Repair must change exactly the two known extension plists")
    require(before["binaries"] == after["binaries"], "Repair changed executable bytes")
    require(file_digest(source_path) == before["sha256"], "Original IPA changed")
    return changed


def repair_ipa(source_path, output_path, expected_sha256):
    source_path, output_path = pathlib.Path(source_path), pathlib.Path(output_path)
    require(re.fullmatch(r"[a-f0-9]{64}", expected_sha256) is not None,
            "Repair requires an explicit lowercase SHA-256")
    require(source_path.resolve() != output_path.resolve(), "Input and output must differ")
    require(not output_path.exists() and not output_path.is_symlink(), "Output already exists")
    require(file_digest(source_path) == expected_sha256, "Input IPA SHA-256 does not match")
    before = inspect_ipa(source_path, allow_known_undefined=True)
    require(before["pending_repairs"] == before["repair_paths"],
            "Repair requires exactly the two known undefined extension build values")
    created = False
    try:
        with output_path.open("xb") as destination:
            created = True
            with zipfile.ZipFile(source_path) as source, zipfile.ZipFile(destination, "w") as output:
                for info in source.infolist():
                    data = source.read(info)
                    if info.filename in before["pending_repairs"]:
                        plist = plistlib.loads(data)
                        plist["CFBundleVersion"] = before["build_version"]
                        fmt = plistlib.FMT_BINARY if data.startswith(b"bplist00") else plistlib.FMT_XML
                        data = plistlib.dumps(plist, fmt=fmt, sort_keys=False)
                    output.writestr(copy.copy(info), data)
                output.comment = source.comment
        after = inspect_ipa(output_path)
        changes = compare_repair(source_path, output_path, before, after)
        return {"operation": "repair-known-extension-builds", "source": before,
                "result": after, "changes": changes,
                "proof": {"unchanged_entry_count": len(before["entries"]) - 2,
                          "all_other_entries_identical": True,
                          "zip_attributes_preserved": True,
                          "all_executable_bytes_unchanged": True,
                          "source_unchanged": True}}
    except BaseException:
        if created:
            output_path.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("verify", "repair"))
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--report", type=pathlib.Path, required=True)
    parser.add_argument("--source-commit")
    parser.add_argument("--source-run")
    args = parser.parse_args()
    require(not args.report.exists() and not args.report.is_symlink(), "Report already exists")
    require(args.output is None or args.report.resolve() != args.output.resolve(),
            "IPA output and report paths must differ")
    if args.mode == "repair":
        require(args.output is not None and args.expected_sha256 is not None,
                "Repair requires --output and --expected-sha256")
        report = repair_ipa(args.input, args.output, args.expected_sha256)
    else:
        require(args.output is None, "Verify mode does not write an IPA")
        if args.expected_sha256:
            require(file_digest(args.input) == args.expected_sha256, "Input IPA SHA-256 does not match")
        report = {"operation": "verify", "result": inspect_ipa(args.input)}
    report["provenance"] = {"source_commit": args.source_commit, "source_run": args.source_run,
                            "script_sha256": file_digest(__file__),
                            "python": sys.version, "zlib": zlib.ZLIB_VERSION}
    with args.report.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"operation": report["operation"], "ipa": report["result"]["path"],
                      "sha256": report["result"]["sha256"], "bytes": report["result"]["bytes"],
                      "report": str(args.report.resolve())}))


if __name__ == "__main__":
    try:
        main()
    except (VerificationError, zipfile.BadZipFile, plistlib.InvalidFileException) as error:
        raise SystemExit(str(error)) from error
