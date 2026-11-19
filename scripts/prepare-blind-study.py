"""Validate the existing four-model reader packets, then optionally import privately."""
import argparse
import csv
import getpass
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
CONFIG = BACKEND / "wrangler.jsonc"
PACKETS = ("Reader01", "Reader02")
SHARED_PACKET = "Reader01"
LETTERS = "ABCD"
MODELS = {"morph": "MORPH-CT", "m3d": "M3D-LaMed-Phi-3-4B", "btb": "BTB3D-16", "ctchat": "CT-CHAT-8B"}
BLOCK_SEPARATOR = "\n\n" + "━" * 30 + "\n\n"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def login_name(value):
    require(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", value) is not None,
            "Use a lowercase ASCII account name (letters, digits, underscores or hyphens).")
    return value


def file_hash(path):
    with path.open("rb") as fp:
        return hashlib.file_digest(fp, "sha256").hexdigest()


def sheet(archive, member):
    return csv.DictReader(io.StringIO(archive.read(member).decode("utf-8-sig")))


def read_report_packets(folder):
    """Validate original letters and case orders independently from account enrollment."""
    with ZipFile(folder / "Coordinator_ONLY.zip") as z:
        manifest = json.loads(z.read("manifest.json"))
        require(set(manifest["models"]) == set(MODELS), "Unexpected set of four models.")
        key = {}
        for row in sheet(z, "unblinding_key.csv"):
            idx = row["reader"], row["case"], row["report"]
            require(idx not in key and row["model"] in MODELS, "Invalid unblinding key.")
            key[idx] = MODELS[row["model"]]
    reports, mappings, referenced = {}, {p: [] for p in PACKETS}, set()
    for reader in PACKETS:
        p = folder / f"{reader}.zip"
        require(file_hash(p) == manifest["reader_zips_sha256"][p.name], f"Changed packet: {p.name}")
        with ZipFile(p) as z:
            # The preference sheet stores the coordinator's randomized presentation order.
            order = [r["病例编号"] for r in sheet(z, "最佳报告.csv")]
            require(len(set(order)) == len(order) == manifest["cases"], "Incomplete case list.")
            for position, case in enumerate(order, start=1):
                require(re.fullmatch(r"Case[0-9]{2,4}", case), "Expected blinded CaseNN aliases.")
                raw = z.read(f"reports/{case}.txt").decode("utf-8-sig")
                title, _, text = raw.partition("\n\n")
                blocks = text.removesuffix("\n").split(BLOCK_SEPARATOR)
                require(title == case and len(blocks) == 4, f"Malformed report packet for {case}.")
                selected = []
                for letter, block in zip(LETTERS, blocks, strict=True):
                    idx = reader, case, letter
                    heading, _, report = block.partition("\n\n")
                    require(heading == f"报告 {letter}" and report.startswith("中文参考译文\n")
                            and report.count("\n\n英文原文\n") == 1, "Unrecognized bilingual format.")
                    model = key[idx]
                    require(all(name.lower() not in report.lower() for name in MODELS.values()),
                            "Found a model name in the blinded report body.")
                    existing = reports.setdefault((case, model), report)
                    require(existing == report, f"Model text differs between readers for {case}.")
                    selected.append(model)
                    referenced.add(idx)
                    mappings[reader].append((case, letter, model, position))
                require(len(set(selected)) == 4, f"Repeated model in {reader}/{case}.")
    require(referenced == set(key), "Unused entries in the unblinding key.")
    cases = sorted({c for c, _ in reports})
    require(len(cases) == manifest["cases"] and len(reports) == 4 * len(cases), "Case set mismatch.")
    return manifest, reports, mappings, cases


def read_images(images, prefix, cases, image_hash):
    require(file_hash(images) == image_hash, "Changed image archive.")
    objects = {}
    with ZipFile(images) as z:
        require(sorted(z.namelist()) == [f"{c}.nii.gz" for c in cases], "Image aliases do not match.")
        for case in cases:
            name = f"{case}.nii.gz"
            with z.open(name) as scan:
                checksum = hashlib.file_digest(scan, "sha256").hexdigest()
            size = z.getinfo(name).file_size
            require(0 < size <= 315 * 1024**2, "Image exceeds the Wrangler single-object upload limit.")
            key = f"blind/{prefix}/{case}/{checksum}.nii.gz"
            objects[case] = (f"{prefix}-{case}", case, key, name, size)
    return objects


def sql_val(value):
    if isinstance(value, int):
        return str(value)
    require("\0" not in value, "NUL character in SQL text input.")
    return "'" + value.replace("'", "''") + "'"


def immutable_insert(table, columns, values):
    """Identical imports are skipped; different content under an existing key fails its UNIQUE constraint."""
    encoded = list(map(sql_val, values))
    matches = " AND ".join(f"{col}={val}" for col, val in zip(columns, encoded, strict=True))
    return (f"INSERT INTO {table} ({','.join(columns)}) SELECT {','.join(encoded)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE {matches});")


def study_sql(objects, reports, shared):
    statements = []
    for row in objects.values():
        statements.append(immutable_insert("private_cases", ("case_id", "case_name", "image_key", "image_filename", "image_size"), row))
    for (case, model), text in reports.items():
        statements.append(immutable_insert("private_reports", ("case_id", "model_name", "report_text"), (objects[case][0], model, text)))
    for row in shared:
        statements.append(immutable_insert("shared_case_letters", ("case_id", "letter", "model_name", "case_order"), row))
    return "\n".join(statements)


def wrangler(*args, capture=False):
    exe = shutil.which("wrangler")
    if os.name == "nt":
        # Run the JS entry point directly to avoid Windows shell interpolation.
        entries = [ROOT / ".wrangler/tools/node_modules/wrangler/bin/wrangler.js",
                   ROOT / "node_modules/wrangler/bin/wrangler.js"]
        if exe:
            entries.append(Path(exe).parent / "node_modules/wrangler/bin/wrangler.js")
        script = next((s for s in entries if s.is_file()), None)
        require(script and shutil.which("node"), "Install Node and Wrangler 4 (npm install -g wrangler@4).")
        cmd = ["node", str(script)]
    else:
        require(exe, "Install Wrangler 4 (npm install -g wrangler@4).")
        cmd = [exe]
    if "--local" in args:
        state = Path.home() / ".ct-report-review-private" / "state"
        require(not state.resolve().is_relative_to(ROOT), "Local state must be outside the website repository.")
        args = (*args, "--persist-to", state)
    return subprocess.run([*cmd, *map(str, args)], check=True, cwd=BACKEND,
                          capture_output=capture, text=True, encoding="utf-8")


def db_execute(db, *flags, remote, capture=False):
    return wrangler("d1", "execute", db, "--config", CONFIG, "--remote" if remote else "--local", *flags, capture=capture)


def query(db, sql, remote):
    data = db_execute(db, "--command", sql, "--json", remote=remote, capture=True)
    return [row for group in json.loads(data.stdout) for row in group["results"]]


def check_doctors(db, names, remote):
    if not names:
        return
    values = ",".join(map(sql_val, names))
    rows = query(db, f"SELECT username FROM accounts WHERE role='doctor' AND username IN ({values})", remote)
    require(set(names) == {r["username"] for r in rows}, "Create a separate doctor account for each person being enrolled.")


def shared_plan(db, prefix, remote):
    pattern = sql_val(f"blind/{prefix}/*")
    rows = query(db, "SELECT c.case_id, s.letter, s.model_name, s.case_order FROM private_cases c "
                     "LEFT JOIN shared_case_letters s ON s.case_id=c.case_id "
                     f"WHERE c.image_key GLOB {pattern}", remote)
    if not rows:
        return []
    require(all(r["letter"] is not None for r in rows),
            "This prefix already contains legacy cases or an incomplete shared plan. Use a new prefix.")
    plan = [(r["case_id"], r["letter"], r["model_name"], r["case_order"]) for r in rows]
    cases = {row[0]: set(MODELS.values()) for row in plan}
    validate_assignment(cases, plan)
    return plan


def validate_assignment(cases, rows):
    positions, seen = {}, {}
    for case, letter, model, position in rows:
        require(case in cases and model in cases[case] and letter in list(LETTERS), "Unrecognized case, model or letter in assignment.")
        require(positions.setdefault(case, position) == position, "Conflicting case order.")
        slot = seen.setdefault(case, {})
        require(letter not in slot, "Duplicate letter assignment.")
        slot[letter] = model
    require(set(seen) == set(cases) and set(positions.values()) == set(range(1, len(cases) + 1))
            and all(set(slot) == set(LETTERS) and len(set(slot.values())) == 4 for slot in seen.values()),
            "Partial or conflicting enrollment. Review the existing assignments before continuing.")


def enroll(db, prefix, username, plan, scratch, remote):
    pattern = sql_val(f"blind/{prefix}/*")
    def get_rows():
        data = query(db, "SELECT a.case_id, a.letter, a.model_name, a.case_order FROM assignments a JOIN private_cases c "
                         f"ON c.case_id=a.case_id WHERE a.username={sql_val(username)} AND c.image_key GLOB {pattern}", remote)
        return [(r["case_id"], r["letter"], r["model_name"], r["case_order"]) for r in data]

    def validate_saved(rows):
        require(len(rows) == len(plan) and set(rows) == set(plan),
                "The existing assignment is incomplete or differs from the study's shared letter/order mapping.")

    saved = get_rows()
    if saved:
        validate_saved(saved)
        return False
    # A single write enrolls one doctor in the entire shared, frozen set.
    sql = ("INSERT INTO assignments(username,case_id,letter,model_name,case_order) "
           f"SELECT {sql_val(username)},s.case_id,s.letter,s.model_name,s.case_order FROM shared_case_letters s "
           f"JOIN private_cases c ON c.case_id=s.case_id WHERE c.image_key GLOB {pattern};")
    try:
        apply_sql(db, sql, scratch, remote)
    except ValueError:
        # A simultaneous enrollment may already have committed the complete assignment.
        saved = get_rows()
        if not saved:
            raise
        validate_saved(saved)
        return False
    validate_saved(get_rows())
    return True


def freeze_for_account(mapping, prefix):
    return [(f"{prefix}-{case}", letter, model, order) for case, letter, model, order in mapping]


def apply_sql(db, sql, scratch, remote):
    path = scratch / "import.sql"
    path.write_text(sql, encoding="utf-8")
    # SQL contains private reports or login verifiers. Do not echo Wrangler's SQL to the console.
    try:
        db_execute(db, "--file", path, "--yes", remote=remote, capture=True)
    except subprocess.CalledProcessError as exc:
        raise ValueError("D1 import failed. Check schema, account, case IDs and existing rows. Existing IDs cannot be remapped.") from exc


def run(args, scratch):
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    db = next(d["database_name"] for d in config["d1_databases"] if d["binding"] == "DB")
    if args.command == "user":
        username = login_name(args.username)
        require(sys.stdin.isatty(), "Enter the new password in an interactive terminal.")
        password = getpass.getpass(f"New password for {username}: ")
        require(12 <= len(password) <= 200 and password == getpass.getpass("Confirm password: "), "Passwords differ or are outside 12–200 characters.")
        salt = secrets.token_hex(24)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000).hex()
        fields = ",".join(map(sql_val, (username, args.role, digest, salt)))
        apply_sql(db, f"INSERT INTO accounts (username,role,password_hash,password_salt) VALUES ({fields});", scratch, args.remote)
        print(f"Created {args.role} account {username}.")
        return

    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,39}", args.prefix), "Invalid study prefix.")
    if args.command == "assign":
        user = login_name(args.username)
        check_doctors(db, [user], args.remote)
        plan = shared_plan(db, args.prefix, args.remote)
        require(plan, "No shared study found for this prefix. Import this study first.")
        added = enroll(db, args.prefix, user, plan, scratch, args.remote)
        print(f"{user}: {'assigned' if added else 'already assigned'} {len(plan) // len(LETTERS)} cases.")
        return

    users = [login_name(name) for name in args.assign]
    require(len(set(users)) == len(users), "Each reader needs a distinct account.")
    manifest, reports, mappings, case_ids = read_report_packets(args.study_dir)
    objects = read_images(args.images_zip, args.prefix, case_ids, manifest["images_sha256"])
    plan = freeze_for_account(mappings[SHARED_PACKET], args.prefix)
    validate_assignment({row[0]: set(MODELS.values()) for row in plan}, plan)
    print(f"Verified {len(objects)} images, {len(reports)} bilingual model reports, {len(plan)} shared letter assignments; {len(users)} selected doctors.")
    if args.command == "check":
        return
    bucket = next((b["bucket_name"] for b in config.get("r2_buckets", []) if b["binding"] == "IMAGES"), None)
    require(bucket, "This CLI import needs an IMAGES bucket. For a Google Drive study, publish from the administrator's Upload study page.")
    # Confirm accounts before uploading image objects. All public access must be disabled on this bucket.
    check_doctors(db, users, args.remote)
    saved_plan = shared_plan(db, args.prefix, args.remote)
    if saved_plan:
        require(set(plan) == set(saved_plan), "This study prefix has a different shared key. Use a new prefix.")
    else:
        with ZipFile(args.images_zip) as z:
            for case, (_, _, key, name, _) in objects.items():
                print(f"Storing {case} in the private image bucket.", flush=True)
                scan = scratch / "scan.nii.gz"
                with z.open(name) as src, scan.open("wb") as dst:
                    shutil.copyfileobj(src, dst, 1024**2)
                require(file_hash(scan) == key.split("/")[-1][:-7], "Image changed during preparation.")
                wrangler("r2", "object", "put", f"{bucket}/{key}", "--file", scan, "--content-type", "application/octet-stream",
                         "--config", CONFIG, "--remote" if args.remote else "--local")
    # Even on a retry, compare all immutable report text, image hashes and canonical letters.
    apply_sql(db, study_sql(objects, reports, plan), scratch, args.remote)
    for user in users:
        enroll(db, args.prefix, user, plan, scratch, args.remote)
    print(f"Private shared study registered with {len(users)} selected doctors.")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="command", required=True)
    account = commands.add_parser("user", help="Create one new individual account")
    account.add_argument("--username", required=True)
    account.add_argument("--role", choices=("admin", "doctor"), required=True)
    account.add_argument("--remote", action="store_true", help="Apply to Cloudflare; the default is local Wrangler storage.")
    for name in ("check", "import"):
        sub = commands.add_parser(name)
        sub.add_argument("--study-dir", type=Path, required=True)
        sub.add_argument("--images-zip", type=Path, required=True)
        sub.add_argument("--prefix", default="BR4shared")
        sub.add_argument("--assign", action="append", default=[], metavar="USERNAME",
                         help="Enroll this individual doctor with the shared mapping. Repeat for any number of doctors; default none.")
        if name == "import":
            sub.add_argument("--remote", action="store_true", help="Upload to the configured private Cloudflare storage.")
    assign = commands.add_parser("assign", help="Assign all cases in a registered study to an individual doctor")
    assign.add_argument("--prefix", default="BR4shared")
    assign.add_argument("--username", required=True)
    assign.add_argument("--remote", action="store_true", help="Enroll in the configured remote D1 database.")
    args = p.parse_args()
    tmp_root = Path(tempfile.gettempdir()).resolve()
    require(not tmp_root.is_relative_to(ROOT), "Set TEMP or TMPDIR to a private directory outside the website repo.")
    with tempfile.TemporaryDirectory(prefix="private-review-", dir=tmp_root) as path:
        run(args, Path(path))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, BadZipFile, subprocess.CalledProcessError) as exc:
        sys.exit(f"Import stopped: {exc}")
