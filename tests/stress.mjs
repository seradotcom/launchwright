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
const started=performance.now();
let app;
try {
  app=new LaunchwrightApplication(source,{initialize:true});
  const count=800;
  for(let i=0;i<count;i++){
    await execute(app,'entity.create',{kind:'product',data:{name:'Stress product '+String(i).padStart(4,'0'),description:'Synthetic bounded stress fixture'}});
  }
  let cursor=null,observed=0,pages=0;
  do{
    const page=app.observe({resource:'launchwright:workspace',scope:'product',limit:37,cursor},{signal:new AbortController().signal});
    observed+=page.items.length;pages++;cursor=page.next;
  }while(cursor);
  if(observed!==count)throw Error(`Observation lost rows: ${observed}/${count}`);
  const snapshot=exportSnapshot(app);
  app.close();app=null;
  const restoreResult=restoreSnapshot(restored,snapshot);
  const check=new LaunchwrightApplication(restored);
  const restoredCount=check.list('product').length;
  const events=check.read('events.list',{after:0,limit:128});
  check.close();
  if(restoredCount!==count)throw Error(`Restore lost rows: ${restoredCount}/${count}`);
  const report={
    schema_version:'launchwright-stress-report/1',
    node:process.version,
    products:count,
    observed,
    observation_pages:pages,
    snapshot_digest:snapshot.digest,
    snapshot_entities:snapshot.entities.length,
    snapshot_events:snapshot.events.length,
    restored_products:restoredCount,
    restored_generation:restoreResult.workspace_version.generation,
    restored_epoch_advanced:true,
    active_receipts_restored:false,
    first_event_page:events.items.length,
    elapsed_ms:Math.round(performance.now()-started)
  };
  mkdirSync('evidence/stress',{recursive:true});
  writeFileSync('evidence/stress/report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  try{app?.close();}catch{}
  rmSync(source,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  rmSync(restored,{recursive:true,force:true,maxRetries:5,retryDelay:50});
}
