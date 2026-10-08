#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""R28 exact-SHA extension execution through Semwright Broker/Policy/Driver Host.

The accepted authority is intentionally narrow: the two Launchwright-owned deterministic
fixtures DeltaRender and DeltaCLI status. The provider cannot select arbitrary executables,
scripts, environment, paths, argv or network access. The resulting Host receipt is then
admitted by the isolated Launchwright Native SDK extension_runtime profile.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SEMWRIGHT = Path(os.environ["SEMWRIGHT_CHECKOUT"]).resolve()
EXTENSION_BINARY = Path(os.environ["LAUNCHWRIGHT_EXTENSION_BINARY"]).resolve()
EVIDENCE = ROOT / "evidence" / "extension-runtime"
SEMWRIGHT_SHA = os.environ["SEMWRIGHT_SHA"]

spec = importlib.util.spec_from_file_location(
    "launchwright_native_host_acceptance", ROOT / "scripts" / "verify-native-host.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load Native Host acceptance helpers")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.EVIDENCE = EVIDENCE


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_json(argv: list[str], env: dict[str, str]) -> dict[str, Any]:
    result = subprocess.run(
        argv,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=40,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"command failed ({result.returncode}): {' '.join(argv)}\n"
            + result.stdout
            + "\n"
            + result.stderr
        )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise AssertionError("command did not return JSON: " + result.stdout) from error


class ExtensionFixture(host.HostFixture):
    def __init__(self, label: str, *, allow_extension: bool) -> None:
        self.allow_extension = allow_extension
        super().__init__(label, allow_driver=True, allow_project_graph=False)

    def _stage_driver(self) -> None:
        super()._stage_driver()
        target = self.paths["binary"] / "launchwright-extension-driver"
        shutil.copyfile(EXTENSION_BINARY, target)
        target.chmod(0o500)
        self.extension_driver = target

    def _stage_runtime(self) -> None:
        super()._stage_runtime()
        target = self.paths["binary"] / "node-extension-provider"
        shutil.copyfile(self.node, target)
        target.chmod(0o500)
        self.provider_node = target

    def _write_manifest_and_policy(self) -> None:
        super()._write_manifest_and_policy()
        manifest = {
            "manifest_version": 1,
            "protocol": 5,
            "id": "launchwright-extension",
            "version": "0.2.0-dev.1",
            "publisher": "launchwright-owned-extension-r28",
            "executable": str(self.extension_driver),
            "sha256": host.sha256(self.extension_driver),
            "application": {
                "desktop_id": None,
                "process_names": ["launchwright-extension-driver"],
                "supported_versions": [],
            },
            "transport": "stdio_v1",
            "network": False,
            "mounts": [],
            "tools": [
                {
                    "root": "launchwright-extension-provider-node",
                    "name": "node-extension-provider",
                    "sha256": host.sha256(self.provider_node),
                    "mounts": [],
                }
            ],
            "resources": {
                "open_files": 64,
                "processes": 16,
                "cpu_seconds": 45,
                "operation_cpu_seconds": 0,
                "address_space_bytes": 2_147_483_648,
                "file_size_bytes": 16_777_216,
            },
            "request_timeout_ms": 15_000,
            "interfaces": {
                "dynamic_capabilities": False,
                "cooperative_cancellation": False,
                "events": False,
                "progress": False,
                "artifacts": False,
                "health": True,
                "native_refs": False,
                "host_tools": True,
            },
        }
        self.extension_manifest_path = self.paths["config"] / "extension-driver.json"
        host.write_private_json(self.extension_manifest_path, manifest)

        conformance = copy.deepcopy(manifest)
        conformance["tools"] = []
        conformance["interfaces"]["host_tools"] = False
        self.extension_conformance_manifest_path = (
            self.paths["config"] / "extension-driver-conformance.json"
        )
        host.write_private_json(self.extension_conformance_manifest_path, conformance)

        allow = ["driver:launchwright"]
        if self.allow_extension:
            allow.append("driver:launchwright-extension")
        config = (
            "drivers = "
            + json.dumps([str(self.manifest_path), str(self.extension_manifest_path)])
            + "\n"
            + "driver_network = false\n"
            + "[policy]\n"
            + 'profile = "observe"\n'
            + "allow = "
            + json.dumps(allow)
            + "\n"
        )
        grants = [
            ("launchwright-runtime", self.paths["launchwright-runtime"], False),
            ("launchwright-data", self.paths["launchwright-data"], True),
            ("verification-receipts", self.paths["verification-receipts"], False),
            ("extension-receipts", self.paths["extension-receipts"], False),
            ("effects-receipts", self.paths["effects-receipts"], False),
            ("launchwright-node", self.node, False),
            ("launchwright-verifier-node", self.verifier_node, False),
            ("launchwright-extension-runtime-node", self.extension_node, False),
            ("launchwright-effects-runtime-node", self.effects_node, False),
            ("launchwright-extension-provider-node", self.provider_node, False),
            ("project-graph-fixture", self.paths["project-graph-fixture"], False),
        ]
        for name, path, writable in grants:
            config += (
                "\n[[policy.filesystem]]\n"
                + "name = "
                + json.dumps(name)
                + "\npath = "
                + json.dumps(str(path))
                + "\nread = true\nwrite = "
                + str(writable).lower()
                + "\n"
            )
        self.config.write_text(config, encoding="utf-8")
        self.config.chmod(0o600)
        host.write_private_json(
            self.evidence / "extension-provider-identity.json",
            {
                "extension_driver": host.sha256(self.extension_driver),
                "provider_node_runtime": host.sha256(self.provider_node),
                "manifest": host.sha256(self.extension_manifest_path),
            },
        )


def provider_execute(
    fixture: ExtensionFixture,
    command: str,
    args: dict[str, Any],
    *,
    expected_ok: bool,
) -> dict[str, Any]:
    envelope = fixture.invoke(command, args, ok=expected_ok)
    if expected_ok:
        provenance = envelope["execution"]["provenance"]
        if provenance.get("provider") != "driver:launchwright-extension":
            raise AssertionError("extension execution did not originate from the extension Driver")
        if provenance.get("source") != "driver":
            raise AssertionError("extension execution provenance is not a driver")
        if not provenance.get("descriptor_sha256"):
            raise AssertionError("extension descriptor digest is missing")
        if provenance.get("provider_generation") is None:
            raise AssertionError("extension provider generation is missing")
        if provenance.get("provider_version") != "0.2.0-dev.1":
            raise AssertionError("extension provider version differs from the reviewed binary")
    return envelope


def write_runtime_receipt(
    fixture: ExtensionFixture,
    command: str,
    envelope: dict[str, Any],
    name: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    provenance = envelope["execution"]["provenance"]
    observed_at = utc_now()
    receipt = {
        "schema_version": "launchwright-extension-runtime/1",
        "observed_at": observed_at,
        "semwright_sha": SEMWRIGHT_SHA,
        "provider": "driver:launchwright-extension",
        "provider_version": provenance["provider_version"],
        "provider_generation": provenance["provider_generation"],
        "descriptor_sha256": provenance["descriptor_sha256"],
        "executable_sha256": host.sha256(fixture.extension_driver),
        "command": command,
        "broker_policy_path_observed": True,
        "driver_host_isolation_accepted": True,
        "platform_execution_authority": False,
        "external_customer_acceptance": False,
        "report": envelope["data"],
    }
    path = fixture.paths["extension-receipts"] / name
    host.write_private_json(path, receipt)
    return receipt, {"file": path.name, "sha256": host.sha256(path)}


def mutate_expect_fail(
    client: host.HostClient,
    operation: str,
    suffix: str,
    input_value: dict[str, Any],
    key_hint: str,
) -> dict[str, Any]:
    ref, expected, description = client.context()
    client.counter += 1
    key = f"{client.key_prefix}-{client.counter:02d}-{key_hint}"[:128]
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
        "resource": host.RESOURCE,
        "epoch": epoch,
        "key": key,
        "request_sha256": host.request_digest(digest_input),
    }
    return client.fixture.invoke(
        f"driver.launchwright.{suffix}",
        {"ref": ref, "request": request, "input": input_value},
        ok=False,
    )


def extension_manifest(
    *,
    name: str,
    kind: str,
    source: str,
    digest: str,
    input_type: str,
    output_type: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "type": kind,
        "package_version": "1.0.0",
        "schema_major": 1,
        "digest": digest,
        "license": "AGPL-3.0-only",
        "rights": "owned",
        "source": source,
        "permissions": ["read", "capture"],
        "inputs": [input_type],
        "outputs": [output_type],
        "preconditions": ["approved-fixture"],
        "evidence": ["driver-host-receipt"],
        "limits": {
            "max_input_bytes": 65536,
            "max_output_bytes": 65536,
            "timeout_seconds": 10,
        },
    }


def create_release_context(
    client: host.HostClient, product_id: str
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    release = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "release",
            "data": {
                "product_id": product_id,
                "name": "R28 extension runtime",
                "build": "build-A",
                "status": "draft",
            },
        },
        key_hint="release",
    )["entity"]
    target = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "target",
            "data": {
                "release_id": release["id"],
                "name": "R28 CLI target",
                "ui_locale": "en-US",
                "editorial_locale": "en-US",
                "role": "viewer",
                "plan": "basic",
                "region": "CI",
                "flags": {},
                "viewport": {"width": 1280, "height": 720, "scale_milli": 1000},
            },
        },
        key_hint="target",
    )["entity"]
    source = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "source",
            "data": {
                "product_id": product_id,
                "name": "DeltaCLI R28",
                "type": "cli",
                "locator": "repo:fixtures/deltacli.mjs",
                "build": "build-A",
                "coverage": "declared",
                "purpose": "Owned CLI fixture for canonical extension runtime acceptance",
                "approval": "approved",
            },
        },
        key_hint="source",
    )["entity"]
    return release, target, source


def allowed_flow() -> dict[str, Any]:
    fixture = ExtensionFixture("allowed", allow_extension=True)
    try:
        cli = str(host.require_binary("semwright"))
        validate = run_json(
            [cli, "--json", "driver", "validate", str(fixture.extension_manifest_path)],
            fixture.env,
        )
        conformance = run_json(
            [
                cli,
                "--json",
                "driver",
                "conformance",
                str(fixture.extension_conformance_manifest_path),
            ],
            fixture.env,
        )
        if validate.get("valid") is not True:
            raise AssertionError("extension provider manifest did not validate")
        if (
            conformance.get("provider") != "driver:launchwright-extension"
            or conformance.get("capabilities") != 3
            or conformance.get("sandboxed") is not True
            or conformance.get("executed_read_only") is not True
            or conformance.get("shutdown") is not True
        ):
            raise AssertionError("extension provider conformance report is incomplete")

        fixture.start()
        client = host.HostClient(fixture, key_prefix="r28")
        product = client.mutate(
            "entity.create",
            "entity-create",
            {
                "kind": "product",
                "data": {
                    "name": "R28 extension runtime fixture",
                    "description": "Owned deterministic acceptance fixture",
                },
            },
            key_hint="product",
        )["entity"]

        renderer_digest = host.sha256(ROOT / "fixtures" / "deltarender.mjs")
        cli_digest = host.sha256(ROOT / "fixtures" / "deltacli.mjs")
        renderer = client.mutate(
            "extension.register",
            "extension-register",
            extension_manifest(
                name="DeltaRender R28",
                kind="deliverable_renderer",
                source="repo:fixtures/deltarender.mjs",
                digest=renderer_digest,
                input_type="deltarender-request/1",
                output_type="rendered-document/1",
            ),
            key_hint="renderer-register",
        )["entity"]
        renderer_prep = client.mutate(
            "extension.prepare_use",
            "extension-prepare_use",
            {
                "extension_id": renderer["id"],
                "name": "R28 canonical render",
                "purpose": "Execute the owned renderer under Driver Host",
                "input_type": "deltarender-request/1",
                "output_type": "rendered-document/1",
                "client_schema_major": 1,
            },
            key_hint="renderer-prep",
        )["entity"]

        render_input = {
            "schema_version": "deltarender-request/1",
            "title": "R28 Host-rendered release",
            "body": "Exact owned fixture execution through the extension Driver Host provider.",
        }
        render_stdin = json.dumps(
            render_input, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        render_envelope = provider_execute(
            fixture,
            "driver.launchwright-extension.render",
            {
                "expected_fixture_sha256": renderer_digest,
                "stdin": render_stdin.decode("utf-8"),
            },
            expected_ok=True,
        )
        render_report = render_envelope["data"]
        if (
            render_report.get("kind") != "renderer"
            or render_report.get("input_sha256") != sha256_bytes(render_stdin)
            or render_report.get("output_type") != "rendered-document/1"
        ):
            raise AssertionError("extension provider renderer report lost exact bindings")
        render_receipt, render_ref = write_runtime_receipt(
            fixture,
            "driver.launchwright-extension.render",
            render_envelope,
            "r28-render.json",
        )
        renderer_input = {
            "preparation_id": renderer_prep["id"],
            "input_sha256": render_report["input_sha256"],
            "output_type": "rendered-document/1",
            "outcome": "SUCCESS",
            "started_at": render_receipt["observed_at"],
            "finished_at": render_receipt["observed_at"],
            "output": render_report["output"],
            "runtime_receipt": render_ref,
        }
        renderer_result = client.mutate(
            "extension.result_record",
            "extension-result_record",
            renderer_input,
            key_hint="renderer-result",
        )["entity"]
        renderer_inspect = client.read(
            "extension-result_inspect", {"id": renderer_result["id"]}
        )
        if (
            renderer_result["data"].get("technical_state") != "PASS"
            or renderer_inspect.get("technical_state") != "PASS"
            or renderer_inspect.get("verified_execution") is not True
            or renderer_inspect.get("host_isolation_verified") is not True
        ):
            raise AssertionError("canonical renderer execution was not admitted as bounded PASS")

        wrong_digest = provider_execute(
            fixture,
            "driver.launchwright-extension.render",
            {
                "expected_fixture_sha256": "0" * 64,
                "stdin": render_stdin.decode("utf-8"),
            },
            expected_ok=False,
        )
        host.assert_error(wrong_digest, "digest", "conflict", "registered")

        crossed = copy.deepcopy(render_receipt)
        crossed["command"] = "driver.launchwright-extension.cli-status"
        crossed_path = fixture.paths["extension-receipts"] / "r28-crossed-command.json"
        host.write_private_json(crossed_path, crossed)
        crossed_input = copy.deepcopy(renderer_input)
        crossed_input["runtime_receipt"] = {
            "file": crossed_path.name,
            "sha256": host.sha256(crossed_path),
        }
        crossed_result = mutate_expect_fail(
            client,
            "extension.result_record",
            "extension-result_record",
            crossed_input,
            "crossed-command",
        )
        host.assert_error(crossed_result, "command", "permission", "admitted")

        release, target, source = create_release_context(client, product["id"])
        cli_extension = client.mutate(
            "extension.register",
            "extension-register",
            extension_manifest(
                name="DeltaCLI R28",
                kind="source_adapter",
                source="repo:fixtures/deltacli.mjs",
                digest=cli_digest,
                input_type="cli-source/1",
                output_type="cli-observation/1",
            ),
            key_hint="cli-register",
        )["entity"]
        cli_envelope = provider_execute(
            fixture,
            "driver.launchwright-extension.cli-status",
            {
                "expected_fixture_sha256": cli_digest,
                "expected_build": "build-A",
            },
            expected_ok=True,
        )
        cli_report = cli_envelope["data"]
        if (
            cli_report.get("kind") != "cli"
            or cli_report.get("observed_build") != "build-A"
            or cli_report.get("facts", {}).get("product") != "DeltaCLI"
        ):
            raise AssertionError("extension provider CLI report lost exact build facts")
        cli_receipt, cli_ref = write_runtime_receipt(
            fixture,
            "driver.launchwright-extension.cli-status",
            cli_envelope,
            "r28-cli.json",
        )
        cli_input = {
            "source_id": source["id"],
            "target_id": target["id"],
            "extension_id": cli_extension["id"],
            "command": "driver.launchwright-extension.cli-status",
            "args": ["status", "--json"],
            "observed_build": "build-A",
            "started_at": cli_receipt["observed_at"],
            "finished_at": cli_receipt["observed_at"],
            "exit_code": cli_report["exit_code"],
            "stdout": cli_report["stdout"],
            "stderr": cli_report["stderr"],
            "runtime_receipt": cli_ref,
        }
        cli_observation = client.mutate(
            "source.cli_ingest",
            "source-cli_ingest",
            cli_input,
            key_hint="cli-ingest",
        )["entity"]
        cli_inspect = client.read("source-cli_inspect", {"id": cli_observation["id"]})
        if (
            cli_inspect.get("technical_state") != "PASS"
            or cli_inspect.get("verified_execution") is not True
            or cli_inspect.get("host_isolation_verified") is not True
        ):
            raise AssertionError("canonical CLI execution was not admitted as bounded PASS")

        wrong_build = provider_execute(
            fixture,
            "driver.launchwright-extension.cli-status",
            {
                "expected_fixture_sha256": cli_digest,
                "expected_build": "build-B",
            },
            expected_ok=False,
        )
        host.assert_error(wrong_build, "build", "stale", "reference")

        client.mutate(
            "extension.retire",
            "extension-retire",
            {
                "id": renderer["id"],
                "expected": renderer["version"],
                "reason": "R28 renderer retirement freshness control",
            },
            key_hint="renderer-retire",
        )
        renderer_stale = client.read(
            "extension-result_inspect", {"id": renderer_result["id"]}
        )
        if (
            renderer_stale.get("freshness") != "REVOKED_EXTENSION"
            or renderer_stale.get("technical_state") != "UNKNOWN"
            or renderer_stale.get("host_isolation_verified") is not True
        ):
            raise AssertionError("renderer retirement did not invalidate current PASS")

        client.mutate(
            "extension.retire",
            "extension-retire",
            {
                "id": cli_extension["id"],
                "expected": cli_extension["version"],
                "reason": "R28 CLI retirement freshness control",
            },
            key_hint="cli-retire",
        )
        cli_stale = client.read("source-cli_inspect", {"id": cli_observation["id"]})
        if (
            cli_stale.get("freshness") != "REVOKED_EXTENSION"
            or cli_stale.get("technical_state") != "UNKNOWN"
            or cli_stale.get("host_isolation_verified") is not True
        ):
            raise AssertionError("CLI retirement did not invalidate current PASS")

        return {
            "manifest_validated": True,
            "conformance": conformance,
            "product_id": product["id"],
            "release_id": release["id"],
            "renderer_extension_id": renderer["id"],
            "renderer_result_id": renderer_result["id"],
            "renderer_fixture_sha256": renderer_digest,
            "renderer_receipt_sha256": render_ref["sha256"],
            "renderer_driver_host_pass": True,
            "renderer_retirement_invalidated_pass": True,
            "cli_extension_id": cli_extension["id"],
            "cli_observation_id": cli_observation["id"],
            "cli_fixture_sha256": cli_digest,
            "cli_receipt_sha256": cli_ref["sha256"],
            "cli_driver_host_pass": True,
            "cli_retirement_invalidated_pass": True,
            "fixture_digest_substitution_rejected": True,
            "cli_build_drift_rejected": True,
            "cross_command_receipt_rejected": True,
            "provider_executable_sha256": host.sha256(fixture.extension_driver),
        }
    finally:
        fixture.close()


def denied_flow() -> dict[str, Any]:
    with ExtensionFixture("policy-denied", allow_extension=False) as fixture:
        denied = fixture.invoke(
            "driver.launchwright-extension.probe", {}, ok=False
        )
        host.assert_error(denied, "policy", "permission", "denied", "authorization")
        return {
            "provider_allowlisted": False,
            "execution_rejected": True,
        }


def main() -> None:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit("R28 extension runtime acceptance is CI-only")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    observed_sha = subprocess.check_output(
        ["git", "-C", str(SEMWRIGHT), "rev-parse", "HEAD"], text=True
    ).strip()
    if observed_sha != SEMWRIGHT_SHA:
        raise AssertionError("Semwright checkout differs from the Launchwright source lock")
    if not EXTENSION_BINARY.is_file():
        raise AssertionError("Launchwright extension provider binary is unavailable")

    allowed = allowed_flow()
    denied = denied_flow()
    report = {
        "schema_version": "launchwright-extension-runtime-acceptance/1",
        "passed": True,
        "launchwright_sha": os.environ.get("GITHUB_SHA"),
        "semwright_sha": observed_sha,
        "native_sdk": "1.0.0",
        "authority": {
            "scope": "owned-deltarender-deltacli-only",
            "extension_provider_driver_host_isolation_accepted": True,
            "renderer_execution_driver_host_isolated": True,
            "cli_execution_driver_host_isolated": True,
            "native_sdk_receipt_admission": True,
            "fixture_digest_substitution_rejected": True,
            "cli_build_drift_rejected": True,
            "cross_command_receipt_rejected": True,
            "arbitrary_extension_execution": False,
            "third_party_extension_execution_authority": False,
            "mobile_device_execution_authority": False,
            "platform_execution_authority": False,
            "external_customer_acceptance": False,
            "publication_authority": False,
        },
        "allowed_flow": allowed,
        "policy_denied_flow": denied,
    }
    host.write_private_json(EVIDENCE / "report.json", report)
    print(
        "LAUNCHWRIGHT_EXTENSION_RUNTIME_ACCEPTANCE_PASS "
        + json.dumps(report, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
