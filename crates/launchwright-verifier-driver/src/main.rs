// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded, read-only Launchwright verifier executed by Semwright Driver Host.
//! Every accepted dimension is deterministic and explicitly scoped. It does not
//! confer Platform, customer, editorial, legal-compliance, publication, or
//! general semantic authority.

use async_trait::async_trait;
use semwright_driver_sdk::{
    Capability, Driver, DriverInterfaces, descriptor_digest, serve, workspace_mount,
};
use semwright_native_sdk::cooperation::exact_request_digest;
use semwright_types::{CommandDescriptor, Error, ErrorCode, Idempotency, Result, Risk};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    path::{Component, Path, PathBuf},
};

const PROVIDER_ID: &str = "launchwright-verifier";
const PROBE_COMMAND: &str = "driver.launchwright-verifier.probe";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const INPUT_SCHEMA: &str = "launchwright-verifier-input/2";
const RESULT_SCHEMA: &str = "launchwright-verifier-result/2";
const MAX_MANIFEST_BYTES: u64 = 1_048_576;
const MAX_ARTIFACT_BYTES: u64 = 16_777_216;
const MAX_TOTAL_BYTES: u64 = 67_108_864;
const MAX_ARTIFACTS: usize = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Dimension {
    Format,
    Privacy,
    Rights,
    Accessibility,
}

impl Dimension {
    const ALL: [Self; 4] = [
        Self::Format,
        Self::Privacy,
        Self::Rights,
        Self::Accessibility,
    ];

    fn name(self) -> &'static str {
        match self {
            Self::Format => "format",
            Self::Privacy => "privacy",
            Self::Rights => "rights",
            Self::Accessibility => "accessibility",
        }
    }

    fn command(self) -> &'static str {
        match self {
            Self::Format => "driver.launchwright-verifier.format",
            Self::Privacy => "driver.launchwright-verifier.privacy",
            Self::Rights => "driver.launchwright-verifier.rights",
            Self::Accessibility => "driver.launchwright-verifier.accessibility",
        }
    }

    fn scope(self) -> &'static str {
        match self {
            Self::Format => "owner-staged-artifact-format-only",
            Self::Privacy => "owner-staged-artifact-secret-patterns-only",
            Self::Rights => "frozen-rights-declarations-only",
            Self::Accessibility => "owner-staged-html-static-structure-only",
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Format => {
                "Verify exact candidate artifact bytes and bounded serialization/format constraints"
            }
            Self::Privacy => {
                "Scan exact candidate artifact bytes for a bounded set of secret-exposure patterns"
            }
            Self::Rights => {
                "Verify exact frozen candidate rights declarations are present, bounded, and non-restricted"
            }
            Self::Accessibility => {
                "Verify bounded static HTML structure only; this is not WCAG conformance"
            }
        }
    }

    fn from_command(command: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|dimension| dimension.command() == command)
    }
}

fn capability(dimension: Dimension) -> Capability {
    Capability {
        descriptor: CommandDescriptor {
            name: dimension.command().into(),
            version: VERSION.into(),
            description: dimension.description().into(),
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
                    "schema_version":{"const":RESULT_SCHEMA},
                    "state":{"enum":["PASS","FAIL"]},
                    "candidate_id":{"type":"string"},
                    "candidate_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                    "candidate_manifest_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                    "dimension":{"const":dimension.name()},
                    "scope":{"const":dimension.scope()},
                    "coverage":{"type":"object"},
                    "artifact_bindings":{"type":"array"},
                    "findings":{"type":"array"}
                },
                "required":["schema_version","state","candidate_id","candidate_sha256","candidate_manifest_sha256","dimension","scope","coverage","artifact_bindings","findings"],
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
        aliases: vec![format!("launchwright-{}", dimension.name())],
        tags: vec![
            "verification".into(),
            "launchwright".into(),
            dimension.name().into(),
        ],
        object_types: vec![],
    }
}

fn probe_capability() -> Capability {
    Capability {
        descriptor: CommandDescriptor {
            name: PROBE_COMMAND.into(),
            version: VERSION.into(),
            description:
                "Return the bounded Launchwright verifier dimensions without reading candidate data"
                    .into(),
            input_schema: json!({"type":"object","properties":{},"additionalProperties":false}),
            output_schema: json!({
                "type":"object",
                "properties":{
                    "ok":{"const":true},
                    "scope":{"const":"owner-staged-bounded-verifier-dimensions"},
                    "dimensions":{"type":"array","minItems":4,"maxItems":4},
                    "external_authority":{"const":false}
                },
                "required":["ok","scope","dimensions","external_authority"],
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

fn finding(code: &str, severity: &str, message: &str, resource_id: Option<&str>) -> Value {
    let mut value = json!({
        "code":code,
        "severity":severity,
        "message":message
    });
    if let Some(resource_id) = resource_id {
        value
            .as_object_mut()
            .expect("finding object")
            .insert("resource_id".into(), Value::String(resource_id.into()));
    }
    value
}

fn media_type(mime: &str) -> String {
    mime.split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn text_bytes<'a>(
    mime: &str,
    bytes: &'a [u8],
    resource_id: &str,
    findings: &mut Vec<Value>,
    code: &str,
) -> Option<&'a str> {
    let kind = media_type(mime);
    if !matches!(
        kind.as_str(),
        "text/markdown" | "text/plain" | "text/html" | "text/vtt" | "application/json"
    ) {
        findings.push(finding(
            code,
            "error",
            "Artifact MIME type is outside this bounded verifier scope",
            Some(resource_id),
        ));
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text),
        Err(_) => {
            findings.push(finding(
                code,
                "error",
                "Artifact is not valid UTF-8 for this bounded verifier scope",
                Some(resource_id),
            ));
            None
        }
    }
}

fn inspect_format(mime: &str, bytes: &[u8], resource_id: &str, findings: &mut Vec<Value>) {
    let kind = media_type(mime);
    match kind.as_str() {
        "text/markdown" | "text/plain" | "text/html" | "text/vtt" => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                findings.push(finding(
                    "FORMAT_UTF8",
                    "error",
                    "Text artifact is not valid UTF-8",
                    Some(resource_id),
                ));
                return;
            };
            if text.contains('\0') {
                findings.push(finding(
                    "FORMAT_NUL",
                    "error",
                    "Text artifact contains a NUL byte",
                    Some(resource_id),
                ));
            }
            if kind == "text/vtt" && !text.trim_start().starts_with("WEBVTT") {
                findings.push(finding(
                    "FORMAT_WEBVTT_HEADER",
                    "error",
                    "VTT artifact is missing the WEBVTT header",
                    Some(resource_id),
                ));
            }
        }
        "application/json" => {
            if serde_json::from_slice::<Value>(bytes).is_err() {
                findings.push(finding(
                    "FORMAT_JSON",
                    "error",
                    "JSON artifact cannot be parsed",
                    Some(resource_id),
                ));
            }
        }
        _ => findings.push(finding(
            "FORMAT_UNSUPPORTED_MIME",
            "error",
            "Artifact MIME type is outside the bounded Launchwright format verifier",
            Some(resource_id),
        )),
    }
}

fn secret_marker(text: &str) -> Option<&'static str> {
    for marker in [
        "-----BEGIN PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
    ] {
        if text.contains(marker) {
            return Some("private-key material");
        }
    }
    if text.as_bytes().windows(20).any(|window| {
        window.starts_with(b"AKIA")
            && window[4..]
                .iter()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    }) {
        return Some("AWS-style access key");
    }
    if text.as_bytes().windows(40).any(|window| {
        window.starts_with(b"ghp_") && window[4..].iter().all(|b| b.is_ascii_alphanumeric())
    }) {
        return Some("GitHub-style personal access token");
    }
    None
}

fn normalized_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn non_empty_secret_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => true,
    }
}

fn json_secret_key(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let key_name = normalized_key(key);
                if matches!(
                    key_name.as_str(),
                    "password"
                        | "passwd"
                        | "secret"
                        | "apikey"
                        | "accesstoken"
                        | "refreshtoken"
                        | "privatekey"
                ) && non_empty_secret_value(child)
                {
                    return Some(key.clone());
                }
                if let Some(found) = json_secret_key(child) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(json_secret_key),
        Value::String(text) => secret_marker(text).map(str::to_owned),
        _ => None,
    }
}

fn inspect_privacy(mime: &str, bytes: &[u8], resource_id: &str, findings: &mut Vec<Value>) {
    let Some(text) = text_bytes(
        mime,
        bytes,
        resource_id,
        findings,
        "PRIVACY_UNSUPPORTED_ARTIFACT",
    ) else {
        return;
    };
    if let Some(kind) = secret_marker(text) {
        findings.push(finding(
            "PRIVACY_SECRET_PATTERN",
            "blocker",
            &format!("Artifact contains a bounded secret pattern: {kind}"),
            Some(resource_id),
        ));
    }
    if media_type(mime) == "application/json" {
        match serde_json::from_str::<Value>(text) {
            Ok(value) => {
                if let Some(key) = json_secret_key(&value) {
                    findings.push(finding(
                        "PRIVACY_SECRET_FIELD",
                        "blocker",
                        &format!(
                            "JSON contains a non-empty field or value matching the bounded secret scan: {key}"
                        ),
                        Some(resource_id),
                    ));
                }
            }
            Err(_) => findings.push(finding(
                "PRIVACY_JSON_PARSE",
                "error",
                "JSON must parse before the bounded privacy scan can pass",
                Some(resource_id),
            )),
        }
    }
}

fn opening_tags<'a>(lower: &'a str, tag_name: &str) -> Vec<&'a str> {
    let needle = format!("<{tag_name}");
    let mut result = Vec::new();
    let mut cursor = 0usize;
    while let Some(offset) = lower[cursor..].find(&needle) {
        let start = cursor + offset;
        let boundary = lower
            .as_bytes()
            .get(start + needle.len())
            .copied()
            .is_none_or(|b| b.is_ascii_whitespace() || b == b'/' || b == b'>');
        if boundary {
            if let Some(end) = lower[start..].find('>') {
                result.push(&lower[start..=start + end]);
                cursor = start + end + 1;
                continue;
            }
        }
        cursor = start + needle.len();
    }
    result
}

fn has_attribute(tag: &str, attribute: &str) -> bool {
    let needle = format!("{attribute}=");
    tag.split_ascii_whitespace()
        .skip(1)
        .any(|part| part.trim_start_matches('/').starts_with(&needle))
}

fn has_nonempty_attribute(tag: &str, attribute: &str) -> bool {
    let needle = format!("{attribute}=");
    tag.split_ascii_whitespace().skip(1).any(|part| {
        let part = part.trim_start_matches('/');
        if !part.starts_with(&needle) {
            return false;
        }
        let value = part[needle.len()..].trim_matches(|c| matches!(c, '"' | '\'' | '>'));
        !value.is_empty()
    })
}

fn inspect_accessibility(
    mime: &str,
    bytes: &[u8],
    resource_id: &str,
    findings: &mut Vec<Value>,
) -> bool {
    if media_type(mime) != "text/html" {
        return false;
    }
    let Some(text) = text_bytes(mime, bytes, resource_id, findings, "ACCESSIBILITY_UTF8") else {
        return true;
    };
    let lower = text.to_ascii_lowercase();
    let html = opening_tags(&lower, "html");
    if html.len() != 1 || !has_nonempty_attribute(html[0], "lang") {
        findings.push(finding(
            "ACCESSIBILITY_HTML_LANG",
            "error",
            "Static HTML scope requires exactly one html element with a non-empty lang attribute",
            Some(resource_id),
        ));
    }
    let mains = opening_tags(&lower, "main");
    if mains.len() != 1 {
        findings.push(finding(
            "ACCESSIBILITY_MAIN",
            "error",
            "Static HTML scope requires exactly one main landmark",
            Some(resource_id),
        ));
    }
    let title_ok = lower
        .find("<title>")
        .and_then(|start| {
            let body = start + "<title>".len();
            lower[body..]
                .find("</title>")
                .map(|end| &text[body..body + end])
        })
        .is_some_and(|title| !title.trim().is_empty());
    if !title_ok {
        findings.push(finding(
            "ACCESSIBILITY_TITLE",
            "error",
            "Static HTML scope requires a non-empty title element",
            Some(resource_id),
        ));
    }
    for tag in opening_tags(&lower, "img") {
        if !has_attribute(tag, "alt") {
            findings.push(finding(
                "ACCESSIBILITY_IMG_ALT",
                "error",
                "Every image in the bounded static HTML scope requires an alt attribute",
                Some(resource_id),
            ));
        }
    }
    true
}

fn inspect_rights(candidate_manifest: &Value, findings: &mut Vec<Value>) {
    let Some(rights) = candidate_manifest.get("rights").and_then(Value::as_array) else {
        findings.push(finding(
            "RIGHTS_DECLARATIONS_MISSING",
            "blocker",
            "Frozen candidate has no rights declaration array",
            None,
        ));
        return;
    };
    if rights.is_empty() {
        findings.push(finding(
            "RIGHTS_EVIDENCE_MISSING",
            "blocker",
            "Frozen candidate protects no rights evidence",
            None,
        ));
        return;
    }
    for entry in rights {
        let Some(map) = entry.as_object() else {
            findings.push(finding(
                "RIGHTS_DECLARATION_INVALID",
                "blocker",
                "Frozen rights declaration is not an object",
                None,
            ));
            continue;
        };
        let rights_value = map
            .get("rights")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        match rights_value {
            "owned" | "licensed" => {}
            "restricted" => findings.push(finding(
                "RIGHTS_RESTRICTED",
                "blocker",
                "Frozen candidate contains explicitly restricted rights evidence",
                None,
            )),
            _ => findings.push(finding(
                "RIGHTS_UNKNOWN",
                "error",
                "Frozen candidate contains unknown or unsupported rights evidence",
                None,
            )),
        }
        let basis = map
            .get("rights_basis")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        if basis.is_empty() || basis == "unknown" {
            findings.push(finding(
                "RIGHTS_BASIS_UNKNOWN",
                "error",
                "Frozen rights declaration lacks an explicit evidence basis",
                None,
            ));
        }
    }
}

fn validate_candidate_snapshot(
    candidate_manifest: &Value,
    candidate_sha256: &str,
    candidate_manifest_sha256: &str,
) -> Result<()> {
    let object = candidate_manifest
        .as_object()
        .ok_or_else(|| invalid("candidate_manifest must be an object"))?;
    if object.get("schema_version").and_then(Value::as_str) != Some("launchwright-candidate/2") {
        return Err(invalid(
            "Canonical verifier requires a launchwright-candidate/2 frozen snapshot",
        ));
    }
    let observed_manifest =
        exact_request_digest("launchwright/candidate-manifest/1", candidate_manifest)?;
    if observed_manifest != candidate_manifest_sha256 {
        return Err(Error::new(
            ErrorCode::Conflict,
            "Verifier candidate manifest bytes do not match the pinned manifest digest",
        ));
    }
    let observed_candidate = exact_request_digest("launchwright/candidate/1", candidate_manifest)?;
    if observed_candidate != candidate_sha256 {
        return Err(Error::new(
            ErrorCode::Conflict,
            "Verifier candidate snapshot does not match the pinned candidate digest",
        ));
    }
    Ok(())
}

fn verify(args: &Value, dimension: Dimension) -> Result<Value> {
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
        "candidate_manifest",
        "artifacts",
    ];
    if manifest_object
        .keys()
        .any(|key| !allowed.contains(&key.as_str()))
        || manifest_object.len() != allowed.len()
    {
        return Err(invalid("Verifier manifest shape is not exact"));
    }
    if exact_string(&manifest, "schema_version", 64)? != INPUT_SCHEMA {
        return Err(invalid("Unsupported verifier input schema"));
    }
    if exact_string(&manifest, "dimension", 32)? != dimension.name() {
        return Err(invalid(
            "Verifier input dimension does not match the pinned command",
        ));
    }

    let candidate_id = exact_string(&manifest, "candidate_id", 96)?.to_owned();
    let candidate_sha256 = exact_sha(&manifest, "candidate_sha256")?;
    let candidate_manifest_sha256 = exact_sha(&manifest, "candidate_manifest_sha256")?;
    let candidate_manifest = manifest
        .get("candidate_manifest")
        .ok_or_else(|| invalid("Verifier input requires candidate_manifest"))?;
    validate_candidate_snapshot(
        candidate_manifest,
        &candidate_sha256,
        &candidate_manifest_sha256,
    )?;

    let artifacts = manifest
        .get("artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Verifier manifest artifacts must be an array"))?;
    if artifacts.is_empty() || artifacts.len() > MAX_ARTIFACTS {
        return Err(invalid(
            "Verifier manifest artifact count is outside the bounded contract",
        ));
    }
    let frozen_artifacts = candidate_manifest
        .get("artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Frozen candidate artifacts must be an array"))?;
    if artifacts.len() != frozen_artifacts.len() {
        return Err(Error::new(
            ErrorCode::Conflict,
            "Verifier staged artifact cardinality differs from the frozen candidate",
        ));
    }

    let mut bindings = Vec::with_capacity(artifacts.len());
    let mut findings = Vec::new();
    let mut total_bytes = 0u64;
    let mut seen = BTreeSet::new();
    let mut html_artifacts = 0usize;

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

        let frozen = frozen_artifacts
            .iter()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| {
                Error::new(
                    ErrorCode::PermissionDenied,
                    "Verifier staged artifact is outside the frozen candidate",
                )
            })?;
        if frozen.get("sha256").and_then(Value::as_str) != Some(expected_sha.as_str())
            || frozen.get("bytes").and_then(Value::as_u64) != Some(expected_bytes)
            || frozen.get("mime").and_then(Value::as_str) != Some(mime.as_str())
        {
            return Err(Error::new(
                ErrorCode::Conflict,
                "Verifier staged artifact binding differs from the frozen candidate manifest",
            ));
        }

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
        let before = findings.len();
        if file_bytes != expected_bytes {
            findings.push(finding(
                "ARTIFACT_SIZE_MISMATCH",
                "blocker",
                "Artifact byte count differs from the frozen candidate binding",
                Some(&id),
            ));
        }
        if observed_sha != expected_sha {
            findings.push(finding(
                "ARTIFACT_DIGEST_MISMATCH",
                "blocker",
                "Artifact digest differs from the frozen candidate binding",
                Some(&id),
            ));
        }
        match dimension {
            Dimension::Format => inspect_format(&mime, &bytes, &id, &mut findings),
            Dimension::Privacy => inspect_privacy(&mime, &bytes, &id, &mut findings),
            Dimension::Accessibility => {
                if inspect_accessibility(&mime, &bytes, &id, &mut findings) {
                    html_artifacts += 1;
                }
            }
            Dimension::Rights => {}
        }
        let failed = findings[before..].iter().any(|finding| {
            matches!(
                finding.get("severity").and_then(Value::as_str),
                Some("error" | "blocker")
            )
        });
        bindings.push(json!({
            "id":id,
            "sha256":observed_sha,
            "bytes":file_bytes,
            "mime":mime,
            "result":if failed {"FAIL"} else {"PASS"}
        }));
    }

    if seen.len() != frozen_artifacts.len() {
        return Err(Error::new(
            ErrorCode::Conflict,
            "Verifier did not stage every frozen candidate artifact",
        ));
    }

    match dimension {
        Dimension::Rights => inspect_rights(candidate_manifest, &mut findings),
        Dimension::Accessibility if html_artifacts == 0 => findings.push(finding(
            "ACCESSIBILITY_NO_HTML_ARTIFACT",
            "error",
            "Bounded accessibility scope requires at least one frozen HTML artifact",
            None,
        )),
        _ => {}
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
        "schema_version":RESULT_SCHEMA,
        "state":state,
        "candidate_id":candidate_id,
        "candidate_sha256":candidate_sha256,
        "candidate_manifest_sha256":candidate_manifest_sha256,
        "dimension":dimension.name(),
        "scope":dimension.scope(),
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
        let mut capabilities = vec![probe_capability()];
        capabilities.extend(Dimension::ALL.into_iter().map(capability));
        Ok(capabilities)
    }

    async fn execute(&mut self, command: &str, pinned_digest: &str, args: Value) -> Result<Value> {
        if command == PROBE_COMMAND {
            let selected = probe_capability();
            if descriptor_digest(&selected.descriptor)? != pinned_digest {
                return Err(Error::new(
                    ErrorCode::StaleReference,
                    "Verifier descriptor digest changed",
                ));
            }
            if args.as_object().is_none_or(|value| !value.is_empty()) {
                return Err(invalid("Verifier probe accepts an empty object"));
            }
            return Ok(json!({
                "ok":true,
                "scope":"owner-staged-bounded-verifier-dimensions",
                "dimensions":Dimension::ALL.map(|dimension| dimension.name()),
                "external_authority":false
            }));
        }
        let dimension = Dimension::from_command(command).ok_or_else(|| {
            Error::new(
                ErrorCode::StaleReference,
                "Verifier command is not a pinned bounded dimension",
            )
        })?;
        let selected = capability(dimension);
        if descriptor_digest(&selected.descriptor)? != pinned_digest {
            return Err(Error::new(
                ErrorCode::StaleReference,
                "Verifier descriptor digest changed",
            ));
        }
        verify(&args, dimension)
    }

    async fn health(&mut self) -> Result<Value> {
        Ok(json!({
            "healthy":true,
            "provider":PROVIDER_ID,
            "version":VERSION,
            "scope":"owner-staged-bounded-verifier-dimensions",
            "dimensions":Dimension::ALL.map(|dimension| dimension.name())
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
    fn vtt_without_header_fails() {
        let mut findings = Vec::new();
        inspect_format(
            "text/vtt; charset=utf-8",
            b"00:00:00.000 --> 00:00:01.000\nHello\n",
            "artifact-2",
            &mut findings,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0]["code"], "FORMAT_WEBVTT_HEADER");
    }

    #[test]
    fn unsupported_format_fails_closed() {
        let mut findings = Vec::new();
        inspect_format(
            "application/octet-stream",
            b"opaque",
            "artifact-3",
            &mut findings,
        );
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0]["code"], "FORMAT_UNSUPPORTED_MIME");
    }

    #[test]
    fn privacy_scan_detects_private_keys_and_json_secret_fields() {
        let mut findings = Vec::new();
        inspect_privacy(
            "text/plain",
            b"-----BEGIN PRIVATE KEY-----\nredacted-fixture\n",
            "artifact-4",
            &mut findings,
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "PRIVACY_SECRET_PATTERN")
        );

        findings.clear();
        inspect_privacy(
            "application/json",
            br#"{"password":"synthetic-secret"}"#,
            "artifact-5",
            &mut findings,
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "PRIVACY_SECRET_FIELD")
        );
    }

    #[test]
    fn accessibility_scope_is_static_and_requires_lang_main_title_and_img_alt() {
        let mut findings = Vec::new();
        let applicable = inspect_accessibility(
            "text/html; charset=utf-8",
            br#"<!doctype html><html lang="en"><title>Release</title><main><img alt="" src=""></main></html>"#,
            "artifact-6",
            &mut findings,
        );
        assert!(applicable);
        assert!(findings.is_empty());

        inspect_accessibility(
            "text/html",
            br#"<html><title></title><img src=""></html>"#,
            "artifact-7",
            &mut findings,
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "ACCESSIBILITY_HTML_LANG")
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "ACCESSIBILITY_MAIN")
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "ACCESSIBILITY_TITLE")
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "ACCESSIBILITY_IMG_ALT")
        );
    }

    #[test]
    fn rights_scope_rejects_missing_unknown_and_restricted_declarations() {
        let mut findings = Vec::new();
        inspect_rights(&json!({"rights":[]}), &mut findings);
        assert_eq!(findings[0]["code"], "RIGHTS_EVIDENCE_MISSING");

        findings.clear();
        inspect_rights(
            &json!({"rights":[{"rights":"unknown","rights_basis":"unknown"}]}),
            &mut findings,
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "RIGHTS_UNKNOWN")
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "RIGHTS_BASIS_UNKNOWN")
        );

        findings.clear();
        inspect_rights(
            &json!({"rights":[{"rights":"restricted","rights_basis":"operator-declaration"}]}),
            &mut findings,
        );
        assert!(
            findings
                .iter()
                .any(|finding| finding["code"] == "RIGHTS_RESTRICTED")
        );
    }

    #[test]
    fn dimensions_have_distinct_commands_and_scopes() {
        let commands = Dimension::ALL
            .into_iter()
            .map(Dimension::command)
            .collect::<BTreeSet<_>>();
        let scopes = Dimension::ALL
            .into_iter()
            .map(Dimension::scope)
            .collect::<BTreeSet<_>>();
        assert_eq!(commands.len(), Dimension::ALL.len());
        assert_eq!(scopes.len(), Dimension::ALL.len());
    }
}
