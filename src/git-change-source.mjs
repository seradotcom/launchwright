// SPDX-License-Identifier: AGPL-3.0-only
// Read-only committed Git metadata snapshots, then imported (never canonical)
// release evidence through the real Semwright Native SDK application dispatcher.
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { TextDecoder } from 'node:util';
import { NativeError, requireCondition as ensure, validateValue } from '@semwright/native-sdk';
import { digest } from './base.mjs';
import { execute } from './application.mjs';

export const GIT_OBSERVATION_SCHEMA='launchwright-git-change-observation/1';
export const MAX_GIT_CHANGED_PATHS=512;
const utf8=new TextDecoder('utf-8',{fatal:true});
const sha=value=>{
  ensure(typeof value==='string'&&/^[0-9a-f]{40}$/u.test(value),
    'Git input must be an exact lowercase full commit SHA');
  return value;
};
const alias=value=>{
  ensure(typeof value==='string'&&/^[a-z][a-z0-9_-]{1,63}$/u.test(value),
    'Source alias must be a bounded private identifier');
  return value;
};
function gitRun(root,args,{allowNonzero=false,limit=1024*1024}={}){
  const env={
    ...process.env,
    GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1',
    GIT_PAGER:'cat',GIT_EXTERNAL_DIFF:'',GIT_LFS_SKIP_SMUDGE:'1',
    GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'
  };
  const result=spawnSync('git',['-C',root,'--no-pager',...args],{
    env,encoding:null,timeout:12000,maxBuffer:limit+64*1024
  });
  if(result.error || (result.status!==0&&!allowNonzero))
    throw new NativeError('Unavailable','Read-only pinned Git inspection failed');
  ensure(result.stdout?.length<=limit,
    'Git metadata reply exceeds inspection budget','ResourceExhausted');
  return result;
}
function gitText(root,args,max=256){
  const result=gitRun(root,args,{limit:max});
  let value;
  try{value=utf8.decode(result.stdout).trimEnd();}catch {
    throw new NativeError('InvalidArgument','Git metadata must be UTF-8');
  }
  ensure(value.length>0&&value.length<=max,'Git metadata is missing or oversized');
  return value;
}
function pathInput(value){
  ensure(typeof value==='string'&&value.length>0&&value.length<=2048&&isAbsolute(value),
    'Repository path must be an explicit bounded absolute path');
  const real=realpathSync(value);
  ensure(statSync(real).isDirectory(),'Git repository root must be a directory');
  // Validate logical worktree root WITHOUT comparing Git's path string with
  // Node's realpath. Git for Windows may emit slash-normalized/drive-cased paths
  // that do not compare byte-for-byte to Win32 canonical filesystem paths.
  // --show-prefix is empty only at the top of the selected working tree.
  ensure(gitText(real,['rev-parse','--is-inside-work-tree'],8)==='true' &&
    gitText(real,['rev-parse','--is-bare-repository'],8)==='false',
    'Source must be a non-bare Git worktree','InvalidArgument');
  const prefix=gitRun(real,['rev-parse','--show-prefix'],{limit:1024}).stdout.toString('utf8').trim();
  ensure(prefix.length===0,
    'Source path must name the exact working tree root','InvalidArgument');
  return real;
}
function parsePaths(buffer){
  const pieces=buffer.toString('binary').split('\0');
  ensure(pieces.at(-1)==='', 'Git NUL-delimited change output is incomplete','ProtocolMismatch');
  pieces.pop();
  ensure(pieces.length%2===0,'Git change path/status pairs are incomplete','ProtocolMismatch');
  ensure(pieces.length/2<=MAX_GIT_CHANGED_PATHS,'Git change inventory exceeds 512 files; split the review window','ResourceExhausted');
  const changes=[],seen=new Set();
  for(let i=0;i<pieces.length;i+=2){
    const status=pieces[i];
    ensure(['A','D','M','T'].includes(status),'Unsupported Git change classification','ProtocolMismatch');
    const binaryPath=Buffer.from(pieces[i+1],'binary');
    let path;
    try{path=utf8.decode(binaryPath);}catch{
      throw new NativeError('InvalidArgument','Git filename is not valid UTF-8');
    }
    ensure(path.length>0&&binaryPath.length<=512&&!/[\0-\x1f\x7f]/u.test(path)&&
      !path.startsWith('/')&&!path.split('/').some(part=>part==='.'||part==='..'||part===''),
      'Git changed path is outside the safe inventory contract','InvalidArgument');
    ensure(!seen.has(path),'Duplicate Git change paths are not permitted','Conflict');
    seen.add(path);changes.push({path,status});
  }
  ensure(changes.reduce((total,item)=>total+Buffer.byteLength(item.path,'utf8'),0)<=160000,
    'Git path inventory exceeds the 160 KiB bounded metadata budget','ResourceExhausted');
  return changes.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
}
export function observeGitChanges({repository_root,source_alias,base_sha,head_sha}){
  alias(source_alias);sha(base_sha);sha(head_sha);
  ensure(base_sha!==head_sha,'Git observation must span two different commits');
  const root=pathInput(repository_root);
  for(const ref of [base_sha,head_sha]){
    ensure(gitText(root,['cat-file','-t',ref],32)==='commit',
      'Git observation SHA does not resolve to a commit','InvalidArgument');
  }
  const ancestry=gitRun(root,['merge-base','--is-ancestor',base_sha,head_sha],
    {allowNonzero:true,limit:10});
  ensure(ancestry.status===0,'Base must be an ancestor of the exact target commit','InvalidArgument');
  const args=['diff','--no-ext-diff','--no-textconv','--no-renames','--ignore-submodules=all',
    '--name-status','-z',base_sha,head_sha];
  const bytes=gitRun(root,args,{limit:1024*1024}).stdout;
  const files=parsePaths(bytes);
  const commits=Number(gitText(root,['rev-list','--count',base_sha+'..'+head_sha],32));
  ensure(Number.isSafeInteger(commits)&&commits>0&&commits<=100000,
    'Git commit count is outside bounded observation scope');
  const baseTree=gitText(root,['rev-parse',base_sha+'^{tree}'],64);
  const headTree=gitText(root,['rev-parse',head_sha+'^{tree}'],64);
  sha(baseTree);sha(headTree);
  const core={
    schema_version:GIT_OBSERVATION_SCHEMA,source_alias,
    base_sha,base_tree_sha:baseTree,head_sha,head_tree_sha:headTree,
    commit_count:commits,changed_paths:files,changed_files:files.length,
    changed_paths_digest:digest('git-change-paths/1',files),
    file_contents_included:false,commit_messages_included:false,
    workspace_dirty_state_inferred:false,
    provenance:'operator-local-git-committed-metadata',
    technical_state:'UNKNOWN',project_graph_authority:false,
    native_driver_host_authority:false,platform_execution_authority:false
  };
  validateValue(core);
  return {...core,observation_sha256:digest('git-change-observation/1',core)};
}
export function verifyGitObservation(observation){
  validateValue(observation);
  ensure(observation&&typeof observation==='object'&&!Array.isArray(observation),
    'Git observation must be a JSON object');
  const {observation_sha256,...core}=observation;
  const fields=['schema_version','source_alias','base_sha','base_tree_sha','head_sha','head_tree_sha',
    'commit_count','changed_paths','changed_files','changed_paths_digest',
    'file_contents_included','commit_messages_included','workspace_dirty_state_inferred',
    'provenance','technical_state','project_graph_authority',
    'native_driver_host_authority','platform_execution_authority'];
  ensure(fields.every(key=>Object.hasOwn(core,key))&&Object.keys(core).length===fields.length,
    'Git observation schema is not exact','InvalidArgument');
  ensure(core.schema_version===GIT_OBSERVATION_SCHEMA,'Unsupported Git observation schema');
  alias(core.source_alias);sha(core.base_sha);sha(core.head_sha);
  sha(core.base_tree_sha);sha(core.head_tree_sha);
  ensure(Number.isSafeInteger(core.commit_count)&&core.commit_count>0&&core.commit_count<=100000,
    'Git commit count is invalid');
  ensure(Array.isArray(core.changed_paths)&&core.changed_paths.length<=MAX_GIT_CHANGED_PATHS&&
    core.changed_files===core.changed_paths.length,
    'Git changed file denominator is invalid','InvalidArgument');
  const safeList=core.changed_paths;
  const seen=new Set();
  let previous=null;
  for(const entry of safeList){
    ensure(entry&&Object.keys(entry).length===2&&typeof entry.path==='string'&&
      entry.path.length>0&&Buffer.byteLength(entry.path)<=512&&
      !/[\0-\x1f\x7f]/u.test(entry.path)&&!entry.path.startsWith('/')&&
      !entry.path.split('/').some(part=>part==='..'||part==='.'||part==='')&&
      /^[ADMT]$/u.test(entry.status),
      'Git source observation contains an unsafe path/status','InvalidArgument');
    ensure(!seen.has(entry.path),'Imported Git observation contains duplicate changed paths','Conflict');
    if(previous!==null)ensure(Buffer.compare(Buffer.from(previous),Buffer.from(entry.path))<0,
      'Imported Git changed paths are not in canonical order','Conflict');
    previous=entry.path;seen.add(entry.path);
  }
  ensure(digest('git-change-paths/1',safeList)===core.changed_paths_digest,
    'Git source change path digest differs','Conflict');
  ensure(core.file_contents_included===false&&core.commit_messages_included===false&&
    core.workspace_dirty_state_inferred===false&&
    core.provenance==='operator-local-git-committed-metadata'&&
    core.technical_state==='UNKNOWN'&&core.project_graph_authority===false&&
    core.native_driver_host_authority===false&&core.platform_execution_authority===false,
    'Git imported observation must not claim canonical or execution authority','PolicyDenied');
  ensure(observation_sha256===digest('git-change-observation/1',core),
    'Git imported observation bytes changed','Conflict');
  return observation;
}
export async function importGitObservation(app,observation,{
  source_id,target_id,release_id,name,rights,acknowledge_imported
}){
  verifyGitObservation(observation);
  ensure(acknowledge_imported===true,
    'Confirm imported Git metadata is not a canonical Semwright source observation','ConsentRequired');
  ensure(typeof name==='string'&&name.length>0&&name.length<=160,'Evidence name is invalid');
  ensure(['owned','licensed'].includes(rights),'Git metadata rights must be operator-declared','InvalidArgument');
  const source=app.get(source_id,'source');
  const target=app.get(target_id,'target');
  const release=app.get(release_id,'release');
  ensure(source.data.type==='cli'&&source.data.approval==='approved'&&source.data.purpose&&
    source.data.locator==='git-local:'+observation.source_alias,
    'Source is not an approved matching local Git CLI origin','PermissionDenied');
  ensure(source.data.product_id===release.data.product_id&&
    target.data.release_id===release.id&&
    source.data.build===observation.head_sha&&release.data.build===observation.head_sha,
    'Git evidence commit/target/source/release build binding changed','StaleReference');
  const summary='Imported read-only Git metadata for '+observation.source_alias+
    '. Base '+observation.base_sha+' head '+observation.head_sha+
    '; '+observation.commit_count+' commits, '+observation.changed_files+
    ' changed paths. No file contents, commit messages, canonical Graph authority or technical PASS.';
  return (await execute(app,'evidence.import',{
    release_id,target_id,source_id,name,build:release.data.build,
    classification:'imported',rights,description:summary,
    origin_digest:observation.observation_sha256
  })).entity;
}
