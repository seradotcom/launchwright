#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""R30 exact-SHA bounded verifier admission through Semwright Driver Host.

CI-only. Canonical authority is limited to four deterministic scopes over the exact
frozen candidate snapshot: format, secret-pattern privacy scanning, rights declaration
consistency, and static HTML structure. It does not claim semantic/editorial judgment,
privacy compliance, legal rights validity, WCAG conformance, Platform/customer authority
or publication.
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
PROVIDER_VERSION = "0.2.0-dev.2"
DIMENSIONS = ("format", "privacy", "rights", "accessibility")
SCOPES = {
    "format": "owner-staged-artifact-format-only",
    "privacy": "owner-staged-artifact-secret-patterns-only",
    "rights": "frozen-rights-declarations-only",
    "accessibility": "owner-staged-html-static-structure-only",
}

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
            "version": PROVIDER_VERSION,
            "publisher": "launchwright-owned-verifier-r30",
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

        # Conformance must not invent candidate-data authority. The probe is no-input.
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
            ("extension-receipts", self.paths["extension-receipts"], False),
            ("effects-receipts", self.paths["effects-receipts"], False),
            ("launchwright-node", self.node, False),
            ("launchwright-verifier-node", self.verifier_node, False),
            ("launchwright-extension-runtime-node", self.extension_node, False),
            ("launchwright-effects-runtime-node", self.effects_node, False),
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


def create_candidate(
    fixture: VerifierFixture,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    client = host.HostClient(fixture, key_prefix="r30")
    product = client.mutate(
        "entity.create",
        "entity-create",
        {"kind": "product", "data": {"name": "R30 verifier fixture", "description": "Owned CI fixture"}},
        key_hint="product",
    )["entity"]
    release = client.mutate(
        "entity.create",
        "entity-create",
        {
            "kind": "release",
            "data": {
                "product_id": product["id"],
                "name": "1.0-r30",
                "build": "r30-build",
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
                "name": "R30 owned source",
                "type": "document",
                "locator": "owned://r30-verifier",
                "build": "r30-build",
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
                "name": "R30 English",
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
    rights = client.mutate(
        "evidence.import",
        "evidence-import",
        {
            "release_id": release["id"],
            "target_id": target["id"],
            "source_id": source["id"],
            "name": "R30 licensed source declaration",
            "build": "r30-build",
            "classification": "actual",
            "rights": "licensed",
            "description": "Synthetic licensed verifier fixture",
            "origin_digest": "a" * 64,
        },
        key_hint="rights",
    )["entity"]

    artifacts: list[dict[str, Any]] = []
    for index, (name, fmt, content) in enumerate(
        (
            ("R30 notes", "markdown", "Owned deterministic verifier fixture."),
            ("R30 HTML", "html", "Static accessible review content."),
            ("R30 JSON", "json", "Safe structured review content."),
        ),
        start=1,
    ):
        deliverable = client.mutate(
            "entity.create",
            "entity-create",
            {
                "kind": "deliverable",
                "data": {
                    "release_id": release["id"],
                    "name": name,
                    "target_id": target["id"],
                    "format": fmt,
                    "content": content,
                    "claim_ids": [],
                    "source_ids": [source["id"]],
                },
            },
            key_hint=f"deliverable-{index}",
        )["entity"]
        artifacts.append(
            client.mutate(
                "deliverable.render",
                "deliverable-render",
                {"id": deliverable["id"]},
                key_hint=f"render-{index}",
            )["entity"]
        )

    candidate = client.mutate(
        "candidate.freeze",
        "candidate-freeze",
        {
            "release_id": release["id"],
            "name": "R30 candidate",
            "artifact_ids": [artifact["id"] for artifact in artifacts],
            "rights_evidence_ids": [rights["id"]],
            "destination": "r30-private-draft",
            "contract": {
                "version": "r30",
                "required_reviewers": 1,
                "require_claims_verified": False,
                "required_verification_dimensions": list(DIMENSIONS),
            },
        },
        key_hint="freeze",
    )["entity"]
    expected_candidate_sha = domain_digest(
        "launchwright/candidate/1", candidate["data"]["manifest"]
    )
    if expected_candidate_sha != candidate["data"]["candidate_sha256"]:
        raise AssertionError("candidate digest does not match exact frozen manifest")
    return artifacts, candidate


def stage_verifier_input(
    fixture: VerifierFixture,
    artifacts: list[dict[str, Any]],
    candidate: dict[str, Any],
    dimension: str,
    *,
    name: str | None = None,
) -> tuple[dict[str, Path], dict[str, bytes], dict[str, Any], str]:
    if dimension not in DIMENSIONS:
        raise AssertionError("unknown verifier dimension")
    client = host.HostClient(fixture, key_prefix="r30-read")
    paths: dict[str, Path] = {}
    bytes_by_id: dict[str, bytes] = {}
    bindings: list[dict[str, Any]] = []
    frozen_by_id = {
        item["id"]: item for item in candidate["data"]["manifest"]["artifacts"]
    }
    for artifact in artifacts:
        readback = client.read("artifact-read", {"id": artifact["id"]})
        artifact_bytes = readback["text"].encode("utf-8")
        if sha256_bytes(artifact_bytes) != artifact["data"]["sha256"]:
            raise AssertionError("Launchwright artifact readback digest drifted")
        frozen = frozen_by_id[artifact["id"]]
        suffix = artifact["data"]["extension"].lstrip(".") or "txt"
        relative = f"candidate-{artifact['id']}.{suffix}"
        artifact_path = fixture.paths["project-graph-fixture"] / relative
        artifact_path.write_bytes(artifact_bytes)
        artifact_path.chmod(0o600)
        paths[artifact["id"]] = artifact_path
        bytes_by_id[artifact["id"]] = artifact_bytes
        bindings.append(
            {
                "id": artifact["id"],
                "relative_path": relative,
                "sha256": frozen["sha256"],
                "bytes": frozen["bytes"],
                "mime": frozen["mime"],
            }
        )

    frozen_manifest = json.loads(json.dumps(candidate["data"]["manifest"]))
    verifier_input = {
        "schema_version": "launchwright-verifier-input/2",
        "candidate_id": candidate["id"],
        "candidate_sha256": candidate["data"]["candidate_sha256"],
        "candidate_manifest_sha256": domain_digest(
            "launchwright/candidate-manifest/1", frozen_manifest
        ),
        "dimension": dimension,
        "candidate_manifest": frozen_manifest,
        "artifacts": bindings,
    }
    filename = name or f"r30-verifier-{dimension}.json"
    manifest_path = fixture.paths["project-graph-fixture"] / filename
    host.write_private_json(manifest_path, verifier_input)
    return paths, bytes_by_id, verifier_input, filename


def verifier_execute(
    fixture: VerifierFixture,
    dimension: str,
    manifest_rel: str,
    *,
    expected_ok: bool,
) -> dict[str, Any]:
    envelope = fixture.invoke(
        f"driver.launchwright-verifier.{dimension}",
        {"manifest_rel": manifest_rel},
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
        data = envelope["data"]
        if data.get("dimension") != dimension or data.get("scope") != SCOPES[dimension]:
            raise AssertionError("verifier returned the wrong bounded dimension/scope")
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
        "provider_version": PROVIDER_VERSION,
        "provider_generation": provenance["provider_generation"],
        "descriptor_sha256": provenance["descriptor_sha256"],
        "executable_sha256": host.sha256(fixture.verifier),
        "broker_policy_path_observed": True,
        "driver_host_isolation_accepted": True,
        "platform_execution_authority": False,
        "external_customer_acceptance": False,
        "report": report,
    }
    path = fixture.paths["verification-receipts"] / (
        f"r30-{report['dimension']}-driver-host.json"
    )
    host.write_private_json(path, receipt)
    return receipt, path.name, host.sha256(path)


def verification_record_input(
    candidate: dict[str, Any],
    artifacts: list[dict[str, Any]],
    receipt: dict[str, Any],
    receipt_file: str,
    receipt_sha: str,
) -> dict[str, Any]:
    return {
        "candidate_id": candidate["id"],
        "dimension": receipt["report"]["dimension"],
        "state": receipt["report"]["state"],
        "verifier": {
            "id": "launchwright-verifier",
            "version": receipt["provider_version"],
            "digest": receipt["executable_sha256"],
            "authority": "canonical",
        },
        "artifact_ids": [artifact["id"] for artifact in artifacts],
        "coverage": receipt["report"]["coverage"],
        "omissions": [],
        "findings": receipt["report"]["findings"],
        "observed_at": receipt["observed_at"],
        "runtime_receipt": {"file": receipt_file, "sha256": receipt_sha},
    }


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


def rebind_artifact_snapshot(
    verifier_input: dict[str, Any],
    artifact_id: str,
    new_bytes: bytes,
) -> None:
    digest = sha256_bytes(new_bytes)
    for binding in verifier_input["artifacts"]:
        if binding["id"] == artifact_id:
            binding["sha256"] = digest
            binding["bytes"] = len(new_bytes)
            break
    else:
        raise AssertionError("artifact binding missing")
    for frozen in verifier_input["candidate_manifest"]["artifacts"]:
        if frozen["id"] == artifact_id:
            frozen["sha256"] = digest
            frozen["bytes"] = len(new_bytes)
            break
    else:
        raise AssertionError("frozen artifact missing")
    verifier_input["candidate_manifest_sha256"] = domain_digest(
        "launchwright/candidate-manifest/1", verifier_input["candidate_manifest"]
    )
    verifier_input["candidate_sha256"] = domain_digest(
        "launchwright/candidate/1", verifier_input["candidate_manifest"]
    )


def negative_dimension_controls(
    fixture: VerifierFixture,
    artifacts: list[dict[str, Any]],
    candidate: dict[str, Any],
) -> dict[str, bool]:
    by_mime = {
        artifact["data"]["mime"].split(";")[0]: artifact for artifact in artifacts
    }

    # Privacy: a self-consistent frozen snapshot containing private-key material must FAIL.
    paths, _, privacy_input, privacy_file = stage_verifier_input(
        fixture, artifacts, candidate, "privacy", name="r30-privacy-negative.json"
    )
    privacy_artifact = by_mime["text/markdown"]
    secret_bytes = paths[privacy_artifact["id"]].read_bytes() + (
        b"\n-----BEGIN PRIVATE KEY-----\nsynthetic-fixture-only\n"
    )
    paths[privacy_artifact["id"]].write_bytes(secret_bytes)
    paths[privacy_artifact["id"]].chmod(0o600)
    rebind_artifact_snapshot(privacy_input, privacy_artifact["id"], secret_bytes)
    host.write_private_json(
        fixture.paths["project-graph-fixture"] / privacy_file, privacy_input
    )
    privacy_fail = verifier_execute(
        fixture, "privacy", privacy_file, expected_ok=True
    )["data"]
    privacy_rejected = (
        privacy_fail.get("state") == "FAIL"
        and any(
            finding.get("code") == "PRIVACY_SECRET_PATTERN"
            for finding in privacy_fail.get("findings", [])
        )
    )

    # Accessibility: a self-consistent frozen HTML snapshot without lang must FAIL.
    paths, _, access_input, access_file = stage_verifier_input(
        fixture, artifacts, candidate, "accessibility", name="r30-accessibility-negative.json"
    )
    html_artifact = by_mime["text/html"]
    original_html = paths[html_artifact["id"]].read_bytes()
    broken_html = original_html.replace(b' lang="en-US"', b"", 1)
    if broken_html == original_html:
        raise AssertionError("accessibility negative fixture could not remove html lang")
    paths[html_artifact["id"]].write_bytes(broken_html)
    paths[html_artifact["id"]].chmod(0o600)
    rebind_artifact_snapshot(access_input, html_artifact["id"], broken_html)
    host.write_private_json(
        fixture.paths["project-graph-fixture"] / access_file, access_input
    )
    access_fail = verifier_execute(
        fixture, "accessibility", access_file, expected_ok=True
    )["data"]
    accessibility_rejected = (
        access_fail.get("state") == "FAIL"
        and any(
            finding.get("code") == "ACCESSIBILITY_HTML_LANG"
            for finding in access_fail.get("findings", [])
        )
    )

    # Rights: a self-consistent frozen restricted declaration must FAIL.
    _, _, rights_input, rights_file = stage_verifier_input(
        fixture, artifacts, candidate, "rights", name="r30-rights-negative.json"
    )
    if not rights_input["candidate_manifest"]["rights"]:
        raise AssertionError("rights negative fixture requires a declaration")
    rights_input["candidate_manifest"]["rights"][0]["rights"] = "restricted"
    rights_input["candidate_manifest_sha256"] = domain_digest(
        "launchwright/candidate-manifest/1", rights_input["candidate_manifest"]
    )
    rights_input["candidate_sha256"] = domain_digest(
        "launchwright/candidate/1", rights_input["candidate_manifest"]
    )
    host.write_private_json(
        fixture.paths["project-graph-fixture"] / rights_file, rights_input
    )
    rights_fail = verifier_execute(
        fixture, "rights", rights_file, expected_ok=True
    )["data"]
    rights_rejected = (
        rights_fail.get("state") == "FAIL"
        and any(
            finding.get("code") == "RIGHTS_RESTRICTED"
            for finding in rights_fail.get("findings", [])
        )
    )

    return {
        "privacy_secret_pattern_rejected": privacy_rejected,
        "accessibility_missing_lang_rejected": accessibility_rejected,
        "restricted_rights_rejected": rights_rejected,
    }


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
            or conformance.get("capabilities") != 5
            or conformance.get("sandboxed") is not True
            or conformance.get("executed_read_only") is not True
            or conformance.get("shutdown") is not True
        ):
            raise AssertionError("verifier conformance report is incomplete")

        fixture.start()
        artifacts, candidate = create_candidate(fixture)
        client = host.HostClient(fixture, key_prefix="r30-record")
        receipts: dict[str, str] = {}
        scopes: dict[str, str] = {}
        descriptor_digests: dict[str, str] = {}
        first_format_paths: dict[str, Path] | None = None
        first_format_bytes: dict[str, bytes] | None = None
        first_format_input: dict[str, Any] | None = None
        first_format_file: str | None = None
        first_format_receipt: dict[str, Any] | None = None
        first_record_input: dict[str, Any] | None = None

        for dimension in DIMENSIONS:
            paths, bytes_by_id, verifier_input, manifest_file = stage_verifier_input(
                fixture, artifacts, candidate, dimension
            )
            verifier_envelope = verifier_execute(
                fixture, dimension, manifest_file, expected_ok=True
            )
            report = verifier_envelope["data"]
            if report.get("state") != "PASS":
                raise AssertionError(f"owned {dimension} verifier fixture did not produce PASS")
            receipt, receipt_file, receipt_sha = write_runtime_receipt(
                fixture, verifier_envelope
            )
            record_input = verification_record_input(
                candidate, artifacts, receipt, receipt_file, receipt_sha
            )
            stored = client.mutate(
                "verification.record",
                "verification-record",
                record_input,
                key_hint=f"record-{dimension}",
            )["entity"]
            admission = stored["data"]["runtime_admission"]
            if (
                stored["data"]["admission"] != "canonical-owner-admitted"
                or admission.get("provider") != "driver:launchwright-verifier"
                or admission.get("receipt_sha256") != receipt_sha
                or admission.get("driver_host_isolation_accepted") is not True
                or admission.get("platform_execution_authority") is not False
                or admission.get("dimension") != dimension
                or admission.get("scope") != SCOPES[dimension]
            ):
                raise AssertionError(f"{dimension} Host receipt lost exact bounded custody")
            receipts[dimension] = receipt_sha
            scopes[dimension] = admission["scope"]
            descriptor_digests[dimension] = receipt["descriptor_sha256"]
            if dimension == "format":
                first_format_paths = paths
                first_format_bytes = bytes_by_id
                first_format_input = verifier_input
                first_format_file = manifest_file
                first_format_receipt = receipt
                first_record_input = record_input

        summary = client.read(
            "verification-summary", {"candidate_id": candidate["id"]}
        )
        if summary.get("state") != "PASS" or summary.get("canonical_passes") != 4:
            raise AssertionError("bounded canonical verifier dimensions did not become PASS")

        inspected = client.read("candidate-inspect", {"id": candidate["id"]})
        verification_gate = next(
            (gate for gate in inspected.get("gates", []) if gate.get("name") == "verification-records"),
            None,
        )
        required_checks = (
            verification_gate.get("details", {}).get("required", [])
            if verification_gate
            else []
        )
        required_states = {
            item.get("dimension"): item.get("state") for item in required_checks
        }
        if (
            verification_gate is None
            or verification_gate.get("state") != "PASS"
            or required_states != {dimension: "PASS" for dimension in DIMENSIONS}
        ):
            raise AssertionError(
                "candidate verification gate did not resolve every required bounded dimension to PASS"
            )

        if not all(
            value is not None
            for value in (
                first_format_paths,
                first_format_bytes,
                first_format_input,
                first_format_file,
                first_format_receipt,
                first_record_input,
            )
        ):
            raise AssertionError("format acceptance state was not retained")

        # Negative control 1: mutate one staged byte set without changing frozen binding.
        artifact_id = artifacts[0]["id"]
        artifact_path = first_format_paths[artifact_id]  # type: ignore[index]
        original_bytes = first_format_bytes[artifact_id]  # type: ignore[index]
        artifact_path.write_bytes(original_bytes + b"tamper\n")
        artifact_path.chmod(0o600)
        tampered = verifier_execute(
            fixture, "format", first_format_file, expected_ok=True  # type: ignore[arg-type]
        )["data"]
        artifact_path.write_bytes(original_bytes)
        artifact_path.chmod(0o600)
        artifact_substitution_rejected = (
            tampered.get("state") == "FAIL"
            and any(
                finding.get("code") == "ARTIFACT_DIGEST_MISMATCH"
                for finding in tampered.get("findings", [])
            )
        )

        # Negative control 2: mutate the frozen snapshot but leave its digest unchanged.
        stale_snapshot = json.loads(json.dumps(first_format_input))
        stale_snapshot["candidate_manifest"]["destination"] = "forged-destination"
        stale_path = fixture.paths["project-graph-fixture"] / "r30-stale-snapshot.json"
        host.write_private_json(stale_path, stale_snapshot)
        snapshot_rejected = verifier_execute(
            fixture, "format", stale_path.name, expected_ok=False
        ).get("ok") is False

        # Negative control 3: exact receipt bytes for another candidate digest.
        substituted = json.loads(json.dumps(first_format_receipt))
        substituted["report"]["candidate_sha256"] = "0" * 64
        bad_path = fixture.paths["verification-receipts"] / "r30-substituted.json"
        host.write_private_json(bad_path, substituted)
        bad_input = json.loads(json.dumps(first_record_input))
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

        dimension_controls = negative_dimension_controls(fixture, artifacts, candidate)
        if not all(dimension_controls.values()):
            raise AssertionError("one or more bounded verifier negative controls failed")

        return {
            "manifest_validated": True,
            "conformance": conformance,
            "candidate_id": candidate["id"],
            "candidate_sha256": candidate["data"]["candidate_sha256"],
            "candidate_manifest_sha256": domain_digest(
                "launchwright/candidate-manifest/1", candidate["data"]["manifest"]
            ),
            "artifact_sha256": {
                artifact["id"]: artifact["data"]["sha256"] for artifact in artifacts
            },
            "verifier_executable_sha256": host.sha256(fixture.verifier),
            "verifier_descriptor_sha256": descriptor_digests,
            "receipt_sha256": receipts,
            "scopes": scopes,
            "effective_state": summary["state"],
            "canonical_passes": summary["canonical_passes"],
            "candidate_verification_gate": {
                "state": verification_gate["state"],
                "required": required_states,
            },
            "artifact_substitution_rejected": artifact_substitution_rejected,
            "candidate_snapshot_digest_rejected": snapshot_rejected,
            "receipt_candidate_substitution_rejected": True,
            **dimension_controls,
        }
    finally:
        fixture.close()


def denied_flow() -> dict[str, Any]:
    with VerifierFixture("policy-denied", allow_verifier=False) as fixture:
        denied = fixture.invoke("driver.launchwright-verifier.probe", {}, ok=False)
        host.assert_error(denied, "policy", "permission", "denied", "authorization")
        return {
            "driver_allowlisted": False,
            "execution_rejected": True,
        }


def main() -> None:
    if os.getenv("GITHUB_ACTIONS") != "true":
        raise SystemExit("R30 verifier acceptance is CI-only")
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
        "schema_version": "launchwright-verifier-runtime-acceptance/2",
        "passed": True,
        "launchwright_sha": os.environ.get("GITHUB_SHA"),
        "semwright_sha": observed_sha,
        "native_sdk": "1.0.0",
        "authority": {
            "scope": "owner-staged-bounded-verifier-dimensions",
            "canonical_verifier_runtime_admitted": True,
            "canonical_dimensions_admitted": list(DIMENSIONS),
            "bounded_scopes": SCOPES,
            "broker_policy_path_observed": True,
            "driver_host_isolation_accepted": True,
            "native_sdk_review_recorded": True,
            "artifact_substitution_rejected": True,
            "candidate_snapshot_digest_rejected": True,
            "receipt_candidate_substitution_rejected": True,
            "dimension_negative_controls_passed": True,
            "platform_execution_authority": False,
            "external_customer_acceptance": False,
            "semantic_authority": False,
            "editorial_authority": False,
            "privacy_compliance_authority": False,
            "legal_rights_authority": False,
            "wcag_conformance_authority": False,
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
