//! Launchwright-owned DeltaDesk acceptance against Semwright's real Chromium semantic adapter.
//! Copied into the disposable exact-SHA Semwright checkout by CI; it is not a patch to Semwright.
use semwright_adapters::chromium::{BrowserConfig, Chromium};
use semwright_backend_api::{Backend, Context};
use semwright_types::NativeTarget;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

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

fn target(value: &Value) -> TestResult<NativeTarget> {
    Ok(serde_json::from_value(value["$ref"].clone())?)
}

async fn semantic_query(
    browser: &Chromium,
    ctx: &Context,
    target_ref: &NativeTarget,
    role: &str,
    name: &str,
) -> TestResult<NativeTarget> {
    Ok(tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            if let Ok(value) = browser
                .execute(
                    ctx,
                    "browser.semantic.query",
                    &json!({
                        "_target": target_ref,
                        "role": role,
                        "name": name,
                        "exact_name": true,
                        "max_results": 8,
                        "depth": 20
                    }),
                )
                .await
                && value["count"] == 1
                && !value["matches"][0]["ref"].is_null()
            {
                return target(&value["matches"][0]["ref"]);
            }
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    })
    .await??)
}

async fn snapshot_contains(
    browser: &Chromium,
    ctx: &Context,
    tab: &NativeTarget,
    needle: &str,
) -> TestResult<bool> {
    let snapshot = browser
        .execute(
            ctx,
            "browser.semantic.snapshot",
            &json!({"_target":tab,"depth":24,"max_nodes":512}),
        )
        .await?;
    Ok(snapshot.to_string().contains(needle))
}

async fn open_demo_identity(
    browser: &Chromium,
    ctx: &Context,
    origin: &str,
    build: &str,
) -> TestResult<NativeTarget> {
    let opened = browser
        .execute(
            ctx,
            "browser.tab.open",
            &json!({"url":format!("{origin}/build-{build}/login?locale=en-US")}),
        )
        .await?;
    let tab = target(&opened["ref"])?;
    let _ = semantic_query(browser, ctx, &tab, "heading", "Sign in to DeltaDesk").await?;

    let role = semantic_query(browser, ctx, &tab, "combobox", "Role").await?;
    let selected = browser
        .execute(
            ctx,
            "browser.element.select",
            &json!({"_target":role,"label":"operator"}),
        )
        .await?;
    assert_eq!(selected["selected"], "operator");

    let plan = semantic_query(browser, ctx, &tab, "combobox", "Plan").await?;
    let selected = browser
        .execute(
            ctx,
            "browser.element.select",
            &json!({"_target":plan,"label":"pro"}),
        )
        .await?;
    assert_eq!(selected["selected"], "pro");

    let open = semantic_query(browser, ctx, &tab, "button", "Open DeltaDesk").await?;
    browser
        .execute(ctx, "browser.element.click", &json!({"_target":open}))
        .await?;
    let _ = semantic_query(browser, ctx, &tab, "heading", "Requests").await?;
    Ok(tab)
}

async fn inspect_build(
    browser: &Chromium,
    ctx: &Context,
    origin: &str,
    evidence_dir: &Path,
    build: &str,
    expected_cta: &str,
    expected_basic_export: &str,
) -> TestResult<Value> {
    let tab = open_demo_identity(browser, ctx, origin, build).await?;
    assert!(
        snapshot_contains(browser, ctx, &tab, "Advanced export: available").await?,
        "pro operator must retain advanced export in both builds"
    );

    let checkout = semantic_query(browser, ctx, &tab, "link", "Checkout").await?;
    browser
        .execute(ctx, "browser.element.click", &json!({"_target":checkout}))
        .await?;
    let _ = semantic_query(browser, ctx, &tab, "heading", "Choose your plan").await?;
    let _ = semantic_query(browser, ctx, &tab, "button", expected_cta).await?;
    let _ = semantic_query(browser, ctx, &tab, "combobox", "Plan").await?;

    let screenshot = browser
        .execute(ctx, "browser.screenshot", &json!({"_target":tab}))
        .await?;
    let owned_path = PathBuf::from(
        screenshot["artifact"]["path"]
            .as_str()
            .ok_or("browser screenshot artifact path missing")?,
    );
    assert!(owned_path.is_file());
    let exported_path = evidence_dir.join(format!("deltadesk-{build}-checkout.png"));
    fs::copy(&owned_path, &exported_path)?;
    let screenshot_sha256 = file_sha256(&exported_path)?;

    let basic = browser
        .execute(
            ctx,
            "browser.tab.open",
            &json!({"url":format!("{origin}/build-{build}/dashboard?role=operator&plan=basic&locale=en-US")}),
        )
        .await?;
    let basic_tab = target(&basic["ref"])?;
    let _ = semantic_query(browser, ctx, &basic_tab, "heading", "Requests").await?;
    assert!(
        snapshot_contains(browser, ctx, &basic_tab, expected_basic_export).await?,
        "basic-operator availability oracle not observed"
    );
    browser
        .execute(ctx, "browser.tab.close", &json!({"_target":basic_tab}))
        .await?;

    browser
        .execute(ctx, "browser.tab.close", &json!({"_target":tab}))
        .await?;
    Ok(json!({
        "build": build,
        "checkout_cta": expected_cta,
        "basic_operator_export": expected_basic_export,
        "screenshot": {
            "file": exported_path.file_name().and_then(|v|v.to_str()).ok_or("invalid evidence filename")?,
            "sha256": screenshot_sha256
        },
        "adapter_artifact_path": owned_path,
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
    }))
}

#[tokio::test]
#[ignore = "requires an owner-supplied disposable Chromium binary and DeltaDesk loopback fixture"]
async fn real_semwright_chromium_captures_deltadesk_a_and_b() -> TestResult {
    let executable = PathBuf::from(std::env::var("SEMWRIGHT_TEST_CHROMIUM")?);
    let executable = fs::canonicalize(executable)?;
    let browser_sha256 = file_sha256(&executable)?;
    let origin = std::env::var("LAUNCHWRIGHT_DELTADESK_ORIGIN")?;
    let evidence_dir = PathBuf::from(std::env::var("LAUNCHWRIGHT_EVIDENCE_DIR")?);
    fs::create_dir_all(&evidence_dir)?;
    let storage = tempfile::tempdir()?;
    let browser = Chromium::new(
        BrowserConfig {
            executable,
            sha256: browser_sha256.clone(),
            allowed_origins: vec![origin.clone()],
            allow_downloads: false,
            ..Default::default()
        },
        storage.path().join("browser"),
    )?;
    let ctx = Context {
        session: "launchwright-deltadesk-browser-acceptance".into(),
        request_id: semwright_types::unique_id(),
        cancellation: CancellationToken::new(),
    };

    browser
        .execute(&ctx, "browser.launch", &json!({"headless":true}))
        .await?;

    let mut build_a = inspect_build(
        &browser,
        &ctx,
        &origin,
        &evidence_dir,
        "a",
        "Start Pro trial",
        "Advanced export: available",
    )
    .await?;
    let mut build_b = inspect_build(
        &browser,
        &ctx,
        &origin,
        &evidence_dir,
        "b",
        "Continue with Pro",
        "Advanced export: unavailable",
    )
    .await?;

    browser.shutdown().await?;

    for row in [&mut build_a, &mut build_b] {
        let path = PathBuf::from(
            row["adapter_artifact_path"]
                .as_str()
                .ok_or("adapter artifact path missing")?,
        );
        assert!(
            !path.exists(),
            "Semwright-owned screenshot artifacts must be removed on browser shutdown"
        );
        row.as_object_mut()
            .ok_or("capture receipt row is not an object")?
            .remove("adapter_artifact_path");
    }

    let receipt = json!({
        "schema_version": "launchwright-deltadesk-browser-driver/1",
        "semwright_sha": std::env::var("SEMWRIGHT_SHA").unwrap_or_default(),
        "provider": "chromium",
        "browser_executable_sha256": browser_sha256,
        "origin": origin,
        "real_semwright_adapter": true,
        "agent_javascript": false,
        "raw_cdp_exposed": false,
        "platform_job_receipt": false,
        "captures": [build_a, build_b],
        "oracle": {
            "checkout_cta_changed": true,
            "basic_operator_availability_changed": true,
            "pro_operator_availability_preserved": true
        }
    });
    fs::write(
        evidence_dir.join("semwright-deltadesk-driver.json"),
        serde_json::to_vec_pretty(&receipt)?,
    )?;
    println!("REAL_DELTADESK_BROWSER_ACCEPTANCE_PASS {receipt}");
    Ok(())
}
