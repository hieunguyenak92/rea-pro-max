"""Build a deterministic, self-contained skill archive; optionally smoke-test extraction."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skills" / "rea-pro-max"
EXCLUDED = {".git", "node_modules", "__pycache__", ".pytest_cache", ".DS_Store"}
REQUIRED = {
    "SKILL.md", "LICENSE", "assets/vendor/acorn.mjs", "assets/vendor/ACORN-LICENSE",
    "scripts/rea-pro-max.mjs", "lib/analysis/inspect.mjs", "assets/prompts.json",
    "assets/workbench/index.html", "assets/workbench/app.js", "assets/workbench/style.css",
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def sources():
    entries = {}
    for path in sorted(SOURCE.rglob("*")):
        relative = path.relative_to(SOURCE)
        if any(part in EXCLUDED for part in relative.parts) or path.suffix in {".pyc", ".pyo", ".tmp"}:
            continue
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError(f"Refusing symlink in skill: {relative}")
        if stat.S_ISDIR(metadata.st_mode):
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"Refusing special file in skill: {relative}")
        entries[relative.as_posix()] = path.read_bytes()
    missing = REQUIRED.difference(entries)
    if missing:
        raise ValueError(f"Required skill files missing: {', '.join(sorted(missing))}")
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    notices = notices.replace("skills/rea-pro-max/assets/vendor/ACORN-LICENSE", "assets/vendor/ACORN-LICENSE")
    notices = notices.replace("docs/ACORN-RECEIPT.json", "ACORN-RECEIPT.json")
    entries["THIRD_PARTY_NOTICES.md"] = notices.encode("utf-8")
    entries["ACORN-RECEIPT.json"] = (ROOT / "docs" / "ACORN-RECEIPT.json").read_bytes()
    if len(entries) > 1000 or sum(map(len, entries.values())) > 20 * 1024 * 1024:
        raise ValueError("Skill exceeds package bounds (1000 files / 20 MiB).")
    manifest = "".join(f"{sha256(data)}  {name}\n" for name, data in sorted(entries.items()))
    entries["SHA256SUMS"] = manifest.encode("utf-8")
    return entries


def archive_bytes(entries):
    # Stored entries avoid compressed-byte differences between zlib versions/OSes.
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(f"rea-pro-max/{name}", (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return output.getvalue()


def smoke_test(data):
    node = shutil.which("node")
    if not node:
        raise ValueError("Node.js 22+ is needed for --check.")
    with tempfile.TemporaryDirectory(prefix="rpm-extracted-skill-") as temporary:
        extracted = Path(temporary)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            archive.extractall(extracted)
        skill = extracted / "rea-pro-max"
        for line in (skill / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
            expected, name = line.split("  ", 1)
            if sha256((skill / name).read_bytes()) != expected:
                raise ValueError(f"Extracted checksum mismatch: {name}")
        cli = skill / "scripts" / "rea-pro-max.mjs"

        def invoke(arguments, expected=0):
            result = subprocess.run([node, str(cli), *map(str, arguments)], cwd=extracted,
                                    text=True, encoding="utf-8", capture_output=True, timeout=30,
                                    check=False)
            if result.returncode != expected or result.stderr:
                raise ValueError(f"Extracted CLI {arguments[0]} failed ({result.returncode}): {result.stderr}")
            return result.stdout

        if "REA Pro Max" not in invoke(["help"]):
            raise ValueError("Extracted help did not identify the product.")
        lab = extracted / "owned-lab"
        result = json.loads(invoke(["demo", "--out", lab]))
        reduced = json.loads((lab / "reduction.json").read_text(encoding="utf-8"))
        if result["verification"] != "fail" or reduced["minimality"] != "one-minimal":
            raise ValueError("Extracted demo did not expose and qualify the owned regression.")
        if [step["type"] for step in reduced["sequence"]] != ["save", "restart", "read"]:
            raise ValueError("Extracted demo did not retain the persistence counterexample.")
        verdict = json.loads(invoke(["verify", "--reference", lab / "reference.json",
                                     "--candidate", lab / "candidate.json"], expected=2))
        if verdict["status"] != "fail" or not (lab / "report.html").is_file():
            raise ValueError("Extracted CLI lost the verification/report artifacts.")
        return {"commands": ["help", "demo", "verify"], "verification": "fail",
                "reduced_actions": len(reduced["sequence"])}


def atomic_write(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix=".rpm-package-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check repeatability and run the extracted CLI without npm.")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "dist", help="Package output directory.")
    arguments = parser.parse_args()
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if not isinstance(version, str) or not version or any(character not in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-" for character in version):
        raise ValueError("Package version must be a plain version identifier.")
    entries = sources()
    data = archive_bytes(entries)
    checks = None
    if arguments.check:
        if data != archive_bytes(sources()):
            raise ValueError("Skill bytes changed during packaging; repeatability check failed.")
        checks = smoke_test(data)
    arguments.out_dir.mkdir(parents=True, exist_ok=True)
    output = arguments.out_dir / f"rea-pro-max-{version}.zip"
    checksum = sha256(data)
    atomic_write(output, data)
    atomic_write(arguments.out_dir / "SHA256SUMS", f"{checksum}  {output.name}\n".encode("utf-8"))
    print(json.dumps({"archive": str(output.resolve()), "sha256": checksum,
                      "files": len(entries), "bytes": len(data), "extracted_smoke": checks}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        raise SystemExit(f"Package check failed: {error}") from error
