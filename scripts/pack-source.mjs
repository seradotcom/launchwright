#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Source-only transfer artifact from one exact tracked Git tree; no private
// specification ZIP, node_modules, caches, run state, credentials or build junk.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const git=(...args)=>execFileSync('git',args,{
  cwd:root,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024
}).trimEnd();
const badPath=path=>
  /(^|\/)(?:node_modules|target|\.git|\.cache|\.env(?:\..*)?|session-token|id_rsa|credentials(?:\.json)?|\.state(?:-.*)?)(\/|$)/iu.test(path)||
  /(?:^|\/)(?:master_release_studio|compendio|operador_privado)\.zip$/iu.test(path);
export function inspectArchiveSource(){
  const sha=git('rev-parse','HEAD');
  const tree=git('rev-parse','HEAD^{tree}');
  if(!/^[0-9a-f]{40}$/u.test(sha)||!/^[0-9a-f]{40}$/u.test(tree))
    throw Error('A full exact Git SHA/tree is required for source backup');
  const files=git('ls-tree','-r','-z','HEAD').split('\0').filter(Boolean);
  if(files.length<30)throw Error('Backup Git tree is unexpectedly incomplete');
  for(const record of files){
    const m=/^([0-9]{6}) (?:blob|commit) ([0-9a-f]{40})\t(.+)$/su.exec(record);
    if(!m||m[1]!=='100644'&&m[1]!=='100755'||
      badPath(m[3]))throw Error('Unsafe tracked content, symlink or secret-bearing path');
  }
  const mustHave=[
    'LICENSE','SOURCE_LOCK.json','THIRD_PARTY_NOTICES.md','README.md',
    'ACCEPTANCE_REPORT.json','DELIVERY_REPORT.json','CAPABILITY_MATRIX.md','docs/SDK_GAPS.md',
    'docs/requirements-index.json','docs/master-profiles.json',
    'scripts/master-acceptance.mjs'
  ];
  for(const name of mustHave){
    if(!files.some(f=>f.endsWith('\t'+name)))
      throw Error('Committed transfer tree is missing required '+name);
  }
  return{schema_version:'launchwright-source-backup-intent/1',sha,tree,
    tracked_files:files.length,committed_project_tree_only:true,
    pinned_vendored_sdk_tarball_included:true,
    untracked_private_files_excluded:true,
    private_specification_zip_path_rejected:true,
    sensitive_file_name_patterns_rejected:true,
    content_secret_scan_performed:false,
    untracked_build_artifacts_excluded:true,archive_created:false};
}
export function createSourceBackup(outDirectory){
  if(!isAbsolute(outDirectory)||!existsSync(outDirectory)||
    !lstatSync(outDirectory).isDirectory()||lstatSync(outDirectory).isSymbolicLink())
    throw Error('Choose a real existing absolute output directory for source backup');
  const inspected=inspectArchiveSource();
  const name='launchwright-source-'+inspected.sha.slice(0,12);
  const zip=join(outDirectory,name+'.zip'),receipt=join(outDirectory,name+'.receipt.json'),
    checksum=join(outDirectory,name+'.zip.sha256');
  if([zip,receipt,checksum].some(existsSync))
    throw Error('Refusing to clobber a previously produced source package or receipt');
  // Using git archive excludes untracked caches/tokens by construction and
  // guarantees the saved bytes come from the one reviewed commit, never a
  // dirty collection of files from other agents' worktrees.
  execFileSync('git',['archive','--format=zip','--prefix='+name+'/',
    '--output='+zip,'HEAD'],{cwd:root,timeout:120000,maxBuffer:1048576});
  const size=statSync(zip).size;
  if(size<1024||size>100*1024*1024)
    throw Error('Source archive falls outside the configured 1 KiB–100 MiB budget');
  const hash=createHash('sha256').update(readFileSync(zip)).digest('hex');
  const data={...inspected,archive_created:true,
    file_name:name+'.zip',bytes:size,archive_sha256:hash,
    report_sha256:createHash('sha256').update(readFileSync(join(root,'ACCEPTANCE_REPORT.json'))).digest('hex'),
    publication_authority:false,customer_acceptance:false};
  writeFileSync(receipt,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
  writeFileSync(checksum,hash+'  '+name+'.zip\n',{flag:'wx',mode:0o600});
  return data;
}
async function main(args){
  if(args.length===1&&args[0]==='--inspect'){
    process.stdout.write(JSON.stringify(inspectArchiveSource(),null,2)+'\n');return;
  }
  if(args.length===2&&args[0]==='--out-dir'){
    process.stdout.write(JSON.stringify(createSourceBackup(resolve(args[1])),null,2)+'\n');return;
  }
  throw Error('Usage: node scripts/pack-source.mjs --inspect | --out-dir /absolute/existing/directory');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(err=>{
    process.stderr.write('Source backup refused: '+err.message+'\n');
    process.exitCode=1;
  });
}
