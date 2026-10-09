// SPDX-License-Identifier: AGPL-3.0-only
// The private original master is not copied here. These public meta-gates
// refuse to turn a source line, file count or a synthetic fixture into PASS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMaster, renderCapabilityMatrix, loadMaster } from '../scripts/master-acceptance.mjs';
import { launcherCatalog } from '../scripts/acceptance-launcher.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const run=(...args)=>spawnSync(process.execPath,['scripts/master-acceptance.mjs',...args],
  {cwd:root,encoding:'utf8'});
test('R39 original master denominator is 196 unique requirements in 22 modules and 36 distinct mandatory scenarios',()=>{
  const {index,manifest,lock}=loadMaster(root),gate=evaluateMaster(index,manifest,lock);
  assert.equal(index.requirements.length,196);
  assert.equal(Object.keys(gate.public_requirement_modules).length,22);
  assert.equal(gate.public_requirement_count,196);
  assert.equal(gate.master_scenario_count,36);
  assert.equal(gate.scenarios_referenced_by_requirements,21);
  assert.equal(gate.scenarios_without_public_requirement_reference,15);
  assert.equal(gate.scenarios.length,36);
  assert.equal(gate.total_core_profiles,9);
  assert.equal(gate.complete_core_profiles,0);
  assert.equal(gate.integration_complete,false);
  assert.equal(gate.overall_status,'BLOCKED');
  assert.equal(gate.external_publish_authority,false);
});

test('R39 no source-only profile or unverified private Publish can become accepted by declaration',()=>{
  const {index,manifest,lock}=loadMaster(root);
  const copy=structuredClone(manifest);
  const publish=copy.profiles.find(p=>p.profile==='PUBLISH_PRIVATE');
  assert.equal(publish.implementation,'BLOCKED_UPSTREAM');
  assert.equal(copy.profiles.find(p=>p.profile==='DECK_PDF').implementation,'MISSING');
  assert.equal(copy.profiles.find(p=>p.profile==='DOCS_GIT').implementation,'PARTIAL');
  publish.implementation='COMPLETE';
  assert.throws(()=>evaluateMaster(index,copy,lock),
    /requires exact evidence/u);
  const duplicate=structuredClone(manifest);
  duplicate.profiles[0]=duplicate.profiles[1];
  assert.throws(()=>evaluateMaster(index,duplicate,lock),/profile entry/u);
});

test('R39 a malformed requirement ID or invalid scenario reference fails the denominator gate',()=>{
  const {index,manifest,lock}=loadMaster(root);
  const bad=structuredClone(index);
  bad.requirements[0].id=bad.requirements[1].id;
  assert.throws(()=>evaluateMaster(bad,manifest,lock),/Requirement/u);
  const badScenario=structuredClone(index);
  badScenario.requirements[0].scenario_ids=['RS-E2E-99'];
  assert.throws(()=>evaluateMaster(badScenario,manifest,lock),/outside the original 36/u);
});

test('R39 master --check is truthful and --require-complete fails until all evidence exists',()=>{
  const check=run('--check');
  assert.equal(check.status,0,check.stderr);
  const output=JSON.parse(check.stdout);
  assert.equal(output.status,'BLOCKED');
  assert.equal(output.completed_core_profiles,0);
  const complete=run('--require-complete');
  assert.equal(complete.status,2);
  assert.equal(JSON.parse(complete.stdout).status,'BLOCKED');
  const profiles=run('--list-profiles');
  assert.equal(profiles.status,0);
  assert.equal(JSON.parse(profiles.stdout).length,18);
});

test('R39 capability matrix is derived from the public profile evidence only, with no private master text',()=>{
  const {index,manifest,lock}=loadMaster(root);
  const md=renderCapabilityMatrix(manifest,evaluateMaster(index,manifest,lock));
  assert.match(md,/\*\*Whole-master gate: BLOCKED/u);
  assert.match(md,/\| PUBLISH_PRIVATE \| CORE \| BLOCKED_UPSTREAM \|/u);
  assert.match(md,/\| DECK_PDF \| CORE \| MISSING \|/u);
  assert.match(md,/21 referenced/u);
  assert.ok(!md.includes('Semwright Release Studio v0.1.0/'));
  // Git checkout may materialize tracked Markdown using Windows CRLF. The
  // actual generated report content and every profile row must still match.
  assert.equal(readFileSync(join(root,'CAPABILITY_MATRIX.md'),'utf8').replace(/\r\n/gu,'\n'),md);
});

test('R39 launcher enumerates actual selective CI lanes without running any suite or live publish',()=>{
  const x=launcherCatalog();
  assert.equal(x.application_sdk,'Semwright Native SDK 1.0.0');
  assert.equal(x.ci_runner_required.length,10);
  for(const name of ['native','host','verifier','extension','effects','composition',
    'deltadesk','godot','browser','stress'])assert.ok(x.ci_runner_required.includes(name));
  assert.equal(x.no_automatic_install_or_publish,true);
  assert.equal(x.platform_publish_gate,'NOT_ESTABLISHED');
  const denied=spawnSync(process.execPath,['scripts/acceptance-launcher.mjs','dispatch','publish'],
    {cwd:root,encoding:'utf8'});
  assert.notEqual(denied.status,0,'Unknown action cannot create a remote job');
});

test('R39 master backup source policies exclude untracked account files; no sensitive private spec is committed',()=>{
  const pkg=readFileSync(join(root,'scripts/pack-source.mjs'),'utf8');
  assert.ok(pkg.includes("'git'"));
  assert.ok(pkg.includes("'archive'"));
  assert.ok(pkg.includes('symlink or secret-bearing path'));
  assert.ok(pkg.includes('content_secret_scan_performed:false'));
  assert.ok(!pkg.includes('launchwright/master-private'));
});


test('R39 delivery report agrees with the strict aggregate master gate',()=>{
  const d=JSON.parse(readFileSync(join(root,'DELIVERY_REPORT.json'),'utf8'));
  const {index,manifest,lock}=loadMaster(root);
  const evaluated=evaluateMaster(index,manifest,lock);
  assert.equal(d.requirements_total,evaluated.public_requirement_count);
  assert.equal(d.public_module_ids,Object.keys(evaluated.public_requirement_modules).length);
  assert.equal(d.mandatory_e2e_scenarios_total,evaluated.master_scenario_count);
  assert.equal(d.public_index_distinct_scenario_references,evaluated.scenarios_referenced_by_requirements);
  assert.equal(d.capability_profile_count,manifest.profiles.length);
  assert.equal(d.whole_master_status,evaluated.overall_status);
  assert.equal(d.platform_publish_authority,false);
  assert.equal(d.chatgpt_plugin_host_acceptance,false);
});

test('R39 CI source-transfer workflow has no publication steps and validates the actual committed SHA',()=>{
  const workflow=readFileSync(join(root,'.github/workflows/source-transfer.yml'),'utf8');
  assert.ok(workflow.includes('workflow_dispatch'));
  assert.ok(workflow.includes('node scripts/pack-source.mjs --out-dir'));
  assert.ok(workflow.includes("subprocess.check_output(['git','rev-parse','HEAD']"));
  assert.ok(workflow.includes('archive_sha256'));
  assert.ok(workflow.includes('npm audit --omit=dev --audit-level=high'));
  assert.ok(!workflow.includes('gh release create'));
  assert.ok(!workflow.includes('release publish'));
});
