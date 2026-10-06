// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../src/application.mjs';
import { setup, baseline, update, captureInput } from './helpers.mjs';

async function mediaFixture(t,options={}){
  const {app}=setup(t,options),b=await baseline(app);
  const source=(await update(app,b.source,{approval:'approved',purpose:'Owned media capture fixture'})).entity;
  const scenario=await b.create('scenario',{
    release_id:b.release.id,name:'Media scenario',source_id:source.id,target_id:b.target.id,
    steps:[{action:'navigate',anchor:'root'},{action:'assert',anchor:'root'}],
    anchors:[{name:'root',role:'main',label:'Owned fixture',expected_count:1}],
    readiness:'declared',version_label:'1',reset_strategy:'isolated-context',effects:[]
  });
  const capture=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{segments:[{start_ms:0,end_ms:20000,source_sha256:'9'.repeat(64)}]}))).entity;
  const sanitized=(await execute(app,'capture.ingest',captureInput(b,source,scenario,{
    name:'Sanitized interactive source',classification:'sanitized',
    provenance:{
      capture_class:'SANITIZED_DERIVATIVE',synthetic:true,parent_evidence_id:capture.id,
      transformations:[{kind:'REDACT',operation_ref:'redact-media-fixture',semantic_effect:'preserves-observed-state'}]
    }
  }))).entity;
  const claim=await b.create('claim',{
    release_id:b.release.id,name:'Media claim',text:'Export is available in this owned fixture.',
    target_id:b.target.id,category:'feature',evidence_ids:[capture.id]
  });
  const script=await b.create('copy_block',{
    release_id:b.release.id,name:'Narration script',target_id:b.target.id,claim_id:claim.id,
    locale:'en-US',content:'Export is available.',owner:'managed'
  });
  const musicSheet=await b.create('copy_block',{
    release_id:b.release.id,name:'Owned music cue sheet',target_id:b.target.id,claim_id:claim.id,
    locale:'en-US',content:'Owned instrumental cue.',owner:'human'
  });
  return{app,b,source,scenario,capture,sanitized,claim,script,musicSheet};
}

function planInput(f,overrides={}){
  const base={
    release_id:f.b.release.id,target_id:f.b.target.id,scenario_id:f.scenario.id,name:'Owned product demo',
    backend:{profile:'motion-canvas',fidelity:'exact',losses:[],unsupported:[]},
    frame_rate:{num:30000,den:1001},duration:{num:'20',den:'1'},
    shots:[{
      id:'shot_main',name:'Observed export flow',capture_evidence_id:f.capture.id,interactive_evidence_id:f.sanitized.id,
      claim_ids:[f.claim.id],interval:{start:{num:'0',den:'1'},end:{num:'20',den:'1'}},
      purpose:'demonstrated',transform_refs:['capture-source-preserved']
    }],
    assets:[
      {id:'narration',kind:'narration',version:'v1',rights:'owned',source_resource_id:f.script.id,claim_ids:[f.claim.id],locale:'en-US',origin:'owned'},
      {id:'captions',kind:'captions',version:'v1',rights:'owned',source_resource_id:f.script.id,claim_ids:[f.claim.id],locale:'en-US',origin:'owned'},
      {id:'music',kind:'music',version:'v1',rights:'owned',source_resource_id:f.musicSheet.id,claim_ids:[],origin:'owned'}
    ],
    tracks:[
      {id:'voice_track',asset_id:'narration',interval:{start:{num:'0',den:'1'},end:{num:'20',den:'1'}}},
      {id:'caption_track',asset_id:'captions',interval:{start:{num:'0',den:'1'},end:{num:'20',den:'1'}}},
      {id:'music_track',asset_id:'music',interval:{start:{num:'0',den:'1'},end:{num:'20',den:'1'}}}
    ],
    variants:[
      {id:'video_16x9',kind:'video',locale:'en-US',width:1920,height:1080,safe_area_milli:{top:50,right:50,bottom:80,left:50},shot_ids:['shot_main'],track_ids:['voice_track','caption_track','music_track']},
      {id:'shots_16x9',kind:'screenshot-series',locale:'en-US',width:1920,height:1080,safe_area_milli:{top:50,right:50,bottom:50,left:50},shot_ids:['shot_main'],track_ids:[]},
      {id:'demo_web',kind:'interactive-demo',locale:'en-US',width:1440,height:900,safe_area_milli:{top:20,right:20,bottom:20,left:20},shot_ids:['shot_main'],track_ids:[]}
    ],
    interactive_policy:{sanitized_only:true,productive_auth:false,active_source_scripts:false,external_links:['https://example.com/docs']}
  };
  return{...base,...overrides,
    backend:{...base.backend,...(overrides.backend??{})},
    interactive_policy:{...base.interactive_policy,...(overrides.interactive_policy??{})}
  };
}

async function createPlan(f,input=planInput(f)){
  return (await execute(f.app,'media.plan',input)).entity;
}

test('RS-MED-01 and RS-MED-09 use canonical Composition/media-time contracts without a local clock kernel',async t=>{
  const f=await mediaFixture(t),plan=await createPlan(f);
  assert.equal(plan.data.composition_contract,'semwright-composition/C0');
  assert.equal(plan.data.media_time_authority,'semwright-media-time');
  assert.deepEqual(plan.data.composition_handoff.operations,{
    plan:'driver.motion-canvas.composition.plan',
    apply:'driver.motion-canvas.composition.apply',
    render_plan:'driver.motion-canvas.render.plan',
    render_execute:'driver.motion-canvas.render.execute',
    verify:'driver.motion-canvas.composition.verify'
  });
  assert.equal(plan.data.composition_handoff.execution_authority,false);
  await assert.rejects(execute(f.app,'media.plan',planInput(f,{duration:{num:'20',den:'2'}})),{code:'InvalidArgument'});
  await assert.rejects(execute(f.app,'media.plan',planInput(f,{duration:{num:20,den:1}})),{code:'InvalidArgument'});
});

test('RS-MED-02 and RS-MED-03 revisions preserve sources and identify reusable variants',async t=>{
  const f=await mediaFixture(t),plan=await createPlan(f);
  const changedMusic=(await update(f.app,f.musicSheet,{content:'Owned instrumental cue, revised.'})).entity;
  f.musicSheet=changedMusic;
  const stale=await execute(f.app,'media.inspect',{id:plan.id});
  assert.equal(stale.source_freshness,'STALE');
  assert.equal(stale.variants.find(v=>v.id==='video_16x9').source_freshness,'STALE');
  assert.equal(stale.variants.find(v=>v.id==='shots_16x9').source_freshness,'CURRENT');
  assert.equal(stale.variants.find(v=>v.id==='demo_web').source_freshness,'CURRENT');

  const revised=(await execute(f.app,'media.revise',{
    id:plan.id,expected:plan.version,plan:planInput(f),reason:'Refresh only the changed owned music source.'
  })).entity;
  assert.equal(revised.data.parent_plan_id,plan.id);
  assert.deepEqual(revised.data.reusable_variant_ids.sort(),['demo_web','shots_16x9']);
  assert.equal(revised.data.variant_contracts.find(v=>v.id==='video_16x9').reusable_from_parent,false);
});

test('RS-MED-04 and RS-MED-06 reject fake footage and unsafe interactive sources',async t=>{
  const f=await mediaFixture(t);
  await assert.rejects(execute(f.app,'media.plan',planInput(f,{
    interactive_policy:{sanitized_only:true,productive_auth:true,active_source_scripts:false,external_links:[]}
  })),{code:'InvalidArgument'});

  const generatedInput=captureInput(f.b,f.source,f.scenario,{
    name:'Generated illustration',classification:'generated',
    provenance:{capture_class:'GENERATED_ILLUSTRATION',synthetic:true,transformations:[]},
    receipt:{authority:'imported',provider:'editorial',provider_version:'1',operation_id:'generated-1',profile:'editorial',outcome:'SUCCEEDED'}
  });
  delete generatedInput.receipt.platform_job_id;delete generatedInput.receipt.native_receipt_sha256;
  const generated=(await execute(f.app,'capture.ingest',generatedInput)).entity;
  const bad=planInput(f);
  bad.shots[0]={...bad.shots[0],capture_evidence_id:generated.id};
  await assert.rejects(execute(f.app,'media.plan',bad),{code:'Conflict'});
});

test('RS-MED-05 claim changes invalidate narration/captions through versioned pins',async t=>{
  const f=await mediaFixture(t),plan=await createPlan(f);
  const before=await execute(f.app,'media.inspect',{id:plan.id});
  assert.equal(before.source_freshness,'CURRENT');
  f.claim=(await update(f.app,f.claim,{text:'Export is available with revised wording.'})).entity;
  const after=await execute(f.app,'media.inspect',{id:plan.id});
  assert.equal(after.source_freshness,'STALE');
  assert.ok(after.changed_sources.some(c=>c.id===f.claim.id));
});

test('RS-MED-07 alternate backends must declare fidelity losses instead of silent equivalence',async t=>{
  const f=await mediaFixture(t);
  await assert.rejects(execute(f.app,'media.plan',planInput(f,{
    backend:{profile:'declared-alternate',fidelity:'exact',losses:[],unsupported:[]}
  })),{code:'InvalidArgument'});
  const plan=await createPlan(f,planInput(f,{
    backend:{profile:'declared-alternate',fidelity:'variant-required',losses:['spring transition approximated'],unsupported:['native blur effect']}
  }));
  assert.equal(plan.data.composition_handoff.operations,null);
  assert.equal(plan.data.composition_handoff.execution_authority,false);
});

test('RS-MED-08 technically admitted media remains editorially pending',async t=>{
  const f=await mediaFixture(t,{capabilities:{canonical_composition_receipts:true}}),plan=await createPlan(f);
  const output=(await execute(f.app,'media.output_record',{
    plan_id:plan.id,variant_id:'video_16x9',state:'SUCCEEDED',authority:'semwright-composition',
    provider:'motion-canvas',provider_version:'fixture',job_id:'job-video-1',receipt_sha256:'1'.repeat(64),
    artifact_sha256:'2'.repeat(64),mime:'video/mp4',duration:{num:'20',den:'1'},
    observed_at:'2026-10-05T15:00:00.000Z',reported_verification:'PASS'
  })).entity;
  assert.equal(output.data.technical_effective,'PASS');
  let inspection=await execute(f.app,'media.inspect',{id:plan.id});
  assert.equal(inspection.variants.find(v=>v.id==='video_16x9').editorial,'PENDING');
  await execute(f.app,'media.review_record',{output_id:output.id,artifact_sha256:output.data.artifact_sha256,decision:'approve-editorial',comment:'Pacing and legibility reviewed.'});
  inspection=await execute(f.app,'media.inspect',{id:plan.id});
  assert.equal(inspection.variants.find(v=>v.id==='video_16x9').editorial,'approve-editorial');
  assert.equal(inspection.editorial_state,'PENDING');
});

test('RS-MED-10 video, screenshot series and interactive demo require independent canonical receipts',async t=>{
  const f=await mediaFixture(t,{capabilities:{canonical_composition_receipts:true}}),plan=await createPlan(f);
  const specs=[
    ['video_16x9','video/mp4','3',true],
    ['shots_16x9','application/zip','4',false],
    ['demo_web','application/zip','5',false]
  ];
  for(const [variant_id,mime,digit,video] of specs){
    const input={
      plan_id:plan.id,variant_id,state:'SUCCEEDED',authority:'semwright-composition',provider:'composition-fixture',provider_version:'1',
      job_id:'job-'+variant_id,receipt_sha256:digit.repeat(64),artifact_sha256:String(Number(digit)+3).repeat(64),mime,
      observed_at:'2026-10-05T15:10:00.000Z',reported_verification:'PASS'
    };
    if(video)input.duration={num:'20',den:'1'};
    const output=(await execute(f.app,'media.output_record',input)).entity;
    await execute(f.app,'media.review_record',{output_id:output.id,artifact_sha256:output.data.artifact_sha256,decision:'approve-editorial',comment:'Independent output reviewed.'});
  }
  const inspection=await execute(f.app,'media.inspect',{id:plan.id});
  assert.equal(inspection.technical_state,'PASS');
  assert.equal(inspection.editorial_state,'APPROVED_EDITORIAL');
  assert.equal(inspection.complete_real_output_set,true);

  const imported=(await execute(f.app,'media.output_record',{
    plan_id:plan.id,variant_id:'shots_16x9',state:'SUCCEEDED',authority:'imported',provider:'external',provider_version:'1',
    artifact_sha256:'f'.repeat(64),mime:'application/zip',observed_at:'2026-10-05T15:20:00.000Z',reported_verification:'PASS'
  })).entity;
  assert.equal(imported.data.technical_effective,'UNKNOWN');

  const failed=(await execute(f.app,'media.output_record',{
    plan_id:plan.id,variant_id:'demo_web',state:'FAILED',authority:'imported',provider:'external',provider_version:'1',
    artifact_sha256:'e'.repeat(64),mime:'application/zip',observed_at:'2026-10-05T15:21:00.000Z',reported_verification:'FAIL'
  })).entity;
  assert.equal(failed.data.technical_effective,'FAIL');
});


test('RS-MED-11 prepares an exact authority-free Motion Canvas handoff manifest',async t=>{
  const f=await mediaFixture(t),plan=await createPlan(f);
  const manifest=await execute(f.app,'media.composition_manifest',{plan_id:plan.id,variant_id:'video_16x9'});
  assert.equal(manifest.schema_version,'launchwright-composition-handoff/1');
  assert.equal(manifest.semwright_snapshot_sha,'4d291de26724810017ce7b6d185326514cb79fa6');
  assert.equal(manifest.plan_digest,plan.data.plan_digest);
  assert.equal(manifest.variant.id,'video_16x9');
  assert.equal(manifest.ready_for_platform_resolution,true);
  assert.equal(manifest.ready_for_driver_execution,false);
  assert.equal(manifest.execution_authority,false);
  assert.equal(manifest.host_acceptance,false);
  assert.deepEqual(manifest.blockers,[]);
  assert.equal(manifest.correlations.length,1);
  assert.equal(manifest.correlations[0].platform_job_id,'job-fixture-1');
  assert.equal(manifest.correlations[0].segments[0].source_sha256,'9'.repeat(64));
  assert.equal(manifest.correlations[0].host_locator_resolved,false);
  assert.equal(manifest.required_operations.render_execute,'driver.motion-canvas.render.execute');
  assert.match(manifest.manifest_digest,/^[0-9a-f]{64}$/);
  await assert.rejects(execute(f.app,'media.composition_manifest',{plan_id:plan.id,variant_id:'demo_web'}),{code:'Unsupported'});
  await update(f.app,f.musicSheet,{content:'Drift after plan preparation.'});
  await assert.rejects(execute(f.app,'media.composition_manifest',{plan_id:plan.id,variant_id:'video_16x9'}),{code:'StaleReference'});
});
