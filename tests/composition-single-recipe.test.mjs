import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSingleRecipeCompositionEvidence } from '../src/composition-single-recipe.mjs';

const semwright='4d291de26724810017ce7b6d185326514cb79fa6';
const launchwright='1'.repeat(40);
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64),e='e'.repeat(64),f='f'.repeat(64),g='0'.repeat(64);

function fixture(){
  return{
    expected_semwright_sha:semwright,
    expected_launchwright_sha:launchwright,
    broker_receipt:{
      schema_version:'launchwright-deltadesk-browser-broker/1',
      semwright_sha:semwright,
      provider:'chromium',
      real_semwright_adapter:true,
      broker_policy_path_observed:true,
      fixture_approver:true,
      human_operator_approval:false,
      agent_javascript:false,
      raw_cdp_exposed:false,
      driver_host_isolation:false,
      platform_job_receipt:false,
      platform_execution_authority:false,
      owned_artifact_cleanup_verified:true,
      negative_controls:{missing_browser_modify_denied:true,forbidden_origin_denied:true},
      captures:[
        {build:'a',screenshot:{sha256:a}},
        {build:'b',screenshot:{sha256:b}}
      ]
    },
    recipe_receipt:{
      schema_version:'launchwright-deltadesk-composition/1',
      classification:'SINGLE_RECIPE_REAL_CAPTURE_COMPOSITION',
      launchwright_source_sha:launchwright,
      semwright_sha:semwright,
      capture_a_sha256:a,
      capture_b_sha256:b,
      managed_assets_exact:true,
      film_sha256:c,
      motion_plan_sha256:d,
      motion_dependencies_sha256:e,
      motion_artifact_sha256:f,
      av_plan_sha256:g,
      master_mp4_sha256:c,
      publication_manifest_sha256:d,
      publication_pointer:'deltadesk/manifest.json',
      native_dispatch_stages:['PlanDelivery','ApplyMotion','RenderMotion','VerifyMotion','TransferMotion','TransferAudio','Mux','VerifyFinalAudio','VerifySync'],
      driver_host:true,
      broker_policy:true,
      single_av_plan:true,
      sync_full_scan_pass:true,
      sync_exhaustive:true,
      audio_pre_encode_pass:true,
      audio_post_encode_pass:true,
      platform_job_receipt:false,
      platform_execution_authority:false,
      r16_closed:false,
      promotional_video:false,
      artifact:{file:'launchwright-deltadesk-single-recipe.mp4',sha256:c,bytes:8192,mime:'video/mp4'}
    }
  };
}

test('single recipe promotes only the owned exact-SHA technical composition path',()=>{
  const out=validateSingleRecipeCompositionEvidence(fixture());
  assert.equal(out.broker_capture_path,'PASS');
  assert.equal(out.single_recipe_real_capture_composition,'PASS');
  assert.equal(out.canonical_av_verification,'PASS');
  assert.equal(out.technical_state,'PASS');
  assert.equal(out.media_requirement_state,'PASS');
  assert.equal(out.capture_authority,'IMPORTED_UNVERIFIED');
  assert.equal(out.platform_execution_authority,false);
  assert.equal(out.external_customer_acceptance,false);
  assert.match(out.chain_sha256,/^[0-9a-f]{64}$/);
});

test('single recipe rejects capture bytes that differ from Broker evidence',()=>{
  const input=fixture();
  input.recipe_receipt.capture_b_sha256='2'.repeat(64);
  assert.throws(()=>validateSingleRecipeCompositionEvidence(input),{code:'Conflict'});
});

test('single recipe rejects another Launchwright revision',()=>{
  const input=fixture();
  input.recipe_receipt.launchwright_source_sha='2'.repeat(40);
  assert.throws(()=>validateSingleRecipeCompositionEvidence(input),{code:'StaleReference'});
});

test('single recipe rejects invented Platform authority',()=>{
  const input=fixture();
  input.recipe_receipt.platform_execution_authority=true;
  assert.throws(()=>validateSingleRecipeCompositionEvidence(input));
});

test('single recipe rejects non-exhaustive sync verification',()=>{
  const input=fixture();
  input.recipe_receipt.sync_exhaustive=false;
  assert.throws(()=>validateSingleRecipeCompositionEvidence(input));
});

test('single recipe requires retained MP4 digest to equal canonical master',()=>{
  const input=fixture();
  input.recipe_receipt.artifact.sha256='3'.repeat(64);
  assert.throws(()=>validateSingleRecipeCompositionEvidence(input),{code:'Conflict'});
});


test('R24 generator is fail-closed over the reviewed exact Semwright Composition source',()=>{
  const source=readFileSync(new URL('../scripts/prepare-composition-single-recipe.py',import.meta.url),'utf8');
  assert.match(source,/UPSTREAM_SHA256 = "09ce6823112affade6df01764f7226f6e33e72a7cb7bfafe0cea9ddca400c700"/);
  assert.match(source,/expected exactly one source anchor/);
  assert.match(source,/driver\.motion-canvas\.asset\.import/);
  assert.match(source,/LAUNCHWRIGHT_SINGLE_RECIPE_COMPOSITION_PASS/);
});

test('R24 heavy lane joins Broker capture and canonical AV in one exact-SHA recipe',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/heavy.yml',import.meta.url),'utf8');
  const composition=workflow.slice(workflow.indexOf('  composition:'),workflow.indexOf('  stress:'));
  assert.match(composition,/semwright-daemon --test launchwright_deltadesk_broker/);
  assert.match(composition,/prepare-composition-single-recipe\.py/);
  assert.match(composition,/semwright-av-composition/);
  assert.match(composition,/launchwright_deltadesk_single_recipe_uses_real_capture_lineage/);
  assert.match(composition,/LAUNCHWRIGHT_SOURCE_SHA: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(composition,/mlt_deltadesk_media\.rs/);
});

test('R24 verifier keeps Platform and customer authority outside the technical fixture PASS',()=>{
  const source=readFileSync(new URL('../src/composition-single-recipe.mjs',import.meta.url),'utf8');
  assert.match(source,/capture_authority:'IMPORTED_UNVERIFIED'/);
  assert.match(source,/platform_execution_authority:false/);
  assert.match(source,/external_customer_acceptance:false/);
});
