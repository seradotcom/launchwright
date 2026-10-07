// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded, read-only Launchwright format verifier executed by Semwright Driver Host.
//! It verifies only owner-staged candidate artifact bytes. It does not confer Platform,
//! customer, editorial, publication, or general semantic authority.

use async_trait::async_trait;
use semwright_driver_sdk::{
    Capability, Driver, DriverInterfaces, descriptor_digest, serve, workspace_mount,
};
use semwright_types::{CommandDescriptor, Error, ErrorCode, Idempotency, Result, Risk};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

const PROVIDER_ID: &str = "launchwright-verifier";
const COMMAND: &str = "driver.launchwright-verifier.format";
const PROBE_COMMAND: &str = "driver.launchwright-verifier.probe";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_MANIFEST_BYTES: u64 = 1_048_576;
const MAX_ARTIFACT_BYTES: u64 = 16_777_216;
const MAX_TOTAL_BYTES: u64 = 67_108_864;
const MAX_ARTIFACTS: usize = 128;

fn capability() -> Capability {
    Capability {
        descriptor: CommandDescriptor {
            name: COMMAND.into(),
            version: VERSION.into(),
            description: "Verify exact owner-staged Launchwright candidate artifact bytes and bounded format constraints".into(),
            input_schema: json!({
                "type":"object",
                "properties":{
                    "manifest_rel":{"type":"string","minLength":1,"maxLength":512}
                },
                "required":["manifest_rel"],
                "additionalProperties":false
            }),
            output_schema: json!({
                "type":"object",
                "properties":{
                    "schema_version":{"const":"launchwright-verifier-result/1"},
                    "state":{"enum":["PASS","FAIL"]},
                    "candidate_id":{"type":"string"},
                    "candidate_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                    "candidate_manifest_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                    "dimension":{"const":"format"},
                    "coverage":{"type":"object"},
                    "artifact_bindings":{"type":"array"},
                    "findings":{"type":"array"}
                },
                "required":["schema_version","state","candidate_id","candidate_sha256","candidate_manifest_sha256","dimension","coverage","artifact_bindings","findings"],
                "additionalProperties":false
            }),
            requires: vec!["driver:launchwright-verifier".into()],
            risk: Risk::ReadOnly,
            idempotency: Idempotency::ReadOnly,
            timeout_ms: 10_000,
            dry_run: true,
            interactive_consent: false,
            backends: vec!["driver:launchwright-verifier".into()],
        },
        aliases: vec!["launchwright-format".into()],
        tags: vec!["verification".into(), "launchwright".into(), "format".into()],
        object_types: vec![],
    }
}

fn probe_capability() -> Capability {
    Capability {
        descriptor: CommandDescriptor {
            name: PROBE_COMMAND.into(),
            version: VERSION.into(),
            description:
                "Return the bounded Launchwright verifier scope without reading candidate data"
                    .into(),
            input_schema: json!({"type":"object","properties":{},"additionalProperties":false}),
            output_schema: json!({
                "type":"object",
                "properties":{
                    "ok":{"const":true},
                    "scope":{"const":"owner-staged-format-only"},
                    "external_authority":{"const":false}
                },
                "required":["ok","scope","external_authority"],
                "additionalProperties":false
            }),
            requires: vec!["driver:launchwright-verifier".into()],
            risk: Risk::ReadOnly,
            idempotency: Idempotency::ReadOnly,
            timeout_ms: 2_000,
            dry_run: true,
            interactive_consent: false,
            backends: vec!["driver:launchwright-verifier".into()],
        },
        aliases: vec!["launchwright-verifier-probe".into()],
        tags: vec![
            "verification".into(),
            "launchwright".into(),
            "conformance".into(),
        ],
        object_types: vec![],
    }
}

fn invalid(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::InvalidArgument, message.into())
}

fn safe_relative(raw: &str) -> Result<PathBuf> {
    if raw.is_empty() || raw.len() > 512 {
        return Err(invalid("Verifier path is outside the bounded contract"));
    }
    let path = Path::new(raw);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid("Verifier path must be a normal relative path"));
    }
    Ok(path.to_path_buf())
}

fn mount_file(root: &Path, raw: &str, max_bytes: u64) -> Result<(PathBuf, u64)> {
    let rel = safe_relative(raw)?;
    let root = root.canonicalize()?;
    let joined = root.join(rel);
    let meta = fs::symlink_metadata(&joined)?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > max_bytes {
        return Err(invalid("Verifier input is not a bounded regular file"));
    }
    let canonical = joined.canonicalize()?;
    if !canonical.starts_with(&root) {
        return Err(invalid("Verifier input escapes its owner grant"));
    }
    Ok((canonical, meta.len()))
}

fn exact_string<'a>(value: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    let text = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("Verifier manifest missing {key}")))?;
    if text.is_empty() || text.len() > max {
        return Err(invalid(format!("Verifier manifest has invalid {key}")));
    }
    Ok(text)
}

fn exact_sha(value: &Value, key: &str) -> Result<String> {
    let text = exact_string(value, key, 64)?;
    if text.len() != 64
        || !text
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(invalid(format!(
            "Verifier manifest has invalid {key} digest"
        )));
    }
    Ok(text.to_owned())
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn format_finding(code: &str, severity: &str, message: &str, resource_id: &str) -> Value {
    json!({
        "code":code,
        "severity":severity,
        "message":message,
        "resource_id":resource_id
    })
}

fn inspect_format(mime: &str, bytes: &[u8], resource_id: &str, findings: &mut Vec<Value>) {
    let media_type = mime
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match media_type.as_str() {
        "text/markdown" | "text/plain" | "text/html" | "text/vtt" => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                findings.push(format_finding(
                    "FORMAT_UTF8",
                    "error",
                    "Text artifact is not valid UTF-8",
                    resource_id,
                ));
                return;
            };
            if text.contains('\0') {
                findings.push(format_finding(
                    "FORMAT_NUL",
                    "error",
                    "Text artifact contains a NUL byte",
                    resource_id,
                ));
            }
            if media_type == "text/vtt" && !text.trim_start().starts_with("WEBVTT") {
                findings.push(format_finding(
                    "FORMAT_WEBVTT_HEADER",
                    "error",
                    "VTT artifact is missing the WEBVTT header",
                    resource_id,
                ));
            }
        }
        "application/json" => {
            if serde_json::from_slice::<Value>(bytes).is_err() {
                findings.push(format_finding(
                    "FORMAT_JSON",
                    "error",
                    "JSON artifact cannot be parsed",
                    resource_id,
                ));
            }
        }
        _ => findings.push(format_finding(
            "FORMAT_UNSUPPORTED_MIME",
            "error",
            "Artifact MIME type is outside the bounded Launchwright format verifier",
            resource_id,
        )),
    }
}

fn verify(args: &Value) -> Result<Value> {
    let object = args
        .as_object()
        .ok_or_else(|| invalid("Verifier arguments must be an object"))?;
    if object.len() != 1 {
        return Err(invalid("Verifier arguments contain unknown fields"));
    }
    let manifest_rel = object
        .get("manifest_rel")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("manifest_rel is required"))?;

    let root = workspace_mount("verification-input")?;
    let (manifest_path, _) = mount_file(&root, manifest_rel, MAX_MANIFEST_BYTES)?;
    let manifest_bytes = fs::read(&manifest_path)?;
    let manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| invalid("Verifier manifest is not valid JSON"))?;
    let manifest_object = manifest
        .as_object()
        .ok_or_else(|| invalid("Verifier manifest must be an object"))?;

    let allowed = [
        "schema_version",
        "candidate_id",
        "candidate_sha256",
        "candidate_manifest_sha256",
        "dimension",
        "artifacts",
    ];
    if manifest_object
        .keys()
        .any(|key| !allowed.contains(&key.as_str()))
        || manifest_object.len() != allowed.len()
    {
        return Err(invalid("Verifier manifest shape is not exact"));
    }
    if exact_string(&manifest, "schema_version", 64)? != "launchwright-verifier-input/1" {
        return Err(invalid("Unsupported verifier input schema"));
    }
    if exact_string(&manifest, "dimension", 32)? != "format" {
        return Err(invalid(
            "This verifier is authoritative only for the format dimension",
        ));
    }

    let candidate_id = exact_string(&manifest, "candidate_id", 96)?.to_owned();
    let candidate_sha256 = exact_sha(&manifest, "candidate_sha256")?;
    let candidate_manifest_sha256 = exact_sha(&manifest, "candidate_manifest_sha256")?;
    let artifacts = manifest
        .get("artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Verifier manifest artifacts must be an array"))?;
    if artifacts.is_empty() || artifacts.len() > MAX_ARTIFACTS {
        return Err(invalid(
            "Verifier manifest artifact count is outside the bounded contract",
        ));
    }

    let mut bindings = Vec::with_capacity(artifacts.len());
    let mut findings = Vec::new();
    let mut total_bytes = 0u64;
    let mut seen = std::collections::BTreeSet::new();

    for artifact in artifacts {
        let map = artifact
            .as_object()
            .ok_or_else(|| invalid("Verifier artifact binding must be an object"))?;
        let allowed = ["id", "relative_path", "sha256", "bytes", "mime"];
        if map.keys().any(|key| !allowed.contains(&key.as_str())) || map.len() != allowed.len() {
            return Err(invalid("Verifier artifact binding shape is not exact"));
        }
        let id = exact_string(artifact, "id", 96)?.to_owned();
        if !seen.insert(id.clone()) {
            return Err(invalid("Verifier artifact IDs must be unique"));
        }
        let relative_path = exact_string(artifact, "relative_path", 512)?;
        let expected_sha = exact_sha(artifact, "sha256")?;
        let expected_bytes = artifact
            .get("bytes")
            .and_then(Value::as_u64)
            .ok_or_else(|| invalid("Verifier artifact bytes must be an unsigned integer"))?;
        if expected_bytes > MAX_ARTIFACT_BYTES {
            return Err(invalid("Verifier artifact exceeds the per-file budget"));
        }
        let mime = exact_string(artifact, "mime", 128)?.to_owned();
        let (path, file_bytes) = mount_file(&root, relative_path, MAX_ARTIFACT_BYTES)?;
        total_bytes = total_bytes
            .checked_add(file_bytes)
            .ok_or_else(|| invalid("Verifier artifact byte count overflow"))?;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(invalid(
                "Verifier artifact set exceeds the total byte budget",
            ));
        }
        let bytes = fs::read(path)?;
        let observed_sha = sha256(&bytes);
        if file_bytes != expected_bytes {
            findings.push(format_finding(
                "ARTIFACT_SIZE_MISMATCH",
                "blocker",
                "Artifact byte count differs from the frozen candidate binding",
                &id,
            ));
        }
        if observed_sha != expected_sha {
            findings.push(format_finding(
                "ARTIFACT_DIGEST_MISMATCH",
                "blocker",
                "Artifact digest differs from the frozen candidate binding",
                &id,
            ));
        }
        inspect_format(&mime, &bytes, &id, &mut findings);
        bindings.push(json!({
            "id":id,
            "sha256":observed_sha,
            "bytes":file_bytes,
            "mime":mime,
            "result":if findings.iter().any(|finding| finding.get("resource_id").and_then(Value::as_str)==Some(id.as_str()) && matches!(finding.get("severity").and_then(Value::as_str), Some("error"|"blocker"))) {"FAIL"} else {"PASS"}
        }));
    }

    let state = if findings.iter().any(|finding| {
        matches!(
            finding.get("severity").and_then(Value::as_str),
            Some("error" | "blocker")
        )
    }) {
        "FAIL"
    } else {
        "PASS"
    };

    Ok(json!({
        "schema_version":"launchwright-verifier-result/1",
        "state":state,
        "candidate_id":candidate_id,
        "candidate_sha256":candidate_sha256,
        "candidate_manifest_sha256":candidate_manifest_sha256,
        "dimension":"format",
        "coverage":{"checked":bindings.len(),"total":artifacts.len()},
        "artifact_bindings":bindings,
        "findings":findings
    }))
}

struct LaunchwrightVerifier;

#[async_trait]
impl Driver for LaunchwrightVerifier {
    fn id(&self) -> &str {
        PROVIDER_ID
    }

    fn version(&self) -> &str {
        VERSION
    }

    fn interfaces(&self) -> DriverInterfaces {
        DriverInterfaces {
            health: true,
            ..Default::default()
        }
    }

    async fn capabilities(&mut self) -> Result<Vec<Capability>> {
        Ok(vec![probe_capability(), capability()])
    }

    async fn execute(&mut self, command: &str, pinned_digest: &str, args: Value) -> Result<Value> {
        let selected = match command {
            PROBE_COMMAND => probe_capability(),
            COMMAND => capability(),
            _ => {
                return Err(Error::new(
                    ErrorCode::StaleReference,
                    "Verifier command is not the pinned capability",
                ));
            }
        };
        if descriptor_digest(&selected.descriptor)? != pinned_digest {
            return Err(Error::new(
                ErrorCode::StaleReference,
                "Verifier descriptor digest changed",
            ));
        }
        if command == PROBE_COMMAND {
            if args.as_object().is_none_or(|value| !value.is_empty()) {
                return Err(invalid("Verifier probe accepts an empty object"));
            }
            return Ok(json!({
                "ok":true,
                "scope":"owner-staged-format-only",
                "external_authority":false
            }));
        }
        verify(&args)
    }

    async fn health(&mut self) -> Result<Value> {
        Ok(json!({
            "healthy":true,
            "provider":PROVIDER_ID,
            "version":VERSION,
            "scope":"owner-staged-format-only"
        }))
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = serve(LaunchwrightVerifier).await {
        eprintln!("{error}");
        std::process::exit(error.exit_code());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_media_type_parameters_are_accepted() {
        let mut findings = Vec::new();
        inspect_format(
            "text/markdown; charset=utf-8",
            b"# Release\n\nOwned verifier fixture.\n",
            "artifact-1",
            &mut findings,
        );
        assert!(findings.is_empty());
    }

    #[test]
    fn vtt_media_type_parameters_still_require_header() {
        let mut findings = Vec::new();
        inspect_format(
            "text/vtt; charset=UTF-8",
            b"not a vtt",
            "artifact-2",
            &mut findings,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0]["code"], "FORMAT_WEBVTT_HEADER");
    }

    #[test]
    fn unsupported_media_type_still_fails_closed() {
        let mut findings = Vec::new();
        inspect_format(
            "application/octet-stream; name=opaque.bin",
            b"opaque",
            "artifact-3",
            &mut findings,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0]["code"], "FORMAT_UNSUPPORTED_MIME");
    }
}
