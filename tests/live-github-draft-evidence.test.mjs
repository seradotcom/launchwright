// SPDX-License-Identifier: AGPL-3.0-only
// R66: static committed proof consistency only. Never claims to simulate
// the actual GitHub API events; those are publicly auditable at PR #90.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const load=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
test('R66 real external GitHub operator receipt is internally SHA-bound, unmerged and scope-limited',()=>{
  const r=load('evidence/r66/live-github-draft.json');
  const {receipt_sha256,...body}=r;
  const hash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  assert.equal(hash,receipt_sha256);
  assert.equal(r.schema_version,'launchwright-r66-owned-operator-github-draft/1');
  assert.equal(r.app_checkout_source_sha,'de8695b8ccce4464c0e4104af69871e5ee61e5cc');
  assert.equal(r.canonical_native_sdk,'1.0.0');
  assert.equal(r.github_draft.pull_request,90);
  assert.equal(r.github_draft.url,'https://github.com/seradotcom/launchwright/pull/90');
  assert.equal(r.github_draft.draft_created,true);
  assert.equal(r.github_draft.final_state,'CLOSED');
  assert.equal(r.github_draft.final_draft,true);
  assert.equal(r.github_draft.merge_commit,null);
  assert.equal(r.github_draft.remote_fixture_branch_deleted,true);
  assert.equal(r.github_draft.read_only_recover_exact_original_intent,true);
  assert.equal(r.github_draft.second_pr_created_during_recovery,false);
  assert.equal(r.local_git_source.remote_branch_push_separate_operator_action,true);
  assert.equal(r.local_git_source.automated_git_push_by_r41,false);
  assert.match(r.local_git_source.head_sha,/^[a-f0-9]{40}$/u);
  assert.match(r.local_git_source.r41_intent_sha256,/^[a-f0-9]{64}$/u);
  assert.equal(r.fixture_production_or_customer_data,false);
  assert.equal(r.admission_boundaries.real_authorized_operator_GitHub_Draft_PR_transport_accepted,true);
  for(const key of ['independent_customer_approval','remote_git_docs_merge',
    'customer_source_capture','public_documentation_activation',
    'semwright_platform_publish_authority','external_customer_acceptance'])
    assert.equal(r.admission_boundaries[key],false,key);
});
test('R66 master keeps DOCS_GIT PARTIAL and the original master BLOCKED despite live Draft PR',()=>{
  const master=load('docs/master-profiles.json');
  const row=master.profiles.find(p=>p.profile==='DOCS_GIT');
  assert.equal(row.implementation,'PARTIAL');
  assert.equal(row.operator_live_evidence.pr,90);
  assert.equal(row.operator_live_evidence.merged,false);
  assert.equal(row.operator_live_evidence.customer_acceptance,false);
  assert.equal(row.operator_live_evidence.platform_publish,false);
  const report=load('ACCEPTANCE_REPORT.json');
  assert.equal(report.overall_status,'BLOCKED');
  assert.equal(report.integration_complete,false);
  const acceptance=readFileSync(join(root,'docs/ACCEPTANCE.md'),'utf8');
  assert.ok(acceptance.includes('R66 accepted'));
  assert.ok(acceptance.includes('PR #90'));
  assert.ok(acceptance.includes('DOCS_GIT remains PARTIAL'));
  const guide=readFileSync(join(root,'docs/GITHUB_DOCS_LIVE_ACCEPTANCE.md'),'utf8');
  assert.ok(guide.includes('DOCS_GIT remains PARTIAL'));
  assert.ok(guide.includes('closed without'));
  const serialized=JSON.stringify(master)+JSON.stringify(report);
  assert.ok(!serialized.includes('gho_'));
  assert.ok(!serialized.includes('/home/sergio/.cache/launchwright-owned-gh'));
});
