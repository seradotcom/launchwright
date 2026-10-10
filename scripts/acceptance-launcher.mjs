#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Master acceptance launcher: enumerates actual local + CI lanes and runs
// only the explicitly selected suite, never auto-publishes or installs tools.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const heavy=[
  'browser','masked-demo','native','host','verifier','extension','effects',
  'composition','deltadesk','godot','stress'
];
const local=['light','master','cleanroom','browser'];
const launched=(bin,args)=>{
  const r=spawnSync(bin,args,{cwd:root,stdio:'inherit',shell:false,
    timeout:180000,maxBuffer:1024*1024});
  if(r.error||r.status!==0)throw Error('Selected acceptance suite failed: '+bin+' '+args.join(' '));
};
function validateGitHubLaneConfiguration(){
  const text=readFileSync(join(root,'.github/workflows/heavy.yml'),'utf8');
  for(const name of heavy){
    if(!text.includes(" || inputs.lane == '"+name+"'")&&
       !text.includes("inputs.lane == '"+name+"'"))
      throw Error('An advertised heavy CI lane is not defined: '+name);
  }
}
export function launcherCatalog(){
  validateGitHubLaneConfiguration();
  return{
    schema_version:'launchwright-master-acceptance-launcher/1',
    application_sdk:'Semwright Native SDK 1.0.0',
    local_real_suites:{
      light:['npm test','node scripts/verify.mjs','npm audit --omit=dev --audit-level=high'],
      master:['node scripts/master-acceptance.mjs --require-complete'],
      cleanroom:['node scripts/clean-room.mjs'],
      browser:['node tests/browser.mjs']
    },
    ci_runner_required:heavy,
    external_customer_gate:'NOT_ESTABLISHED',
    platform_publish_gate:'NOT_ESTABLISHED',
    no_automatic_install_or_publish:true
  };
}
async function main(argv){
  if(argv.length===0||argv[0]==='list'){
    process.stdout.write(JSON.stringify(launcherCatalog(),null,2)+'\n');return;
  }
  if(argv.length!==2||argv[0]!=='run'||!local.includes(argv[1]))
    throw Error('Usage: node scripts/acceptance-launcher.mjs list | run light|master|cleanroom|browser');
  const lane=argv[1];
  if(lane==='light'){
    launched('npm',['test']);
    launched(process.execPath,['scripts/verify.mjs']);
    launched('npm',['audit','--omit=dev','--audit-level=high']);
  }else if(lane==='master'){
    launched(process.execPath,['scripts/master-acceptance.mjs','--require-complete']);
  }else if(lane==='cleanroom'){
    launched(process.execPath,['scripts/clean-room.mjs']);
  }else if(lane==='browser'){
    if(!existsSync(join(root,'.ci-tools/node_modules/playwright/index.mjs')))
      throw Error('Browser runner not installed. Use the manual GitHub Actions browser lane; no auto-install is performed.');
    launched(process.execPath,['tests/browser.mjs']);
  }
  process.stdout.write('LAUNCHWRIGHT_SELECTED_SUITE_PASS '+lane+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(err=>{
    process.stderr.write('Acceptance launcher: '+err.message+'\n');
    process.exitCode=1;
  });
}
