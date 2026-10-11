// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContinuityController} from '../web/continuity-ui.mjs';
const first={id:'old',data:{name:'R <img src=x onerror=alert(1)>'}};
const second={id:'new',data:{name:'Release B'}};
const a={id:'ca',data:{name:'Candidate A',release_id:'old'}};
const b={id:'cb',data:{name:'Candidate B',release_id:'new'}};
const sha='a'.repeat(64),before='b'.repeat(64),after='c'.repeat(64);
const plan={plan_sha256:sha,before_candidate_sha256:before,after_candidate_sha256:after,
  changed_artifacts:1,added_artifacts:0,removed_artifacts:0,unchanged_artifacts:0};
const client={
  planLocalContinuity:async x=>{assert.equal(x.before_candidate_id,'ca');return plan;},
  exportLocalContinuity:async(p,c)=>{assert.equal(p,plan);assert.equal(c.confirm_plan_sha256,sha);return{plan_sha256:sha,zip_sha256:sha,zip_bytes:56};},
  continuityStatus:async hash=>({plan_sha256:hash,state:'READY',zip_sha256:sha}),
  continuityBundleUrl:hash=>'/api/v1/local-continuity/'+hash+'/bundle.zip'
};
test('R67 UI escapes source names, constrains selections, validates explicit approvals',async()=>{
  const ui=createContinuityController(client);
  let html=ui.render([first,second],[a,b]);
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  ui.choose('before_release_id','old');ui.choose('before_candidate_id','ca');
  ui.choose('after_release_id','new');ui.choose('after_candidate_id','cb');
  await assert.rejects(ui.prepare({private:false,incomplete:true}),/acknowledgement/);
  await ui.prepare({private:true,incomplete:true});
  assert.equal(ui.plan.plan_sha256,sha);
  html=ui.render([first,second],[a,b]);
  assert.ok(html.includes('Prepared plan'));
  await assert.rejects(ui.exportPrivate({acknowledge_private_export:false}),/confirmation/);
  await ui.exportPrivate({confirm_plan_sha256:sha,acknowledge_private_export:true});
  html=ui.render([first,second],[a,b]);
  assert.ok(html.includes('/api/v1/local-continuity/'+sha+'/bundle.zip'));
  ui.choose('after_release_id','old');
  assert.equal(ui.plan,null);
  assert.equal(ui.selection.after_candidate_id,'');
  assert.ok(!ui.render([first,second],[a,b]).includes('Download private'));
});
test('R67 UI can recover original export without retrying the POST',async()=>{
  const ui=createContinuityController(client);
  await assert.rejects(ui.recover('bad'),/complete plan SHA/);
  assert.equal((await ui.recover(sha)).state,'READY');
  assert.ok(ui.render([first,second],[a,b]).includes('Download private continuity ZIP'));
  ui.clear();
  assert.equal(ui.status,null);
});
