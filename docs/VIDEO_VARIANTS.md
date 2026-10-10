# R46 — Source-bound landscape/portrait MP4 and WebVTT

R46 produces **two real MP4 delivery formats** and **one WebVTT caption sidecar** from an already registered and editorial-reviewed Semwright Media source. The original landscape MP4 is preserved byte-for-byte; the portrait variant is a bounded FFmpeg **aspect-only derivative**, not a replacement for the canonical Semwright Composition timeline or Driver Host. No new narration, source application execution, HTTP publication or Platform grant is involved.

## Strict supported subset

- Original master: real private 1280×720 H.264 MP4, 30 fps, AAC 48kHz, 3–30 seconds, up to 80 MiB.
- Derived portrait: 720×1280 H.264 MP4, 30 fps. The entire original image is **contained** in a black letterbox, never cropped. AAC audio packets are copied from the source.
- Captions: independently human-approved, frozen Native SDK WebVTT artifact, cue timestamps verified against the original Media duration. Captions are **sidecars**, not burned-in.
- Local output: deterministic ZIP with both MP4s, exact frozen captions, manifest and README. Explicit operator SHA confirmation and private 0700 output directory are mandatory. Changed files are never clobbered.
- Source Media plan must contain video variants for both output dimensions, plus the original required screenshot-series and interactive-demo Media variants. Both target the same release, locale and rational duration.
- The original Media output must be Native-recorded and separately editorially approved on exactly its source bytes. The frozen WebVTT Candidate must also be fresh, approved and linked to the same release/target.
- Operator declarations of audio/visual rights and technical UNKNOWN do not prove the truth of claims, pixel privacy, licensing, voice identity, Host isolation, or customer approval.

## Private two-phase workflow

Save a private JSON selection file (0600 on POSIX) containing real returned Native SDK IDs:

```json
{
  "media_plan_id": "media_plan_EXACT",
  "media_output_id": "media_output_EXACT",
  "landscape_variant_id": "landscape",
  "vertical_variant_id": "portrait",
  "source_mp4_path": "/private/owned.mp4",
  "source_mp4_sha256": "FULL_64_CHARACTER_SHA256",
  "caption_candidate_id": "candidate_EXACT",
  "caption_artifact_id": "artifact_EXACT",
  "acknowledge_audio_rights": true,
  "acknowledge_technical_unknown": true
}
```

Prepare a source-bound plan without changing the workspace or producing video:

```sh
node scripts/video-variants.mjs plan \
  --state /private/launchwright-state \
  --input /private/video-selection.json \
  --out /private/video-variants-plan.json
```

Read the full plan SHA, original MP4 SHA, exact Media plan digest, caption digest and FFmpeg version. Then explicitly confirm both hashes:

```sh
node scripts/video-variants.mjs export \
  --state /private/launchwright-state \
  --input /private/video-selection.json \
  --plan-file /private/video-variants-plan.json \
  --out-dir /private/private-output-0700 \
  --confirm-plan FULL_PLAN_SHA256 \
  --confirm-source FULL_SOURCE_MP4_SHA256 \
  --acknowledge-private-export
```

The ZIP contains exactly landscape-16x9.mp4, portrait-9x16.mp4, captions.vtt, manifest.json and README.txt. A hashed private receipt accompanies it. The operator source video file path is not serialized as a manifest field, but the original MP4 bytes are preserved and may themselves contain embedded author, location, device or path metadata. **R46 does not independently scrub or audit original MP4 metadata.** Privately review source metadata and pixel/voice content before any distribution. Both the original MP4 and captions are separately hashed.

## Security, recovery and technical custody

FFmpeg/ffprobe must be installed and authorized by the operator. Video probes require one H.264 and one AAC stream with strict dimensions/frame count/duration. Conversion is invoked with an argv array (not a shell), protocol whitelist file/pipe, fixed scale/pad settings, no audio synthesis, no temporal changes, no crops, and a bounded timeout. The exact FFmpeg version is included in the saved plan to prevent silent toolchain drift. Untrusted arbitrary customer media should be inspected only in an appropriately isolated runner; this local adapter does not itself constitute a sandbox.

An exclusive Native-workspace operator lock prevents concurrent exports. A lost reply can be recovered using the **same private plan**. Existing ZIP/receipt bytes are compared against regenerated output before creating anything; incompatible Native Media output, modified files, symlink paths or stale source references fail closed. A crashed process may leave a lock: verify no exporter runs before manually clearing it.

After an approved private export the original Native SDK dispatcher records the portrait Media output as authority=imported, technical_effective=UNKNOWN. The original source's technical acceptance is never inherited by a derivative merely because the FFmpeg command succeeded. Human portrait readability, caption pacing and audio quality reviews are separately pending. No external publication occurs.

## Technical acceptance

Tests use an owned disposable synthetic H.264 test pattern with a 440Hz synthesized tone (not a real voice), a real frozen Native WebVTT Candidate, Media plan/version pins, and exact editorial source reviews. They validate both MP4 files, real source AAC audio, byte-identical decoded PCM from the two aspect formats, timestamped captions, error/tamper controls, deterministic ZIP generation across runs, private directory/lock safety, and Native Media output custody.

Node 24 Linux/Windows/macOS application checks cover the portable JS/Native code. Expensive FFmpeg-dependent tests are **explicitly opt-in** on Linux through LAUNCHWRIGHT_VIDEO_REAL_TESTS=1 and are skipped by default app checks; the selective Linux workflow video-variants.yml sets that flag and **must run real encoding acceptance**. Individual supported-engine green checks without this selective video run do not establish real audiovisual acceptance. It retains actual video, captions, FFprobe diagnostics, PNG screenshots and exact source-SHA receipts.

These synthetic technical acceptance results do not prove customer video, a compelling marketing film, voice alternatives, burned-in captions, full locale/accessibility, general rights/PII, streaming/HLS, or Semwright Platform Publish. The original master VIDEO profile remains **PARTIAL**.

## Optional exact caption burn-in extension (R62)

R46 keeps captions as an immutable, approved sidecar and does not burn them
into either image track. R62 introduces a **separate explicitly approved**
private formatting derivative for both H.264/AAC aspect variants. It
requires the original frozen Native Media/WebVTT receipt and exact R46
ZIP/plan; no original clip, audio or Native Media authority is overwritten.
See [R62 real caption burn-in](VIDEO_CAPTION_BURNIN.md). The original VIDEO
master profile remains PARTIAL even if the Linux synthetic render passes.
