#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""R29 canonical Native SDK Effects evaluation through Semwright Driver Host.

Authority is intentionally narrow: the pinned Semwright v1.0.0 immutable-artifact
Effects reader is linked into one fixed Launchwright Driver SDK provider. The caller
supplies only a protected-spec digest. Owner grants fix the protected spec, artifact
root and Launchwright state roots. The resulting Host receipt is admitted only through
Launchwright's isolated effects_runtime Native profile.
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
EFFECTS_DRIVER_BINARY = Path(os.environ["LAUNCHWRIGHT_EFFECTS_BINARY"]).resolve()
EVIDENCE = ROOT / "evidence" / "effects-runtime"
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
        timeout=45,
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


class EffectsFixture(host.HostFixture):
    def __init__(self, label: str, *, allow_effects: bool) -> None:
        self.allow_effects = allow_effects
        super().__init__(label, allow_driver=True, allow_project_graph=False)

    def _stage_driver(self) -> None:
        super()._stage_driver()
        target = self.paths["binary"] / "launchwright-effects-driver"
        shutil.copyfile(EFFECTS_DRIVER_BINARY, target)
        target.chmod(0o500)
        self.effects_driver = target

    def _stage_runtime(self) -> None:
        super()._stage_runtime()
        for name in ("effects-protected", "effects-artifacts"):
            path = self.root / name
            path.mkdir(mode=0o700)
            self.paths[name] = path

    def _write_manifest_and_policy(self) -> None:
        super()._write_manifest_and_policy()
        manifest = {
            "manifest_version": 1,
            "protocol": 5,
            "id": "launchwright-effects",
            "version": "0.2.0-dev.1",
            "publisher": "launchwright-owned-effects-r29",
            "executable": str(self.effects_driver),
            "sha256": host.sha256(self.effects_driver),
            "application": {
                "desktop_id": None,
                "process_names": ["launchwright-effects-driver"],
                "supported_versions": [],
            },
            "transport": "stdio_v1",
            "network": False,
            "mounts": [
                {"root": "launchwright-data", "read_only": True, "execute": False},
                {"root": "effects-protected", "read_only": True, "execute": False},
                {"root": "effects-artifacts", "read_only": True, "execute": False},
            ],
            "tools": [],
            "resources": {
                "open_files": 64,
                "processes": 8,
                "cpu_seconds": 30,
                "operation_cpu_seconds": 0,
                "address_space_bytes": 1_073_741_824,
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
                "host_tools": False,
            },
        }
        self.effects_manifest_path = self.paths["config"] / "effects-driver.json"
        host.write_private_json(self.effects_manifest_path, manifest)

        conformance = copy.deepcopy(manifest)
        conformance["mounts"] = []
        self.effects_conformance_manifest_path = self.paths["config"] / "effects-conformance.json"
        host.write_private_json(self.effects_conformance_manifest_path, conformance)

        allow = ["driver:launchwright"]
        if self.allow_effects:
            allow.append("driver:launchwright-effects")
        config = (
            "drivers = "
            + json.dumps([str(self.manifest_path), str(self.effects_manifest_path)])
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
            ("project-graph-fixture", self.paths["project-graph-fixture"], False),
            ("effects-protected", self.paths["effects-protected"], False),
            ("effects-artifacts", self.paths["effects-artifacts"], False),
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
            self.evidence / "effects-provider-identity.json",
            {
                "effects_driver": host.sha256(self.effects_driver),
                "manifest": host.sha256(self.effects_manifest_path),
                "canonical_reader_source": host.sha256(
                    SEMWRIGHT / "crates" / "native-sdk" / "src" / "effects_readback.rs"
                ),
            },
        )


def provider_execute(
    fixture: EffectsFixture,
    command: str,
    args: dict[str, Any],
    *,
    expected_ok: bool,
) -> dict[str, Any]:
    envelope = fixture.invoke(command, args, ok=expected_ok)
    if expected_ok:
        provenance = envelope["execution"]["provenance"]
        if provenance.get("provider") != "driver:launchwright-effects":
            raise AssertionError("Effects evaluation did not originate from the Effects Driver")
        if provenance.get("source") != "driver":
            raise AssertionError("Effects execution provenance is not a driver")
        if not provenance.get("descriptor_sha256"):
            raise AssertionError("Effects descriptor digest is missing")
        if provenance.get("provider_generation") is None:
            raise AssertionError("Effects provider generation is missing")
        if provenance.get("provider_version") != "0.2.0-dev.1":
            raise AssertionError("Effects provider version differs from the reviewed binary")
    return envelope


def prepare_spec(
    fixture: EffectsFixture,
    definition: dict[str, Any],
    *,
    filename: str = "spec.json",
) -> tuple[bytes, str]:
    effects_binary = host.require_binary("semwright-native-effects")
    prepared = subprocess.run(
        [str(effects_binary), "--prepare"],
        cwd=ROOT,
        env=fixture.env,
        input=json.dumps(definition, separators=(",", ":")).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=20,
    )
    if prepared.returncode:
        raise AssertionError(
            "canonical Effects preparation failed: "
            + prepared.stderr.decode("utf-8", "replace")
        )
    spec_bytes = prepared.stdout.rstrip(b"\n")
    if not spec_bytes:
        raise AssertionError("canonical Effects preparation returned an empty protected spec")
    path = fixture.paths["effects-protected"] / filename
    path.write_bytes(spec_bytes)
    path.chmod(0o600)
    return spec_bytes, sha256_bytes(spec_bytes)


def write_runtime_receipt(
    fixture: EffectsFixture,
    envelope: dict[str, Any],
    name: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    provenance = envelope["execution"]["provenance"]
    executable = host.sha256(fixture.effects_driver)
    receipt = {
        "schema_version": "launchwright-effects-runtime/1",
        "observed_at": utc_now(),
        "semwright_sha": SEMWRIGHT_SHA,
        "provider": "driver:launchwright-effects",
        "provider_version": provenance["provider_version"],
        "provider_generation": provenance["provider_generation"],
        "descriptor_sha256": provenance["descriptor_sha256"],
        "provider_executable_sha256": executable,
        "evaluator_executable_sha256": executable,
        "command": "driver.launchwright-effects.verify",
        "broker_policy_path_observed": True,
        "driver_host_isolation_accepted": True,
        "evaluator_driver_host_isolated": True,
        "platform_execution_authority": False,
        "external_customer_acceptance": False,
        "report": envelope["data"],
    }
    path = fixture.paths["effects-receipts"] / name
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


def create_context(
    fixture: EffectsFixture,
) -> tuple[host.HostClient, dict[str, Any], dict[str, Any], dict[str, Any]]:
    client = host.HostClient(fixture, key_prefix="r29-effects")
    product = client.mutate(
        "entity.create",
        "entity-create",
        {"kind": "product", "data": {"name": "R29 Effects fixture", "description": "Owned CI fixture"}},
        key_hint="product",
    )["entity"]
    release = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "release",
            "data": {
                "product_id": product["id"],
                "name": "effects-r29",
                "build": "build-A",
                "status": "draft",
            },
        },
        key_hint="release",
    )["entity"]
    source = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "source",
            "data": {
                "product_id": product["id"],
                "name": "Owned R29 Effects source",
                "type": "document",
                "locator": "owned://effects-r29",
                "build": "build-A",
                "coverage": "declared",
            },
        },
        key_hint="source",
    )["entity"]
    target = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "target",
            "data": {
                "release_id": release["id"],
                "name": "Owned R29 Effects target",
                "ui_locale": "en-US",
                "editorial_locale": "en-US",
                "role": "owner",
                "plan": "test",
                "region": "CI",
                "flags": {},
                "viewport": {"width": 1280, "height": 720, "scale_milli": 1000},
            },
        },
        key_hint="target",
    )["entity"]
    deliverable = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "deliverable",
            "data": {
                "release_id": release["id"],
                "name": "R29 Effects acceptance JSON",
                "target_id": target["id"],
                "format": "json",
                "content": "Owned deterministic Effects Driver Host artifact.",
                "claim_ids": [],
                "source_ids": [source["id"]],
            },
        },
        key_hint="deliverable",
    )["entity"]
    artifact = client.mutate(
        "deliverable.render",
        "deliverable-render",
        {"id": deliverable["id"]},
        key_hint="render",
    )["entity"]
    readback = client.read("artifact-read", {"id": artifact["id"]})
    artifact_bytes = readback["text"].encode("utf-8")
    if sha256_bytes(artifact_bytes) != artifact["data"]["sha256"]:
        raise AssertionError("Effects artifact bytes differ from the Launchwright durable digest")
    artifact_path = fixture.paths["effects-artifacts"] / "release.json"
    artifact_path.write_bytes(artifact_bytes)
    artifact_path.chmod(0o600)
    return client, release, source, artifact


def definition_for(
    fixture: EffectsFixture,
    artifact: dict[str, Any],
    runtime_digest: str,
) -> dict[str, Any]:
    source_digest = host.sha256(
        SEMWRIGHT / "crates" / "native-sdk" / "src" / "effects_readback.rs"
    )
    artifact_path = fixture.paths["effects-artifacts"] / "release.json"
    return {
        "owner": {
            "session": "launchwright_effects_r29_host",
            "principal": {"named": "launchwright_owner"},
        },
        "request_id": "launchwright_effects_r29_host",
        "source_digest": source_digest,
        "runtime_digest": runtime_digest,
        "declared_producer_execution_status": "unknown",
        "application_roots": ["/workspace/launchwright-data"],
        "artifacts": [
            {
                "slot": "release",
                "path": "release.json",
                "sha256": artifact["data"]["sha256"],
                "bytes": artifact_path.stat().st_size,
                "mime_type": "application/json",
            }
        ],
        "checks": [
            {
                "id": "draft",
                "artifact_slot": "release",
                "selector": {
                    "kind": "json",
                    "pointer": "/draft",
                    "scalar": {"kind": "bool"},
                },
                "predicate": {
                    "kind": "equals",
                    "expected": {"kind": "bool", "value": True},
                },
            },
            {
                "id": "build",
                "artifact_slot": "release",
                "selector": {
                    "kind": "json",
                    "pointer": "/release/build",
                    "scalar": {"kind": "text"},
                },
                "predicate": {
                    "kind": "equals",
                    "expected": {"kind": "text", "value": "build-A"},
                },
            },
        ],
    }


def allowed_flow() -> dict[str, Any]:
    fixture = EffectsFixture("allowed", allow_effects=True)
    try:
        cli = str(host.require_binary("semwright"))
        validate = run_json(
            [cli, "--json", "driver", "validate", str(fixture.effects_manifest_path)],
            fixture.env,
        )
        conformance = run_json(
            [cli, "--json", "driver", "conformance", str(fixture.effects_conformance_manifest_path)],
            fixture.env,
        )
        if validate.get("valid") is not True:
            raise AssertionError("production Effects manifest did not validate")
        if (
            conformance.get("provider") != "driver:launchwright-effects"
            or conformance.get("capabilities") != 2
            or conformance.get("sandboxed") is not True
            or conformance.get("executed_read_only") is not True
            or conformance.get("shutdown") is not True
        ):
            raise AssertionError("Effects conformance report is incomplete")

        fixture.start()
        client, release, source, artifact = create_context(fixture)
        executable_sha = host.sha256(fixture.effects_driver)
        definition = definition_for(fixture, artifact, executable_sha)
        spec_bytes, spec_sha = prepare_spec(fixture, definition)
        envelope = provider_execute(
            fixture,
            "driver.launchwright-effects.verify",
            {"spec_sha256": spec_sha},
            expected_ok=True,
        )
        report = envelope["data"]
        if (
            report.get("verdict") != "PASS"
            or report.get("inspection_state") != "EVALUATED"
            or report.get("scope") != "immutable_native_sdk_artifact_properties_only"
            or report.get("execution_authority") is not False
            or report.get("runtime_digest") != executable_sha
        ):
            raise AssertionError("Effects provider did not return the exact bounded canonical PASS")

        receipt, receipt_ref = write_runtime_receipt(fixture, envelope, "r29-effects.json")
        effect_input = {
            "release_id": release["id"],
            "artifact_ids": [artifact["id"]],
            "spec_text": spec_bytes.decode("utf-8"),
            "result_text": report["result_text"],
            "admit": True,
            "runtime_receipt": receipt_ref,
        }
        stored = client.mutate(
            "effects.record",
            "effects-record",
            effect_input,
            key_hint="record-pass",
        )["entity"]
        status = client.read("effects-inspect", {"release_id": release["id"]})
        if (
            stored["data"].get("admission") != "canonical-driver-host-admitted"
            or status.get("state") != "PASS"
            or status.get("canonical_passes") != 1
            or status["receipts"][0].get("verified_evaluator_execution") is not True
            or status["receipts"][0].get("evaluator_driver_host_isolated") is not True
            or status.get("scenario_effects_authority") is not False
        ):
            raise AssertionError("Driver Host Effects receipt was not admitted as bounded PASS")

        wrong_digest = provider_execute(
            fixture,
            "driver.launchwright-effects.verify",
            {"spec_sha256": "0" * 64},
            expected_ok=False,
        )
        host.assert_error(wrong_digest, "digest", "invalid", "effect")

        substituted = copy.deepcopy(receipt)
        substituted["report"]["result_text"] = substituted["report"]["result_text"].replace(
            '"verdict":"PASS"', '"verdict":"FAIL"', 1
        )
        substituted_path = fixture.paths["effects-receipts"] / "r29-result-substitution.json"
        host.write_private_json(substituted_path, substituted)
        substituted_input = copy.deepcopy(effect_input)
        substituted_input["runtime_receipt"] = {
            "file": substituted_path.name,
            "sha256": host.sha256(substituted_path),
        }
        rejected = mutate_expect_fail(
            client,
            "effects.record",
            "effects-record",
            substituted_input,
            "result-substitution",
        )
        host.assert_error(rejected, "result", "digest", "conflict")

        elevated = copy.deepcopy(receipt)
        elevated["platform_execution_authority"] = True
        elevated_path = fixture.paths["effects-receipts"] / "r29-authority-escalation.json"
        host.write_private_json(elevated_path, elevated)
        elevated_input = copy.deepcopy(effect_input)
        elevated_input["runtime_receipt"] = {
            "file": elevated_path.name,
            "sha256": host.sha256(elevated_path),
        }
        rejected = mutate_expect_fail(
            client,
            "effects.record",
            "effects-record",
            elevated_input,
            "authority-escalation",
        )
        host.assert_error(rejected, "authority", "conflict", "external")

        bad_definition = definition_for(fixture, artifact, "0" * 64)
        bad_spec_bytes, bad_spec_sha = prepare_spec(fixture, bad_definition)
        bad_envelope = provider_execute(
            fixture,
            "driver.launchwright-effects.verify",
            {"spec_sha256": bad_spec_sha},
            expected_ok=True,
        )
        bad_receipt, bad_ref = write_runtime_receipt(
            fixture, bad_envelope, "r29-runtime-substitution.json"
        )
        bad_input = {
            "release_id": release["id"],
            "artifact_ids": [artifact["id"]],
            "spec_text": bad_spec_bytes.decode("utf-8"),
            "result_text": bad_envelope["data"]["result_text"],
            "admit": True,
            "runtime_receipt": bad_ref,
        }
        rejected = mutate_expect_fail(
            client,
            "effects.record",
            "effects-record",
            bad_input,
            "runtime-substitution",
        )
        host.assert_error(rejected, "runtime", "digest", "evaluator", "conflict")

        # Restore the exact admitted spec; the fixed provider path is intentionally not caller-selected.
        spec_path = fixture.paths["effects-protected"] / "spec.json"
        spec_path.write_bytes(spec_bytes)
        spec_path.chmod(0o600)

        updated_source = client.mutate(
            "entity.update",
            "entity-update",
            {
                "id": source["id"],
                "expected": source["version"],
                "data": {**source["data"], "coverage": "partial"},
            },
            key_hint="source-drift",
        )["entity"]
        if updated_source["version"] == source["version"]:
            raise AssertionError("Effects drift control did not advance the source revision")
        stale = client.read("effects-inspect", {"release_id": release["id"]})
        if (
            stale.get("state") != "UNKNOWN"
            or stale["receipts"][0].get("current") is not False
            or stale["receipts"][0].get("evaluator_driver_host_isolated") is not True
        ):
            raise AssertionError("Effects input drift did not invalidate the current PASS")

        return {
            "manifest_validated": True,
            "conformance": conformance,
            "release_id": release["id"],
            "artifact_id": artifact["id"],
            "artifact_sha256": artifact["data"]["sha256"],
            "protected_spec_sha256": spec_sha,
            "provider_executable_sha256": executable_sha,
            "receipt_sha256": receipt_ref["sha256"],
            "effective_state_before_drift": "PASS",
            "effective_state_after_drift": stale["state"],
            "spec_digest_rejected": True,
            "result_substitution_rejected": True,
            "runtime_digest_substitution_rejected": True,
            "external_authority_escalation_rejected": True,
        }
    finally:
        fixture.close()


def denied_flow() -> dict[str, Any]:
    with EffectsFixture("policy-denied", allow_effects=False) as fixture:
        denied = fixture.invoke("driver.launchwright-effects.probe", {}, ok=False)
        host.assert_error(denied, "policy", "permission", "denied", "authorization")
        return {"provider_allowlisted": False, "execution_rejected": True}


def main() -> None:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit("R29 Effects runtime acceptance is CI-only")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    observed_sha = subprocess.check_output(
        ["git", "-C", str(SEMWRIGHT), "rev-parse", "HEAD"], text=True
    ).strip()
    if observed_sha != SEMWRIGHT_SHA:
        raise AssertionError("Semwright checkout differs from the Launchwright source lock")
    if not EFFECTS_DRIVER_BINARY.is_file():
        raise AssertionError("Launchwright Effects provider binary is unavailable")

    allowed = allowed_flow()
    denied = denied_flow()
    report = {
        "schema_version": "launchwright-effects-runtime-acceptance/1",
        "passed": True,
        "launchwright_sha": os.environ.get("GITHUB_SHA"),
        "semwright_sha": observed_sha,
        "native_sdk": "1.0.0",
        "authority": {
            "scope": "immutable-native-sdk-effects-reader-only",
            "effects_provider_driver_host_isolation_accepted": True,
            "effects_evaluation_driver_host_isolation_accepted": True,
            "effects_owner_admission_accepted": True,
            "exact_spec_result_binding": True,
            "runtime_digest_provider_binding": True,
            "policy_denied_without_provider_authority": True,
            "execution_authority": False,
            "scenario_effects_authority": False,
            "native_browser_godot_mutation_effect_authority": False,
            "platform_execution_authority": False,
            "external_customer_acceptance": False,
            "publication_authority": False,
        },
        "allowed_flow": allowed,
        "policy_denied_flow": denied,
    }
    host.write_private_json(EVIDENCE / "report.json", report)
    print(
        "LAUNCHWRIGHT_EFFECTS_RUNTIME_ACCEPTANCE_PASS "
        + json.dumps(report, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
