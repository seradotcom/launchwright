// SPDX-License-Identifier: AGPL-3.0-only
import { requireCondition as ensure } from '@semwright/native-sdk';

const table = new Uint32Array(256);
for (let n=0;n<256;n++) {
  let c=n;
  for (let k=0;k<8;k++) c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
  table[n]=c>>>0;
}
export function crc32(bytes) {
  let c=0xffffffff;
  for (const b of bytes) c=table[(c^b)&0xff]^(c>>>8);
  return (c^0xffffffff)>>>0;
}
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};
function safeName(name) {
  ensure(typeof name==='string' && Buffer.byteLength(name)<=240, 'Invalid ZIP entry name');
  ensure(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), 'Unsafe ZIP entry path');
  ensure(/^[A-Za-z0-9._\/-]+$/.test(name), 'ZIP entry name contains unsupported characters');
  return name;
}
export function createStoredZip(inputEntries) {
  ensure(Array.isArray(inputEntries) && inputEntries.length>0 && inputEntries.length<=4096, 'Invalid ZIP entry set');
  const entries=[...inputEntries].map(entry=>({
    name:safeName(entry.name),
    bytes:Buffer.isBuffer(entry.bytes)?entry.bytes:Buffer.from(entry.bytes),
  })).sort((a,b)=>a.name.localeCompare(b.name));
  ensure(new Set(entries.map(e=>e.name)).size===entries.length, 'Duplicate ZIP entry');
  const locals=[]; const centrals=[]; let offset=0;
  for (const entry of entries) {
    const name=Buffer.from(entry.name,'utf8');
    const crc=crc32(entry.bytes);
    const local=Buffer.concat([
      u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(33),
      u32(crc),u32(entry.bytes.length),u32(entry.bytes.length),u16(name.length),u16(0),name,entry.bytes,
    ]);
    locals.push(local);
    const central=Buffer.concat([
      u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(33),
      u32(crc),u32(entry.bytes.length),u32(entry.bytes.length),u16(name.length),u16(0),u16(0),
      u16(0),u16(0),u32(0),u32(offset),name,
    ]);
    centrals.push(central); offset+=local.length;
  }
  const centralBytes=Buffer.concat(centrals);
  const end=Buffer.concat([
    u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),
    u32(centralBytes.length),u32(offset),u16(0),
  ]);
  return Buffer.concat([...locals,centralBytes,end]);
}
export function readStoredZip(input,{maxBytes=16*1024*1024,maxEntries=4096}={}) {
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  ensure(bytes.length<=maxBytes,'ZIP exceeds read budget','ResourceExhausted');
  const out=new Map(); let offset=0;
  while(offset+4<=bytes.length) {
    const sig=bytes.readUInt32LE(offset);
    if(sig===0x02014b50||sig===0x06054b50) break;
    ensure(sig===0x04034b50,'Invalid ZIP local header');
    ensure(offset+30<=bytes.length,'Truncated ZIP header');
    const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8);
    ensure((flags&0x0008)===0,'Streaming ZIP entries are unsupported');
    ensure(method===0,'Only stored ZIP entries are supported');
    const expectedCrc=bytes.readUInt32LE(offset+14);
    const compressed=bytes.readUInt32LE(offset+18),uncompressed=bytes.readUInt32LE(offset+22);
    const nameLen=bytes.readUInt16LE(offset+26),extraLen=bytes.readUInt16LE(offset+28);
    ensure(compressed===uncompressed,'Compressed ZIP entry is unsupported');
    const nameStart=offset+30,nameEnd=nameStart+nameLen,dataStart=nameEnd+extraLen,dataEnd=dataStart+compressed;
    ensure(dataEnd<=bytes.length,'Truncated ZIP entry');
    const name=safeName(bytes.subarray(nameStart,nameEnd).toString('utf8'));
    ensure(!out.has(name),'Duplicate ZIP entry');
    const data=Buffer.from(bytes.subarray(dataStart,dataEnd));
    ensure(crc32(data)===expectedCrc,'ZIP entry checksum mismatch','Conflict');
    out.set(name,data); offset=dataEnd;
    ensure(out.size<=maxEntries,'ZIP entry count exceeds budget','ResourceExhausted');
  }
  ensure(out.size>0,'ZIP has no readable entries');
  return out;
}
