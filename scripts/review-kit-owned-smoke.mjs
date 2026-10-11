#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Disposable synthetic Native Candidate/Docs/Deck => genuine review ZIP.
import {resolve} from 'node:path';
import {mkdtempSync,chmodSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {makeOwnedReviewKitFixture} from '../tests/release-review-kit-fixture.mjs';
import {planReleaseReviewKit,exportReleaseReviewKit} from '../src/release-review-kit.mjs';
if(process.argv.length!==4||process.argv[2]!=='--out-dir'){
  process.stderr.write('Usage: node scripts/review-kit-owned-smoke.mjs --out-dir PRIVATE_EXISTING_DIR\n');
  process.exit(2);
}
const dir=resolve(process.argv[3]);
const st=lstatSync(dir);
if(!st.isDirectory()||st.isSymbolicLink()||
  (process.platform!=='win32'&&(st.mode&0o077)!==0)){
  process.stderr.write('Output must be an existing 0700 real directory\n');
  process.exit(2);
}
let f;
try{
  f=await makeOwnedReviewKitFixture(mkdtempSync(tmpdir()+'/lw-r64-owned-'));
  const plan=await planReleaseReviewKit(f.app,f.kitInput);
  const receipt=await exportReleaseReviewKit(f.app,plan,f.kitInput,dir,f.approve(plan));
  process.stdout.write(JSON.stringify({
    schema_version:'launchwright-r64-owned-acceptance/1',
    synthetic_fixture:true,real_customer_capture:false,
    native_sdk:'1.0.0',plan_sha256:plan.plan_sha256,
    release_id:plan.release_id,candidate_sha256:plan.candidate_sha256,
    original_build:plan.release_build,
    real_docs_html:true,editable_pptx:true,real_pdf:true,
    optional_demo_included:false,technical_state:'UNKNOWN',
    external_publish:false,platform_authority:false,
    ownership_review:'operator-declared-only',
    receipt
  },null,2)+'\n');
}finally{f?.close();}
