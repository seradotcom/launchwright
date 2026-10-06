#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Canonical Semwright Driver Host acceptance for Launchwright.

This harness is intentionally CI-only. It launches the exact pinned Semwright
daemon/CLI/sandbox, admits the real Launchwright NativeDriver through the Driver
Host, delegates its owner-pinned Node runtime through the Host tool interface,
and then proves durable read/write/readback plus fail-closed policy behavior.

It never substitutes an in-process Provider and never upgrades Host acceptance
into Platform, external-channel, or ChatGPT host acceptance.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import time
import tomllib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SEMWRIGHT = Path(os.environ["SEMWRIGHT_CHECKOUT"]).resolve()
LAUNCHWRIGHT_DRIVER = Path(os.environ["LAUNCHWRIGHT_NATIVE_BINARY"]).resolve()
BUNDLE_MANIFEST = ROOT / "dist" / "native-bundle.json"
SEMWRIGHT_BINS = SEMWRIGHT / "target" / "debug"
EVIDENCE = ROOT / "evidence" / "native-host"
RESOURCE = "launchwright:workspace"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def exact_json(value: Any) -> str:
    if value is None or isinstance(value, (str, bool)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int) and not isinstance(value, bool):
        if abs(value) > 9_007_199_254_740_991:
            raise AssertionError("integer exceeds Semwright exact JSON range")
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(exact_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise AssertionError("exact JSON object keys must be strings")
        keys = sorted(value, key=lambda key: key.encode("utf-8"))
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + exact_json(value[key])
            for key in keys
        ) + "}"
    raise AssertionError(f"unsupported exact JSON value: {type(value)!r}")


def request_digest(value: dict[str, Any]) -> str:
    payload = "launchwright/request/1\n" + exact_json(value)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def write_private_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    path.chmod(0o600)


def require_binary(name: str) -> Path:
    path = SEMWRIGHT_BINS / name
    if not path.is_file():
        raise AssertionError(f"missing Semwright binary: {path}")
    return path


class HostFixture:
    def __init__(self, label: str, *, allow_driver: bool) -> None:
        self.label = label
        self.allow_driver = allow_driver
        self.temp = tempfile.TemporaryDirectory(prefix=f"launchwright-host-{label}-")
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.paths: dict[str, Path] = {}
        for name in (
            "runtime",
            "state",
            "home",
            "config",
            "binary",
            "launchwright-runtime",
            "launchwright-data",
        ):
            path = self.root / name
            path.mkdir(mode=0o700)
            self.paths[name] = path

        self.evidence = EVIDENCE / label
        self.evidence.mkdir(parents=True, exist_ok=False)
        self.records: list[dict[str, Any]] = []
        self.process: subprocess.Popen[bytes] | None = None
        self.log = None
        self.attempt = 0
        self.socket = self.paths["runtime"] / "broker.sock"
        self.session = self.paths["runtime"] / "cli.session"

        self.env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS"}
        }
        self.env.update(
            HOME=str(self.paths["home"]),
            XDG_RUNTIME_DIR=str(self.paths["runtime"]),
            XDG_STATE_HOME=str(self.paths["state"]),
            RUST_BACKTRACE="1",
        )

        self._stage_driver()
        self._stage_runtime()
        self._provision_workspace()
        self._write_manifest_and_policy()

    def _stage_driver(self) -> None:
        target = self.paths["binary"] / "launchwright-native"
        shutil.copyfile(LAUNCHWRIGHT_DRIVER, target)
        target.chmod(0o500)
        self.driver = target

    def _stage_runtime(self) -> None:
        manifest = json.loads(BUNDLE_MANIFEST.read_text(encoding="utf-8"))
        if manifest.get("sdk_sha") != os.environ["SEMWRIGHT_SHA"]:
            raise AssertionError("Launchwright bundle manifest is not pinned to the tested Semwright SHA")
        profiles = manifest.get("profiles", {})
        if set(profiles) != {
            "core",
            "production",
            "review",
            "integrations",
            "extensions",
            "work",
            "media",
            "publish",
            "graph",
            "effects",
        }:
            raise AssertionError("unexpected Native bundle profile set")

        self.bundle_manifest = manifest
        for profile in profiles.values():
            source = ROOT / "dist" / profile["file"]
            if not source.is_file() or sha256(source) != profile["sha256"]:
                raise AssertionError(f"Native bundle digest drift: {profile['file']}")
            target = self.paths["launchwright-runtime"] / profile["file"]
            shutil.copyfile(source, target)
            target.chmod(0o400)

        source_node = Path(shutil.which("node") or "").resolve()
        if not source_node.is_file():
            raise AssertionError("Node 24 runtime is unavailable")
        node = self.paths["binary"] / "node-runtime"
        shutil.copyfile(source_node, node)
        node.chmod(0o500)
        self.node = node

    def _provision_workspace(self) -> None:
        result = subprocess.run(
            [
                str(self.node),
                str(ROOT / "src" / "main.mjs"),
                "init",
                "--state",
                str(self.paths["launchwright-data"]),
            ],
            cwd=ROOT,
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
        )
        if result.returncode:
            raise AssertionError(
                "Launchwright workspace initialization failed: "
                + result.stderr.decode("utf-8", "replace")
            )

    def _write_manifest_and_policy(self) -> None:
        cargo = tomllib.loads((ROOT / "crates" / "launchwright-native" / "Cargo.toml").read_text())
        manifest = {
            "manifest_version": 1,
            "protocol": 5,
            "id": "launchwright",
            "version": cargo["package"]["version"],
            "publisher": "launchwright-owned-native-acceptance",
            "executable": str(self.driver),
            "sha256": sha256(self.driver),
            "application": {
                "desktop_id": None,
                "process_names": ["launchwright-native"],
                "supported_versions": [],
            },
            "transport": "stdio_v1",
            "network": False,
            "mounts": [
                {"root": "launchwright-runtime", "read_only": True, "execute": False},
                {"root": "launchwright-data", "read_only": False, "execute": False},
            ],
            "tools": [
                {
                    "root": "launchwright-node",
                    "name": "node",
                    "sha256": sha256(self.node),
                    "mounts": ["launchwright-data"],
                }
            ],
            "resources": {
                "open_files": 256,
                "processes": 32,
                "cpu_seconds": 120,
                "operation_cpu_seconds": 0,
                "address_space_bytes": 4_294_967_296,
                "file_size_bytes": 33_554_432,
            },
            "request_timeout_ms": 15_000,
            "interfaces": {
                "dynamic_capabilities": False,
                "cooperative_cancellation": True,
                "events": False,
                "progress": False,
                "artifacts": False,
                "health": True,
                "native_refs": True,
                "host_tools": True,
            },
        }
        self.manifest_path = self.paths["config"] / "driver.json"
        write_private_json(self.manifest_path, manifest)

        allow = ["driver:launchwright"] if self.allow_driver else []
        config = (
            "drivers = [" + json.dumps(str(self.manifest_path)) + "]\n"
            "driver_network = false\n"
            "[policy]\n"
            'profile = "observe"\n'
            "allow = " + json.dumps(allow) + "\n"
        )
        grants = [
            ("launchwright-runtime", self.paths["launchwright-runtime"], False),
            ("launchwright-data", self.paths["launchwright-data"], True),
            ("launchwright-node", self.node, False),
        ]
        for name, path, writable in grants:
            config += (
                "\n[[policy.filesystem]]\n"
                "name = " + json.dumps(name) + "\n"
                "path = " + json.dumps(str(path)) + "\n"
                "read = true\n"
                "write = " + str(writable).lower() + "\n"
            )
        self.config = self.paths["config"] / "owner.toml"
        self.config.write_text(config, encoding="utf-8")
        self.config.chmod(0o600)

        write_private_json(
            self.evidence / "binary-identities.json",
            {
                "launchwright_driver": sha256(self.driver),
                "node_runtime": sha256(self.node),
                "semwright_cli": sha256(require_binary("semwright")),
                "semwright_daemon": sha256(require_binary("semwrightd")),
                "semwright_sandbox": sha256(require_binary("semwright-sandbox")),
                "profiles": {
                    name: {"sha256": meta["sha256"], "bytes": meta["bytes"]}
                    for name, meta in sorted(self.bundle_manifest["profiles"].items())
                },
            },
        )

    def __enter__(self) -> "HostFixture":
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def start(self) -> None:
        if self.process is not None:
            raise AssertionError("fixture is already running")
        self.attempt += 1
        self.log = (self.evidence / f"daemon-{self.attempt}.log").open("wb")
        self.process = subprocess.Popen(
            [
                str(require_binary("semwrightd")),
                "--config",
                str(self.config),
                "--socket",
                str(self.socket),
            ],
            env=self.env,
            stdin=subprocess.DEVNULL,
            stdout=self.log,
            stderr=self.log,
            start_new_session=True,
        )
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.log.flush()
                raise AssertionError(
                    (self.evidence / f"daemon-{self.attempt}.log").read_text(
                        encoding="utf-8", errors="replace"
                    )
                )
            if self.socket.is_socket():
                return
            time.sleep(0.025)
        raise AssertionError("Semwright daemon did not expose its owner socket")

    def stop(self) -> None:
        if self.process is None:
            return
        pid = self.process.pid
        self.process.terminate()
        try:
            code = self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(pid, signal.SIGKILL)
            self.process.wait(timeout=5)
            raise AssertionError("daemon/Driver Host failed to shut down")
        finally:
            assert self.log is not None
            self.log.close()
            self.process = None
        if code != 0:
            raise AssertionError(f"daemon did not shut down cleanly: {code}")
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return
        os.killpg(pid, signal.SIGKILL)
        raise AssertionError("owned driver descendants survived daemon shutdown")

    def close(self) -> None:
        try:
            self.stop()
        finally:
            write_private_json(self.evidence / "calls.json", self.records)
            self.temp.cleanup()

    def invoke(
        self,
        command: str,
        args: dict[str, Any] | None = None,
        *,
        ok: bool,
    ) -> dict[str, Any]:
        result = subprocess.run(
            [
                str(require_binary("semwright")),
                "--socket",
                str(self.socket),
                "--session-file",
                str(self.session),
                "--json",
                "execute",
                command,
                "--args-json",
                json.dumps(args or {}, ensure_ascii=False, separators=(",", ":")),
            ],
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
        )
        if len(result.stdout) > 1_048_576:
            raise AssertionError("Semwright CLI output budget exceeded")
        try:
            envelope = json.loads(result.stdout)
        except Exception as error:
            raise AssertionError(
                "Semwright CLI did not return JSON: "
                + result.stderr.decode("utf-8", "replace")
            ) from error
        self.records.append(
            {
                "command": command,
                "args": args or {},
                "exit_code": result.returncode,
                "envelope": envelope,
            }
        )
        if bool(envelope.get("ok")) is not ok or ((result.returncode == 0) is not ok):
            raise AssertionError(json.dumps(envelope, indent=2))
        if ok and command.startswith("driver.launchwright."):
            provenance = envelope["execution"]["provenance"]
            if provenance.get("provider") != "driver:launchwright":
                raise AssertionError("execution did not originate from the Launchwright Driver Host")
            if provenance.get("source") != "driver":
                raise AssertionError("execution provenance is not a driver")
            if not provenance.get("descriptor_sha256"):
                raise AssertionError("descriptor digest is missing")
            if provenance.get("provider_generation") is None:
                raise AssertionError("provider generation is missing")
        return envelope


def assert_error(envelope: dict[str, Any], *needles: str) -> None:
    payload = json.dumps(envelope.get("error", {}), ensure_ascii=False).lower()
    if not any(needle.lower() in payload for needle in needles):
        raise AssertionError(f"unexpected error envelope: {json.dumps(envelope, indent=2)}")


def allowed_flow() -> dict[str, Any]:
    fixture = HostFixture("allowed", allow_driver=True)
    try:
        fixture.start()
        first = fixture.invoke(
            "driver.launchwright.observe",
            {"resource": RESOURCE, "scope": "all", "limit": 64},
            ok=True,
        )["data"]
        reference = first["ref"]
        version = first["page"]["version"]

        description = fixture.invoke(
            "driver.launchwright.workspace-describe",
            {"ref": reference, "input": {}},
            ok=True,
        )["data"]
        if description.get("app") != "Launchwright":
            raise AssertionError("unexpected application identity")
        if description.get("native_sdk") != "0.9.0-dev.1":
            raise AssertionError("unexpected Native SDK identity")

        operation = "entity.create"
        input_value = {
            "kind": "product",
            "data": {
                "name": "Driver Host acceptance product",
                "description": "Synthetic owned acceptance state; not a customer asset.",
            },
        }
        epoch = description["request_epoch"]
        key = "native-host-create-product"
        digest_input = {
            "app_version": description["version"],
            "operation": operation,
            "input": input_value,
            "expected": version,
            "epoch": epoch,
            "key": key,
        }
        request = {
            "resource": RESOURCE,
            "epoch": epoch,
            "key": key,
            "request_sha256": request_digest(digest_input),
        }

        created = fixture.invoke(
            "driver.launchwright.entity-create",
            {"ref": reference, "request": request, "input": input_value},
            ok=True,
        )["data"]["entity"]
        product_id = created["id"]

        stale = fixture.invoke(
            "driver.launchwright.workspace-describe",
            {"ref": reference, "input": {}},
            ok=False,
        )
        assert_error(stale, "stale")

        second = fixture.invoke(
            "driver.launchwright.observe",
            {"resource": RESOURCE, "scope": "all", "limit": 64},
            ok=True,
        )["data"]
        second_ref = second["ref"]
        second_version = second["page"]["version"]
        second_description = fixture.invoke(
            "driver.launchwright.workspace-describe",
            {"ref": second_ref, "input": {}},
            ok=True,
        )["data"]

        bad_request = {
            "resource": RESOURCE,
            "epoch": second_description["request_epoch"],
            "key": "native-host-bad-digest",
            "request_sha256": "0" * 64,
        }
        rejected = fixture.invoke(
            "driver.launchwright.entity-create",
            {"ref": second_ref, "request": bad_request, "input": input_value},
            ok=False,
        )
        assert_error(rejected, "digest", "conflict")

        # A known rejection must not advance the workspace revision. This proves
        # the negative case reached the app transaction boundary with a fresh Host ref.
        after_rejection = fixture.invoke(
            "driver.launchwright.workspace-describe",
            {"ref": second_ref, "input": {}},
            ok=True,
        )["data"]
        if after_rejection["workspace_version"] != second_version:
            raise AssertionError("known-rejected request changed Launchwright state")

        readback = fixture.invoke(
            "driver.launchwright.resource-get",
            {"ref": second_ref, "input": {"id": product_id}},
            ok=True,
        )["data"]
        if readback.get("id") != product_id:
            raise AssertionError("created product did not survive canonical Host readback")

        fixture.stop()
        fixture.session.unlink(missing_ok=True)
        fixture.start()

        # Establish a new Broker session and a new NativeDriver observation first.
        # The old ref is then tested inside that live replacement session, matching
        # Semwright's canonical restart/rebind acceptance rather than merely failing
        # because a persisted CLI session file belonged to the old daemon.
        third = fixture.invoke(
            "driver.launchwright.observe",
            {"resource": RESOURCE, "scope": "all", "limit": 64},
            ok=True,
        )["data"]
        if third["ref"] == second_ref:
            raise AssertionError("NativeDriver reused an opaque ref across Host restart")

        old_ref = fixture.invoke(
            "driver.launchwright.resource-get",
            {"ref": second_ref, "input": {"id": product_id}},
            ok=False,
        )
        assert_error(old_ref, "stale", "reference", "generation", "session", "notfound", "not found")

        persisted = fixture.invoke(
            "driver.launchwright.resource-get",
            {"ref": third["ref"], "input": {"id": product_id}},
            ok=True,
        )["data"]
        if persisted.get("data", {}).get("name") != "Driver Host acceptance product":
            raise AssertionError("workspace state did not persist across Driver Host restart")

        return {
            "product_id": product_id,
            "initial_revision": version,
            "final_revision": third["page"]["version"],
            "restart_persistence": True,
            "stale_reference_rejected": True,
            "bad_request_rejected": True,
        }
    finally:
        fixture.close()


def denied_flow() -> dict[str, Any]:
    with HostFixture("policy-denied", allow_driver=False) as fixture:
        denied = fixture.invoke(
            "driver.launchwright.observe",
            {"resource": RESOURCE, "scope": "all", "limit": 16},
            ok=False,
        )
        assert_error(denied, "policy", "permission", "denied", "authorization")
        return {"provider_allowlisted": False, "execution_rejected": True}


def main() -> None:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit("Driver Host acceptance is CI-only")
    EVIDENCE.mkdir(parents=True, exist_ok=True)

    semwright_sha = subprocess.check_output(
        ["git", "-C", str(SEMWRIGHT), "rev-parse", "HEAD"], text=True
    ).strip()
    if semwright_sha != os.environ["SEMWRIGHT_SHA"]:
        raise AssertionError("Semwright checkout differs from the exact Launchwright source lock")

    allowed = allowed_flow()
    denied = denied_flow()
    report = {
        "schema_version": "launchwright-native-host-acceptance/1",
        "passed": True,
        "launchwright_sha": os.environ.get("GITHUB_SHA"),
        "semwright_sha": semwright_sha,
        "native_sdk": "0.9.0-dev.1",
        "authority": {
            "driver_host_isolation_accepted": True,
            "broker_policy_path_observed": True,
            "host_mediated_node_runtime": True,
            "platform_external_acceptance": False,
            "chatgpt_host_acceptance": False,
            "public_channel_acceptance": False,
        },
        "allowed_flow": allowed,
        "policy_denied_flow": denied,
    }
    write_private_json(EVIDENCE / "report.json", report)
    print("LAUNCHWRIGHT_NATIVE_HOST_ACCEPTANCE_PASS " + json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
