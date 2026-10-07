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
const PRODUCTION_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_PRODUCTION_BUNDLE_SHA256");
const REVIEW_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_REVIEW_BUNDLE_SHA256");
const VERIFIER_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_VERIFIER_BUNDLE_SHA256");
const INTEGRATIONS_BUNDLE: Option<&str> =
    option_env!("LAUNCHWRIGHT_NATIVE_INTEGRATIONS_BUNDLE_SHA256");
const EXTENSIONS_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_EXTENSIONS_BUNDLE_SHA256");
const WORK_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_WORK_BUNDLE_SHA256");
const MEDIA_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_MEDIA_BUNDLE_SHA256");
const PUBLISH_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_PUBLISH_BUNDLE_SHA256");
const GRAPH_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_GRAPH_BUNDLE_SHA256");
const EFFECTS_BUNDLE: Option<&str> = option_env!("LAUNCHWRIGHT_NATIVE_EFFECTS_BUNDLE_SHA256");

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
enum Profile {
    Core,
    Production,
    Review,
    Verifier,
    Integrations,
    Extensions,
    Work,
    Media,
    Publish,
    Graph,
    Effects,
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
        profile: Profile::Graph,
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
        profile: Profile::Graph,
    },
    Operation {
        suffix: "impact-plan",
        read: false,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "graph-contract",
        read: true,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "graph-inspect",
        read: true,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "graph-cache_assess",
        read: true,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "graph-observation_record",
        read: false,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "impact-coalesce",
        read: false,
        consent: false,
        profile: Profile::Graph,
    },
    Operation {
        suffix: "impact-receipt_record",
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
        profile: Profile::Review,
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
        profile: Profile::Verifier,
    },
    Operation {
        suffix: "waiver-record",
        read: false,
        consent: false,
        profile: Profile::Review,
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
        profile: Profile::Integrations,
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
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "profile-preflight",
        read: true,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "profile-execution_inspect",
        read: true,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "profile-execution_record",
        read: false,
        consent: false,
        profile: Profile::Integrations,
    },
    Operation {
        suffix: "extension-discovery",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "extension-generic_view",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "extension-preparation_status",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "extension-result_inspect",
        read: true,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "source-cli_inspect",
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
        suffix: "extension-prepare_use",
        read: false,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "extension-result_record",
        read: false,
        consent: false,
        profile: Profile::Extensions,
    },
    Operation {
        suffix: "source-cli_ingest",
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
        suffix: "usage-inspect",
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
        suffix: "usage-reserve",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "usage-record",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "usage-adjust",
        read: false,
        consent: false,
        profile: Profile::Work,
    },
    Operation {
        suffix: "billing-test_callback",
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
        suffix: "media-inspect",
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

fn bridge_with_output(
    file: &str,
    sha: Option<&str>,
    output_mount: Option<&str>,
) -> Result<Arc<NodeBridge>> {
    let sha=sha.ok_or_else(||semwright_native_sdk::Error::invalid(
        "Build with all LAUNCHWRIGHT_NATIVE_*_BUNDLE_SHA256 values fixed to reviewed bundles; runtime caller pins are forbidden"
    ))?;
    NodeBridge::new(NodeBridgeConfig {
        tool: "node".into(),
        bundle_mount: "launchwright-runtime".into(),
        bundle_file: file.into(),
        bundle_sha256: sha.into(),
        data_mount: "launchwright-data".into(),
        output_mount: output_mount.map(str::to_owned),
        timeout: Duration::from_secs(8),
    })
}

fn bridge(file: &str, sha: Option<&str>) -> Result<Arc<NodeBridge>> {
    bridge_with_output(file, sha, None)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let core = bridge("launchwright-core.cjs", CORE_BUNDLE)?;
    let production = bridge("launchwright-production.cjs", PRODUCTION_BUNDLE)?;
    let review = bridge("launchwright-review.cjs", REVIEW_BUNDLE)?;
    let verifier = bridge_with_output(
        "launchwright-verifier.cjs",
        VERIFIER_BUNDLE,
        Some("verification-receipts"),
    )?;
    let integrations = bridge("launchwright-integrations.cjs", INTEGRATIONS_BUNDLE)?;
    let extensions = bridge("launchwright-extensions.cjs", EXTENSIONS_BUNDLE)?;
    let work = bridge("launchwright-work.cjs", WORK_BUNDLE)?;
    let media = bridge("launchwright-media.cjs", MEDIA_BUNDLE)?;
    let publish = bridge("launchwright-publish.cjs", PUBLISH_BUNDLE)?;
    let graph = bridge("launchwright-graph.cjs", GRAPH_BUNDLE)?;
    let effects = bridge("launchwright-effects.cjs", EFFECTS_BUNDLE)?;
    let mut app = Application::new("launchwright", VERSION)?
        .require_host_tools()
        .with_observer(core.clone())
        .with_recovery(core.clone());
    for spec in OPERATIONS {
        let contract = operation(*spec);
        let name = contract.descriptor.name.clone();
        let provider = match spec.profile {
            Profile::Core => core.clone(),
            Profile::Production => production.clone(),
            Profile::Review => review.clone(),
            Profile::Verifier => verifier.clone(),
            Profile::Integrations => integrations.clone(),
            Profile::Extensions => extensions.clone(),
            Profile::Work => work.clone(),
            Profile::Media => media.clone(),
            Profile::Publish => publish.clone(),
            Profile::Graph => graph.clone(),
            Profile::Effects => effects.clone(),
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
        assert_eq!(names.len(), 86);
    }
    #[test]
    fn profile_partition_counts_are_stable() {
        let mut counts = std::collections::BTreeMap::new();
        for spec in OPERATIONS {
            *counts.entry(spec.profile).or_insert(0usize) += 1;
        }
        assert_eq!(counts.get(&Profile::Core), Some(&13));
        assert_eq!(counts.get(&Profile::Production), Some(&6));
        assert_eq!(counts.get(&Profile::Review), Some(&7));
        assert_eq!(counts.get(&Profile::Verifier), Some(&1));
        assert_eq!(counts.get(&Profile::Integrations), Some(&9));
        assert_eq!(counts.get(&Profile::Extensions), Some(&13));
        assert_eq!(counts.get(&Profile::Work), Some(&11));
        assert_eq!(counts.get(&Profile::Media), Some(&5));
        assert_eq!(counts.get(&Profile::Publish), Some(&10));
        assert_eq!(counts.get(&Profile::Graph), Some(&9));
        assert_eq!(counts.get(&Profile::Effects), Some(&2));
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
    fn graph_contract_is_locked_to_canonical_semwright_types() {
        use semwright_native_sdk::serde_json::{Value, from_str, to_value};
        use semwright_project_graph::composition::Verdict;
        use semwright_project_graph::{
            Coverage, Divergence, Existence, Freshness, Knowledge, MAX_EDGES, MAX_RESOURCES,
            Relation, TraversalBudget,
        };
        let lock: Value = from_str(include_str!(
            "../../../contracts/project-graph-contract.json"
        ))
        .unwrap();
        assert_eq!(
            lock["source"]["sha"],
            "4d291de26724810017ce7b6d185326514cb79fa6"
        );
        assert_eq!(
            lock["source"]["schema_version"].as_u64(),
            Some(semwright_project_graph::SCHEMA_VERSION as u64)
        );
        assert_eq!(
            lock["query"]["budget"]["nodes"].as_u64(),
            Some(MAX_RESOURCES as u64)
        );
        assert_eq!(
            lock["query"]["budget"]["edges"].as_u64(),
            Some(MAX_EDGES as u64)
        );
        let budget = TraversalBudget {
            nodes: MAX_RESOURCES,
            edges: MAX_EDGES,
            depth: 256,
            results: 10_000,
        };
        budget.validate().unwrap();
        assert!(
            TraversalBudget {
                depth: 257,
                ..budget
            }
            .validate()
            .is_err()
        );
        let relations = [
            Relation::Contains,
            Relation::References,
            Relation::DerivedFrom,
            Relation::ProducedBy,
            Relation::ConsumedBy,
            Relation::Realizes,
            Relation::PublishedAs,
            Relation::VerifiedBy,
        ]
        .iter()
        .map(|value| to_value(value).unwrap())
        .collect::<Vec<_>>();
        assert_eq!(lock["edge"]["relations"], Value::Array(relations));
        let mut knowledge = Knowledge::unknown();
        assert_eq!(knowledge.label(), "UNKNOWN");
        knowledge.existence = Existence::Present;
        knowledge.freshness = Freshness::Current;
        knowledge.divergence = Divergence::Clean;
        knowledge.verification = Verdict::Pass;
        knowledge.coverage = Coverage::complete();
        knowledge.requires_reconcile = false;
        assert_eq!(knowledge.label(), "CURRENT");
        knowledge.freshness = Freshness::Stale;
        assert_eq!(knowledge.label(), "STALE");
        knowledge.existence = Existence::Missing;
        assert_eq!(knowledge.label(), "MISSING");
        knowledge.existence = Existence::Present;
        knowledge.divergence = Divergence::Diverged;
        assert_eq!(knowledge.label(), "DIVERGED");
    }
}
