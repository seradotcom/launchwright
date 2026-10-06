use semwright_backend_api::{Context, Provider};
use semwright_driver_host::DriverProvider;
use semwright_driver_sdk::{
    ApplicationMatch, DRIVER_PROTOCOL_VERSION, DriverInterfaces, DriverMount, DriverResources,
    DriverToolMount, Manifest, Transport,
};
use semwright_policy::FilesystemGrant;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};
use tokio_util::sync::CancellationToken;

const FPS: u64 = 30;
const FRAME_COUNT: u64 = 600;
const DURATION_SECONDS: u64 = 20;

fn digest(path: &Path) -> String {
    hex::encode(Sha256::digest(fs::read(path).unwrap()))
}

fn configured_tool(variable: &str) -> PathBuf {
    fs::canonicalize(
        std::env::var_os(variable)
            .unwrap_or_else(|| panic!("{variable} must point to the real executable")),
    )
    .unwrap()
}

fn find<'a>(
    capabilities: &'a [semwright_backend_api::ProvidedCapability],
    name: &str,
) -> &'a semwright_backend_api::ProvidedCapability {
    capabilities
        .iter()
        .find(|capability| capability.descriptor.name == name)
        .unwrap_or_else(|| panic!("missing capability {name}"))
}

async fn call(
    provider: &DriverProvider,
    capabilities: &[semwright_backend_api::ProvidedCapability],
    name: &str,
    args: Value,
) -> semwright_types::Result<Value> {
    Provider::execute(
        provider,
        &Context {
            session: "launchwright-real-media".into(),
            request_id: semwright_types::unique_id(),
            cancellation: CancellationToken::new(),
        },
        &find(capabilities, name).descriptor,
        &args,
    )
    .await
}

fn png_dimensions(path: &Path) -> (u32, u32) {
    let bytes = fs::read(path).unwrap();
    assert!(bytes.len() >= 24, "PNG too small");
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "not a PNG");
    (
        u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
        u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
    )
}

fn link_or_copy(source: &Path, destination: &Path) {
    if fs::hard_link(source, destination).is_err() {
        fs::copy(source, destination).unwrap();
    }
}

#[tokio::test]
#[ignore = "requires owner-captured DeltaDesk PNGs, bubblewrap, real MLT and FFmpeg"]
async fn real_deltadesk_captures_become_verified_h264_mp4_inside_driver_host() {
    if std::env::var_os("SEMWRIGHT_TEST_LAUNCHWRIGHT_REAL_MEDIA").is_none() {
        return;
    }

    let source_sha = std::env::var("SEMWRIGHT_SHA").expect("SEMWRIGHT_SHA");
    assert!(
        source_sha.len() == 40 && source_sha.bytes().all(|b| b.is_ascii_hexdigit()),
        "Semwright source SHA must be immutable"
    );
    let capture_a = fs::canonicalize(
        std::env::var_os("LAUNCHWRIGHT_CAPTURE_A").expect("LAUNCHWRIGHT_CAPTURE_A"),
    )
    .unwrap();
    let capture_b = fs::canonicalize(
        std::env::var_os("LAUNCHWRIGHT_CAPTURE_B").expect("LAUNCHWRIGHT_CAPTURE_B"),
    )
    .unwrap();
    let evidence_dir = PathBuf::from(
        std::env::var_os("LAUNCHWRIGHT_COMPOSITION_EVIDENCE_DIR")
            .expect("LAUNCHWRIGHT_COMPOSITION_EVIDENCE_DIR"),
    );
    fs::create_dir_all(&evidence_dir).unwrap();

    let capture_a_sha = digest(&capture_a);
    let capture_b_sha = digest(&capture_b);
    let (width, height) = png_dimensions(&capture_a);
    assert_eq!(png_dimensions(&capture_b), (width, height));
    assert!(width >= 640 && height >= 480);

    let cargo_executable = PathBuf::from(env!("CARGO_BIN_EXE_semwright-mlt-video-driver"));
    let cargo_runtime_runner = PathBuf::from(env!("CARGO_BIN_EXE_semwright-mlt-runtime-runner"));
    let binary_dir = tempfile::tempdir().unwrap();
    fs::set_permissions(binary_dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let executable = binary_dir.path().join("semwright-mlt-video-driver");
    let runtime_runner = binary_dir.path().join("semwright-mlt-runtime-runner");
    fs::copy(&cargo_executable, &executable).unwrap();
    fs::copy(&cargo_runtime_runner, &runtime_runner).unwrap();
    for binary in [&executable, &runtime_runner] {
        fs::set_permissions(binary, fs::Permissions::from_mode(0o700)).unwrap();
    }

    let helper = PathBuf::from(
        std::env::var_os("SEMWRIGHT_TEST_SANDBOX_HELPER").expect("SEMWRIGHT_TEST_SANDBOX_HELPER"),
    );
    let melt = configured_tool("SEMWRIGHT_TEST_MELT");
    let ffprobe = configured_tool("SEMWRIGHT_TEST_FFPROBE");
    let ffmpeg = configured_tool("SEMWRIGHT_TEST_FFMPEG");
    let bwrap = configured_tool("SEMWRIGHT_TEST_BWRAP");
    let mlt_runtime_root = melt
        .parent()
        .and_then(Path::parent)
        .expect("melt runtime root")
        .canonicalize()
        .unwrap();

    let project = tempfile::tempdir().unwrap();
    let media = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let runtime = tempfile::tempdir().unwrap();
    let scratch = tempfile::tempdir().unwrap();
    let state = tempfile::tempdir().unwrap();
    for directory in [
        project.path(),
        media.path(),
        output.path(),
        runtime.path(),
        scratch.path(),
        state.path(),
    ] {
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).unwrap();
    }

    let runtime_json = json!({
        "schema": 1,
        "melt": {"path": melt, "sha256": digest(&melt)},
        "ffprobe": {"path": ffprobe, "sha256": digest(&ffprobe)},
        "ffmpeg": {"path": ffmpeg, "sha256": digest(&ffmpeg)},
        "bubblewrap": {"path": bwrap.to_string_lossy(), "sha256": digest(&bwrap)},
        "timeout_seconds": 300
    });
    let runtime_file = runtime.path().join("runtime.json");
    fs::write(
        &runtime_file,
        serde_json::to_vec_pretty(&runtime_json).unwrap(),
    )
    .unwrap();
    fs::set_permissions(&runtime_file, fs::Permissions::from_mode(0o600)).unwrap();

    let artifact = media.path().join("deltadesk-capture-artifact");
    let frames = artifact.join("frames");
    fs::create_dir_all(&frames).unwrap();
    let seed_a = artifact.join("capture-a.png");
    let seed_b = artifact.join("capture-b.png");
    fs::copy(&capture_a, &seed_a).unwrap();
    fs::copy(&capture_b, &seed_b).unwrap();

    let mut frame_rows = Vec::with_capacity(FRAME_COUNT as usize);
    for index in 0..FRAME_COUNT {
        let source = if index < FRAME_COUNT / 2 {
            &seed_a
        } else {
            &seed_b
        };
        let path = frames.join(format!("{index:06}.png"));
        link_or_copy(source, &path);
        frame_rows.push(json!({
            "index": index,
            "file": format!("frames/{index:06}.png"),
            "bytes": fs::metadata(&path).unwrap().len(),
            "sha256": digest(&path),
            "pixel_sha256": null,
            "min_alpha": null,
            "max_alpha": null
        }));
    }
    let frame_manifest = json!({
        "native_observations": null,
        "renderer": "launchwright-real-browser-capture-sequence-v1",
        "plan": {
            "renderer": "captured_semwright_chromium_v1",
            "width": width,
            "height": height,
            "fps": FPS,
            "fps_denominator": 1,
            "first_frame": 0,
            "end_frame_exclusive": FRAME_COUNT,
            "frame_count": FRAME_COUNT,
            "project_duration_ms": DURATION_SECONDS * 1000,
            "alpha": false,
            "color_space": "srgb",
            "timeout_ms": 300000
        },
        "pixel_validation": {"mode":"source-byte-bound","sample_indices":[0,299,300,599]},
        "frames": frame_rows,
        "source_captures": [
            {"build":"A","sha256":capture_a_sha},
            {"build":"B","sha256":capture_b_sha}
        ]
    });
    let manifest_path = artifact.join("artifact-manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&frame_manifest).unwrap(),
    )
    .unwrap();
    let manifest_sha = digest(&manifest_path);

    let audio = media.path().join("launchwright-demo.wav");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            "20",
            "-c:a",
            "pcm_s16le",
        ])
        .arg(&audio)
        .status()
        .unwrap();
    assert!(
        status.success(),
        "failed to create bounded 20-second audio master"
    );

    let manifest = Manifest {
        manifest_version: 1,
        protocol: DRIVER_PROTOCOL_VERSION,
        id: "mlt-video".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        publisher: "launchwright-acceptance".into(),
        executable: executable.clone(),
        sha256: digest(&executable),
        application: ApplicationMatch {
            desktop_id: Some("org.mltframework.melt".into()),
            process_names: vec!["melt".into()],
            supported_versions: vec![],
        },
        transport: Transport::StdioV1,
        mounts: vec![
            DriverMount {
                root: "project".into(),
                read_only: true,
                execute: false,
            },
            DriverMount {
                root: "media".into(),
                read_only: true,
                execute: false,
            },
            DriverMount {
                root: "output".into(),
                read_only: false,
                execute: false,
            },
            DriverMount {
                root: "runtime".into(),
                read_only: true,
                execute: false,
            },
            DriverMount {
                root: "mlt-runtime".into(),
                read_only: true,
                execute: true,
            },
            DriverMount {
                root: "scratch".into(),
                read_only: false,
                execute: false,
            },
        ],
        system_config: vec![],
        secrets: vec![],
        tools: vec![
            DriverToolMount {
                root: "mlt-runner-root".into(),
                name: "mlt-runner".into(),
                sha256: digest(&runtime_runner),
                mounts: vec![
                    "mlt-runtime".into(),
                    "scratch".into(),
                    "project".into(),
                    "media".into(),
                    "output".into(),
                ],
                system_config: vec![],
                dependencies: vec!["melt".into(), "ffprobe".into(), "ffmpeg".into()],
                nvidia_gpu: false,
                resources: None,
            },
            DriverToolMount {
                root: "melt-root".into(),
                name: "melt".into(),
                sha256: digest(&melt),
                mounts: vec![],
                system_config: vec![],
                dependencies: vec![],
                nvidia_gpu: false,
                resources: None,
            },
            DriverToolMount {
                root: "ffprobe-root".into(),
                name: "ffprobe".into(),
                sha256: digest(&ffprobe),
                mounts: vec![],
                system_config: vec![],
                dependencies: vec![],
                nvidia_gpu: false,
                resources: None,
            },
            DriverToolMount {
                root: "ffmpeg-root".into(),
                name: "ffmpeg".into(),
                sha256: digest(&ffmpeg),
                mounts: vec![],
                system_config: vec![],
                dependencies: vec![],
                nvidia_gpu: false,
                resources: None,
            },
        ],
        network: false,
        nvidia_gpu: false,
        loopback_port: None,
        resources: DriverResources {
            address_space_bytes: 4_294_967_296,
            cpu_seconds: 300,
            operation_cpu_seconds: 0,
            file_size_bytes: 1_073_741_824,
            processes: 256,
            open_files: 512,
        },
        request_timeout_ms: 300_000,
        interfaces: DriverInterfaces {
            health: true,
            host_tools: true,
            ..DriverInterfaces::default()
        },
    };

    let grants = vec![
        FilesystemGrant {
            name: "project".into(),
            path: project.path().canonicalize().unwrap(),
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "media".into(),
            path: media.path().canonicalize().unwrap(),
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "output".into(),
            path: output.path().canonicalize().unwrap(),
            read: true,
            write: true,
        },
        FilesystemGrant {
            name: "runtime".into(),
            path: runtime.path().canonicalize().unwrap(),
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "mlt-runtime".into(),
            path: mlt_runtime_root,
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "scratch".into(),
            path: scratch.path().canonicalize().unwrap(),
            read: true,
            write: true,
        },
        FilesystemGrant {
            name: "mlt-runner-root".into(),
            path: runtime_runner.canonicalize().unwrap(),
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "melt-root".into(),
            path: melt.clone(),
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "ffprobe-root".into(),
            path: ffprobe.clone(),
            read: true,
            write: false,
        },
        FilesystemGrant {
            name: "ffmpeg-root".into(),
            path: ffmpeg.clone(),
            read: true,
            write: false,
        },
    ];

    let provider = DriverProvider::connect(manifest, state.path(), &helper, &grants, false)
        .await
        .unwrap();
    let capabilities = Provider::capabilities(provider.as_ref()).await.unwrap();
    for required in [
        "driver.mlt-video.frames.encode",
        "driver.mlt-video.av.mux",
        "driver.mlt-video.doctor",
    ] {
        assert!(capabilities.iter().any(|c| c.descriptor.name == required));
    }
    let doctor = call(
        provider.as_ref(),
        &capabilities,
        "driver.mlt-video.doctor",
        json!({}),
    )
    .await
    .unwrap();
    assert_eq!(doctor["network"], false);
    assert_eq!(doctor["render_available"], true);

    let mezzanine = call(
        provider.as_ref(),
        &capabilities,
        "driver.mlt-video.frames.encode",
        json!({
            "root":"media",
            "manifest_path":"deltadesk-capture-artifact/artifact-manifest.json",
            "expected_manifest_sha256":manifest_sha,
            "output_path":"deltadesk-real-capture.mkv",
            "max_bytes":268435456u64
        }),
    )
    .await
    .unwrap();
    assert_eq!(mezzanine["frame_count"], FRAME_COUNT);
    assert_eq!(mezzanine["width"], width);
    assert_eq!(mezzanine["height"], height);
    assert_eq!(mezzanine["media"]["video"], true);
    assert_eq!(mezzanine["media"]["audio"], false);

    let mezzanine_path = output.path().join("deltadesk-real-capture.mkv");
    let mezzanine_sha = digest(&mezzanine_path);
    let audio_sha = digest(&audio);
    let muxed = call(
        provider.as_ref(),
        &capabilities,
        "driver.mlt-video.av.mux",
        json!({
            "video_root":"output",
            "video_path":"deltadesk-real-capture.mkv",
            "video_sha256":mezzanine_sha,
            "audio_root":"media",
            "audio_path":"launchwright-demo.wav",
            "audio_sha256":audio_sha,
            "width":width,
            "height":height,
            "fps_num":FPS,
            "fps_den":1,
            "frame_count":FRAME_COUNT,
            "sample_rate":48000,
            "channels":2,
            "profile":"h264-aac-mp4",
            "output_path":"launchwright-deltadesk-demo.mp4",
            "max_bytes":268435456u64
        }),
    )
    .await
    .unwrap();

    assert_eq!(muxed["profile"], "h264-aac-mp4");
    assert_eq!(muxed["frame_count"], FRAME_COUNT);
    assert_eq!(muxed["media"]["video"], true);
    assert_eq!(muxed["media"]["audio"], true);
    let final_path = output.path().join("launchwright-deltadesk-demo.mp4");
    let final_sha = digest(&final_path);
    assert_eq!(muxed["artifact"]["sha256"], final_sha);
    assert!(fs::metadata(&final_path).unwrap().len() > 1000);

    let retained_video = evidence_dir.join("launchwright-deltadesk-demo.mp4");
    fs::copy(&final_path, &retained_video).unwrap();
    assert_eq!(digest(&retained_video), final_sha);

    let receipt = json!({
        "schema_version":"launchwright-real-media-driver/1",
        "classification":"REAL_BROWSER_CAPTURE_TO_DRIVER_HOST_MLT",
        "semwright_sha":source_sha,
        "provider":"driver.mlt-video",
        "driver_host":true,
        "broker_dispatch":false,
        "network":false,
        "source":{
            "kind":"semwright-chromium-capture",
            "capture_a_sha256":capture_a_sha,
            "capture_b_sha256":capture_b_sha,
            "width":width,
            "height":height
        },
        "timeline":{
            "fps":{"num":FPS,"den":1},
            "frame_count":FRAME_COUNT,
            "duration":{"num":DURATION_SECONDS,"den":1},
            "segments":[
                {"build":"A","first_frame":0,"end_frame_exclusive":FRAME_COUNT/2},
                {"build":"B","first_frame":FRAME_COUNT/2,"end_frame_exclusive":FRAME_COUNT}
            ]
        },
        "frame_manifest_sha256":manifest_sha,
        "mezzanine_sha256":mezzanine_sha,
        "audio_sha256":audio_sha,
        "artifact":{
            "file":"launchwright-deltadesk-demo.mp4",
            "sha256":final_sha,
            "bytes":fs::metadata(&retained_video).unwrap().len(),
            "mime":"video/mp4"
        },
        "technical_scope":"real captured bytes -> pinned Semwright MLT driver inside Driver Host -> H.264/AAC MP4",
        "composition_coordinator_receipt":false,
        "platform_job_receipt":false,
        "editorial_approval":false
    });
    let receipt_path = evidence_dir.join("launchwright-real-media-driver.json");
    fs::write(&receipt_path, serde_json::to_vec_pretty(&receipt).unwrap()).unwrap();

    Provider::shutdown(provider.as_ref()).await.unwrap();
    println!("LAUNCHWRIGHT_REAL_MEDIA_DRIVER_PASS {receipt}");
}
