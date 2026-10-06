import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompositionEvidence } from '../src/composition-evidence.mjs';

const semwright='4d291de26724810017ce7b6d185326514cb79fa6';
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64),e='e'.repeat(64),f='f'.repeat(64);
function fixture(){
  return{
    expected_semwright_sha:semwright,
    browser_receipt:{
      schema_version:'launchwright-deltadesk-browser-driver/1',semwright_sha:semwright,real_semwright_adapter:true,
      agent_javascript:false,raw_cdp_exposed:false,platform_job_receipt:false,
      captures:[
        {build:'a',screenshot:{sha256:a}},
        {build:'b',screenshot:{sha256:b}}
      ]
    },
    media_receipt:{
      schema_version:'launchwright-real-media-driver/1',classification:'REAL_BROWSER_CAPTURE_TO_DRIVER_HOST_MLT',
      semwright_sha:semwright,provider:'driver.mlt-video',driver_host:true,broker_dispatch:false,network:false,
      platform_job_receipt:false,composition_coordinator_receipt:false,
      source:{kind:'semwright-chromium-capture',capture_a_sha256:a,capture_b_sha256:b,width:1440,height:900},
      timeline:{fps:{num:30,den:1},frame_count:600,duration:{num:20,den:1},segments:[
        {build:'A',first_frame:0,end_frame_exclusive:300},{build:'B',first_frame:300,end_frame_exclusive:600}
      ]},
      frame_manifest_sha256:c,mezzanine_sha256:d,audio_sha256:e,
      artifact:{file:'launchwright-deltadesk-demo.mp4',sha256:f,bytes:12000,mime:'video/mp4'}
    },
    av_receipt:{
      schema_version:1,classification:'COMBINED_A_B_NATIVE_AV_CANDIDATE',composition_source_sha:semwright,audio_source_sha:semwright,
      audio_pre_encode_pass:true,audio_post_encode_pass:true,sync_full_scan_pass:true,sync_exhaustive:true,master_mp4_sha256:c,
      r16_closed:false,promotional_video:false
    }
  };
}

test('composition evidence preserves partial authority while proving both real-media legs',()=>{
  const out=validateCompositionEvidence(fixture());
  assert.equal(out.real_capture_source,'PASS');
  assert.equal(out.native_driver_host_render,'PASS');
  assert.equal(out.canonical_composition_av_stack,'PASS');
  assert.equal(out.single_recipe_real_capture_composition,'UNKNOWN');
  assert.equal(out.technical_state,'UNKNOWN');
  assert.equal(out.media_requirement_state,'PARTIAL');
  assert.equal(out.execution_authority,false);
  assert.match(out.chain_sha256,/^[0-9a-f]{64}$/);
});

test('composition evidence rejects media that is not bound to exact browser bytes',()=>{
  const input=fixture();
  input.media_receipt.source.capture_b_sha256='0'.repeat(64);
  assert.throws(()=>validateCompositionEvidence(input),{code:'Conflict'});
});

test('composition evidence rejects another Semwright source revision',()=>{
  const input=fixture();
  input.av_receipt.composition_source_sha='1'.repeat(40);
  assert.throws(()=>validateCompositionEvidence(input),{code:'StaleReference'});
});

test('composition evidence rejects non-exhaustive canonical AV verification',()=>{
  const input=fixture();
  input.av_receipt.sync_exhaustive=false;
  assert.throws(()=>validateCompositionEvidence(input));
});
