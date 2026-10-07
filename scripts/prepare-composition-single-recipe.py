#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Prepare the Launchwright R24 exact-SHA Composition acceptance test.

This intentionally transforms the reviewed Semwright combined_native.rs test instead
of copying/forking the Composition implementation. Every replacement is fail-closed
and the exact upstream test bytes are pinned below.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

UPSTREAM_SHA256 = "09ce6823112affade6df01764f7226f6e33e72a7cb7bfafe0cea9ddca400c700"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one source anchor, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    raw = args.source.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != UPSTREAM_SHA256:
        raise SystemExit(
            f"reviewed Semwright combined_native.rs changed: expected {UPSTREAM_SHA256}, got {actual}"
        )
    text = raw.decode("utf-8")

    text = replace_once(
        text,
        'const SESSION: &str = "combined-av-native-e2e";',
        'const SESSION: &str = "launchwright-r24-deltadesk-single-recipe";',
        "session",
    )

    text = replace_once(
        text,
        '''            DriverMount {
                root: "output".into(),
                read_only: false,
                execute: false,
            },
            DriverMount {
                root: "runtime".into(),''',
        '''            DriverMount {
                root: "output".into(),
                read_only: false,
                execute: false,
            },
            DriverMount {
                root: "media".into(),
                read_only: true,
                execute: false,
            },
            DriverMount {
                root: "runtime".into(),''',
        "motion media mount",
    )

    text = replace_once(
        text,
        '''    project: PathBuf,
    output: PathBuf,
    media: PathBuf,
    mlt_runtime_root: PathBuf,''',
        '''    project: PathBuf,
    output: PathBuf,
    media: PathBuf,
    capture_media: PathBuf,
    mlt_runtime_root: PathBuf,''',
        "harness capture field",
    )

    text = replace_once(
        text,
        '''        let project = make_dir(root.path(), "motion-project");
        let output = make_dir(root.path(), "shared-output");
        let media = make_dir(root.path(), "av-delivery");
        let runtime = make_dir(root.path(), "mlt-runtime");''',
        '''        let project = make_dir(root.path(), "motion-project");
        let output = make_dir(root.path(), "shared-output");
        let media = make_dir(root.path(), "av-delivery");
        let capture_media = make_dir(root.path(), "capture-media");
        for (env_name, file_name) in [
            ("LAUNCHWRIGHT_CAPTURE_A", "deltadesk-a-checkout.png"),
            ("LAUNCHWRIGHT_CAPTURE_B", "deltadesk-b-checkout.png"),
        ] {
            let source = required_file(env_name);
            let destination = capture_media.join(file_name);
            fs::copy(&source, &destination).unwrap();
            fs::set_permissions(&destination, fs::Permissions::from_mode(0o400)).unwrap();
            let metadata = fs::metadata(&destination).unwrap();
            assert!(
                metadata.is_file() && metadata.len() > 0 && metadata.len() <= 16_777_216,
                "capture media is outside the managed Motion Canvas asset bound"
            );
        }
        let runtime = make_dir(root.path(), "mlt-runtime");''',
        "capture staging",
    )

    text = replace_once(
        text,
        '''            project,
            output,
            media,
            mlt_runtime_root,''',
        '''            project,
            output,
            media,
            capture_media,
            mlt_runtime_root,''',
        "harness capture init",
    )

    text = replace_once(
        text,
        '''                grant("project", &self.project, true, true),
                grant("output", &self.output, true, true),
                grant("runtime", &self.motion_runtime, true, false),''',
        '''                grant("project", &self.project, true, true),
                grant("output", &self.output, true, true),
                grant("media", &self.capture_media, true, false),
                grant("runtime", &self.motion_runtime, true, false),''',
        "motion media grant",
    )

    helper = r'''
fn required_sha256(name: &str) -> String {
    let value = std::env::var(name).unwrap_or_else(|_| panic!("missing expected digest {name}"));
    assert!(
        value.len() == 64
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "{name} must be a lowercase SHA-256"
    );
    value
}

async fn seed_launchwright_capture_assets(
    executor: &dyn Executor,
    harness: &Harness,
) -> (Digest, Digest) {
    let capture_a_path = harness.capture_media.join("deltadesk-a-checkout.png");
    let capture_b_path = harness.capture_media.join("deltadesk-b-checkout.png");
    let expected_a = required_sha256("LAUNCHWRIGHT_CAPTURE_A_SHA256");
    let expected_b = required_sha256("LAUNCHWRIGHT_CAPTURE_B_SHA256");
    assert_eq!(file_sha(&capture_a_path), expected_a, "Build A capture bytes drifted");
    assert_eq!(file_sha(&capture_b_path), expected_b, "Build B capture bytes drifted");
    let capture_a = Digest::parse(expected_a).unwrap();
    let capture_b = Digest::parse(expected_b).unwrap();

    let created = call(
        executor,
        "driver.motion-canvas.project.create",
        json!({
            "project": {
                "schema_version": 1,
                "component_version": 1,
                "id": "launchwright-deltadesk-r24",
                "generation": "0123456789abcdef0123456789abcdef",
                "revision": 1,
                "settings": {
                    "width": 320,
                    "height": 180,
                    "fps": 30,
                    "fps_denominator": 1,
                    "background": "#000000",
                    "color_space": "srgb"
                },
                "theme": {
                    "font_family": "Instrument Sans Variable",
                    "mono_family": "IBM Plex Mono",
                    "font_size": 36.0,
                    "font_weight": 500,
                    "spacing": 16.0,
                    "line_width": 2.0,
                    "radius": 0.0,
                    "colors": {
                        "ink": "#ffffff",
                        "surface": "#000000"
                    }
                },
                "variables": {},
                "scenes": [{
                    "id": "bootstrap",
                    "name": "Bootstrap",
                    "duration_ms": 1000,
                    "nodes": [],
                    "animations": [],
                    "cues": [],
                    "transition": null
                }],
                "assets": [],
                "audio": []
            },
            "dry_run": false
        }),
    )
    .await;
    assert_eq!(created["applied"], true);
    let mut fingerprint = created["resulting_fingerprint"]
        .as_str()
        .expect("created Motion Canvas fingerprint")
        .to_owned();

    for (id, source, expected, provenance) in [
        (
            "deltadesk-a",
            "deltadesk-a-checkout.png",
            capture_a.as_str(),
            format!("launchwright-r23-broker-capture:{}", capture_a.as_str()),
        ),
        (
            "deltadesk-b",
            "deltadesk-b-checkout.png",
            capture_b.as_str(),
            format!("launchwright-r23-broker-capture:{}", capture_b.as_str()),
        ),
    ] {
        let imported = call(
            executor,
            "driver.motion-canvas.asset.import",
            json!({
                "expected_fingerprint": fingerprint,
                "id": id,
                "kind": "image",
                "source": source,
                "provenance": provenance,
                "license": null,
                "dry_run": false
            }),
        )
        .await;
        assert_eq!(imported["applied"], true);
        fingerprint = imported["resulting_fingerprint"]
            .as_str()
            .expect("asset import fingerprint")
            .to_owned();

        let listed = call(executor, "driver.motion-canvas.asset.list", json!({})).await;
        let item = listed["items"]
            .as_array()
            .expect("managed asset list")
            .iter()
            .find(|item| item["id"] == id)
            .unwrap_or_else(|| panic!("managed asset {id} absent after import"));
        assert_eq!(item["sha256"], expected, "managed asset digest changed");
        assert_eq!(item["dimensions"], json!([780, 493]), "capture dimensions changed");
    }

    (capture_a, capture_b)
}

fn launchwright_capture_film(
    capture_a: &Digest,
    capture_b: &Digest,
) -> Film {
    let base: Film = serde_json::from_slice(include_bytes!(
        "../../../fixtures/composition/av/technical-film.json"
    ))
    .unwrap();
    let mut value = serde_json::to_value(base).unwrap();
    value["id"] = json!("launchwright-deltadesk-r24");
    value["assets"] = json!([
        {
            "id": "deltadesk-a",
            "sha256": capture_a.as_str(),
            "media_type": "image/png",
            "provenance": format!("launchwright-r23-broker-capture:{}", capture_a.as_str()),
            "license": null
        },
        {
            "id": "deltadesk-b",
            "sha256": capture_b.as_str(),
            "media_type": "image/png",
            "provenance": format!("launchwright-r23-broker-capture:{}", capture_b.as_str()),
            "license": null
        }
    ]);

    let shot = &mut value["sequences"][0]["beats"][0]["shots"][0];
    let subjects = shot["subjects"].as_array_mut().expect("technical film subjects");
    subjects.insert(
        0,
        json!({
            "id": "capture-a",
            "role": "observed-build-a",
            "parent": null,
            "layer": "background",
            "content": {
                "kind": "image",
                "asset_id": "deltadesk-a",
                "fit": "contain",
                "ratio": 780.0 / 493.0
            },
            "layout": {
                "kind": "fixed",
                "position": {"x": 0.0, "y": 0.0},
                "size": {"width": 320.0, "height": 180.0}
            },
            "initially_visible": true,
            "clip_intentional": false
        }),
    );
    subjects.insert(
        1,
        json!({
            "id": "capture-b",
            "role": "observed-build-b",
            "parent": null,
            "layer": "background",
            "content": {
                "kind": "image",
                "asset_id": "deltadesk-b",
                "fit": "contain",
                "ratio": 780.0 / 493.0
            },
            "layout": {
                "kind": "fixed",
                "position": {"x": 0.0, "y": 0.0},
                "size": {"width": 320.0, "height": 180.0}
            },
            "initially_visible": false,
            "clip_intentional": false
        }),
    );
    shot["layers"]
        .as_array_mut()
        .expect("technical film layers")
        .insert(
            0,
            json!({
                "id": "background",
                "order": -1,
                "intentional_overlay": false
            }),
        );
    shot["motion"]
        .as_array_mut()
        .expect("technical film motion")
        .push(json!({
            "id": "capture-b-in",
            "span_id": "flash-in-span",
            "easing": "linear",
            "primitive": {
                "kind": "fade_in",
                "target": "capture-b"
            }
        }));

    let film: Film = serde_json::from_value(value).unwrap();
    film.validate().unwrap();
    film
}

'''
    text = replace_once(
        text,
        "async fn motion_subplan(executor: &dyn Executor, film: &Film) -> (Owner, Subplan) {",
        helper + "async fn motion_subplan(executor: &dyn Executor, film: &Film) -> (Owner, Subplan) {",
        "capture helpers",
    )

    text = replace_once(
        text,
        '''    let body = &planned["plan"]["body"];
    let owner: Owner = serde_json::from_value(body["owner"].clone()).unwrap();''',
        '''    let body = &planned["plan"]["body"];
    let planned_film: Film = serde_json::from_value(body["intent"].clone()).unwrap();
    assert_eq!(
        planned_film.assets, film.assets,
        "Motion plan did not preserve exact digest-bound capture assets"
    );
    let owner: Owner = serde_json::from_value(body["owner"].clone()).unwrap();''',
        "motion plan lineage",
    )

    text = replace_once(
        text,
        "async fn combined_a_b_native_av_candidate_uses_post_encode_audio_and_full_scan_sync() {",
        "async fn launchwright_deltadesk_single_recipe_uses_real_capture_lineage() {",
        "test name",
    )

    text = replace_once(
        text,
        '''    let harness = Harness::new();
    let broker = harness.broker().await;
    let executor = broker.session_executor(SESSION);
    let film: Film = serde_json::from_slice(include_bytes!(
        "../../../fixtures/composition/av/technical-film.json"
    ))
    .unwrap();
    film.validate().unwrap();
    assert_eq!(film.timing.duration, Rational::new(2, 1).unwrap());''',
        '''    let harness = Harness::new();
    let broker = harness.broker().await;
    let executor = broker.session_executor(SESSION);
    let (capture_a_digest, capture_b_digest) =
        seed_launchwright_capture_assets(&executor, &harness).await;
    assert_ne!(capture_a_digest, capture_b_digest, "A/B captures unexpectedly match");
    let film = launchwright_capture_film(&capture_a_digest, &capture_b_digest);
    let film_digest = canonical_digest(&film).unwrap();
    assert_eq!(film.timing.duration, Rational::new(2, 1).unwrap());''',
        "test capture setup",
    )

    text = replace_once(
        text,
        '''    let (owner, motion) = motion_subplan(&executor, &film).await;
    let audio = audio_consumer_receipt(&executor, &owner, &film.cues, &harness).await;''',
        '''    let (owner, motion) = motion_subplan(&executor, &film).await;
    let motion_plan_digest = motion.plan_digest.clone();
    let motion_dependency_digest = motion
        .dependencies
        .get("render-dependencies")
        .expect("Motion render dependencies")
        .clone();
    let audio = audio_consumer_receipt(&executor, &owner, &film.cues, &harness).await;''',
        "motion lineage capture",
    )

    text = replace_once(
        text,
        '''    let evidence = evidence_root.join("combined-native.json");
    fs::write(''',
        '''    let single_recipe_evidence =
        evidence_root.join("launchwright-deltadesk-single-recipe.json");
    let retained_master = evidence_root.join("launchwright-deltadesk-single-recipe.mp4");
    fs::copy(&mp4, &retained_master).unwrap();
    let retained_master_bytes = fs::metadata(&retained_master).unwrap().len();
    assert!(retained_master_bytes > 1_000, "retained master is unexpectedly small");
    assert_eq!(
        Digest::parse(file_sha(&retained_master)).unwrap(),
        manifest.final_artifact.sha256,
        "retained master bytes differ from canonical AV manifest"
    );
    let motion_artifact_digest = manifest
        .final_artifact
        .dependencies
        .get("motion-artifact")
        .expect("final MP4 must name the Motion artifact dependency")
        .clone();
    let launchwright_source_sha =
        std::env::var("LAUNCHWRIGHT_SOURCE_SHA").expect("Launchwright exact source SHA");
    assert!(
        launchwright_source_sha.len() == 40
            && launchwright_source_sha
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "Launchwright source must be a full immutable SHA"
    );
    fs::write(
        &single_recipe_evidence,
        serde_json::to_vec_pretty(&json!({
            "schema_version": "launchwright-deltadesk-composition/1",
            "classification": "SINGLE_RECIPE_REAL_CAPTURE_COMPOSITION",
            "launchwright_source_sha": launchwright_source_sha,
            "semwright_sha": integration_source_sha(),
            "capture_a_sha256": capture_a_digest.as_str(),
            "capture_b_sha256": capture_b_digest.as_str(),
            "managed_assets_exact": true,
            "film_sha256": film_digest.as_str(),
            "motion_plan_sha256": motion_plan_digest.as_str(),
            "motion_dependencies_sha256": motion_dependency_digest.as_str(),
            "motion_artifact_sha256": motion_artifact_digest.as_str(),
            "av_plan_sha256": manifest.av_plan_digest.as_str(),
            "master_mp4_sha256": manifest.final_artifact.sha256.as_str(),
            "publication_manifest_sha256": manifest_digest.as_str(),
            "publication_pointer": publication.destination_path,
            "artifact": {
                "file": "launchwright-deltadesk-single-recipe.mp4",
                "sha256": manifest.final_artifact.sha256.as_str(),
                "bytes": retained_master_bytes,
                "mime": "video/mp4"
            },
            "native_dispatch_stages": coordinator
                .ledger()
                .iter()
                .filter(|entry| entry.origin == CompletionOrigin::NativeDispatch)
                .map(|entry| format!("{:?}", entry.stage))
                .collect::<Vec<_>>(),
            "driver_host": true,
            "broker_policy": true,
            "single_av_plan": true,
            "sync_full_scan_pass": true,
            "sync_exhaustive": manifest.sync.exhaustive,
            "audio_pre_encode_pass": true,
            "audio_post_encode_pass": true,
            "platform_job_receipt": false,
            "platform_execution_authority": false,
            "r16_closed": false,
            "promotional_video": false
        }))
        .unwrap(),
    )
    .unwrap();
    println!(
        "LAUNCHWRIGHT_SINGLE_RECIPE_COMPOSITION_PASS {}",
        fs::read_to_string(&single_recipe_evidence).unwrap()
    );

    let evidence = evidence_root.join("combined-native.json");
    fs::write(''',
        "single-recipe evidence",
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text)
    print(f"prepared {args.output} from exact upstream sha256={actual}")


if __name__ == "__main__":
    main()
