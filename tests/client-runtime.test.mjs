// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { LaunchwrightClient } from '../client/index.mjs';

test('default browser-style fetch keeps the global receiver instead of LaunchwrightClient', async () => {
  const original=globalThis.fetch;
  let receiver=null;
  globalThis.fetch=async function(url,options){
    receiver=this;
    assert.equal(url,'http://example.test/health');
    assert.equal(options.method,'GET');
    return{ok:true,json:async()=>({ok:true})};
  };
  try{
    const client=new LaunchwrightClient({baseUrl:'http://example.test'});
    assert.deepEqual(await client.request('/health',undefined,'GET'),{ok:true});
    assert.equal(receiver,globalThis);
  }finally{globalThis.fetch=original;}
});
