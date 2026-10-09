#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Real owned Native SDK synthetic fixture for CI source-bound offline docs.
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { makeOwnedStaticDocsFixture } from '../tests/static-docs-fixture.mjs';
import { planStaticDocs,exportStaticDocs } from '../src/static-docs.mjs';

if(process.argv.length!==4||process.argv[2]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/static-docs-owned-smoke.mjs --out-dir EXISTING_PRIVATE_DIR\n');
  process.exit(2);
}
const root=mkdtempSync(join(tmpdir(),'launchwright-owned-docs-'));let app=null;
try{
  const f=await makeOwnedStaticDocsFixture({root});app=f.app;
  const plan=await planStaticDocs(app,f.input);
  const receipt=await exportStaticDocs(app,plan,resolve(process.argv[3]),f.approve(plan));
  process.stdout.write(JSON.stringify({
    schema_version:'launchwright-owned-static-docs-smoke/1',
    synthetic_fixture:true,real_customer_acceptance:false,
    candidate_sha256:plan.candidate_sha256,
    source_release_build:f.release.data.build,
    archive_sha256:receipt.archive_sha256,
    page_count:receipt.html_pages,
    technical_state:'UNKNOWN',site_publicly_deployed:false,
    external_network_access:false,platform_authority:false,
    browser_validation_pending:true,
    receipt
  },null,2)+'\n');
}finally{
  try{app?.close();}finally{rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
}
