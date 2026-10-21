import {test} from 'node:test';
import assert from 'node:assert/strict';
import {floatToPCM,validatePCM,wavToPCM} from './audio.mjs';
function wav(channels=1,rate=16000) {
  const bytes=new Uint8Array(48),view=new DataView(bytes.buffer),put=(n,s)=>bytes.set(new TextEncoder().encode(s),n);
  put(0,'RIFF');view.setUint32(4,40,true);put(8,'WAVE');put(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,4,true);view.setInt16(44,-32768,true);view.setInt16(46,32767,true);return bytes;
}
test('WAV extraction strips container and preserves signed little endian samples',()=>assert.deepEqual([...wavToPCM(wav())],[0,128,255,127]));
test('WAV rejects stereo, wrong sample rate, corrupt sizes and truncated chunks',()=>{
  for(const bytes of [wav(2),wav(1,48000),wav().slice(0,47)])assert.throws(()=>wavToPCM(bytes));
  const bad=wav();new DataView(bad.buffer).setUint32(40,1000,true);assert.throws(()=>wavToPCM(bad));
});
test('Float32 conversion has correct endpoints, clipping and little endian order',()=>assert.deepEqual([...floatToPCM(new Float32Array([-2,-1,0,1,2]))],[0,128,0,128,0,0,255,127,255,127]));
test('Raw formatting rejects odd, empty, oversized, nonfinite and wrong-rate audio',()=>{
  for(const n of [0,3,960002])assert.throws(()=>validatePCM(new Uint8Array(n)));
  assert.throws(()=>validatePCM(wav()));assert.throws(()=>floatToPCM([NaN]));assert.throws(()=>floatToPCM([Infinity]));assert.throws(()=>floatToPCM([0],48000));assert.throws(()=>floatToPCM([0],16000,2));assert.equal(validatePCM(new Uint8Array(960000)).length,960000);
});
