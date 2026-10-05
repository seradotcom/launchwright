// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IDS, LAB_MANIFEST, createDeltaDeskServer, renderDeltaDesk } from '../lab/deltadesk/server.mjs';

test('DeltaDesk laboratory exposes owned two-build source identities and the required A/B change oracle',()=>{
  assert.equal(LAB_MANIFEST.owned_fixture,true);
  assert.equal(LAB_MANIFEST.synthetic_data,true);
  assert.notEqual(BUILD_IDS.a,BUILD_IDS.b);
  const ctx='role=operator&plan=pro&locale=en-US';
  const a=renderDeltaDesk(new URL('/build-a/checkout?'+ctx,'http://127.0.0.1'));
  const b=renderDeltaDesk(new URL('/build-b/checkout?'+ctx,'http://127.0.0.1'));
  assert.match(a,/Start Pro trial/);
  assert.match(b,/Continue with Pro/);
  assert.ok(a.indexOf('data-checkout-selector')<a.indexOf('Start Pro trial'));
  assert.ok(b.indexOf('Continue with Pro')<b.indexOf('data-checkout-selector'));

  const basicA=renderDeltaDesk(new URL('/build-a/dashboard?role=operator&plan=basic&locale=en-US','http://127.0.0.1'));
  const basicB=renderDeltaDesk(new URL('/build-b/dashboard?role=operator&plan=basic&locale=en-US','http://127.0.0.1'));
  const proA=renderDeltaDesk(new URL('/build-a/dashboard?role=operator&plan=pro&locale=en-US','http://127.0.0.1'));
  const proB=renderDeltaDesk(new URL('/build-b/dashboard?role=operator&plan=pro&locale=en-US','http://127.0.0.1'));
  assert.match(basicA,/Advanced export: available/);
  assert.match(basicB,/Advanced export: unavailable/);
  assert.match(proA,/Advanced export: available/);
  assert.match(proB,/Advanced export: available/);
});

test('DeltaDesk fixture provides es-MX, demo login, source build headers and explicit reset',async()=>{
  const fixture=createDeltaDeskServer();
  const origin=await fixture.listen();
  try{
    let response=await fetch(origin+'/build-b/login?locale=es-MX');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-deltadesk-build'),BUILD_IDS.b);
    const login=await response.text();
    assert.match(login,/Inicia sesión en DeltaDesk/);
    assert.match(login,/name="role"/);
    assert.match(login,/name="plan"/);

    response=await fetch(origin+'/build-a/request/REQ-104?role=viewer&plan=basic&locale=en-US');
    assert.equal(response.status,200);
    assert.match(await response.text(),/REQ-104 · Add export columns/);

    response=await fetch(origin+'/lab/reset',{method:'POST'});
    assert.deepEqual(await response.json(),{status:'reset',resets:1});
    response=await fetch(origin+'/health');
    const health=await response.json();
    assert.equal(health.status,'ok');
    assert.equal(health.resets,1);
    assert.deepEqual(health.builds,BUILD_IDS);
  }finally{
    await fixture.close();
  }
});

test('DeltaDesk fixture rejects unknown routes instead of serving a generic fake surface',async()=>{
  const fixture=createDeltaDeskServer();
  const origin=await fixture.listen();
  try{
    const response=await fetch(origin+'/build-a/not-a-real-surface');
    assert.equal(response.status,404);
    assert.equal(await response.text(),'not found');
  }finally{
    await fixture.close();
  }
});
