// SPDX-License-Identifier: AGPL-3.0-only
//! Thin canonical Native SDK adapter. Launchwright owns SQLite transactions;
//! Broker/Driver Host own references, grants, sealed runtime tools and mounts.
use semwright_native_sdk::cooperation::{
    Application, CancellationSemantics, CommitSemantics, OperationContract, RetrySemantics,
    TargetRequirement, UndoSemantics,
};
use semwright_native_sdk::process_bridge::{NodeBridge, NodeBridgeConfig};
use semwright_native_sdk::{
    CommandDescriptor, Idempotency, NativeDriver, Result, Risk, json, serve,
};
use std::{sync::Arc, time::Duration};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const CORE_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_CORE_BUNDLE_SHA256");
const SOURCES_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_SOURCES_BUNDLE_SHA256");
const GRAPH_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_GRAPH_BUNDLE_SHA256");
const EFFECTS_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_EFFECTS_BUNDLE_SHA256");
const PRODUCTION_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_PRODUCTION_BUNDLE_SHA256");
const REVIEW_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_REVIEW_BUNDLE_SHA256");
const VERIFICATION_BUNDLE: Option<&str> =
    option_env!("LAUNCHWRIGHT_NATIVE_VERIFICATION_BUNDLE_SHA256");
const INTEGRATIONS_BUNDLE: Option<&str> =
    option_env!("LAUNCHWRIGHT_NATIVE_INTEGRATIONS_BUNDLE_SHA256");
const EXTENSIONS_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_EXTENSIONS_BUNDLE_SHA256");
const WORK_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_WORK_BUNDLE_SHA256");
const USAGE_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_USAGE_BUNDLE_SHA256");
const MEDIA_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_MEDIA_BUNDLE_SHA256");
const PUBLISH_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_PUBLISH_BUNDLE_SHA256");

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum Profile {
    Core,
    Sources,
    Graph,
    Effects,
    Production,
    Review,
    Verification,
    Integrations,
    Extensions,
    Work,
    Usage,
    Media,
    Publish,
}
#[derive(Clone, Copy)]
struct Operation {
    suffix: &'static str,
    read: bool,
    consent: bool,
    profile: Profile,
}

const OPERATIONS: &[Operation] = &[
    Operation {
        suffix: "workspace-describe",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "resource-get",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "events-list",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "history-get",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "history-list",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "history-diff",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "change-inspect",
        read: true,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "entity-create",
        read: false,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "entity-update",
        read: false,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "entity-retire",
        read: false,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "change-propose",
        read: false,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "change-apply",
        read: false,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "template-instantiate",
        read: false,
        consent: false,
        profile: Profile::Core,
    },
    Operation {
        suffix: "release-coverage",
        read: true,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "release-impact",
        read: true,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "anchor-assess",
        read: true,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "artifact-read",
        read: true,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "relation-record",
        read: false,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "impact-plan",
        read: false,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "evidence-import",
        read: false,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "capture-ingest",
        read: false,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "deliverable-render",
        read: false,
        consent: false,
        profile: Profile::Production,
    },
    Operation {
        suffix: "candidate-inspect",
        read: true,
        consent: false,
        profile: Profile::Review,
    },
    Operation {
        suffix: "verification-summary",
        read: true,
        consent: false,
        profile: Profile::Verification,
    },
    Operation {
        suffix: "channel-status",
        read: true,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "verification-record",
        read: false,
        consent: false,
        profile: Profile::Verification,
    },
    Operation {
        suffix: "verification-repair_prepare",
        read: false,
        consent: false,
        profile: Profile::Verification,
    },
    Operation {
        suffix: "verification-repair_record",
        read: false,
        consent: false,
        profile: Profile::Verification,
    },
    Operation {
        suffix: "waiver-record",
        read: false,
        consent: false,
        profile: Profile::Verification,
    },
    Operation {
        suffix: "candidate-freeze",
        read: false,
        consent: false,
        profile: Profile::Review,
    },
    Operation {
        suffix: "candidate-review",
        read: false,
        consent: false,
        profile: Profile::Review,
    },
    Operation {
        suffix: "candidate-deliver_private",
        read: false,
        consent: true,
        profile: Profile::Review,
    },
    Operation {
        suffix: "channel-package",
        read: false,
        consent: false,
        profile: Profile::Review,
    },
    Operation {
        suffix: "channel-record_outcome",
        read: false,
        consent: false,
        profile: Profile::Review,
    },
    Operation {
        suffix: "localization-assess",
        read: true,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "profile-matrix",
        read: true,
        consent: false,
        profile: Profile::Sources,
    },
    Operation {
        suffix: "profile-preflight",
        read: true,
        consent: false,
        profile: Profile::Sources,
    },
    Operation {
        suffix: "graph-inspect",
        read: true,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "graph-record",
        read: false,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "effects-inspect",
        read: true,
        consent: false,
        profile: Profile::Effects,
    },
    Operation {
        suffix: "effects-record",
        read: false,
        consent: false,
        profile: Profile::Effects,
    },
    Operation {
        suffix: "extension-discovery",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "compatibility-negotiate",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "compatibility-inspect",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "mobile-inspect",
        read: true,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "mobile-import",
        read: false,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "localization-create",
        read: false,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "localization-update",
        read: false,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "extension-register",
        read: false,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "extension-retire",
        read: false,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "compatibility-lock",
        read: false,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "workspace-snapshot",
        read: true,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "work-prepare",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "work-claim",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "work-complete",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "work-mark_unknown",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "workspace-rotate_epoch",
        read: false,
        consent: true,
        profile: Profile::Work,
    },
    Operation {
        suffix: "usage-inspect",
        read: true,
        consent: false,
        profile: Profile::Usage,
    },
    Operation {
        suffix: "usage-reserve_record",
        read: false,
        consent: false,
        profile: Profile::Usage,
    },
    Operation {
        suffix: "usage-receipt_record",
        read: false,
        consent: false,
        profile: Profile::Usage,
    },
    Operation {
        suffix: "usage-finalize",
        read: false,
        consent: false,
        profile: Profile::Usage,
    },
    Operation {
        suffix: "usage-billing_record",
        read: false,
        consent: true,
        profile: Profile::Usage,
    },
    Operation {
        suffix: "usage-performance_record",
        read: false,
        consent: false,
        profile: Profile::Usage,
    },
    Operation {
        suffix: "media-inspect",
        read: true,
        consent: false,
        profile: Profile::Media,
    },
    Operation {
        suffix: "media-composition_manifest",
        read: true,
        consent: false,
        profile: Profile::Media,
    },
    Operation {
        suffix: "media-plan",
        read: false,
        consent: false,
        profile: Profile::Media,
    },
    Operation {
        suffix: "media-revise",
        read: false,
        consent: false,
        profile: Profile::Media,
    },
    Operation {
        suffix: "media-output_record",
        read: false,
        consent: false,
        profile: Profile::Media,
    },
    Operation {
        suffix: "media-review_record",
        read: false,
        consent: false,
        profile: Profile::Media,
    },
    Operation {
        suffix: "publish-inspect",
        read: true,
        consent: false,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-template_create",
        read: false,
        consent: false,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-template_update",
        read: false,
        consent: false,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-version_freeze",
        read: false,
        consent: true,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-deployment_create",
        read: false,
        consent: true,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-deployment_transition",
        read: false,
        consent: true,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-invoke_prepare",
        read: false,
        consent: true,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-export",
        read: false,
        consent: true,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-import",
        read: false,
        consent: false,
        profile: Profile::Publish,
    },
    Operation {
        suffix: "publish-import_rebind",
        read: false,
        consent: true,
        profile: Profile::Publish,
    },
];

fn operation(spec: Operation) -> OperationContract {
    let request = json!({"type":"object","properties":{
        "resource":{"const":"launchwright:workspace"},
        "epoch":{"type":"integer","minimum":0,"maximum":9007199254740991_u64},
        "key":{"type":"string","minLength":1,"maxLength":128},
        "request_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}
    },"required":["resource","epoch","key","request_sha256"],"additionalProperties":false});
    let schema = if spec.read {
        json!({"type":"object","properties":{"ref":{"type":"string"},"input":{"type":"object"}},"required":["ref","input"],"additionalProperties":false})
    } else {
        json!({"type":"object","properties":{"ref":{"type":"string"},"input":{"type":"object"},"request":request},"required":["ref","request","input"],"additionalProperties":false})
    };
    OperationContract {
        descriptor: CommandDescriptor {
            name: format!("driver.launchwright.{}", spec.suffix),
            version: VERSION.into(),
            description: format!(
                "Launchwright {}; app-owned transaction, no implied Platform acceptance",
                spec.suffix
            ),
            input_schema: schema,
            output_schema: json!({"type":"object"}),
            requires: vec!["driver:launchwright".into()],
            risk: if spec.read {
                Risk::ReadOnly
            } else {
                Risk::Mutating
            },
            idempotency: if spec.read {
                Idempotency::ReadOnly
            } else {
                Idempotency::Idempotent
            },
            timeout_ms: 10000,
            dry_run: false,
            interactive_consent: spec.consent,
            backends: vec!["driver:launchwright".into()],
        },
        target: TargetRequirement::ObservedResource,
        commit: if spec.read {
            CommitSemantics::ReadOnly
        } else {
            CommitSemantics::ApplicationTransaction
        },
        retry: if spec.read {
            RetrySemantics::StateIdempotent
        } else {
            RetrySemantics::DurableRequestKey
        },
        undo: UndoSemantics::None,
        cancellation: CancellationSemantics::BeforeEffects,
        atomic_revision_cas: !spec.read,
    }
}

fn bridge(file: &str, sha: Option<&str>) -> Result<Arc<NodeBridge>> {
    let sha=sha.ok_or_else(||semwright_native_sdk::Error::invalid(
        "Build with all LAUNCHWRIGHT_NATIVE_*_BUNDLE_SHA256 values fixed to reviewed bundles; runtime caller pins are forbidden"
    ))?;
    NodeBridge::new(NodeBridgeConfig {
        tool: "node".into(),
        bundle_mount: "launchwright-runtime".into(),
        bundle_file: file.into(),
        bundle_sha256: sha.into(),
        data_mount: "launchwright-data".into(),
        output_mount: None,
        timeout: Duration::from_secs(8),
    })
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let core = bridge("launchwright-core.cjs", CORE_BUNDLE)?;
    let sources = bridge("launchwright-sources.cjs", SOURCES_BUNDLE)?;
    let graph = bridge("launchwright-graph.cjs", GRAPH_BUNDLE)?;
    let effects = bridge("launchwright-effects.cjs", EFFECTS_BUNDLE)?;
    let production = bridge("launchwright-production.cjs", PRODUCTION_BUNDLE)?;
    let review = bridge("launchwright-review.cjs", REVIEW_BUNDLE)?;
    let verification = bridge("launchwright-verification.cjs", VERIFICATION_BUNDLE)?;
    let integrations = bridge("launchwright-integrations.cjs", INTEGRATIONS_BUNDLE)?;
    let extensions = bridge("launchwright-extensions.cjs", EXTENSIONS_BUNDLE)?;
    let work = bridge("launchwright-work.cjs", WORK_BUNDLE)?;
    let usage = bridge("launchwright-usage.cjs", USAGE_BUNDLE)?;
    let media = bridge("launchwright-media.cjs", MEDIA_BUNDLE)?;
    let publish = bridge("launchwright-publish.cjs", PUBLISH_BUNDLE)?;
    let mut app = Application::new("launchwright", VERSION)?
        .require_host_tools()
        .with_observer(core.clone())
        .with_recovery(core.clone());
    for spec in OPERATIONS {
        let contract = operation(*spec);
        let name = contract.descriptor.name.clone();
        let provider = match spec.profile {
            Profile::Core => core.clone(),
            Profile::Sources => sources.clone(),
            Profile::Graph => graph.clone(),
            Profile::Effects => effects.clone(),
            Profile::Production => production.clone(),
            Profile::Review => review.clone(),
            Profile::Verification => verification.clone(),
            Profile::Integrations => integrations.clone(),
            Profile::Extensions => extensions.clone(),
            Profile::Work => work.clone(),
            Profile::Usage => usage.clone(),
            Profile::Media => media.clone(),
            Profile::Publish => publish.clone(),
        };
        app = app.register(contract, provider.operation(name))?;
    }
    serve(NativeDriver::new(app)?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_mutation_declares_atomic_app_cas() {
        for spec in OPERATIONS {
            let contract = operation(*spec);
            assert_eq!(contract.atomic_revision_cas, !spec.read);
            assert!(!contract.descriptor.dry_run);
            assert!(contract.descriptor.name.starts_with("driver.launchwright."));
        }
    }
    #[test]
    fn names_are_unique_and_surface_is_complete() {
        let mut names = std::collections::BTreeSet::new();
        for spec in OPERATIONS {
            assert!(names.insert(spec.suffix));
        }
        assert_eq!(names.len(), 79);
    }
    #[test]
    fn canonical_graph_adapter_is_linked_without_an_admission_surface() {
        assert!(
            semwright_native_sdk::graph_adapter::native_locator(
                "driver:launchwright",
                "release-synthetic",
                "launchwright:workspace",
            )
            .is_ok()
        );
    }
    #[test]
    fn canonical_effects_readback_is_linked_without_execution_authority() {
        assert_eq!(
            semwright_native_sdk::effects_readback::SCOPE,
            "immutable_native_sdk_artifact_properties_only"
        );
        assert_eq!(
            semwright_native_sdk::effects_readback::RESULT_SCHEMA,
            "semwright-native-effects-result/1"
        );
    }
    #[test]
    fn profile_partition_counts_are_stable() {
        let mut counts = std::collections::BTreeMap::new();
        for spec in OPERATIONS {
            *counts.entry(spec.profile).or_insert(0usize) += 1;
        }
        assert_eq!(counts.get(&Profile::Core), Some(&13));
        assert_eq!(counts.get(&Profile::Sources), Some(&2));
        assert_eq!(counts.get(&Profile::Graph), Some(&2));
        assert_eq!(counts.get(&Profile::Effects), Some(&2));
        assert_eq!(counts.get(&Profile::Production), Some(&9));
        assert_eq!(counts.get(&Profile::Review), Some(&6));
        assert_eq!(counts.get(&Profile::Verification), Some(&5));
        assert_eq!(counts.get(&Profile::Integrations), Some(&6));
        assert_eq!(counts.get(&Profile::Extensions), Some(&6));
        assert_eq!(counts.get(&Profile::Work), Some(&6));
        assert_eq!(counts.get(&Profile::Usage), Some(&6));
        assert_eq!(counts.get(&Profile::Media), Some(&6));
        assert_eq!(counts.get(&Profile::Publish), Some(&10));
    }
}
