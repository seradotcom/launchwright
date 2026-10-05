// SPDX-License-Identifier: AGPL-3.0-only
import { object, integer, validateValue, requireCondition as ensure } from '@semwright/native-sdk';
import { array, choice, digest, idText, locale, noSecrets, sha, str } from './contracts.mjs';
import { iso } from './base.mjs';

export const MOBILE_IMPORT_SCHEMA='launchwright-mobile-import/1';
export const MOBILE_ASSET_MIMES=Object.freeze(['image/png','image/jpeg','video/mp4']);
export const MOBILE_ASSET_KINDS=Object.freeze(['screenshot','screen-recording']);
export const MOBILE_MAX_ASSETS=8;
export const MOBILE_MAX_ASSET_BYTES=2*1024*1024;
export const MOBILE_MAX_TOTAL_BYTES=8*1024*1024;

const timestamp=(value,label)=>{str(value,64);ensure(Number.isFinite(Date.parse(value)),label+' must be an ISO timestamp');return value;};

function pngDimensions(bytes){
  ensure(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature is invalid');
  ensure(bytes.toString('ascii',12,16)==='IHDR','PNG IHDR is missing');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  ensure(width>0&&height>0,'PNG dimensions are invalid');
  return{width,height,format:'png'};
}
function jpegDimensions(bytes){
  ensure(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8,'JPEG signature is invalid');
  let offset=2;
  const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while(offset+4<=bytes.length){
    while(offset<bytes.length&&bytes[offset]!==0xff)offset++;
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    if(offset>=bytes.length)break;
    const marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    ensure(offset+2<=bytes.length,'JPEG segment is truncated');
    const length=bytes.readUInt16BE(offset);ensure(length>=2&&offset+length<=bytes.length,'JPEG segment length is invalid');
    if(sof.has(marker)){
      ensure(length>=7,'JPEG SOF is truncated');
      const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
      ensure(width>0&&height>0,'JPEG dimensions are invalid');
      return{width,height,format:'jpeg'};
    }
    offset+=length;
  }
  ensure(false,'JPEG dimensions were not found');
}
function readBoxSize(bytes,offset,end){
  ensure(offset+8<=end,'MP4 box header is truncated');
  let size=bytes.readUInt32BE(offset),header=8;
  if(size===1){
    ensure(offset+16<=end,'MP4 extended box header is truncated');
    const extended=bytes.readBigUInt64BE(offset+8);
    ensure(extended<=BigInt(Number.MAX_SAFE_INTEGER),'MP4 box is too large');
    size=Number(extended);header=16;
  } else if(size===0) size=end-offset;
  ensure(size>=header&&offset+size<=end,'MP4 box size is invalid');
  return{size,header,type:bytes.toString('ascii',offset+4,offset+8)};
}
function mp4Dimensions(bytes){
  let sawFtyp=false,found=null;
  const containers=new Set(['moov','trak','mdia','minf','stbl','edts','dinf']);
  const walk=(start,end,depth)=>{
    ensure(depth<=8,'MP4 box nesting exceeds budget');
    let offset=start,boxes=0;
    while(offset+8<=end){
      ensure(++boxes<=4096,'MP4 box count exceeds budget');
      const box=readBoxSize(bytes,offset,end),content=offset+box.header,boxEnd=offset+box.size;
      if(depth===0&&box.type==='ftyp')sawFtyp=true;
      if(box.type==='tkhd'&&!found){
        ensure(content+4<=boxEnd,'MP4 tkhd is truncated');
        const version=bytes[content],widthOffset=version===1?88:version===0?76:null;
        ensure(widthOffset!==null,'Unsupported MP4 tkhd version');
        ensure(content+widthOffset+8<=boxEnd,'MP4 tkhd dimensions are truncated');
        const width=bytes.readUInt32BE(content+widthOffset)>>>16;
        const height=bytes.readUInt32BE(content+widthOffset+4)>>>16;
        if(width>0&&height>0)found={width,height,format:'mp4'};
      }
      if(containers.has(box.type))walk(content,boxEnd,depth+1);
      offset=boxEnd;
    }
  };
  walk(0,bytes.length,0);
  ensure(sawFtyp,'MP4 ftyp box is missing');
  ensure(found,'MP4 visual track dimensions were not found');
  return found;
}
export function inspectMobileAssetBytes(bytes,mime){
  ensure(Buffer.isBuffer(bytes),'Mobile asset bytes must be a Buffer');
  ensure(bytes.length>0&&bytes.length<=MOBILE_MAX_ASSET_BYTES,'Mobile asset exceeds bounded import size','ResourceExhausted');
  choice(mime,MOBILE_ASSET_MIMES);
  if(mime==='image/png')return pngDimensions(bytes);
  if(mime==='image/jpeg')return jpegDimensions(bytes);
  return mp4Dimensions(bytes);
}
export function validateMobileImport(raw){
  validateValue(raw);noSecrets(raw);const d=structuredClone(raw);
  object(d,
    ['schema_version','release_id','target_id','source_id','name','build','device','os','locale','origin','captured_at','assets'],
    ['schema_version','release_id','target_id','source_id','name','build','device','os','locale','origin','captured_at','assets']);
  ensure(d.schema_version===MOBILE_IMPORT_SCHEMA,'Unsupported mobile import schema','ProtocolMismatch');
  for(const key of ['release_id','target_id','source_id'])idText(d[key]);
  str(d.name,160);str(d.build,256);locale(d.locale);timestamp(d.captured_at,'Mobile capture timestamp');
  object(d.device,['kind','model','identifier'],['kind','model']);
  choice(d.device.kind,['physical','simulator','emulator','unknown']);str(d.device.model,160);
  if(d.device.identifier!==undefined)str(d.device.identifier,160);
  object(d.os,['family','version'],['family','version']);
  choice(d.os.family,['android','ios','other']);str(d.os.version,96);
  object(d.origin,['kind','producer','reference'],['kind','reference']);
  choice(d.origin.kind,['external-device','fastlane-export','operator-export']);
  if(d.origin.producer!==undefined)str(d.origin.producer,160);
  str(d.origin.reference,512);
  let total=0;const names=new Set(),hashes=new Set();
  array(d.assets,MOBILE_MAX_ASSETS);
  ensure(d.assets.length>0,'Mobile import requires at least one asset');
  for(const asset of d.assets){
    object(asset,['name','kind','mime','sha256','size_bytes','width','height','rights'],
      ['name','kind','mime','sha256','size_bytes','width','height','rights']);
    str(asset.name,128);
    ensure(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(asset.name),'Mobile asset name must be a basename without path syntax');
    ensure(!names.has(asset.name),'Duplicate mobile asset name');names.add(asset.name);
    choice(asset.kind,MOBILE_ASSET_KINDS);choice(asset.mime,MOBILE_ASSET_MIMES);sha(asset.sha256);
    ensure(!hashes.has(asset.sha256),'Duplicate mobile asset digest');hashes.add(asset.sha256);
    integer(asset.size_bytes,1,MOBILE_MAX_ASSET_BYTES);
    integer(asset.width,1,16384);integer(asset.height,1,16384);
    choice(asset.rights,['owned','licensed','unknown','restricted']);
    if(asset.kind==='screenshot')ensure(asset.mime==='image/png'||asset.mime==='image/jpeg','Screenshot must be PNG or JPEG');
    if(asset.kind==='screen-recording')ensure(asset.mime==='video/mp4','Screen recording must be MP4');
    total+=asset.size_bytes;
    ensure(total<=MOBILE_MAX_TOTAL_BYTES,'Mobile import exceeds total size budget','ResourceExhausted');
  }
  return d;
}
function rightsSummary(assets){
  const values=assets.map(a=>a.rights);
  if(values.includes('restricted'))return{rights:'restricted',state:'FAIL',reason:'restricted-asset'};
  if(values.includes('unknown'))return{rights:'unknown',state:'UNKNOWN',reason:'rights-unresolved'};
  if(values.includes('licensed'))return{rights:'licensed',state:'PASS',reason:'licensed-or-owned'};
  return{rights:'owned',state:'PASS',reason:'owned'};
}

export function registerMobileImport(app,raw){
  const d=validateMobileImport(raw);
  const release=app.get(d.release_id,'release'),target=app.get(d.target_id,'target'),source=app.get(d.source_id,'source');
  ensure(source.data.type==='mobile-import','Mobile import requires a mobile-import source','InvalidArgument');
  ensure(target.data.release_id===release.id&&source.data.product_id===release.data.product_id,'Mobile import scope mismatch','PermissionDenied');
  ensure(d.build===release.data.build&&source.data.build===release.data.build,'Mobile import build context does not match release','Conflict');
  const verifiedAssets=d.assets.map(asset=>{
    const blob=app.store.readBlob(asset.sha256);
    ensure(blob.bytes.length===asset.size_bytes,'Mobile asset size does not match manifest','Conflict');
    ensure(blob.mime===asset.mime,'Mobile asset MIME does not match stored bytes','Conflict');
    const dimensions=inspectMobileAssetBytes(blob.bytes,asset.mime);
    ensure(dimensions.width===asset.width&&dimensions.height===asset.height,'Mobile asset dimensions do not match manifest','Conflict');
    return{...asset,format_validation:'STRUCTURE_PASS',dimensions_validation:'CONTAINER_METADATA_PASS'};
  });
  const rights=rightsSummary(verifiedAssets);
  const originDigest=digest('mobile-import',{...d,assets:verifiedAssets});
  const evidence=app.store.create('evidence',{
    release_id:release.id,target_id:target.id,source_id:source.id,name:d.name,build:d.build,
    classification:'imported',rights:rights.rights,
    description:'Imported mobile bundle; device capture authority is not established.',
    origin_digest:originDigest,evidence_type:'mobile_import',mobile_import_contract:MOBILE_IMPORT_SCHEMA,
    device:d.device,os:d.os,locale:d.locale,origin:d.origin,captured_at:d.captured_at,assets:verifiedAssets,
    asset_count:verifiedAssets.length,total_bytes:verifiedAssets.reduce((n,a)=>n+a.size_bytes,0),
    rights_state:rights.state,rights_reason:rights.reason,
    target_version:target.version,source_version:source.version,admission:'imported-unverified',
    technical:'UNKNOWN',observed_state_eligible:false,host_acceptance:'NOT_ESTABLISHED',
    native_capture:false,store_review:'PENDING',recorded_by:app.principal,observed_at:iso()
  });
  const pin=entity=>({id:entity.id,kind:entity.kind,version:entity.version});
  const extensionFor=mime=>mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'mp4';
  const artifacts=verifiedAssets.map(asset=>app.store.create('artifact',{
    name:asset.name,release_id:release.id,target_id:target.id,deliverable_id:null,
    sha256:asset.sha256,size_bytes:asset.size_bytes,mime:asset.mime,extension:extensionFor(asset.mime),
    inputs:[pin(release),pin(source),pin(target),pin(evidence)],classification:'imported',
    producer:'launchwright-mobile-import/1',draft:true,technical:'UNKNOWN',mobile_evidence_id:evidence.id,
    mobile_asset_kind:asset.kind,rights:asset.rights,observed_state_eligible:false,native_capture:false
  }));
  return{entity:evidence,artifacts};
}
export function inspectMobileImport(app,raw){
  object(raw,['id'],['id']);idText(raw.id);
  const evidence=app.get(raw.id,'evidence');
  ensure(evidence.data.evidence_type==='mobile_import'&&evidence.data.mobile_import_contract===MOBILE_IMPORT_SCHEMA,
    'Evidence is not a mobile import','InvalidArgument');
  const release=app.get(evidence.data.release_id,'release');
  const source=app.get(evidence.data.source_id,'source');
  const target=app.get(evidence.data.target_id,'target');
  const stale=evidence.data.build!==release.data.build||source.data.build!==release.data.build||
    source.version.generation!==evidence.data.source_version.generation||
    source.version.revision!==evidence.data.source_version.revision||
    target.version.generation!==evidence.data.target_version.generation||
    target.version.revision!==evidence.data.target_version.revision;
  const assets=evidence.data.assets.map(asset=>{
    let state='PASS',reason='verified';
    try{
      const blob=app.store.readBlob(asset.sha256);
      const dimensions=inspectMobileAssetBytes(blob.bytes,asset.mime);
      if(blob.bytes.length!==asset.size_bytes||blob.mime!==asset.mime||
        dimensions.width!==asset.width||dimensions.height!==asset.height){
        state='FAIL';reason='stored-bytes-differ';
      }
    }catch(err){state='FAIL';reason=err.code??'invalid-stored-asset';}
    return{name:asset.name,kind:asset.kind,mime:asset.mime,sha256:asset.sha256,
      width:asset.width,height:asset.height,rights:asset.rights,state,reason};
  });
  const importedArtifacts=app.list('artifact',evidence.data.release_id)
    .filter(artifact=>artifact.data.mobile_evidence_id===evidence.id)
    .map(artifact=>({id:artifact.id,version:artifact.version,sha256:artifact.data.sha256,mime:artifact.data.mime,size_bytes:artifact.data.size_bytes,target_id:artifact.data.target_id,technical:artifact.data.technical}));
  const bytesValid=assets.every(a=>a.state==='PASS')&&importedArtifacts.length===assets.length;
  const packageState=!bytesValid?'FAIL':stale?'STALE':
    evidence.data.rights_state==='FAIL'?'BLOCKED_RIGHTS':
    evidence.data.rights_state==='UNKNOWN'?'PENDING_RIGHTS':'READY_FOR_EDITORIAL_PACKAGE';
  return{
    evidence,assets,artifacts:importedArtifacts,package_state:packageState,stale,
    technical_state:'UNKNOWN',native_capture:false,host_acceptance:'NOT_ESTABLISHED',store_review:'PENDING',
    limitations:[
      'Imported files do not prove execution on the declared device.',
      'Android evidence does not satisfy iOS acceptance and vice versa.',
      'External runner or device capture remains a separate acceptance gate.'
    ]
  };
}
