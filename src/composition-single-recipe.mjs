// SPDX-License-Identifier: AGPL-3.0-only
import { exactRequestDigest, requireCondition as ensure, validateValue } from '@semwright/native-sdk';

const SHA=/^[0-9a-f]{64}$/;
const COMMIT=/^[0-9a-f]{40}$/;

function sha(value,label){
  ensure(typeof value==='string'&&SHA.test(value),label+' must be lowercase SHA-256');
  return value;
}
function commit(value,label){
  ensure(typeof value==='string'&&COMMIT.test(value),label+' must be a full lowercase commit SHA');
  return value;
}
function object(value,label){
  ensure(value&&typeof value==='object'&&!Array.isArray(value),label+' must be an object');
  return value;
}

export function validateSingleRecipeCompositionEvidence({
  expected_semwright_sha,
  expected_launchwright_sha,
  broker_receipt,
  recipe_receipt
}){
  validateValue({expected_semwright_sha,expected_launchwright_sha,broker_receipt,recipe_receipt});
  commit(expected_semwright_sha,'Expected Semwright SHA');
  commit(expected_launchwright_sha,'Expected Launchwright SHA');
  object(broker_receipt,'Broker receipt');
  object(recipe_receipt,'Single-recipe receipt');

  ensure(broker_receipt.schema_version==='launchwright-deltadesk-browser-broker/1','Unexpected Broker receipt schema');
  ensure(broker_receipt.semwright_sha===expected_semwright_sha,'Broker receipt is from another Semwright revision','StaleReference');
  ensure(broker_receipt.provider==='chromium'&&broker_receipt.real_semwright_adapter===true,'Broker receipt did not use the real Chromium backend');
  ensure(broker_receipt.broker_policy_path_observed===true,'Broker + Policy path was not observed');
  ensure(broker_receipt.fixture_approver===true&&broker_receipt.human_operator_approval===false,'Owned fixture approval scope changed');
  ensure(broker_receipt.agent_javascript===false&&broker_receipt.raw_cdp_exposed===false,'Broker receipt bypassed the semantic browser surface');
  ensure(broker_receipt.owned_artifact_cleanup_verified===true,'Semwright-owned browser artifacts were not proven cleaned up');
  ensure(broker_receipt.negative_controls?.missing_browser_modify_denied===true,'Missing browser.modify negative control did not pass');
  ensure(broker_receipt.negative_controls?.forbidden_origin_denied===true,'Forbidden-origin negative control did not pass');
  ensure(broker_receipt.driver_host_isolation===false,'Browser fixture receipt must not manufacture Driver Host isolation');
  ensure(broker_receipt.platform_job_receipt===false&&broker_receipt.platform_execution_authority===false,'Browser fixture receipt must not manufacture Platform authority');
  ensure(Array.isArray(broker_receipt.captures)&&broker_receipt.captures.length===2,'Expected exact DeltaDesk A/B Broker captures');
  const captures=new Map(broker_receipt.captures.map(row=>[String(row.build).toUpperCase(),row]));
  const captureA=captures.get('A'),captureB=captures.get('B');
  ensure(captureA&&captureB,'DeltaDesk A/B Broker capture identities are incomplete');
  sha(captureA.screenshot?.sha256,'Build A Broker capture digest');
  sha(captureB.screenshot?.sha256,'Build B Broker capture digest');

  ensure(recipe_receipt.schema_version==='launchwright-deltadesk-composition/1','Unexpected single-recipe receipt schema');
  ensure(recipe_receipt.classification==='SINGLE_RECIPE_REAL_CAPTURE_COMPOSITION','Unexpected single-recipe classification');
  ensure(recipe_receipt.semwright_sha===expected_semwright_sha,'Single-recipe evidence is from another Semwright revision','StaleReference');
  ensure(recipe_receipt.launchwright_source_sha===expected_launchwright_sha,'Single-recipe evidence is from another Launchwright revision','StaleReference');
  ensure(recipe_receipt.capture_a_sha256===captureA.screenshot.sha256,'Build A recipe input differs from Broker capture','Conflict');
  ensure(recipe_receipt.capture_b_sha256===captureB.screenshot.sha256,'Build B recipe input differs from Broker capture','Conflict');
  ensure(recipe_receipt.capture_a_sha256!==recipe_receipt.capture_b_sha256,'A/B captures unexpectedly match');
  ensure(recipe_receipt.managed_assets_exact===true,'Motion Canvas did not retain exact managed capture assets');
  sha(recipe_receipt.film_sha256,'Film digest');
  sha(recipe_receipt.motion_plan_sha256,'Motion plan digest');
  sha(recipe_receipt.motion_dependencies_sha256,'Motion dependency digest');
  sha(recipe_receipt.motion_artifact_sha256,'Motion artifact digest');
  sha(recipe_receipt.av_plan_sha256,'AV plan digest');
  sha(recipe_receipt.master_mp4_sha256,'Final master digest');
  sha(recipe_receipt.publication_manifest_sha256,'Publication manifest digest');
  ensure(typeof recipe_receipt.publication_pointer==='string'&&recipe_receipt.publication_pointer.length>0,'Publication pointer is missing');
  ensure(Array.isArray(recipe_receipt.native_dispatch_stages)&&recipe_receipt.native_dispatch_stages.length>=9,'Native dispatch ledger is incomplete');
  ensure(new Set(recipe_receipt.native_dispatch_stages).size===recipe_receipt.native_dispatch_stages.length,'Native dispatch stages contain duplicates');
  ensure(recipe_receipt.driver_host===true&&recipe_receipt.broker_policy===true,'Single recipe did not traverse Broker/Policy and Driver Host');
  ensure(recipe_receipt.single_av_plan===true,'Single recipe did not retain one AV plan');
  ensure(recipe_receipt.sync_full_scan_pass===true&&recipe_receipt.sync_exhaustive===true,'Single recipe sync verification was not exhaustive');
  ensure(recipe_receipt.audio_pre_encode_pass===true&&recipe_receipt.audio_post_encode_pass===true,'Single recipe audio verification did not pass');
  ensure(recipe_receipt.platform_job_receipt===false&&recipe_receipt.platform_execution_authority===false,'Single-recipe receipt must not manufacture Platform authority');
  ensure(recipe_receipt.r16_closed===false&&recipe_receipt.promotional_video===false,'Single-recipe evidence scope changed unexpectedly');
  object(recipe_receipt.artifact,'Retained master artifact');
  ensure(recipe_receipt.artifact.file==='launchwright-deltadesk-single-recipe.mp4','Unexpected retained master filename');
  ensure(recipe_receipt.artifact.mime==='video/mp4','Retained master is not MP4');
  sha(recipe_receipt.artifact.sha256,'Retained master digest');
  ensure(recipe_receipt.artifact.sha256===recipe_receipt.master_mp4_sha256,'Retained master digest differs from AV manifest','Conflict');
  ensure(Number.isInteger(recipe_receipt.artifact.bytes)&&recipe_receipt.artifact.bytes>1000,'Retained master is unexpectedly small');

  const facts={
    launchwright_sha:expected_launchwright_sha,
    semwright_sha:expected_semwright_sha,
    capture_a_sha256:recipe_receipt.capture_a_sha256,
    capture_b_sha256:recipe_receipt.capture_b_sha256,
    film_sha256:recipe_receipt.film_sha256,
    motion_plan_sha256:recipe_receipt.motion_plan_sha256,
    av_plan_sha256:recipe_receipt.av_plan_sha256,
    master_mp4_sha256:recipe_receipt.master_mp4_sha256,
    publication_manifest_sha256:recipe_receipt.publication_manifest_sha256,
    broker_capture_path:'PASS',
    single_recipe_real_capture_composition:'PASS',
    canonical_av_verification:'PASS'
  };
  return{
    schema_version:'launchwright-composition-single-recipe-evidence/1',
    ...facts,
    chain_sha256:exactRequestDigest('launchwright/composition-single-recipe-evidence/1',facts),
    scope:'OWNED_SYNTHETIC_DELTADESK_EXACT_SHA',
    admission:'EXACT_SHA_NATIVE_RECIPE_ACCEPTANCE',
    technical_state:'PASS',
    media_requirement_state:'PASS',
    output_editorial_state:'PENDING',
    capture_authority:'IMPORTED_UNVERIFIED',
    human_operator_approval:false,
    platform_execution_authority:false,
    external_customer_acceptance:false,
    explanation:'The exact Broker-routed DeltaDesk A/B capture digests are consumed as managed Motion Canvas assets by one pinned Semwright Composition/AV execution that continues through Driver Host, exhaustive sync/audio verification and publication. This establishes the owned exact-SHA technical recipe only; it does not create human approval, Platform job authority, customer capture admission or editorial approval.'
  };
}
