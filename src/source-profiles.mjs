// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure } from '@semwright/native-sdk';
import { inputObject, str } from './contracts.mjs';

export const GODOT_RUNTIME_CONTRACT=Object.freeze({
  semwright_sha:'4d291de26724810017ce7b6d185326514cb79fa6',
  driver_id:'godot',
  driver_version:'0.9.0-dev.1',
  driver_protocol:5,
  engine_version:'4.7.2',
  engine_sha256:'8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e'
});

export const BROWSER_RUNTIME_CONTRACT=Object.freeze({
  semwright_sha:'4d291de26724810017ce7b6d185326514cb79fa6',
  provider_id:'chromium',
  execution_model:'owned-disposable-browser',
  authority:'semantic-adapter'
});

export const PROFILE_MATRIX=Object.freeze({
  browser:{source_types:['web'],execution:'canonical-driver-required',capture:'requires-authorized-driver',readback:'provider-dependent',driver:BROWSER_RUNTIME_CONTRACT,native_available:true},
  cli:{source_types:['cli'],execution:'reviewed-driver-unavailable',capture:'no-shell-fallback',readback:'provider-required',native_available:false},
  'mobile-import':{source_types:['mobile-import'],execution:'import-only',capture:'bounded-manifest-hash-dimension-validation',readback:'content-addressed-assets-with-imported-provenance',native_capture:false,max_assets:8,max_asset_bytes:2097152,max_total_bytes:8388608},
  godot:{source_types:['godot'],execution:'canonical-driver-required',capture:'engine-receipt-required',readback:'driver-only',driver:GODOT_RUNTIME_CONTRACT,native_available:true},
  document:{source_types:['document'],execution:'parse-only',capture:'not-applicable',readback:'bounded-structured-import'}
});

function browserRuntimeChecks(app){
  const runtime=app.capabilities.profile_runtime?.browser;
  if(!runtime)return[
    {name:'runtime-pin',state:'UNKNOWN',detail:'not-declared'},
    {name:'runtime-executable-digest',state:'UNKNOWN',detail:'not-declared'}
  ];
  return[
    {
      name:'runtime-pin',
      state:runtime.semwright_sha===BROWSER_RUNTIME_CONTRACT.semwright_sha&&runtime.provider_id===BROWSER_RUNTIME_CONTRACT.provider_id?'PASS':'FAIL',
      detail:{semwright_sha:runtime.semwright_sha,provider_id:runtime.provider_id}
    },
    {
      name:'runtime-executable-digest',
      state:/^[0-9a-f]{64}$/.test(runtime.executable_sha256??'')?'PASS':'FAIL',
      detail:runtime.executable_sha256??'missing'
    }
  ];
}

function browserLocatorCheck(locator){
  try{
    const parsed=new URL(locator);
    const ok=['http:','https:'].includes(parsed.protocol)&&parsed.username===''&&parsed.password==='';
    return{state:ok?'PASS':'FAIL',detail:locator};
  }catch{return{state:'FAIL',detail:locator};}
}

function godotRuntimeCheck(app){
  const runtime=app.capabilities.profile_runtime?.godot;
  if(!runtime)return{state:'UNKNOWN',detail:'not-declared'};
  const expected=GODOT_RUNTIME_CONTRACT;
  const actual={
    semwright_sha:runtime.semwright_sha,
    driver_version:runtime.driver_version,
    engine_version:runtime.engine_version,
    engine_sha256:runtime.engine_sha256
  };
  const state=actual.semwright_sha===expected.semwright_sha&&actual.driver_version===expected.driver_version&&actual.engine_version===expected.engine_version&&actual.engine_sha256===expected.engine_sha256?'PASS':'FAIL';
  return{state,detail:state==='PASS'?'exact-pins':'pin-mismatch'};
}

export function profilePreflight(app,input){
  inputObject(input,['profile','source_id','target_id'],['profile','source_id']);str(input.profile,64);
  const profile=PROFILE_MATRIX[input.profile];ensure(profile,'Unknown source profile','NotFound');
  const source=app.get(input.source_id,'source');let target=null,release=null;
  if(input.target_id){
    target=app.get(input.target_id,'target');release=app.get(target.data.release_id,'release');
    ensure(release.data.product_id===source.data.product_id,'Source and target belong to different products','PermissionDenied');
  }
  const checks=[
    {name:'source-type',state:profile.source_types.includes(source.data.type)?'PASS':'FAIL',detail:source.data.type},
    {name:'source-purpose',state:source.data.approval==='approved'?'PASS':input.profile==='mobile-import'||input.profile==='document'?'UNKNOWN':'FAIL',detail:source.data.approval??'undeclared'},
    {name:'build-match',state:release?source.data.build===release.data.build?'PASS':'FAIL':'UNKNOWN',detail:release?{source:source.data.build,release:release.data.build}:'target-not-supplied'},
    {name:'execution-authority',state:app.capabilities.profile_execution?.[input.profile]==='available'?'PASS':'UNKNOWN',detail:profile.execution}
  ];
  if(profile.native_available===false)checks.push({name:'canonical-runtime',state:'FAIL',detail:'no-reviewed-driver'});
  if(input.profile==='browser'){
    checks.push({name:'source-locator',...browserLocatorCheck(source.data.locator)});
    checks.push(...browserRuntimeChecks(app));
  }
  if(input.profile==='godot'){
    checks.push({name:'logical-project-locator',state:/^godot:\/\/project\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(source.data.locator)?'PASS':'FAIL',detail:source.data.locator});
    checks.push({name:'runtime-pin',...godotRuntimeCheck(app)});
  }
  const importOnly=profile.execution==='import-only';
  return{
    profile:input.profile,contract:profile,source_id:source.id,target_id:target?.id??null,checks,
    ready_for_native_execution:checks.every(check=>check.state==='PASS')&&!importOnly,
    import_only:importOnly,
    note:'Preflight only; runtime evidence required.'
  };
}
