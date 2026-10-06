// SPDX-License-Identifier: AGPL-3.0-only
// Heavy runner-only acceptance. Keep this out of npm test to protect developer workstations.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { LaunchwrightApplication, execute } from '../src/application.mjs';
import { exportSnapshot, restoreSnapshot } from '../src/snapshot.mjs';

const source=mkdtempSync(join(tmpdir(),'launchwright-stress-source-'));
const restored=mkdtempSync(join(tmpdir(),'launchwright-stress-restored-'));
const started=performance.now(),createMs=[],queryMs=[];let peakRss=process.memoryUsage().rss;
const sampleMemory=()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);};
const round=value=>Math.round(value*1000)/1000;
const stats=values=>{
  const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]??0;
  return{count:sorted.length,p50_ms:round(at(.50)),p95_ms:round(at(.95)),p99_ms:round(at(.99)),max_ms:round(sorted.at(-1)??0)};
};
let app;
try {
  app=new LaunchwrightApplication(source,{initialize:true});
  const count=800;
  for(let i=0;i<count;i++){
    const tick=performance.now();
    await execute(app,'entity.create',{kind:'product',data:{name:'Stress product '+String(i).padStart(4,'0'),description:'Synthetic bounded stress fixture'}});
    createMs.push(performance.now()-tick);sampleMemory();
  }
  let cursor=null,observed=0,pages=0;
  do{
    const tick=performance.now();
    const page=app.observe({resource:'launchwright:workspace',scope:'product',limit:37,cursor},{signal:new AbortController().signal});
    queryMs.push(performance.now()-tick);observed+=page.items.length;pages++;cursor=page.next;sampleMemory();
  }while(cursor);
  if(observed!==count)throw Error(`Observation lost rows: ${observed}/${count}`);

  let tick=performance.now();const snapshot=exportSnapshot(app),snapshotMs=performance.now()-tick;sampleMemory();
  const snapshotBytes=Buffer.byteLength(JSON.stringify(snapshot));
  app.close();app=null;

  tick=performance.now();const restoreResult=restoreSnapshot(restored,snapshot),restoreMs=performance.now()-tick;sampleMemory();
  tick=performance.now();const check=new LaunchwrightApplication(restored),restoredCount=check.list('product').length,
    verifyQueryMs=performance.now()-tick;
  const events=check.read('events.list',{after:0,limit:128});check.close();sampleMemory();
  if(restoredCount!==count)throw Error(`Restore lost rows: ${restoredCount}/${count}`);

  const report={
    schema_version:'launchwright-stress-report/2',
    evidence_scope:'synthetic-runner-lab-only-not-production-throughput',
    environment:{node:process.version,platform:process.platform,arch:process.arch},
    products:count,observed,observation_pages:pages,
    measurements:{
      local_mutation:createMs.length?stats(createMs):null,
      local_query:queryMs.length?stats(queryMs):null,
      snapshot_export:{elapsed_ms:round(snapshotMs),bytes:snapshotBytes},
      restore:{elapsed_ms:round(restoreMs)},
      restored_query:{elapsed_ms:round(verifyQueryMs)},
      platform_admission:null,platform_queue:null,composition_render:null,
      unavailable_reason:'No canonical Platform admission/queue or Composition render was exercised by this lane.',
      total_elapsed_ms:round(performance.now()-started),peak_rss_bytes:peakRss
    },
    snapshot_digest:snapshot.digest,snapshot_entities:snapshot.entities.length,snapshot_events:snapshot.events.length,
    restored_products:restoredCount,restored_generation:restoreResult.workspace_version.generation,
    restored_epoch_advanced:true,active_receipts_restored:false,first_event_page:events.items.length
  };
  mkdirSync('evidence/stress',{recursive:true});
  writeFileSync('evidence/stress/report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  try{app?.close();}catch{}
  rmSync(source,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  rmSync(restored,{recursive:true,force:true,maxRetries:5,retryDelay:50});
}
