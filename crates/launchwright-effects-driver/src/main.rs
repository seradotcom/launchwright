// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded canonical Native SDK Effects evaluation executed inside Semwright Driver Host.
//! The provider exposes one fixed immutable-artifact readback operation. Callers cannot
//! choose executable bytes, paths, mounts, environment, shell, or arbitrary arguments.

use async_trait::async_trait;
use semwright_driver_sdk::{
    Capability, Driver, DriverExecutionContext, DriverInterfaces, descriptor_digest, serve,
    workspace_mount,
};
use semwright_effect_conformance::composition::{ContractError, Digest};
use semwright_native_sdk::effects_readback;
use semwright_types::{CommandDescriptor, Error, ErrorCode, Idempotency, Result, Risk};
use serde_json::{Value, json};
use sha2::{Digest as ShaDigest, Sha256};

const PROVIDER_ID: &str = "launchwright-effects";
const PROVIDER_SCOPE: &str = "driver:launchwright-effects";
const VERIFY_COMMAND: &str = "driver.launchwright-effects.verify";
const PROBE_COMMAND: &str = "driver.launchwright-effects.probe";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const PROTECTED_MOUNT: &str = "effects-protected";
const ARTIFACT_MOUNT: &str = "effects-artifacts";
const SPEC_FILE: &str = "spec.json";
const MAX_RESULT_TEXT: usize = 192_000;

fn err(code: ErrorCode, message: impl Into<String>) -> Error {
    Error::new(code, message.into())
}
fn invalid(message: impl Into<String>) -> Error {
    err(ErrorCode::InvalidArgument, message)
}
fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn exact_sha(args: &Value, key: &str) -> Result<String> {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{key} is required")))?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid(format!("{key} must be lowercase SHA-256")));
    }
    Ok(value.to_owned())
}
fn map_contract(error: ContractError) -> Error {
    let message = format!("Canonical Native SDK Effects evaluation failed: {error}");
    match error {
        ContractError::Invalid(_) => err(ErrorCode::InvalidArgument, message),
        ContractError::Stale(_) => err(ErrorCode::StaleReference, message),
        ContractError::Limit(_) => err(ErrorCode::ResourceExhausted, message),
        ContractError::Unknown(_) => err(ErrorCode::BackendFailed, message),
        ContractError::Denied(_) => err(ErrorCode::PolicyDenied, message),
    }
}
fn capability(
    name: &str,
    description: &str,
    input_schema: Value,
    output_schema: Value,
) -> Capability {
    Capability {
        descriptor: CommandDescriptor {
            name: name.into(),
            version: VERSION.into(),
            description: description.into(),
            input_schema,
            output_schema,
            requires: vec![PROVIDER_SCOPE.into()],
            risk: Risk::ReadOnly,
            idempotency: Idempotency::ReadOnly,
            timeout_ms: 15_000,
            dry_run: true,
            interactive_consent: false,
            backends: vec![PROVIDER_SCOPE.into()],
        },
        aliases: vec![],
        tags: vec![
            "launchwright".into(),
            "effects".into(),
            "verification".into(),
        ],
        object_types: vec![],
    }
}
fn verify_capability() -> Capability {
    capability(
        VERIFY_COMMAND,
        "Evaluate the fixed owner-staged protected spec and immutable artifacts with the canonical Semwright Native SDK Effects reader inside Driver Host",
        json!({
            "type":"object",
            "properties":{
                "spec_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}
            },
            "required":["spec_sha256"],
            "additionalProperties":false
        }),
        json!({
            "type":"object",
            "properties":{
                "schema_version":{"const":"launchwright-effects-driver-result/1"},
                "spec_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "result_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "result_text":{"type":"string","maxLength":192000},
                "verdict":{"enum":["PASS","FAIL","UNKNOWN"]},
                "inspection_state":{"enum":["EVALUATED","INCOMPLETE","ERROR"]},
                "scope":{"const":"immutable_native_sdk_artifact_properties_only"},
                "runtime_digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "source_digest":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "execution_authority":{"const":false}
            },
            "required":["schema_version","spec_sha256","result_sha256","result_text","verdict","inspection_state","scope","runtime_digest","source_digest","execution_authority"],
            "additionalProperties":false
        }),
    )
}
fn probe_capability() -> Capability {
    capability(
        PROBE_COMMAND,
        "Describe the fixed canonical Effects evaluation scope without reading owner data",
        json!({"type":"object","properties":{},"additionalProperties":false}),
        json!({
            "type":"object",
            "properties":{
                "ok":{"const":true},
                "scope":{"const":"immutable-native-sdk-effects-reader-only"},
                "arbitrary_execution":{"const":false},
                "execution_authority":{"const":false}
            },
            "required":["ok","scope","arbitrary_execution","execution_authority"],
            "additionalProperties":false
        }),
    )
}
fn catalog() -> Vec<Capability> {
    vec![probe_capability(), verify_capability()]
}
fn verify_descriptor(command: &str, digest: &str) -> Result<()> {
    let selected = catalog()
        .into_iter()
        .find(|capability| capability.descriptor.name == command)
        .ok_or_else(|| err(ErrorCode::StaleReference, "Effects command is not pinned"))?;
    if descriptor_digest(&selected.descriptor)? != digest {
        return Err(err(
            ErrorCode::StaleReference,
            "Effects descriptor digest changed",
        ));
    }
    Ok(())
}
fn evaluate(args: &Value) -> Result<Value> {
    let expected = exact_sha(args, "spec_sha256")?;
    let protected = workspace_mount(PROTECTED_MOUNT)?;
    let artifacts = workspace_mount(ARTIFACT_MOUNT)?;
    let spec_path = protected.join(SPEC_FILE);
    let digest = Digest::parse(expected.clone()).map_err(map_contract)?;
    let verified =
        effects_readback::verify(&spec_path, &digest, &artifacts).map_err(map_contract)?;
    let result = verified.result();
    if result.spec_sha256.as_str() != expected
        || result.scope != effects_readback::SCOPE
        || result.execution_authority
    {
        return Err(err(
            ErrorCode::PluginProtocolError,
            "Canonical Effects reader returned an out-of-contract result",
        ));
    }
    let result_text = serde_json::to_string(result).map_err(|_| {
        err(
            ErrorCode::PluginProtocolError,
            "Effects result serialization failed",
        )
    })?;
    if result_text.len() > MAX_RESULT_TEXT {
        return Err(err(
            ErrorCode::ResourceExhausted,
            "Canonical Effects result exceeds the Launchwright admission budget",
        ));
    }
    let result_sha256 = sha256(result_text.as_bytes());
    Ok(json!({
        "schema_version":"launchwright-effects-driver-result/1",
        "spec_sha256":expected,
        "result_sha256":result_sha256,
        "result_text":result_text,
        "verdict":serde_json::to_value(result.verdict).map_err(|_| err(ErrorCode::PluginProtocolError,"Effects verdict serialization failed"))?,
        "inspection_state":serde_json::to_value(&result.inspection_state).map_err(|_| err(ErrorCode::PluginProtocolError,"Effects inspection-state serialization failed"))?,
        "scope":result.scope,
        "runtime_digest":result.runtime_digest.as_str(),
        "source_digest":result.source_digest.as_str(),
        "execution_authority":false
    }))
}

struct LaunchwrightEffectsDriver;

#[async_trait]
impl Driver for LaunchwrightEffectsDriver {
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
        Ok(catalog())
    }
    async fn execute(
        &mut self,
        command: &str,
        descriptor_sha256: &str,
        args: Value,
    ) -> Result<Value> {
        verify_descriptor(command, descriptor_sha256)?;
        if command == PROBE_COMMAND {
            if args.as_object().is_none_or(|value| !value.is_empty()) {
                return Err(invalid("Effects provider probe accepts an empty object"));
            }
            return Ok(json!({
                "ok":true,
                "scope":"immutable-native-sdk-effects-reader-only",
                "arbitrary_execution":false,
                "execution_authority":false
            }));
        }
        Err(err(
            ErrorCode::Unsupported,
            "Effects evaluation requires an authenticated Driver Host context",
        ))
    }
    async fn execute_with_context(
        &mut self,
        command: &str,
        descriptor_sha256: &str,
        args: Value,
        context: DriverExecutionContext,
    ) -> Result<Value> {
        verify_descriptor(command, descriptor_sha256)?;
        context.check_cancelled()?;
        match command {
            PROBE_COMMAND => self.execute(command, descriptor_sha256, args).await,
            VERIFY_COMMAND => evaluate(&args),
            _ => Err(err(
                ErrorCode::StaleReference,
                "Effects command is not pinned",
            )),
        }
    }
    async fn health(&mut self) -> Result<Value> {
        Ok(json!({
            "healthy":true,
            "provider":PROVIDER_ID,
            "version":VERSION,
            "scope":"immutable-native-sdk-effects-reader-only",
            "execution_authority":false
        }))
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = serve(LaunchwrightEffectsDriver).await {
        eprintln!("{error}");
        std::process::exit(error.exit_code());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_is_fixed_read_only_and_has_no_path_input() {
        let capabilities = catalog();
        assert_eq!(capabilities.len(), 2);
        let verify = capabilities
            .iter()
            .find(|capability| capability.descriptor.name == VERIFY_COMMAND)
            .unwrap();
        let properties = verify.descriptor.input_schema["properties"]
            .as_object()
            .unwrap();
        assert_eq!(properties.len(), 1);
        assert!(properties.contains_key("spec_sha256"));
        for capability in capabilities {
            assert_eq!(capability.descriptor.risk, Risk::ReadOnly);
            assert_eq!(capability.descriptor.idempotency, Idempotency::ReadOnly);
            assert!(capability.descriptor.dry_run);
            assert!(!capability.descriptor.interactive_consent);
        }
    }

    #[test]
    fn fixed_mounts_and_spec_filename_are_not_caller_controlled() {
        assert_eq!(PROTECTED_MOUNT, "effects-protected");
        assert_eq!(ARTIFACT_MOUNT, "effects-artifacts");
        assert_eq!(SPEC_FILE, "spec.json");
    }
}
