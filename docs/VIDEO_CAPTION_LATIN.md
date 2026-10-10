# R63 — Source-bound Latin WebVTT burn-in

R63 adds an **opt-in NFC Latin text profile** to the already accepted R62 Native Media → R46 source video/WebVTT → FFmpeg caption burn-in path. It does not modify R62's default ASCII v1 source plan, published schema or safe fallback. The new source, manifest and receipt use a separately digested version /2.

R63 never invents caption content, translates text, alters original music/speech, executes the source app or upgrades the technical state. Every subtitle comes from an existing, frozen, independently editorial-approved WebVTT Candidate linked to Semwright Native Media, and both MP4s come from the exact original R46 private ZIP.

## Supported text, locales and font authorization

The accepted subset is plain NFC-composed Latin text with accents, including source-approved Spanish, French, Portuguese, German and related languages. Examples: **¡Ya está disponible!**, **Revisión de edición: función útil.**, **Olá, coração!** and **Grüße aus München!**.

The original source Media plan's two video variants and the target's editorial locale must match exactly (e.g., es-MX or pt-BR). Supported language prefixes are en, es, pt, fr, de, it, nl, ca, gl. This is not language translation and does not make a mismatched target correct.

The source-bound text budget remains **1–20 cues**, one line of **2–85 characters** each, at least 300 ms per cue, no overlap, exact Native WebVTT timing. Emojis, CJK/Cyrillic, BiDi controls, invisible spacing, unnormalized combining accents, ASS formatting, backslashes/braces, HTML tags, unknown punctuation and ambiguous ampersand entities fail closed. The app never replaces glyphs with fallback boxes.

The Linux host must have the system-shipped DejaVuSans.ttf and fontconfig installed. R63 resolves this through fc-match, binds the actual **font-file SHA-256**, verifies every requested code point through fc-query, then rechecks the font, original video, source WebVTT, Native revisions and plan at export. It never downloads, embeds or redistributes font files. This proves actual font coverage of the selected characters, not a human accessibility review.

## Private operator commands

Start with the approved Native/R46 plan/input/ZIP described in [R62](VIDEO_CAPTION_BURNIN.md). On a Linux host with FFmpeg/libass and the system DejaVu font, create the private plan:

```sh
node scripts/video-caption-burnin.mjs plan \
  --state /private/workspace \
  --r46-plan /private/r46-plan.json \
  --r46-input /private/r46-input.json \
  --r46-dir /private/r46-output \
  --out /private/r63-latin-plan.json \
  --latin-nfc --acknowledge-latin-glyph-review \
  --acknowledge-caption-review \
  --acknowledge-privacy-unknown \
  --acknowledge-private-only
```

Read its exact SHA-256 digests and explicitly confirm export into a pre-existing owner-private 0700 directory:

```sh
node scripts/video-caption-burnin.mjs export \
  --state /private/workspace \
  --r46-plan /private/r46-plan.json \
  --r46-input /private/r46-input.json \
  --r46-dir /private/r46-output \
  --burnin-plan /private/r63-latin-plan.json \
  --out-dir /private/r63-output \
  --confirm-plan FULL_R63_PLAN_SHA256 \
  --confirm-r46 FULL_R46_ZIP_SHA256 \
  --acknowledge-latin-glyph-review --acknowledge-export
```

The output ZIP contains real landscape-captioned.mp4 and portrait-captioned.mp4, the original UTF-8 captions.vtt, a private manifest and README, plus an exact SHA-bound receipt. Decoded AAC remains unchanged. A lost/interrupted local write can be reconciled only with **the same original plan**; previously written bytes must match in full. Human-edited outputs, changed sources, font drift, mismatched locale, expired rights approval and concurrent export locks fail closed.

## Genuine owned acceptance versus remaining authority

The selective workflow [video-caption-latin.yml](../.github/workflows/video-caption-latin.yml) runs the official Node 24 Linux environment, checks the original R62 v1 ASCII regression, and builds a real four-second **owned synthetic es-MX Native Media** fixture with approved Spanish VTT. FFmpeg renders both H.264/AAC variants. Independent tests verify source and receipt hashes, font SHA, full character coverage, exact frame count and video dimensions, original decoded AAC PCM equality, visible caption pixels at the timed cue, and portrait central-UI protection. Source ZIP, output videos and screenshots are retained as exact-commit CI artifacts.

This is not a customer source, machine translation, third-party voice rights review, automatic occlusion/accessibility verification, broad multilingual font suite or real Platform/Driver Host acceptance. Caption quality, product semantics, privacy/rights and external publication remain human/external gates; original master VIDEO stays PARTIAL.
