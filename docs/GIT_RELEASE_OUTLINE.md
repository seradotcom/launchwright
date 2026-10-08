# Git change inventory to editorial outline (R33)

R33 builds a deterministic Markdown draft from an already-imported R32 Git observation.

The adapter checks the saved observation hash, approved local Git source, exact release build, target, and imported evidence record. It does not inspect repository content or create product feature claims. The generated deliverable is editable, and it remains an unverified editorial draft until a human reviews it.

Use the script at scripts/git-release-outline.mjs. The "preview" command requires a private observation file, release/source/target/evidence IDs, document name and output path. It writes a local preview without changing the workspace. The "create" command uses the same identifiers and requires the acknowledge-editorial-draft flag before creating a normal Launchwright Markdown deliverable through its existing Native SDK application dispatcher.

The default preview contains counts of added, modified, deleted and type-changed paths without displaying names. Including filenames is optional and requires both include-paths and acknowledge-path-disclosure; the appendix has strict size limits.

Repeated creation with unchanged inputs reuses the same deliverable. Editing an existing draft prevents automatic replacement. Observed source/target revision drift or a different imported evidence hash fails closed.

This workflow does not publish, send data to GitHub, certify product behavior, or supply Semwright Project Graph, Driver Host or Platform authority. Supported Node 24 Linux, Windows and macOS CI passed on exact SHA c01be5d99f8edc907a4ebb96acc20c8db113773b, including real disposable Git fixtures and SQLite-backed Launchwright resources. Details are recorded in evidence/r33/ci-runs.json.
