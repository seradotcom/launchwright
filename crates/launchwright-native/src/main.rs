// SPDX-License-Identifier: AGPL-3.0-only
//! Thin canonical Native SDK adapter. Launchwright owns its SQLite transactions;
//! Broker/Driver Host still own references, grants, sealed runtime tools and mounts.
use semwright_native_sdk::cooperation::{Application,CancellationSemantics,CommitSemantics,OperationContract,RetrySemantics,TargetRequirement,UndoSemantics};
use semwright_native_sdk::process_bridge::{NodeBridge,NodeBridgeConfig};
use semwright_native_sdk::{CommandDescriptor,Idempotency,NativeDriver,Result,Risk,json,serve};
use std::time::Duration;
const VERSION:&str=env!("CARGO_PKG_VERSION");
const BUNDLE:Option<&str>=option_env!("LAUNCHWRIGHT_NATIVE_BUNDLE_SHA256");
const OPERATIONS:&[(&str,bool,bool)]=&[
 ("workspace-describe",true,false),("resource-get",true,false),("events-list",true,false),
 ("release-coverage",true,false),("release-impact",true,false),("anchor-assess",true,false),("artifact-read",true,false),("candidate-inspect",true,false),
 ("entity-create",false,false),("entity-update",false,false),("impact-plan",false,false),("evidence-import",false,false),("deliverable-render",false,false),
 ("candidate-freeze",false,false),("candidate-review",false,false),("candidate-deliver_private",false,true),
 ("template-instantiate",false,false),("work-prepare",false,false),("work-claim",false,false),("work-complete",false,false),
 ("work-mark_unknown",false,false),("workspace-rotate_epoch",false,true),
];
fn operation(suffix:&str,read:bool,consent:bool)->OperationContract{
 let request=json!({"type":"object","properties":{"resource":{"const":"launchwright:workspace"},"epoch":{"type":"integer","minimum":0,"maximum":9007199254740991_u64},"key":{"type":"string","minLength":1,"maxLength":128},"request_sha256":{"type":"string","pattern":"^[0-9a-f]{64}$"}},"required":["resource","epoch","key","request_sha256"],"additionalProperties":false});
 let schema=if read {json!({"type":"object","properties":{"ref":{"type":"string"},"input":{"type":"object"}},"required":["ref","input"],"additionalProperties":false})}else{json!({"type":"object","properties":{"ref":{"type":"string"},"input":{"type":"object"},"request":request},"required":["ref","request","input"],"additionalProperties":false})};
 OperationContract{
  descriptor:CommandDescriptor{name:format!("driver.launchwright.{suffix}"),version:VERSION.into(),description:format!("Launchwright {suffix}; app-owned transaction, no implied Platform acceptance"),input_schema:schema,output_schema:json!({"type":"object"}),requires:vec!["driver:launchwright".into()],risk:if read{Risk::ReadOnly}else{Risk::Mutating},idempotency:if read{Idempotency::ReadOnly}else{Idempotency::Idempotent},timeout_ms:10000,dry_run:false,interactive_consent:consent,backends:vec!["driver:launchwright".into()]},
  target:TargetRequirement::ObservedResource,commit:if read{CommitSemantics::ReadOnly}else{CommitSemantics::ApplicationTransaction},retry:if read{RetrySemantics::StateIdempotent}else{RetrySemantics::DurableRequestKey},undo:UndoSemantics::None,cancellation:CancellationSemantics::BeforeEffects,atomic_revision_cas:!read,
 }
}
#[tokio::main(flavor="current_thread")]
async fn main()->Result<()>{
 let sha=BUNDLE.ok_or_else(||semwright_native_sdk::Error::invalid("Build with LAUNCHWRIGHT_NATIVE_BUNDLE_SHA256 fixed to the reviewed bundle; runtime caller pins are forbidden"))?;
 let bridge=NodeBridge::new(NodeBridgeConfig{tool:"node".into(),bundle_mount:"launchwright-runtime".into(),bundle_file:"launchwright.cjs".into(),bundle_sha256:sha.into(),data_mount:"launchwright-data".into(),output_mount:None,timeout:Duration::from_secs(8)})?;
 let mut app=Application::new("launchwright",VERSION)?.require_host_tools().with_observer(bridge.clone()).with_recovery(bridge.clone());
 for(suffix,read,consent)in OPERATIONS {let contract=operation(suffix,*read,*consent);let name=contract.descriptor.name.clone();app=app.register(contract,bridge.operation(name))?;}
 serve(NativeDriver::new(app)?).await
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn every_mutation_declares_atomic_app_cas(){for(suffix,read,consent)in OPERATIONS{let c=operation(suffix,*read,*consent);assert_eq!(c.atomic_revision_cas,!read);assert!(!c.descriptor.dry_run);assert!(c.descriptor.name.starts_with("driver.launchwright."));}}
 #[test]fn names_are_unique(){let mut names=std::collections::BTreeSet::new();for(suffix,_,_)in OPERATIONS{assert!(names.insert(*suffix));}}
}
