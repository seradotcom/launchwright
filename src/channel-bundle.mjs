// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { requireCondition as ensure } from '@semwright/native-sdk';

const MAX_BUNDLE_BYTES=40*1024*1024;
const DOS_DATE=(1<<5)|1; // 1980-01-01
const DOS_TIME=0;
const crcTable=(()=>{
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
    table[n]=c>>>0;
  }
  return table;
})();
const crc32=bytes=>{
  let c=0xffffffff;
  for(const byte of bytes)c=crcTable[(c^byte)&0xff]^(c>>>8);
  return (c^0xffffffff)>>>0;
};
const u16=value=>{const b=Buffer.allocUnsafe(2);b.writeUInt16LE(value,0);return b;};
const u32=value=>{const b=Buffer.allocUnsafe(4);b.writeUInt32LE(value>>>0,0);return b;};
const rawSha=bytes=>createHash('sha256').update(bytes).digest('hex');

function safeEntry(name){
  ensure(typeof name==='string'&&name.length>0&&name.length<=240,'Invalid bundle entry name');
  ensure(!name.startsWith('/')&&!name.includes('..')&&/^[A-Za-z0-9._/-]+$/.test(name),'Unsafe bundle entry name');
  return name;
}

export function deterministicZip(entries){
  ensure(Array.isArray(entries)&&entries.length>0&&entries.length<=128,'Invalid bundle entry set');
  const seen=new Set(),locals=[],centrals=[];let offset=0,totalPayload=0;
  for(const entry of entries){
    const name=safeEntry(entry.name),nameBytes=Buffer.from(name,'utf8'),bytes=Buffer.from(entry.bytes);
    ensure(!seen.has(name),'Duplicate bundle entry');seen.add(name);
    totalPayload+=bytes.length;ensure(totalPayload<=MAX_BUNDLE_BYTES,'Private bundle exceeds local export budget','ResourceExhausted');
    const crc=crc32(bytes),flags=0x0800;
    const local=Buffer.concat([
      u32(0x04034b50),u16(20),u16(flags),u16(0),u16(DOS_TIME),u16(DOS_DATE),
      u32(crc),u32(bytes.length),u32(bytes.length),u16(nameBytes.length),u16(0),nameBytes,bytes
    ]);
    locals.push(local);
    const central=Buffer.concat([
      u32(0x02014b50),u16(20),u16(20),u16(flags),u16(0),u16(DOS_TIME),u16(DOS_DATE),
      u32(crc),u32(bytes.length),u32(bytes.length),u16(nameBytes.length),u16(0),u16(0),
      u16(0),u16(0),u32(0),u32(offset),nameBytes
    ]);
    centrals.push(central);offset+=local.length;
  }
  const centralOffset=offset,centralBytes=Buffer.concat(centrals);
  const end=Buffer.concat([
    u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),
    u32(centralBytes.length),u32(centralOffset),u16(0)
  ]);
  const bytes=Buffer.concat([...locals,centralBytes,end]);
  ensure(bytes.length<=MAX_BUNDLE_BYTES+1024*1024,'Private bundle exceeds local export budget','ResourceExhausted');
  return{bytes,sha256:rawSha(bytes),entries:entries.map(entry=>({name:entry.name,size_bytes:Buffer.byteLength(entry.bytes)}))};
}

const extensionFor=mime=>{
  const type=String(mime).split(';')[0].trim().toLowerCase();
  return({'text/markdown':'md','text/html':'html','application/json':'json','text/vtt':'vtt','text/plain':'txt'}[type]??'bin');
};

export function buildPrivateChannelBundle(app,deliveryId){
  const delivery=app.get(deliveryId,'channel_delivery');
  ensure(delivery.data.package_sha256,'Channel delivery has no immutable package manifest','Conflict');
  const packageBlob=app.store.readBlob(delivery.data.package_sha256);
  let manifest;try{manifest=JSON.parse(packageBlob.bytes.toString('utf8'));}catch{ensure(false,'Channel package manifest is not valid JSON','Conflict');}
  ensure(manifest.candidate_id===delivery.data.candidate_id&&manifest.candidate_sha256===delivery.data.candidate_sha256,'Channel package binding changed','Conflict');
  const candidateManifestSha=delivery.data.candidate_manifest_sha256;
  let candidateBytes;
  if(candidateManifestSha)candidateBytes=app.store.readBlob(candidateManifestSha).bytes;
  else{
    const candidate=app.get(delivery.data.candidate_id,'candidate');
    candidateBytes=Buffer.from(JSON.stringify(candidate.data.manifest,null,2)+'\n');
  }
  const entries=[
    {name:'manifest/channel-package.json',bytes:packageBlob.bytes},
    {name:'manifest/release-candidate.json',bytes:candidateBytes}
  ];
  const artifacts=[...(manifest.artifacts??[])].sort((a,b)=>a.id.localeCompare(b.id));
  for(let i=0;i<artifacts.length;i++){
    const artifact=artifacts[i],blob=app.store.readBlob(artifact.sha256);
    ensure(blob.bytes.length===artifact.bytes,'Candidate artifact byte count changed','Conflict');
    const ext=artifact.extension??extensionFor(artifact.mime??blob.mime);
    const prefix=String(i+1).padStart(2,'0');
    entries.push({name:`artifacts/${prefix}-${artifact.id}.${ext}`,bytes:blob.bytes});
  }
  const notice=Buffer.from(
    'Launchwright private review bundle\n'+
    `Candidate: ${delivery.data.candidate_sha256}\n`+
    `Channel profile: ${delivery.data.profile_id}\n`+
    `Participant: ${delivery.data.participant}\n`+
    'State: package bytes only; this archive does not prove upload, publication or external availability.\n'
  );
  entries.push({name:'README.txt',bytes:notice});
  const bundle=deterministicZip(entries);
  if(delivery.data.bundle_sha256)ensure(bundle.sha256===delivery.data.bundle_sha256,'Reconstructed private bundle digest changed','Conflict');
  if(delivery.data.bundle_size_bytes!==undefined)ensure(bundle.bytes.length===delivery.data.bundle_size_bytes,'Reconstructed private bundle size changed','Conflict');
  return{...bundle,mime:'application/zip',filename:`launchwright-${delivery.id}.zip`};
}
