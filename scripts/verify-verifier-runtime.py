#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""R26 exact-SHA verifier admission through Semwright Broker/Policy/Driver Host.

CI-only. The accepted authority is intentionally narrow: an owner-staged Launchwright
candidate, format verification only, on the pinned Semwright source. It does not claim
Platform execution, customer acceptance, semantic/editorial correctness or publication.
"""
from __future__ import annotations

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
VERIFIER_BINARY = Path(os.environ["LAUNCHWRIGHT_VERIFIER_BINARY"]).resolve()
EVIDENCE = ROOT / "evidence" / "verifier-runtime"
SEMWRIGHT_SHA = os.environ["SEMWRIGHT_SHA"]

spec = importlib.util.spec_from_file_location(
    "launchwright_native_host_acceptance", ROOT / "scripts" / "verify-native-host.py"
)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load Native Host acceptance helpers")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
host.EVIDENCE = EVIDENCE


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def domain_digest(domain: str, value: Any) -> str:
    payload = f"{domain}\n{host.exact_json(value)}".encode("utf-8")
    return sha256_bytes(payload)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run_json(argv: list[str], env: dict[str, str]) -> dict[str, Any]:
    result = subprocess.run(
        argv,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
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


class VerifierFixture(host.HostFixture):
    def __init__(self, label: str, *, allow_verifier: bool) -> None:
        self.allow_verifier = allow_verifier
        super().__init__(label, allow_driver=True, allow_project_graph=False)

    def _stage_driver(self) -> None:
        super()._stage_driver()
        target = self.paths["binary"] / "launchwright-verifier-driver"
        shutil.copyfile(VERIFIER_BINARY, target)
        target.chmod(0o500)
        self.verifier = target

    def _write_manifest_and_policy(self) -> None:
        super()._write_manifest_and_policy()
        verifier_manifest = {
            "manifest_version": 1,
            "protocol": 5,
            "id": "launchwright-verifier",
            "version": "0.2.0-dev.1",
            "publisher": "launchwright-owned-verifier-r26",
            "executable": str(self.verifier),
            "sha256": host.sha256(self.verifier),
            "application": {
                "desktop_id": None,
                "process_names": ["launchwright-verifier-driver"],
                "supported_versions": [],
            },
            "transport": "stdio_v1",
            "network": False,
            "mounts": [
                {"root": "verification-input", "read_only": True, "execute": False}
            ],
            "resources": {
                "open_files": 64,
                "processes": 8,
                "cpu_seconds": 30,
                "operation_cpu_seconds": 0,
                "address_space_bytes": 536_870_912,
                "file_size_bytes": 16_777_216,
            },
            "request_timeout_ms": 10_000,
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
        self.verifier_manifest_path = self.paths["config"] / "verifier.json"
        host.write_private_json(self.verifier_manifest_path, verifier_manifest)

        # Conformance must not invent a filesystem grant. The same pinned binary exposes
        # a no-input read-only probe, so handshake/catalog/probe/health/shutdown can run
        # with an otherwise identical manifest that has no candidate mount.
        conformance_manifest = {**verifier_manifest, "mounts": []}
        self.verifier_conformance_manifest_path = (
            self.paths["config"] / "verifier-conformance.json"
        )
        host.write_private_json(
            self.verifier_conformance_manifest_path, conformance_manifest
        )

        allow = ["driver:launchwright"]
        if self.allow_verifier:
            allow.append("driver:launchwright-verifier")
        config = (
            "drivers = "
            + json.dumps([str(self.manifest_path), str(self.verifier_manifest_path)])
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
            ("launchwright-node", self.node, False),
            ("launchwright-verifier-node", self.verifier_node, False),
            ("verification-input", self.paths["project-graph-fixture"], False),
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


def create_candidate(fixture: VerifierFixture) -> tuple[dict[str, Any], dict[str, Any]]:
    client = host.HostClient(fixture, key_prefix="r26")
    product = client.mutate(
        "entity.create",
        "entity-create",
        {"kind": "product", "data": {"name": "R26 verifier fixture", "description": "Owned CI fixture"}},
        key_hint="product",
    )["entity"]
    release = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "release",
            "data": {
                "product_id": product["id"],
                "name": "1.0-r26",
                "build": "r26-build",
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
                "name": "R26 owned source",
                "type": "document",
                "locator": "owned://r26-verifier",
                "build": "r26-build",
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
                "name": "R26 English",
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
                "name": "R26 release note",
                "target_id": target["id"],
                "format": "markdown",
                "content": "# R26\n\nOwned deterministic verifier fixture.\n",
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
    candidate = client.mutate(
        "candidate.freeze",
        "candidate-freeze",
        {
            "release_id": release["id"],
            "name": "R26 candidate",
            "artifact_ids": [artifact["id"]],
            "destination": "r26-private-draft",
            "contract": {
                "version": "r26",
                "required_reviewers": 1,
                "require_claims_verified": False,
            },
        },
        key_hint="freeze",
    )["entity"]
    return artifact, candidate


def stage_verifier_input(
    fixture: VerifierFixture, artifact: dict[str, Any], candidate: dict[str, Any]
) -> tuple[Path, bytes, dict[str, Any]]:
    client = host.HostClient(fixture, key_prefix="r26-read")
    readback = client.read("artifact-read", {"id": artifact["id"]})
    artifact_bytes = readback["text"].encode("utf-8")
    if sha256_bytes(artifact_bytes) != artifact["data"]["sha256"]:
        raise AssertionError("Launchwright artifact readback digest drifted")

    frozen = next(
        item
        for item in candidate["data"]["manifest"]["artifacts"]
        if item["id"] == artifact["id"]
    )
    suffix = artifact["data"]["extension"].lstrip(".") or "txt"
    relative = f"candidate-{artifact['id']}.{suffix}"
    artifact_path = fixture.paths["project-graph-fixture"] / relative
    artifact_path.write_bytes(artifact_bytes)
    artifact_path.chmod(0o600)
    verifier_input = {
        "schema_version": "launchwright-verifier-input/1",
        "candidate_id": candidate["id"],
        "candidate_sha256": candidate["data"]["candidate_sha256"],
        "candidate_manifest_sha256": domain_digest(
            "launchwright/candidate-manifest/1", candidate["data"]["manifest"]
        ),
        "dimension": "format",
        "artifacts": [
            {
                "id": artifact["id"],
                "relative_path": relative,
                "sha256": frozen["sha256"],
                "bytes": frozen["bytes"],
                "mime": frozen["mime"],
            }
        ],
    }
    manifest_path = fixture.paths["project-graph-fixture"] / "r26-verifier-input.json"
    host.write_private_json(manifest_path, verifier_input)
    return artifact_path, artifact_bytes, verifier_input


def verifier_execute(
    fixture: VerifierFixture, *, expected_ok: bool
) -> dict[str, Any]:
    envelope = fixture.invoke(
        "driver.launchwright-verifier.format",
        {"manifest_rel": "r26-verifier-input.json"},
        ok=expected_ok,
    )
    if expected_ok:
        provenance = envelope["execution"]["provenance"]
        if provenance.get("provider") != "driver:launchwright-verifier":
            raise AssertionError("verifier execution did not originate from Driver Host")
        if provenance.get("source") != "driver":
            raise AssertionError("verifier execution provenance is not a driver")
        if not provenance.get("descriptor_sha256"):
            raise AssertionError("verifier descriptor digest is missing")
        if provenance.get("provider_generation") is None:
            raise AssertionError("verifier provider generation is missing")
    return envelope


def write_runtime_receipt(
    fixture: VerifierFixture,
    verifier_envelope: dict[str, Any],
) -> tuple[dict[str, Any], str, str]:
    provenance = verifier_envelope["execution"]["provenance"]
    report = verifier_envelope["data"]
    observed_at = utc_now()
    receipt = {
        "schema_version": "launchwright-canonical-verifier-runtime/1",
        "observed_at": observed_at,
        "semwright_sha": SEMWRIGHT_SHA,
        "provider": "driver:launchwright-verifier",
        "provider_version": "0.2.0-dev.1",
        "provider_generation": provenance["provider_generation"],
        "descriptor_sha256": provenance["descriptor_sha256"],
        "executable_sha256": host.sha256(fixture.verifier),
        "broker_policy_path_observed": True,
        "driver_host_isolation_accepted": True,
        "platform_execution_authority": False,
        "external_customer_acceptance": False,
        "report": report,
    }
    path = fixture.paths["verification-receipts"] / "r26-driver-host.json"
    host.write_private_json(path, receipt)
    return receipt, path.name, host.sha256(path)


def mutate_expect_fail(
    client: Any,
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


def allowed_flow() -> dict[str, Any]:
    fixture = VerifierFixture("allowed", allow_verifier=True)
    try:
        cli = str(host.require_binary("semwright"))
        validate = run_json(
            [cli, "--json", "driver", "validate", str(fixture.verifier_manifest_path)],
            fixture.env,
        )
        conformance = run_json(
            [
                cli,
                "--json",
                "driver",
                "conformance",
                str(fixture.verifier_conformance_manifest_path),
            ],
            fixture.env,
        )
        if validate.get("valid") is not True:
            raise AssertionError("production verifier manifest did not validate")
        if (
            conformance.get("provider") != "driver:launchwright-verifier"
            or conformance.get("capabilities") != 2
            or conformance.get("sandboxed") is not True
            or conformance.get("executed_read_only") is not True
            or conformance.get("shutdown") is not True
        ):
            raise AssertionError("verifier conformance report is incomplete")

        fixture.start()
        artifact, candidate = create_candidate(fixture)
        artifact_path, original_bytes, verifier_input = stage_verifier_input(
            fixture, artifact, candidate
        )
        verifier_envelope = verifier_execute(fixture, expected_ok=True)
        if verifier_envelope["data"].get("state") != "PASS":
            raise AssertionError("owned verifier fixture did not produce PASS")

        receipt, receipt_file, receipt_sha = write_runtime_receipt(
            fixture, verifier_envelope
        )
        client = host.HostClient(fixture, key_prefix="r26-record")
        verification_input = {
            "candidate_id": candidate["id"],
            "dimension": "format",
            "state": receipt["report"]["state"],
            "verifier": {
                "id": "launchwright-verifier",
                "version": receipt["provider_version"],
                "digest": receipt["executable_sha256"],
                "authority": "canonical",
            },
            "artifact_ids": [artifact["id"]],
            "coverage": receipt["report"]["coverage"],
            "omissions": [],
            "findings": receipt["report"]["findings"],
            "observed_at": receipt["observed_at"],
            "runtime_receipt": {"file": receipt_file, "sha256": receipt_sha},
        }
        stored = client.mutate(
            "verification.record",
            "verification-record",
            verification_input,
            key_hint="record-pass",
        )["entity"]
        if stored["data"]["admission"] != "canonical-owner-admitted":
            raise AssertionError("Host receipt did not reach canonical admission")
        admission = stored["data"]["runtime_admission"]
        if (
            admission.get("provider") != "driver:launchwright-verifier"
            or admission.get("receipt_sha256") != receipt_sha
            or admission.get("driver_host_isolation_accepted") is not True
            or admission.get("platform_execution_authority") is not False
        ):
            raise AssertionError("stored verifier admission lost exact Host custody")

        summary = client.read(
            "verification-summary", {"candidate_id": candidate["id"]}
        )
        if summary.get("state") != "PASS" or summary.get("canonical_passes") != 1:
            raise AssertionError("canonical Host verification did not become effective PASS")

        # Negative control 1: mutate the owner-staged bytes after the frozen binding.
        artifact_path.write_bytes(original_bytes + b"tamper\n")
        artifact_path.chmod(0o600)
        tampered = verifier_execute(fixture, expected_ok=True)["data"]
        if tampered.get("state") != "FAIL" or not any(
            finding.get("code") == "ARTIFACT_DIGEST_MISMATCH"
            for finding in tampered.get("findings", [])
        ):
            raise AssertionError("verifier accepted substituted artifact bytes")
        artifact_path.write_bytes(original_bytes)
        artifact_path.chmod(0o600)

        # Negative control 2: exact pinned receipt bytes for a different candidate digest.
        substituted = json.loads(json.dumps(receipt))
        substituted["report"]["candidate_sha256"] = "0" * 64
        bad_path = fixture.paths["verification-receipts"] / "r26-substituted.json"
        host.write_private_json(bad_path, substituted)
        bad_input = json.loads(json.dumps(verification_input))
        bad_input["runtime_receipt"] = {
            "file": bad_path.name,
            "sha256": host.sha256(bad_path),
        }
        rejected = mutate_expect_fail(
            client,
            "verification.record",
            "verification-record",
            bad_input,
            "reject-substitution",
        )
        host.assert_error(rejected, "stale", "digest", "candidate", "conflict")

        return {
            "manifest_validated": True,
            "conformance": conformance,
            "candidate_id": candidate["id"],
            "candidate_sha256": candidate["data"]["candidate_sha256"],
            "candidate_manifest_sha256": verifier_input["candidate_manifest_sha256"],
            "artifact_sha256": artifact["data"]["sha256"],
            "verifier_executable_sha256": host.sha256(fixture.verifier),
            "verifier_descriptor_sha256": receipt["descriptor_sha256"],
            "receipt_sha256": receipt_sha,
            "effective_state": summary["state"],
            "artifact_substitution_rejected": True,
            "receipt_candidate_substitution_rejected": True,
        }
    finally:
        fixture.close()


def denied_flow() -> dict[str, Any]:
    with VerifierFixture("policy-denied", allow_verifier=False) as fixture:
        denied = fixture.invoke(
            "driver.launchwright-verifier.probe", {}, ok=False
        )
        host.assert_error(denied, "policy", "permission", "denied", "authorization")
        return {
            "driver_allowlisted": False,
            "execution_rejected": True,
        }


def main() -> None:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit("R26 verifier acceptance is CI-only")
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    observed_sha = subprocess.check_output(
        ["git", "-C", str(SEMWRIGHT), "rev-parse", "HEAD"], text=True
    ).strip()
    if observed_sha != SEMWRIGHT_SHA:
        raise AssertionError("Semwright checkout differs from the Launchwright source lock")
    if not VERIFIER_BINARY.is_file():
        raise AssertionError("Launchwright verifier binary is unavailable")

    allowed = allowed_flow()
    denied = denied_flow()
    report = {
        "schema_version": "launchwright-verifier-runtime-acceptance/1",
        "passed": True,
        "launchwright_sha": os.environ.get("GITHUB_SHA"),
        "semwright_sha": observed_sha,
        "native_sdk": "1.0.0",
        "authority": {
            "scope": "owner-staged-format-only",
            "canonical_verifier_runtime_admitted": True,
            "broker_policy_path_observed": True,
            "driver_host_isolation_accepted": True,
            "native_sdk_review_recorded": True,
            "artifact_substitution_rejected": True,
            "receipt_candidate_substitution_rejected": True,
            "platform_execution_authority": False,
            "external_customer_acceptance": False,
            "semantic_authority": False,
            "editorial_authority": False,
            "publication_authority": False,
        },
        "allowed_flow": allowed,
        "policy_denied_flow": denied,
    }
    host.write_private_json(EVIDENCE / "report.json", report)
    print(
        "LAUNCHWRIGHT_VERIFIER_RUNTIME_ACCEPTANCE_PASS "
        + json.dumps(report, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
