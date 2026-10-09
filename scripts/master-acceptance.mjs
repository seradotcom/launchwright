#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// R39 master closeout gate: evidence-aware, no invented PASS and no access
// to private specification ZIP. Source schema IDs only; real acceptance
// remains in exact-SHA evidence folders and the upstream Platform owner.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const knownProfiles=new Set([
  'WEB','CLI','GODOT','MOBILE_IMPORT','ANDROID_CAPTURE','IOS_CAPTURE',
  'DOCS_STATIC','DOCS_GIT','VIDEO','DECK_PDF','INTERACTIVE_DEMO',
  'STORE_PACKAGE','APPLE_UPLOAD','PLAY_UPLOAD','PLUGIN_HOST',
  'PUBLISH_PRIVATE','CUSTOM_CMS','PUBLIC_SOCIAL_POST'
]);
const states=new Set(['PARTIAL','MISSING','BLOCKED_UPSTREAM','OUT_OF_SCOPE','COMPLETE']);
const levels=new Set([
  'OWNED_FIXTURE_BROKER','OWNED_FIXTURE_DRIVER_HOST','OWNED_FIXTURE_HOST',
  'LOCAL_CONTRACT_CI','LOCAL_APPLICATION_CI','OWNED_FIXTURE_DOCUMENT_RENDER','OWNED_FIXTURE_OFFLINE_BROWSER','NOT_TESTED',
  'LOCAL_MCP_CONSUMER','LOCAL_CONSUMER_REHEARSAL','LOCAL_GIT_BRANCH_CI','EXTENSION_CONTRACT_ONLY',
  'NOT_REQUIRED'
]);
const scopes=new Set(['CORE','PROFILE','EXTERNAL_ACCEPTANCE','FUTURE_OPTION']);
export function evaluateMaster(index,manifest,sourceLock){
  if(!index||index.schema_version!=='launchwright-requirements-index/1'||
    !Array.isArray(index.requirements)||index.requirements.length!==196)
    throw Error('Master requires exactly 196 versioned public requirement identifiers');
  if(!manifest||manifest.schema_version!=='launchwright-master-profile-evidence/1'||
    manifest.requirements_total!==196||manifest.scenario_catalog_total!==36 ||
    !Array.isArray(manifest.profiles)||manifest.profiles.length!==18)
    throw Error('Original master profile/requirement/scenario denominator differs');
  if(!sourceLock||sourceLock.schema_version!=='launchwright-source-lock/1'||
    sourceLock.native_sdk?.version!=='1.0.0')
    throw Error('Pinned real Native SDK source lock is absent or unsupported');
  const ids=new Set(),scenarios=new Set(),modules=new Map();
  for(const req of index.requirements){
    if(!req||typeof req.id!=='string'||
      !/^RS-[A-Z]{2,8}-[0-9]{2}$/u.test(req.id)||ids.has(req.id)||
      typeof req.test_id!=='string'||!req.test_id.startsWith('RS-AT-')||
      !Array.isArray(req.scenario_ids)||!req.module||!scopes.has(req.scope))
      throw Error('Requirement ledger has duplicated/invalid ID or incomplete metadata');
    ids.add(req.id);
    modules.set(req.module,(modules.get(req.module)??0)+1);
    for(const code of req.scenario_ids){
      if(!/^RS-E2E-(0[1-9]|[12][0-9]|3[0-6])$/u.test(code))
        throw Error('Requirement links to scenario outside the original 36');
      scenarios.add(code);
    }
  }
  if(modules.size!==22)throw Error('Master public ledger module denominator differs from actual 22');
  const names=new Set(),counts={COMPLETE:0,PARTIAL:0,MISSING:0,BLOCKED_UPSTREAM:0,OUT_OF_SCOPE:0};
  const required=[];
  for(const item of manifest.profiles){
    if(!item||!knownProfiles.has(item.profile)||names.has(item.profile)||
      !scopes.has(item.scope)||!states.has(item.implementation)||
      !levels.has(item.evidence)||typeof item.remaining!=='string'||
      item.remaining.length<15||item.remaining.length>700)
      throw Error('Master profile entry is incomplete or implies unsupported authority');
    if(item.scope==='FUTURE_OPTION'&&item.implementation!=='OUT_OF_SCOPE')
      throw Error('Future option must not be described as an accepted core requirement');
    if(item.implementation==='COMPLETE'&&
      (!item.source_sha||!item.run_id||item.evidence==='NOT_TESTED'))
      throw Error('A completed profile requires exact evidence; no green by assertion');
    if(item.source_sha!==null&&!/^[a-f0-9]{40}$/u.test(item.source_sha))
      throw Error('Profile evidence is not pinned to a full lowercase source SHA');
    if(item.run_id!==null&&(!Number.isSafeInteger(item.run_id)||item.run_id<=0))
      throw Error('Profile CI run reference is not valid');
    names.add(item.profile);counts[item.implementation]++;
    if(item.scope==='CORE')required.push(item);
  }
  if(names.size!==knownProfiles.size)throw Error('Master source profile is missing');
  const allScenarios=Array.from({length:36},(_,i)=>
    'RS-E2E-'+String(i+1).padStart(2,'0'));
  const scenarioMap=allScenarios.map(key=>({
    id:key,required_by_public_index:scenarios.has(key),
    acceptance:'NOT_ASSESSED_AT_THIS_AGGREGATE_LEVEL'
  }));
  const gate={
    schema_version:'launchwright-master-closeout/1',
    specification_edition:manifest.specification_edition,
    public_requirement_count:ids.size,
    public_requirement_modules:Object.fromEntries([...modules].sort()),
    master_scenario_count:allScenarios.length,
    scenarios_referenced_by_requirements:scenarios.size,
    scenarios_without_public_requirement_reference:allScenarios.length-scenarios.size,
    complete_core_profiles:required.filter(x=>x.implementation==='COMPLETE').length,
    total_core_profiles:required.length,
    profile_state_counts:counts,
    integration_complete:required.every(x=>x.implementation==='COMPLETE')&&
      [...manifest.profiles].filter(x=>x.scope==='EXTERNAL_ACCEPTANCE')
        .every(x=>x.implementation==='COMPLETE')&&
      scenarios.size===36,
    overall_status:'BLOCKED',
    why_not_complete:[
      'Individual requirement E2E execution evidence is not established by the public ID-only index',
      'Some CORE profile implementations remain partial, missing or blocked upstream',
      'ChatGPT host, third-party accounts, customer projects and canonical Platform Publish require separate acceptance'
    ],
    external_publish_authority:false,
    scenarios:scenarioMap
  };
  if(gate.integration_complete)throw Error('Unexpected master completion assertion requires independent owner acceptance');
  return gate;
}
export function renderCapabilityMatrix(manifest,report){
  const title='# Master profile capability matrix — evidence, not marketing';
  const rows=manifest.profiles.map(p=>{
    const evidence=p.source_sha?
      'Exact source '+p.source_sha.slice(0,12)+'; CI run '+p.run_id:
      p.evidence.replaceAll('_',' ').toLowerCase();
    return'| '+p.profile+' | '+p.scope+' | '+p.implementation+' | '+
      evidence+' | '+p.remaining.replaceAll('|','/')+' |';
  });
  return[
    title,'','Source: original Semwright Release Studio 0.1.0 profile IDs, reconciled',
    'against the public Launchwright code/evidence. The private master ZIP is',
    'not included or published. No profile is auto-promoted by a source file.',
    '',
    '**Whole-master gate: '+report.overall_status+'.** Original 196 requirement IDs;',
    '36 required E2E scenarios, only '+report.scenarios_referenced_by_requirements+
      ' referenced by the public ID-only requirements ledger.',
    '',
    '| Profile | Scope | Implementation | Evidence level | Remaining obligation |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'PARTIAL is not COMPLETE. An OWNED_FIXTURE CI acceptance is not a real',
    'customer or ChatGPT host test. A generic ZIP/channel contract is not an',
    'App Store/Play Store upload, and a Git metadata import is not a docs PR.',
    '',
    'See SDK_GAPS.md, ACCEPTANCE.md, SOURCE_LOCK.json and the exact evidence/rNN',
    'records. No external Publish, tenant authority, subscription, billing or',
    'live customer acceptance is inferred.'
  ].join('\n')+'\n';
}
export function loadMaster(rootFolder=root){
  return{
    index:JSON.parse(readFileSync(join(rootFolder,'docs/requirements-index.json'),'utf8')),
    manifest:JSON.parse(readFileSync(join(rootFolder,'docs/master-profiles.json'),'utf8')),
    lock:JSON.parse(readFileSync(join(rootFolder,'SOURCE_LOCK.json'),'utf8'))
  };
}
async function main(argv){
  if(argv.length===0||argv[0]==='--help'){
    process.stdout.write('Launchwright master acceptance: --check | --write | --require-complete | --list-profiles\n');
    return;
  }
  if(argv.length!==1||!['--check','--write','--require-complete','--list-profiles'].includes(argv[0]))
    throw Error('Unknown acceptance action');
  const{index,manifest,lock}=loadMaster();
  const report=evaluateMaster(index,manifest,lock);
  if(argv[0]==='--write'){
    writeFileSync(join(root,'ACCEPTANCE_REPORT.json'),JSON.stringify(report,null,2)+'\n');
    writeFileSync(join(root,'CAPABILITY_MATRIX.md'),renderCapabilityMatrix(manifest,report));
  }
  if(argv[0]==='--list-profiles'){
    process.stdout.write(JSON.stringify(manifest.profiles.map(p=>({
      profile:p.profile,scope:p.scope,implementation:p.implementation,evidence:p.evidence
    })),null,2)+'\n');
    return;
  }
  process.stdout.write(JSON.stringify({
    status:report.overall_status,
    public_requirements:report.public_requirement_count,
    master_e2e_total:report.master_scenario_count,
    publicly_linked_scenarios:report.scenarios_referenced_by_requirements,
    core_profiles:report.total_core_profiles,
    completed_core_profiles:report.complete_core_profiles,
    reports_written:argv[0]==='--write'
  })+'\n');
  if(argv[0]==='--require-complete'&&!report.integration_complete)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{
    process.stderr.write('Master acceptance failed: '+e.message+'\n');
    process.exitCode=1;
  });
}
