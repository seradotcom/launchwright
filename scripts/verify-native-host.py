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
    def __init__(
        self,
        label: str,
        *,
        allow_driver: bool,
        allow_project_graph: bool = True,
    ) -> None:
        self.label = label
        self.allow_driver = allow_driver
        self.allow_project_graph = allow_project_graph
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
            "project-graph-fixture",
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
        self._provision_project_graph_fixture()
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

    def _provision_project_graph_fixture(self) -> None:
        root = self.paths["project-graph-fixture"]
        (root / "source.txt").write_text(
            "Launchwright R21 owned synthetic source.\n", encoding="utf-8"
        )
        (root / "deliverable.txt").write_text(
            "Launchwright R21 owned synthetic deliverable.\n", encoding="utf-8"
        )
        (root / "source.txt").chmod(0o400)
        (root / "deliverable.txt").chmod(0o400)

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

        allow = []
        if self.allow_driver:
            allow.append("driver:launchwright")
        if self.allow_project_graph:
            allow.append("project.manage")
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
            ("project-graph-fixture", self.paths["project-graph-fixture"], False),
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


class HostClient:
    """Fresh-ref helper for exact-digest Launchwright operations over the real Host."""

    def __init__(self, fixture: HostFixture, *, key_prefix: str = "r20") -> None:
        self.fixture = fixture
        self.counter = 0
        self.key_prefix = key_prefix

    def context(self) -> tuple[str, Any, dict[str, Any]]:
        observed = self.fixture.invoke(
            "driver.launchwright.observe",
            {"resource": RESOURCE, "scope": "all", "limit": 128},
            ok=True,
        )["data"]
        ref = observed["ref"]
        description = self.fixture.invoke(
            "driver.launchwright.workspace-describe",
            {"ref": ref, "input": {}},
            ok=True,
        )["data"]
        return ref, observed["page"]["version"], description

    def read(self, suffix: str, input_value: dict[str, Any]) -> dict[str, Any]:
        ref, _, _ = self.context()
        return self.fixture.invoke(
            f"driver.launchwright.{suffix}",
            {"ref": ref, "input": input_value},
            ok=True,
        )["data"]

    def mutate(
        self,
        operation: str,
        suffix: str,
        input_value: dict[str, Any],
        *,
        key_hint: str,
    ) -> dict[str, Any]:
        ref, expected, description = self.context()
        self.counter += 1
        key = f"{self.key_prefix}-{self.counter:02d}-{key_hint}"[:128]
        epoch = description["request_epoch"]
        digest_input = {
            "app_version": description["version"],
            "operation": operation,
            "input": input_value,
            "expected": expected,
            "epoch": epoch,
            "key": key,
        }
        request = {
            "resource": RESOURCE,
            "epoch": epoch,
            "key": key,
            "request_sha256": request_digest(digest_input),
        }
        return self.fixture.invoke(
            f"driver.launchwright.{suffix}",
            {"ref": ref, "request": request, "input": input_value},
            ok=True,
        )["data"]


def extension_lifecycle_flow(fixture: HostFixture, product_id: str) -> dict[str, Any]:
    """Exercise RS-EXT lifecycle through Broker/Policy/Driver Host without elevating fixture execution."""
    client = HostClient(fixture)

    renderer_path = ROOT / "fixtures" / "deltarender.mjs"
    cli_path = ROOT / "fixtures" / "deltacli.mjs"
    renderer_digest = sha256(renderer_path)
    cli_digest = sha256(cli_path)

    renderer_manifest = {
        "name": "DeltaRender Host acceptance",
        "type": "deliverable_renderer",
        "package_version": "1.0.0",
        "schema_major": 1,
        "digest": renderer_digest,
        "license": "AGPL-3.0-only",
        "rights": "owned",
        "source": "repo:fixtures/deltarender.mjs",
        "permissions": ["read", "capture"],
        "inputs": ["deltarender-request/1"],
        "outputs": ["rendered-document/1"],
        "preconditions": ["approved-fixture"],
        "evidence": ["process-receipt"],
        "limits": {"max_input_bytes": 65536, "max_output_bytes": 65536, "timeout_seconds": 10},
    }
    cli_manifest = {
        "name": "DeltaCLI Host acceptance",
        "type": "source_adapter",
        "package_version": "1.0.0",
        "schema_major": 1,
        "digest": cli_digest,
        "license": "AGPL-3.0-only",
        "rights": "owned",
        "source": "repo:fixtures/deltacli.mjs",
        "permissions": ["read", "capture"],
        "inputs": ["cli-source/1"],
        "outputs": ["cli-observation/1"],
        "preconditions": ["approved-source"],
        "evidence": ["process-receipt"],
        "limits": {"max_input_bytes": 4096, "max_output_bytes": 65536, "timeout_seconds": 10},
    }

    renderer = client.mutate(
        "extension.register", "extension-register", renderer_manifest, key_hint="renderer-register"
    )["entity"]
    cli_extension = client.mutate(
        "extension.register", "extension-register", cli_manifest, key_hint="cli-register"
    )["entity"]

    discovered = client.read("extension-discovery", {"include_retired": False})
    discovered_ids = {item["id"] for item in discovered["items"]}
    if renderer["id"] not in discovered_ids or cli_extension["id"] not in discovered_ids:
        raise AssertionError("Host-mediated extension discovery missed an installed package")

    generic = client.read("extension-generic_view", {"id": renderer["id"]})
    if generic.get("remote_code_execution") is not False or generic.get("trusted_markup") is not False:
        raise AssertionError("generic extension view widened authority")

    renderer_prep = client.mutate(
        "extension.prepare_use",
        "extension-prepare_use",
        {
            "extension_id": renderer["id"],
            "name": "Render release note",
            "purpose": "Owned deterministic renderer fixture",
            "input_type": "deltarender-request/1",
            "output_type": "rendered-document/1",
            "client_schema_major": 1,
        },
        key_hint="renderer-prepare",
    )["entity"]

    render_input = {
        "schema_version": "deltarender-request/1",
        "title": "Host lifecycle release 1.0",
        "body": "Owned fixture output recorded through the canonical Launchwright Host path.",
    }
    render_stdin = json.dumps(render_input, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    render_process = subprocess.run(
        [str(fixture.node), str(renderer_path)],
        cwd=ROOT,
        env=fixture.env,
        input=render_stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=10,
    )
    if render_process.returncode != 0:
        raise AssertionError(render_process.stderr.decode("utf-8", "replace"))
    render_output = json.loads(render_process.stdout)
    if render_output.get("format") != "markdown" or render_output.get("rights") != "owned":
        raise AssertionError("DeltaRender fixture returned an unexpected result")

    renderer_result = client.mutate(
        "extension.result_record",
        "extension-result_record",
        {
            "preparation_id": renderer_prep["id"],
            "input_sha256": hashlib.sha256(render_stdin).hexdigest(),
            "output_type": "rendered-document/1",
            "outcome": "SUCCESS",
            "started_at": "2026-10-06T18:00:00.000Z",
            "finished_at": "2026-10-06T18:00:00.100Z",
            "output": render_output,
        },
        key_hint="renderer-result",
    )["entity"]
    renderer_inspect = client.read("extension-result_inspect", {"id": renderer_result["id"]})
    if renderer_inspect.get("technical_state") != "UNKNOWN":
        raise AssertionError("external renderer process was incorrectly promoted to technical PASS")
    if renderer_inspect.get("host_isolation_verified") is not False:
        raise AssertionError("external renderer process was incorrectly marked Host-isolated")
    if renderer_inspect.get("verified_execution") is not False:
        raise AssertionError("external renderer process was incorrectly marked verified")

    release = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "release",
            "data": {"product_id": product_id, "name": "R20 synthetic", "build": "build-A", "status": "draft"},
        },
        key_hint="release-create",
    )["entity"]
    target = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "target",
            "data": {
                "release_id": release["id"],
                "name": "CLI host lifecycle",
                "ui_locale": "en-US",
                "editorial_locale": "en-US",
                "role": "viewer",
                "plan": "basic",
                "region": "MX",
                "flags": {"advanced_export": False},
                "viewport": {"width": 1440, "height": 900, "scale_milli": 1000},
            },
        },
        key_hint="target-create",
    )["entity"]
    source = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "source",
            "data": {
                "product_id": product_id,
                "name": "DeltaCLI",
                "type": "cli",
                "locator": "repo:fixtures/deltacli.mjs",
                "build": "build-A",
                "coverage": "declared",
                "purpose": "Owned CLI fixture for Host lifecycle acceptance",
                "approval": "approved",
            },
        },
        key_hint="source-create",
    )["entity"]

    cli_env = {**fixture.env, "DELTACLI_BUILD": "build-A"}
    cli_process = subprocess.run(
        [str(fixture.node), str(cli_path), "status", "--json"],
        cwd=ROOT,
        env=cli_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=10,
    )
    if cli_process.returncode != 0:
        raise AssertionError(cli_process.stderr.decode("utf-8", "replace"))
    cli_facts = json.loads(cli_process.stdout)
    if cli_facts.get("product") != "DeltaCLI" or cli_facts.get("build") != "build-A":
        raise AssertionError("DeltaCLI fixture returned an unexpected build")

    cli_observation = client.mutate(
        "source.cli_ingest",
        "source-cli_ingest",
        {
            "source_id": source["id"],
            "target_id": target["id"],
            "extension_id": cli_extension["id"],
            "command": "node fixtures/deltacli.mjs",
            "args": ["status", "--json"],
            "observed_build": "build-A",
            "started_at": "2026-10-06T18:00:01.000Z",
            "finished_at": "2026-10-06T18:00:01.100Z",
            "exit_code": 0,
            "stdout": cli_process.stdout.decode("utf-8"),
            "stderr": cli_process.stderr.decode("utf-8"),
        },
        key_hint="cli-ingest",
    )["entity"]
    cli_inspect = client.read("source-cli_inspect", {"id": cli_observation["id"]})
    if cli_inspect.get("technical_state") != "UNKNOWN":
        raise AssertionError("external CLI process was incorrectly promoted to technical PASS")
    if cli_inspect.get("host_isolation_verified") is not False:
        raise AssertionError("external CLI process was incorrectly marked Host-isolated")

    compatibility = client.mutate(
        "compatibility.lock",
        "compatibility-lock",
        {
            "product_id": product_id,
            "name": "R20 extension rehearsal lock",
            "components": [
                {
                    "kind": "renderer",
                    "name": renderer["data"]["name"],
                    "version": renderer["data"]["package_version"],
                    "digest": renderer["data"]["digest"],
                    "resource_id": renderer["id"],
                },
                {
                    "kind": "source-adapter",
                    "name": cli_extension["data"]["name"],
                    "version": cli_extension["data"]["package_version"],
                    "digest": cli_extension["data"]["digest"],
                    "resource_id": cli_extension["id"],
                },
            ],
            "notes": "Owned synthetic extension rehearsal over the exact Host path.",
        },
        key_hint="compat-lock",
    )["entity"]
    lock_before = client.read("compatibility-inspect", {"id": compatibility["id"]})
    if lock_before.get("state") != "CURRENT":
        raise AssertionError("new compatibility lock was not CURRENT")

    old_client = client.read(
        "compatibility-negotiate",
        {"schema_major": 2, "operations": ["future.operation"], "kinds": ["extension_package"]},
    )
    if old_client.get("compatible") is not False:
        raise AssertionError("unsupported schema major was accepted")
    if "future.operation" not in old_client.get("unsupported_operations", []):
        raise AssertionError("unsupported operation was not diagnosed")

    client.mutate(
        "extension.retire",
        "extension-retire",
        {"id": renderer["id"], "expected": renderer["version"], "reason": "R20 renderer retirement rehearsal"},
        key_hint="renderer-retire",
    )
    renderer_prep_after = client.read("extension-preparation_status", {"id": renderer_prep["id"]})
    if renderer_prep_after.get("state") != "REVOKED_FOR_NEW_START":
        raise AssertionError("retired renderer did not revoke prepared new starts")
    renderer_result_after = client.read("extension-result_inspect", {"id": renderer_result["id"]})
    if renderer_result_after.get("freshness") != "REVOKED_EXTENSION":
        raise AssertionError("renderer history was not preserved after retirement")
    lock_after = client.read("compatibility-inspect", {"id": compatibility["id"]})
    if lock_after.get("state") != "DRIFT":
        raise AssertionError("compatibility lock did not surface retirement drift")

    client.mutate(
        "extension.retire",
        "extension-retire",
        {"id": cli_extension["id"], "expected": cli_extension["version"], "reason": "R20 source adapter retirement rehearsal"},
        key_hint="cli-retire",
    )
    cli_after = client.read("source-cli_inspect", {"id": cli_observation["id"]})
    if cli_after.get("freshness") != "REVOKED_EXTENSION":
        raise AssertionError("CLI observation history was not preserved after adapter retirement")

    process_report = {
        "renderer": {
            "fixture_sha256": renderer_digest,
            "stdout_sha256": hashlib.sha256(render_process.stdout).hexdigest(),
            "exit_code": render_process.returncode,
        },
        "cli_source": {
            "fixture_sha256": cli_digest,
            "stdout_sha256": hashlib.sha256(cli_process.stdout).hexdigest(),
            "exit_code": cli_process.returncode,
        },
        "authority": {
            "control_plane_driver_host_admitted": True,
            "fixture_process_driver_host_isolated": False,
            "technical_state_promoted": False,
        },
    }
    write_private_json(fixture.evidence / "extension-lifecycle.json", process_report)

    return {
        "renderer_extension_id": renderer["id"],
        "renderer_result_id": renderer_result["id"],
        "cli_extension_id": cli_extension["id"],
        "cli_observation_id": cli_observation["id"],
        "compatibility_lock_id": compatibility["id"],
        "discovery_visible": True,
        "generic_view_safe": True,
        "unsupported_major_rejected": True,
        "retirement_preserved_history": True,
        "compatibility_retirement_drift_visible": True,
        "control_plane_driver_host_admitted": True,
        "fixture_process_driver_host_isolated": False,
        "technical_state_promoted": False,
    }


def project_graph_host_flow(fixture: HostFixture, product_id: str) -> dict[str, Any]:
    """Exercise Semwright Project Graph through Broker policy and admit its bounded projection through NativeDriver."""
    client = HostClient(fixture, key_prefix="r21")
    release = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "release",
            "data": {
                "product_id": product_id,
                "name": "R21 Project Graph synthetic",
                "build": "graph-build-A",
                "status": "draft",
            },
        },
        key_hint="graph-release",
    )["entity"]
    target = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "target",
            "data": {
                "release_id": release["id"],
                "name": "R21 Graph target",
                "ui_locale": "en-US",
                "editorial_locale": "en-US",
                "role": "viewer",
                "plan": "basic",
                "region": "MX",
                "flags": {"advanced_export": False},
                "viewport": {"width": 1440, "height": 900, "scale_milli": 1000},
            },
        },
        key_hint="graph-target",
    )["entity"]
    source = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "source",
            "data": {
                "product_id": product_id,
                "name": "R21 Graph source",
                "type": "document",
                "locator": "owned:r21/source.txt",
                "build": "graph-build-A",
                "coverage": "declared",
                "purpose": "Owned synthetic Project Graph acceptance source",
                "approval": "approved",
            },
        },
        key_hint="graph-source",
    )["entity"]
    deliverable = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "deliverable",
            "data": {
                "release_id": release["id"],
                "name": "R21 Graph deliverable",
                "target_id": target["id"],
                "format": "markdown",
                "content": "Owned synthetic Project Graph acceptance deliverable.",
                "claim_ids": [],
                "source_ids": [source["id"]],
            },
        },
        key_hint="graph-deliverable",
    )["entity"]

    root = "project-graph-fixture"
    created = fixture.invoke("project.create", {"root": root}, ok=True)["data"]
    if created.get("graph_schema") != 1:
        raise AssertionError("unexpected Project Graph schema")
    project_id = created["project"]
    registered_source = fixture.invoke(
        "project.asset.register",
        {
            "root": root,
            "project": project_id,
            "label": "R21 source",
            "resource_type": "release_source",
            "path": "source.txt",
            "max_bytes": 4096,
        },
        ok=True,
    )["data"]
    registered_deliverable = fixture.invoke(
        "project.asset.register",
        {
            "root": root,
            "project": project_id,
            "label": "R21 deliverable",
            "resource_type": "release_deliverable",
            "path": "deliverable.txt",
            "max_bytes": 4096,
        },
        ok=True,
    )["data"]
    source_asset = registered_source["result"]["asset"]["id"]
    deliverable_asset = registered_deliverable["result"]["asset"]["id"]
    declared = fixture.invoke(
        "project.edge.declare",
        {
            "root": root,
            "project": project_id,
            "from": source_asset,
            "to": deliverable_asset,
            "relation": "references",
        },
        ok=True,
    )["data"]
    if declared["result"].get("execution_certified") is not False:
        raise AssertionError("declared Project Graph edge was incorrectly execution-certified")

    budget = {"nodes": 64, "edges": 128, "depth": 16, "results": 64}
    queried = fixture.invoke(
        "project.query", {"root": root, "project": project_id, "limit": 64}, ok=True
    )["data"]
    impact = fixture.invoke(
        "project.impact",
        {"root": root, "project": project_id, "asset": source_asset, "budget": budget},
        ok=True,
    )["data"]
    exported = fixture.invoke(
        "project.manifest.export",
        {"root": root, "project": project_id, "assets": [source_asset, deliverable_asset]},
        ok=True,
    )["data"]
    page = queried["result"]
    report = impact["result"]
    manifest = exported["result"]
    if page.get("next_cursor") is not None or page.get("truncated"):
        raise AssertionError("R21 Project Graph query did not exhaust the authorized visible page")
    if page.get("scope_partial") is not True:
        raise AssertionError("R21 Project Graph file-scoped query did not preserve its partial-scope marker")
    if report.get("cancelled"):
        raise AssertionError("R21 Project Graph traversal was cancelled")
    if manifest.get("source_project") != project_id:
        raise AssertionError("portable declaration manifest belongs to another Project Graph")

    resource_by_asset = {source_asset: source["id"], deliverable_asset: deliverable["id"]}
    item_by_asset = {item["asset"]["id"]: item for item in page["items"]}
    if set(item_by_asset) != set(resource_by_asset):
        raise AssertionError("Project Graph query did not enumerate the exact authorized fixture assets")

    assets = []
    for asset_id in (source_asset, deliverable_asset):
        item = item_by_asset[asset_id]
        knowledge = item["knowledge"]
        assets.append(
            {
                "asset_id": asset_id,
                "resource_id": resource_by_asset[asset_id],
                "revision": item.get("latest_revision"),
                "knowledge": {
                    "existence": knowledge["existence"],
                    "freshness": knowledge["freshness"],
                    "divergence": knowledge["divergence"],
                    "verification": knowledge["verification"],
                    "coverage": {
                        "complete": knowledge["coverage"]["complete"],
                        "unknown_frontier": sorted(knowledge["coverage"]["unknown_frontier"]),
                    },
                    "observed_unix_ms": knowledge.get("observed_unix_ms"),
                    "requires_reconcile": knowledge["requires_reconcile"],
                },
            }
        )

    declarations = manifest.get("declarations", [])
    edges = [
        {
            "from": edge["from"],
            "to": edge["to"],
            "relation": edge["relation"],
            "evidence_kind": "declared",
            "evidence_id": f"project-manifest:{manifest['source_snapshot']}:{index}",
        }
        for index, edge in enumerate(declarations, start=1)
    ]
    if not any(
        edge["from"] == source_asset
        and edge["to"] == deliverable_asset
        and edge["relation"] == "references"
        for edge in edges
    ):
        raise AssertionError("canonical Project Graph export lost the declared dependency")

    projection_epoch = hashlib.sha256(
        f"{project_id}:{report['snapshot']}:{os.environ['SEMWRIGHT_SHA']}".encode("utf-8")
    ).hexdigest()
    graph_observation = {
        "schema_version": "semwright-project-graph-observation/1",
        "source_sha": os.environ["SEMWRIGHT_SHA"],
        "project_graph_schema_version": created["graph_schema"],
        "project_id": project_id,
        "observation_epoch": "host-snapshot-" + projection_epoch[:32],
        "source_asset_id": source_asset,
        "budget": budget,
        "impact": report,
        "assets": assets,
        "edges": edges,
        "inventory": {
            "visible_total": len(page["items"]),
            "enumerated_total": len(page["items"]),
            # Semwright file_scope intentionally marks the query partial relative to
            # the whole Project Graph even when this bounded page is exhausted.
            # Preserve that upstream uncertainty instead of manufacturing a safe
            # percentage denominator inside Launchwright.
            "denominator_complete": False,
            "scope_partial": bool(page["scope_partial"]),
            "truncated": bool(page["truncated"]),
        },
    }
    transcript = {
        "schema_version": "launchwright-project-graph-host-transcript/1",
        "semwright_sha": os.environ["SEMWRIGHT_SHA"],
        "project_create": created,
        "source_register": registered_source,
        "deliverable_register": registered_deliverable,
        "edge_declare": declared,
        "query": queried,
        "impact": impact,
        "manifest_export": exported,
        "projection": graph_observation,
    }
    receipt_sha = hashlib.sha256(exact_json(transcript).encode("utf-8")).hexdigest()
    write_private_json(fixture.evidence / "project-graph-host.json", {**transcript, "transcript_sha256": receipt_sha})

    work = client.mutate(
        "work.prepare",
        "work-prepare",
        {
            "release_id": release["id"],
            "name": "R21 canonical Project Graph observation",
            "action": "graph.observation",
            "arguments": {
                "project_id": project_id,
                "source_asset_id": source_asset,
                "snapshot": report["snapshot"],
            },
            "budget": {"max_cost_microunits": 0, "currency": "USD", "max_runtime_seconds": 60},
        },
        key_hint="graph-work",
    )["entity"]
    claimed = client.mutate(
        "work.claim",
        "work-claim",
        {
            "id": work["id"],
            "prepared_record": {
                "schema_version": "launchwright-project-graph-host-prepared/1",
                "project_id": project_id,
                "transcript_sha256": receipt_sha,
            },
        },
        key_hint="graph-claim",
    )
    completed = client.mutate(
        "work.complete",
        "work-complete",
        {
            "id": work["id"],
            "pending_digest": claimed["pending_digest"],
            "result": {
                "job_id": "project-graph-" + receipt_sha[:40],
                "admission": "canonical-owner-admitted",
                "native_receipt_sha256": receipt_sha,
                "graph_observation": graph_observation,
            },
        },
        key_hint="graph-complete",
    )["entity"]
    if completed["data"].get("evidence_trust") != "NOT_ADMITTED":
        raise AssertionError("generic work custody unexpectedly self-admitted evidence")

    recorded = client.mutate(
        "graph.observation_record",
        "graph-observation_record",
        {
            "release_id": release["id"],
            "name": "R21 live Semwright Project Graph projection",
            "work_id": work["id"],
        },
        key_hint="graph-record",
    )["entity"]
    inspected = client.read("graph-inspect", {"id": recorded["id"]})
    release_impact = client.read("release-impact", {"release_id": release["id"]})
    if inspected.get("canonical_graph_authority") is not True:
        raise AssertionError("Host-admitted Project Graph projection was not canonical inside Launchwright")
    if inspected.get("project_id") != project_id or release_impact.get("graph", {}).get("project_id") != project_id:
        raise AssertionError("Launchwright did not retain the exact canonical Project Graph identity")
    if release_impact.get("coverage") != "CANONICAL_PROJECT_GRAPH_PROJECTION":
        raise AssertionError("release impact did not consume the admitted Project Graph projection")

    fixture.stop()
    fixture.session.unlink(missing_ok=True)
    fixture.start()
    after_restart = fixture.invoke(
        "project.query", {"root": root, "project": project_id, "limit": 64}, ok=True
    )["data"]["result"]
    if len(after_restart.get("items", [])) != 2:
        raise AssertionError("Project Graph state did not survive daemon restart")
    persisted = client.read("graph-inspect", {"id": recorded["id"]})
    if persisted.get("project_id") != project_id:
        raise AssertionError("Launchwright Graph projection did not survive Driver Host restart")

    return {
        "project_id": project_id,
        "graph_observation_id": recorded["id"],
        "release_id": release["id"],
        "source_asset_id": source_asset,
        "deliverable_asset_id": deliverable_asset,
        "snapshot": report["snapshot"],
        "transcript_sha256": receipt_sha,
        "broker_project_graph_live": True,
        "native_driver_projection_recorded": True,
        "restart_persistence": True,
        "platform_job_authority": False,
        "external_publish_authority": False,
    }


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

        extension_lifecycle = extension_lifecycle_flow(fixture, product_id)
        project_graph = project_graph_host_flow(fixture, product_id)

        return {
            "product_id": product_id,
            "initial_revision": version,
            "final_revision": client_revision(fixture),
            "restart_persistence": True,
            "stale_reference_rejected": True,
            "bad_request_rejected": True,
            "extension_lifecycle": extension_lifecycle,
            "project_graph": project_graph,
        }
    finally:
        fixture.close()


def client_revision(fixture: HostFixture) -> Any:
    observed = fixture.invoke(
        "driver.launchwright.observe",
        {"resource": RESOURCE, "scope": "all", "limit": 16},
        ok=True,
    )["data"]
    return observed["page"]["version"]


def denied_flow() -> dict[str, Any]:
    with HostFixture("policy-denied", allow_driver=False) as fixture:
        denied = fixture.invoke(
            "driver.launchwright.observe",
            {"resource": RESOURCE, "scope": "all", "limit": 16},
            ok=False,
        )
        assert_error(denied, "policy", "permission", "denied", "authorization")
        return {"provider_allowlisted": False, "execution_rejected": True}


def project_graph_denied_flow() -> dict[str, Any]:
    with HostFixture(
        "project-graph-policy-denied", allow_driver=True, allow_project_graph=False
    ) as fixture:
        denied = fixture.invoke(
            "project.create", {"root": "project-graph-fixture"}, ok=False
        )
        assert_error(denied, "policy", "permission", "denied", "authorization")
        return {"project_manage_allowlisted": False, "execution_rejected": True}


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
    graph_denied = project_graph_denied_flow()
    report = {
        "schema_version": "launchwright-native-host-acceptance/3",
        "passed": True,
        "launchwright_sha": os.environ.get("GITHUB_SHA"),
        "semwright_sha": semwright_sha,
        "native_sdk": "0.9.0-dev.1",
        "authority": {
            "driver_host_isolation_accepted": True,
            "broker_policy_path_observed": True,
            "host_mediated_node_runtime": True,
            "extension_control_plane_driver_host_accepted": True,
            "extension_fixture_execution_host_isolation_accepted": False,
            "project_graph_live_broker_admitted": True,
            "project_graph_native_projection_recorded": True,
            "project_graph_platform_job_authority": False,
            "platform_external_acceptance": False,
            "chatgpt_host_acceptance": False,
            "public_channel_acceptance": False,
        },
        "allowed_flow": allowed,
        "policy_denied_flow": denied,
        "project_graph_policy_denied_flow": graph_denied,
    }
    write_private_json(EVIDENCE / "report.json", report)
    print("LAUNCHWRIGHT_NATIVE_HOST_ACCEPTANCE_PASS " + json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
