//! Launchwright R23 acceptance: real DeltaDesk A/B browser flow through Semwright Broker + Policy.
//! Copied into the disposable exact-SHA Semwright core test tree by CI.
//!
//! The fixture approver exists only inside this acceptance test so CI can exercise the
//! sensitive browser.launch and browser.screenshot paths. It is not production human
//! approval and must never be reported as Platform/Host/operator acceptance.
use async_trait::async_trait;
use semwright_adapters::chromium::{BrowserConfig, Chromium};
use semwright_backend_api::Backend;
use semwright_core::{Approval, Approver, Broker, NoApprover, audit::Audit};
use semwright_policy::{Policy, PolicyConfig, Profile};
use semwright_types::{Envelope, ErrorCode, ExecuteRequest, Result as SemwrightResult, unique_id};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn failure(message: impl Into<String>) -> Box<dyn std::error::Error + Send + Sync> {
    std::io::Error::other(message.into()).into()
}

fn file_sha256(path: &Path) -> TestResult<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hex::encode(hash.finalize()))
}

#[derive(Default)]
struct FixtureApprover {
    approvals: Mutex<Vec<String>>,
}
impl FixtureApprover {
    fn commands(&self) -> Vec<String> {
        self.approvals.lock().expect("approval mutex").clone()
    }
}
#[async_trait]
impl Approver for FixtureApprover {
    async fn approve(&self, approval: Approval, _: CancellationToken) -> SemwrightResult<bool> {
        let accepted = approval.backend == "chromium"
            && matches!(
                approval.command.as_str(),
                "browser.launch" | "browser.screenshot"
            );
        if accepted {
            self.approvals
                .lock()
                .expect("approval mutex")
                .push(approval.command);
        }
        Ok(accepted)
    }
}

async fn envelope(broker: &Arc<Broker>, session: &str, command: &str, args: Value) -> Envelope {
    broker
        .clone()
        .execute(
            session.to_owned(),
            unique_id(),
            ExecuteRequest {
                command: command.into(),
                args,
                dry_run: false,
                backend: None,
            },
            CancellationToken::new(),
        )
        .await
}

async fn call(
    broker: &Arc<Broker>,
    session: &str,
    command: &str,
    args: Value,
) -> TestResult<Value> {
    let result = envelope(broker, session, command, args).await;
    if !result.ok {
        return Err(failure(format!(
            "{command} failed through Broker: {:?}",
            result.error
        )));
    }
    result
        .data
        .ok_or_else(|| failure(format!("{command} returned no data")))
}

async fn semantic_query(
    broker: &Arc<Broker>,
    session: &str,
    tab_ref: &str,
    role: &str,
    name: &str,
) -> TestResult<String> {
    for _ in 0..300 {
        let result = envelope(
            broker,
            session,
            "browser.semantic.query",
            json!({
                "ref": tab_ref,
                "role": role,
                "name": name,
                "exact_name": true,
                "max_results": 8,
                "depth": 20
            }),
        )
        .await;
        if result.ok {
            if let Some(data) = result.data {
                if data["count"] == 1 {
                    if let Some(reference) = data["matches"][0]["ref"].as_str() {
                        return Ok(reference.to_owned());
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
    Err(failure(format!(
        "semantic query did not resolve exactly one {role:?} {name:?}"
    )))
}

async fn snapshot_contains(
    broker: &Arc<Broker>,
    session: &str,
    tab_ref: &str,
    needle: &str,
) -> TestResult<bool> {
    let snapshot = call(
        broker,
        session,
        "browser.semantic.snapshot",
        json!({"ref":tab_ref,"depth":24,"max_nodes":512}),
    )
    .await?;
    Ok(snapshot.to_string().contains(needle))
}

async fn open_demo_identity(
    broker: &Arc<Broker>,
    session: &str,
    origin: &str,
    build: &str,
) -> TestResult<String> {
    let opened = call(
        broker,
        session,
        "browser.tab.open",
        json!({"url":format!("{origin}/build-{build}/login?locale=en-US")}),
    )
    .await?;
    let tab = opened["ref"]
        .as_str()
        .ok_or_else(|| failure("broker did not materialize a tab ref"))?
        .to_owned();
    let _ = semantic_query(broker, session, &tab, "heading", "Sign in to DeltaDesk").await?;

    let role = semantic_query(broker, session, &tab, "combobox", "Role").await?;
    let selected = call(
        broker,
        session,
        "browser.element.select",
        json!({"ref":role,"label":"operator"}),
    )
    .await?;
    if selected["selected"] != "operator" {
        return Err(failure("operator role was not selected"));
    }

    let plan = semantic_query(broker, session, &tab, "combobox", "Plan").await?;
    let selected = call(
        broker,
        session,
        "browser.element.select",
        json!({"ref":plan,"label":"pro"}),
    )
    .await?;
    if selected["selected"] != "pro" {
        return Err(failure("pro plan was not selected"));
    }

    let open = semantic_query(broker, session, &tab, "button", "Open DeltaDesk").await?;
    call(
        broker,
        session,
        "browser.element.click",
        json!({"ref":open}),
    )
    .await?;
    let _ = semantic_query(broker, session, &tab, "heading", "Requests").await?;
    Ok(tab)
}

async fn inspect_build(
    broker: &Arc<Broker>,
    session: &str,
    origin: &str,
    evidence_dir: &Path,
    build: &str,
    expected_cta: &str,
    expected_basic_export: &str,
) -> TestResult<(Value, PathBuf)> {
    let tab = open_demo_identity(broker, session, origin, build).await?;
    if !snapshot_contains(broker, session, &tab, "Advanced export: available").await? {
        return Err(failure(
            "pro operator must retain advanced export in both builds",
        ));
    }

    let checkout = semantic_query(broker, session, &tab, "link", "Checkout").await?;
    call(
        broker,
        session,
        "browser.element.click",
        json!({"ref":checkout}),
    )
    .await?;
    let _ = semantic_query(broker, session, &tab, "heading", "Choose your plan").await?;
    let _ = semantic_query(broker, session, &tab, "button", expected_cta).await?;
    let _ = semantic_query(broker, session, &tab, "combobox", "Plan").await?;

    let screenshot = call(broker, session, "browser.screenshot", json!({"ref":tab})).await?;
    let owned_path = PathBuf::from(
        screenshot["artifact"]["path"]
            .as_str()
            .ok_or_else(|| failure("browser screenshot artifact path missing"))?,
    );
    if !owned_path.is_file() {
        return Err(failure(
            "Semwright screenshot artifact was not materialized",
        ));
    }
    let exported_path = evidence_dir.join(format!("deltadesk-{build}-checkout.png"));
    fs::copy(&owned_path, &exported_path)?;
    let screenshot_sha256 = file_sha256(&exported_path)?;

    let basic = call(
        broker,
        session,
        "browser.tab.open",
        json!({"url":format!(
            "{origin}/build-{build}/dashboard?role=operator&plan=basic&locale=en-US"
        )}),
    )
    .await?;
    let basic_tab = basic["ref"]
        .as_str()
        .ok_or_else(|| failure("broker did not materialize basic tab ref"))?
        .to_owned();
    let _ = semantic_query(broker, session, &basic_tab, "heading", "Requests").await?;
    if !snapshot_contains(broker, session, &basic_tab, expected_basic_export).await? {
        return Err(failure("basic-operator availability oracle not observed"));
    }

    Ok((
        json!({
            "build": build,
            "checkout_cta": expected_cta,
            "basic_operator_export": expected_basic_export,
            "screenshot": {
                "file": exported_path
                    .file_name()
                    .and_then(|value|value.to_str())
                    .ok_or_else(|| failure("invalid evidence filename"))?,
                "sha256": screenshot_sha256
            },
            "semantic_checks": {
                "login": true,
                "role_select": true,
                "plan_select": true,
                "dashboard": true,
                "checkout_link": true,
                "checkout_heading": true,
                "checkout_cta": true,
                "plan_combobox": true
            }
        }),
        owned_path,
    ))
}

fn policy_with(capabilities: &[&str]) -> TestResult<Policy> {
    Ok(Policy::new(PolicyConfig {
        profile: Profile::Observe,
        allow: capabilities
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<BTreeSet<_>>(),
        ..Default::default()
    })?)
}

#[tokio::test]
#[ignore = "requires owner-supplied disposable Chromium and DeltaDesk loopback fixture"]
async fn real_semwright_broker_policy_captures_deltadesk_a_and_b() -> TestResult {
    let executable = fs::canonicalize(PathBuf::from(std::env::var("SEMWRIGHT_TEST_CHROMIUM")?))?;
    let browser_sha256 = file_sha256(&executable)?;
    let origin = std::env::var("LAUNCHWRIGHT_DELTADESK_ORIGIN")?;
    let evidence_dir = PathBuf::from(std::env::var("LAUNCHWRIGHT_EVIDENCE_DIR")?);
    fs::create_dir_all(&evidence_dir)?;

    let config = BrowserConfig {
        executable,
        sha256: browser_sha256.clone(),
        allowed_origins: vec![origin.clone()],
        allow_downloads: false,
        ..Default::default()
    };

    // Negative control: policy denial occurs before any approver can manufacture authority.
    let denied_root = tempfile::tempdir()?;
    let denied_browser = Arc::new(Chromium::new(
        config.clone(),
        denied_root.path().join("browser"),
    )?);
    let denied_broker = Arc::new(Broker::new(
        policy_with(&["browser.observe"])?,
        vec![denied_browser],
        Audit::open(&denied_root.path().join("audit"), 65_536, 2)?,
        Arc::new(NoApprover),
        None,
        json!({"fixture":"launchwright-r23-browser-policy-denial"}),
        false,
    )?);
    let denied = envelope(
        &denied_broker,
        &unique_id(),
        "browser.launch",
        json!({"headless":true}),
    )
    .await;
    if denied.ok || denied.error.as_ref().map(|error| error.code) != Some(ErrorCode::PolicyDenied) {
        return Err(failure(format!(
            "browser.launch without browser.modify did not fail closed: {denied:?}"
        )));
    }

    let root = tempfile::tempdir()?;
    let browser = Arc::new(Chromium::new(config, root.path().join("browser"))?);
    let approver = Arc::new(FixtureApprover::default());
    let broker = Arc::new(Broker::new(
        policy_with(&["browser.observe", "browser.modify", "screen.capture"])?,
        vec![browser.clone()],
        Audit::open(&root.path().join("audit"), 262_144, 4)?,
        approver.clone(),
        None,
        json!({"fixture":"launchwright-r23-real-chromium-broker"}),
        false,
    )?);
    let session = unique_id();

    call(
        &broker,
        &session,
        "browser.launch",
        json!({"headless":true}),
    )
    .await?;

    // Negative control: allowed command class still cannot escape the owner's origin allowlist.
    let forbidden = envelope(
        &broker,
        &session,
        "browser.tab.open",
        json!({"url":"https://example.com/launchwright-r23-forbidden"}),
    )
    .await;
    if forbidden.ok
        || forbidden.error.as_ref().map(|error| error.code) != Some(ErrorCode::PolicyDenied)
    {
        return Err(failure(format!(
            "browser origin allowlist did not fail closed: {forbidden:?}"
        )));
    }

    let (build_a, owned_a) = inspect_build(
        &broker,
        &session,
        &origin,
        &evidence_dir,
        "a",
        "Start Pro trial",
        "Advanced export: available",
    )
    .await?;
    let (build_b, owned_b) = inspect_build(
        &broker,
        &session,
        &origin,
        &evidence_dir,
        "b",
        "Continue with Pro",
        "Advanced export: unavailable",
    )
    .await?;

    Backend::shutdown(browser.as_ref()).await?;
    if owned_a.exists() || owned_b.exists() {
        return Err(failure(
            "Semwright-owned screenshot artifacts survived browser shutdown",
        ));
    }

    let approvals = approver.commands();
    if approvals
        != vec![
            "browser.launch".to_owned(),
            "browser.screenshot".to_owned(),
            "browser.screenshot".to_owned(),
        ]
    {
        return Err(failure(format!(
            "fixture approval surface changed unexpectedly: {approvals:?}"
        )));
    }

    let receipt = json!({
        "schema_version": "launchwright-deltadesk-browser-broker/1",
        "semwright_sha": std::env::var("SEMWRIGHT_SHA").unwrap_or_default(),
        "provider": "chromium",
        "browser_executable_sha256": browser_sha256,
        "origin": origin,
        "real_semwright_adapter": true,
        "broker_policy_path_observed": true,
        "fixture_approver": true,
        "fixture_approvals": approvals,
        "human_operator_approval": false,
        "agent_javascript": false,
        "raw_cdp_exposed": false,
        "driver_host_isolation": false,
        "platform_job_receipt": false,
        "platform_execution_authority": false,
        "owned_artifact_cleanup_verified": true,
        "negative_controls": {
            "missing_browser_modify_denied": true,
            "forbidden_origin_denied": true
        },
        "captures": [build_a, build_b],
        "oracle": {
            "checkout_cta_changed": true,
            "basic_operator_availability_changed": true,
            "pro_operator_availability_preserved": true
        }
    });
    fs::write(
        evidence_dir.join("semwright-deltadesk-broker.json"),
        serde_json::to_vec_pretty(&receipt)?,
    )?;
    println!("REAL_DELTADESK_BROKER_ACCEPTANCE_PASS {receipt}");
    Ok(())
}
