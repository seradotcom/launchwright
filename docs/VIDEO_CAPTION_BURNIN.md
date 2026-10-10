# R62 — Private WebVTT burn-in for approved landscape and portrait MP4

R62 adds two real **H.264/AAC videos with visible burned-in captions** to the existing R46 source-bound two-format media workflow. Unlike an FFmpeg command over an arbitrary video, R62 requires the original **Semwright Native Media plan/output**, a separately editorial-approved frozen WebVTT Candidate, and the **exact original R46 private ZIP and JSON receipt**. It is an optional local formatting derivative; Semwright Composition still owns the original timeline and effects.

R62 does not create product behavior claims, synthesize audio, execute customer scripts, create a new Native Media technical PASS receipt or publish. The derivative technical state remains **UNKNOWN**; human caption readability/accessibility, rights, privacy, UI occlusion and marketing quality need independent review.

## Supported subset

The original R46 video is 1280×720 H.264 at 30 fps with 48 kHz AAC, 3–30 seconds; R46 already produced an approved 720×1280 spatial-only variant and a frozen WebVTT sidecar. All are in the exact R46 private ZIP.

R62 renders the approved captions into **both** videos with FFmpeg/libass and an installed DejaVu Sans font. It reencodes only video and stream-copies original AAC audio. Width, height, rational frame rate, total frames and duration are checked after conversion; original R46 clips remain untouched. The caption style is fixed, high-contrast and bottom anchored, not arbitrary operator-defined filter text.

The current scope is **1–20 approved cues**, each at least 300 ms and at most 85 visible ASCII characters. Unicode/emoji, multiline, arbitrary styles or ASS override syntax, custom fonts, RTL, open-ended streams and overlapping cues fail closed. New locale and font tests are needed for broader accessibility.

## Prepare a private source-bound plan

Retain the original R46 private JSON plan, input selection, full R46 output directory and the source video on the same authorized machine. The input selection includes a source video filesystem path, so never copy it into a public repository or ticket.

```sh
node scripts/video-caption-burnin.mjs plan \
  --state /private/launchwright-workspace \
  --r46-plan /private/r46-video-plan.json \
  --r46-input /private/r46-video-input.json \
  --r46-dir /private/r46-output \
  --out /private/r62-caption-plan.json \
  --acknowledge-caption-review \
  --acknowledge-privacy-unknown \
  --acknowledge-private-only
```

This reads and validates R46 ZIP/receipt bytes, Native Media revisions, original candidate and frozen WebVTT SHA, exact FFmpeg version and operator consents. Planning does not reencode, create a Native receipt or send external requests.

## Export both MP4s privately

Choose an existing private 0700 directory on **Linux** with FFmpeg/libass and an installed DejaVu Sans font:

```sh
node scripts/video-caption-burnin.mjs export \
  --state /private/launchwright-workspace \
  --r46-plan /private/r46-video-plan.json \
  --r46-input /private/r46-video-input.json \
  --r46-dir /private/r46-output \
  --burnin-plan /private/r62-caption-plan.json \
  --out-dir /private/r62-video-output \
  --confirm-plan FULL_R62_PLAN_SHA256 \
  --confirm-r46 FULL_ORIGINAL_R46_ZIP_SHA256 \
  --acknowledge-export
```

The output ZIP contains exactly landscape-captioned.mp4, portrait-captioned.mp4, captions.vtt, manifest.json and README.txt, plus a private source-bound receipt. The package does not contain original source filesystem paths. Both clips are real H.264/AAC with subtitles rendered into their video pixels.

An interrupted export is recovered with the **same saved plan**. All existing bytes are checked before writing; edited outputs, unsafe directories, symlinks, stale locks or changed Native/R46 source are rejected. No original Media record is overwritten, and no new runtime acceptance authority is implied.

## Genuine owned-fixture acceptance

The selective Linux Node24 workflow video-caption-burnin.yml generates synthetic test-pattern video, original AAC and exact frozen Native WebVTT, then creates both captioned MP4s and verifies:

- R46 source ZIP/receipt, Native Media plan, output and caption candidate identities and frozen source digests.
- 1280×720 and 720×1280 H.264/AAC, 30fps, 120 frames and 4 seconds for the owned synthetic sample.
- Decoded 48 kHz AAC PCM is **byte-identical** before and after captions.
- Source frames and captioned frames differ visibly during a timed caption cue, versus a frame without captions.
- Deterministic re-export, source/caption tampering refusals, private receipt equality and no extra Native Media output.

The CI artifact retains both formats, an **owned synthetic** original R46 ZIP, decoded frame previews and hashed receipts. This proves real formatting on owned fixtures, not customer-video acceptance, legal rights, visual marketing quality, actual Driver Host execution or Platform Publish.

## Remaining limitations

Portrait video still contains the entire landscape image inside a black letterbox. Captions may cover UI, so human safe-area and accessibility review remain mandatory. Source pixels/audio and privacy outside approved masks are not independently validated. Multilingual glyphs, voice alternatives, rich cinematography and externally published videos remain outside this fixed text-only subset.

The original master **VIDEO profile remains PARTIAL** even after R62 acceptance.
