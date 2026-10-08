// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded first-party Launchwright extension execution through Semwright Driver Host.
//! The provider exposes only the owned DeltaRender transform and DeltaCLI status probe.
//! Callers cannot select executable bytes, scripts, paths, environment, or arbitrary argv.

use async_trait::async_trait;
use semwright_driver_sdk::{
    Capability, Driver, DriverExecutionContext, DriverInterfaces, RuntimeToolMode,
    descriptor_digest, serve,
};
use semwright_types::{CommandDescriptor, Error, ErrorCode, Idempotency, Result, Risk};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::time::Duration;

const PROVIDER_ID: &str = "launchwright-extension";
const PROVIDER_SCOPE: &str = "driver:launchwright-extension";
const RENDER_COMMAND: &str = "driver.launchwright-extension.render";
const CLI_COMMAND: &str = "driver.launchwright-extension.cli-status";
const PROBE_COMMAND: &str = "driver.launchwright-extension.probe";
const NODE_TOOL: &str = "node-extension-provider";
const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_STDIN: usize = 65_536;
const MAX_STDOUT: usize = 65_536;
const MAX_STDERR: usize = 16_384;

const DELTARENDER: &str = include_str!("../../../fixtures/deltarender.mjs");
const DELTACLI: &str = include_str!("../../../fixtures/deltacli.mjs");

fn error(code: ErrorCode, message: impl Into<String>) -> Error {
    Error::new(code, message.into())
}
fn invalid(message: impl Into<String>) -> Error {
    error(ErrorCode::InvalidArgument, message)
}
fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn source_sha(source: &str) -> String {
    sha256(source.as_bytes())
}
fn eval_source(source: &str, prefix: &str) -> String {
    let body = source
        .strip_prefix("#!/usr/bin/env node\n")
        .unwrap_or(source);
    format!("{prefix}\n{body}")
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
fn text<'a>(args: &'a Value, key: &str, max: usize) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= max)
        .ok_or_else(|| invalid(format!("{key} is outside the bounded contract")))
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
            timeout_ms: 12_000,
            dry_run: true,
            interactive_consent: false,
            backends: vec![PROVIDER_SCOPE.into()],
        },
        aliases: vec![],
        tags: vec![
            "launchwright".into(),
            "extension".into(),
            "host-execution".into(),
        ],
        object_types: vec![],
    }
}
fn probe_capability() -> Capability {
    capability(
        PROBE_COMMAND,
        "Describe the fixed first-party Launchwright extension execution surface",
        json!({"type":"object","properties":{},"additionalProperties":false}),
        json!({
            "type":"object",
            "properties":{
                "ok":{"const":true},
                "scope":{"const":"owned-deltarender-deltacli-only"},
                "arbitrary_execution":{"const":false}
            },
            "required":["ok","scope","arbitrary_execution"],
            "additionalProperties":false
        }),
    )
}
fn render_capability() -> Capability {
    capability(
        RENDER_COMMAND,
        "Execute the exact embedded DeltaRender fixture through a Host-mediated sealed Node runtime",
        json!({
            "type":"object",
            "properties":{
                "expected_fixture_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "stdin":{"type":"string","maxLength":65536}
            },
            "required":["expected_fixture_sha256","stdin"],
            "additionalProperties":false
        }),
        result_schema("renderer"),
    )
}
fn cli_capability() -> Capability {
    capability(
        CLI_COMMAND,
        "Execute the exact embedded DeltaCLI status operation through a Host-mediated sealed Node runtime",
        json!({
            "type":"object",
            "properties":{
                "expected_fixture_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "expected_build":{"type":"string","minLength":1,"maxLength":256}
            },
            "required":["expected_fixture_sha256","expected_build"],
            "additionalProperties":false
        }),
        result_schema("cli"),
    )
}
fn result_schema(kind: &str) -> Value {
    let base = |kind: &str, extra: Value, required_extra: Vec<&str>| {
        let mut properties = serde_json::Map::from_iter([
            (
                "schema_version".into(),
                json!({"const":"launchwright-extension-driver-result/1"}),
            ),
            ("kind".into(), json!({"const":kind})),
            (
                "fixture_sha256".into(),
                json!({"type":"string","pattern":"^[0-9a-f]{64}$"}),
            ),
            (
                "exit_code".into(),
                json!({"type":"integer","minimum":0,"maximum":65535}),
            ),
            ("stdout".into(), json!({"type":"string","maxLength":65536})),
            ("stderr".into(), json!({"type":"string","maxLength":16384})),
            (
                "stdout_sha256".into(),
                json!({"type":"string","pattern":"^[0-9a-f]{64}$"}),
            ),
            (
                "stderr_sha256".into(),
                json!({"type":"string","pattern":"^[0-9a-f]{64}$"}),
            ),
        ]);
        if let Some(extra) = extra.as_object() {
            properties.extend(extra.clone());
        }
        let mut required = vec![
            "schema_version",
            "kind",
            "fixture_sha256",
            "exit_code",
            "stdout",
            "stderr",
            "stdout_sha256",
            "stderr_sha256",
        ];
        required.extend(required_extra);
        json!({
            "type":"object",
            "properties":properties,
            "required":required,
            "additionalProperties":false
        })
    };
    match kind {
        "renderer" => base(
            kind,
            json!({
                "input_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"},
                "output_type":{"const":"rendered-document/1"},
                "output":{"type":"object"}
            }),
            vec!["input_sha256", "output_type", "output"],
        ),
        "cli" => base(
            kind,
            json!({
                "observed_build":{"type":"string","minLength":1,"maxLength":256},
                "facts":{"type":"object"}
            }),
            vec!["observed_build", "facts"],
        ),
        _ => unreachable!("fixed extension result kind"),
    }
}

fn catalog() -> Vec<Capability> {
    vec![probe_capability(), render_capability(), cli_capability()]
}
fn verify_descriptor(command: &str, digest: &str) -> Result<()> {
    let selected = catalog()
        .into_iter()
        .find(|capability| capability.descriptor.name == command)
        .ok_or_else(|| error(ErrorCode::StaleReference, "Extension command is not pinned"))?;
    if descriptor_digest(&selected.descriptor)? != digest {
        return Err(error(
            ErrorCode::StaleReference,
            "Extension descriptor digest changed",
        ));
    }
    Ok(())
}
fn require_fixed_digest(args: &Value, source: &str) -> Result<String> {
    let expected = exact_sha(args, "expected_fixture_sha256")?;
    let actual = source_sha(source);
    if expected != actual {
        return Err(error(
            ErrorCode::Conflict,
            "Registered extension digest differs from the provider-pinned fixture source",
        ));
    }
    Ok(actual)
}
async fn run_node(
    context: &DriverExecutionContext,
    script: String,
    extra_args: Vec<String>,
    stdin: Vec<u8>,
) -> Result<semwright_driver_sdk::ToolExecutionOutput> {
    if context.runtime_tool_mode(NODE_TOOL)? != RuntimeToolMode::HostMediated {
        return Err(error(
            ErrorCode::Unsupported,
            "Launchwright extension execution requires Host-mediated sealed Node",
        ));
    }
    if stdin.len() > MAX_STDIN {
        return Err(error(
            ErrorCode::ResourceExhausted,
            "Extension input exceeds the provider budget",
        ));
    }
    let mut args = vec![
        "--disable-wasm-trap-handler".into(),
        "--max-old-space-size=128".into(),
        "--input-type=module".into(),
        "--eval".into(),
        script,
    ];
    args.extend(extra_args);
    let output = context
        .execute_runtime_tool(NODE_TOOL, args, stdin, Duration::from_secs(10))
        .await?;
    if output.stdout.len() > MAX_STDOUT || output.stderr.len() > MAX_STDERR {
        return Err(error(
            ErrorCode::ResourceExhausted,
            "Extension process output exceeds the provider budget",
        ));
    }
    Ok(output)
}
fn base_report(
    kind: &str,
    fixture_sha256: String,
    output: &semwright_driver_sdk::ToolExecutionOutput,
) -> Value {
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    json!({
        "schema_version":"launchwright-extension-driver-result/1",
        "kind":kind,
        "fixture_sha256":fixture_sha256,
        "exit_code":output.exit_code,
        "stdout":stdout,
        "stderr":stderr,
        "stdout_sha256":sha256(&output.stdout),
        "stderr_sha256":sha256(&output.stderr)
    })
}
async fn render(args: &Value, context: &DriverExecutionContext) -> Result<Value> {
    let fixture_sha256 = require_fixed_digest(args, DELTARENDER)?;
    let stdin = text(args, "stdin", MAX_STDIN)?.as_bytes().to_vec();
    let input_sha256 = sha256(&stdin);
    let script = eval_source(DELTARENDER, "");
    let output = run_node(context, script, vec![], stdin).await?;
    if output.exit_code != 0 {
        return Err(error(
            ErrorCode::BackendFailed,
            "Pinned DeltaRender execution failed",
        ));
    }
    let rendered: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        error(
            ErrorCode::PluginProtocolError,
            "DeltaRender returned malformed JSON",
        )
    })?;
    let mut report = base_report("renderer", fixture_sha256, &output);
    let object = report.as_object_mut().expect("base report object");
    object.insert("input_sha256".into(), json!(input_sha256));
    object.insert("output_type".into(), json!("rendered-document/1"));
    object.insert("output".into(), rendered);
    Ok(report)
}
async fn cli_status(args: &Value, context: &DriverExecutionContext) -> Result<Value> {
    let fixture_sha256 = require_fixed_digest(args, DELTACLI)?;
    let expected_build = text(args, "expected_build", 256)?.to_owned();
    let script = eval_source(DELTACLI, "process.argv.splice(1,0,'deltacli.mjs');");
    let output = run_node(
        context,
        script,
        vec!["status".into(), "--json".into()],
        vec![],
    )
    .await?;
    if output.exit_code != 0 {
        return Err(error(
            ErrorCode::BackendFailed,
            "Pinned DeltaCLI status execution failed",
        ));
    }
    let facts: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        error(
            ErrorCode::PluginProtocolError,
            "DeltaCLI returned malformed JSON",
        )
    })?;
    if facts.get("build").and_then(Value::as_str) != Some(expected_build.as_str()) {
        return Err(error(
            ErrorCode::StaleReference,
            "DeltaCLI observed build differs from the requested source build",
        ));
    }
    let mut report = base_report("cli", fixture_sha256, &output);
    let object = report.as_object_mut().expect("base report object");
    object.insert("observed_build".into(), json!(expected_build));
    object.insert("facts".into(), facts);
    Ok(report)
}

struct LaunchwrightExtensionDriver;
#[async_trait]
impl Driver for LaunchwrightExtensionDriver {
    fn id(&self) -> &str {
        PROVIDER_ID
    }
    fn version(&self) -> &str {
        VERSION
    }
    fn interfaces(&self) -> DriverInterfaces {
        DriverInterfaces {
            health: true,
            host_tools: std::env::var_os("SEMWRIGHT_DRIVER_HOST_TOOLS").is_some(),
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
                return Err(invalid("Extension provider probe accepts an empty object"));
            }
            return Ok(
                json!({"ok":true,"scope":"owned-deltarender-deltacli-only","arbitrary_execution":false}),
            );
        }
        Err(error(
            ErrorCode::Unsupported,
            "Extension execution requires an authenticated Driver Host context",
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
            RENDER_COMMAND => render(&args, &context).await,
            CLI_COMMAND => cli_status(&args, &context).await,
            _ => Err(error(
                ErrorCode::StaleReference,
                "Extension command is not pinned",
            )),
        }
    }
    async fn health(&mut self) -> Result<Value> {
        Ok(json!({
            "healthy":true,
            "provider":PROVIDER_ID,
            "version":VERSION,
            "scope":"owned-deltarender-deltacli-only",
            "host_tools":std::env::var_os("SEMWRIGHT_DRIVER_HOST_TOOLS").is_some()
        }))
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    if let Err(error) = serve(LaunchwrightExtensionDriver).await {
        eprintln!("{error}");
        std::process::exit(error.exit_code());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_digests_are_pinned_to_repository_sources() {
        assert_eq!(
            source_sha(DELTARENDER),
            sha256(include_bytes!("../../../fixtures/deltarender.mjs"))
        );
        assert_eq!(
            source_sha(DELTACLI),
            sha256(include_bytes!("../../../fixtures/deltacli.mjs"))
        );
    }
    #[test]
    fn catalog_is_fixed_and_read_only() {
        let capabilities = catalog();
        assert_eq!(capabilities.len(), 3);
        for capability in capabilities {
            assert_eq!(capability.descriptor.risk, Risk::ReadOnly);
            assert_eq!(capability.descriptor.idempotency, Idempotency::ReadOnly);
            assert!(capability.descriptor.dry_run);
            assert!(!capability.descriptor.interactive_consent);
        }
    }
    #[test]
    fn eval_wrapper_does_not_accept_caller_code() {
        let script = eval_source(DELTACLI, "process.argv.splice(1,0,'deltacli.mjs');");
        assert!(script.contains("deltacli 1.0.0"));
        assert!(!script.starts_with("#!"));
    }
}
