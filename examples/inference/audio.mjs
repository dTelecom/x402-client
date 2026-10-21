/** Raw PCM only: mono, 16 kHz, signed 16-bit little-endian, at most 30 s. */
export function validatePCM(bytes) {
  const pcm = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!pcm.length || pcm.length % 2 || pcm.length > 960000) throw new Error('Expected 1–480000 PCM16 samples (up to 30 seconds)');
  if (pcm.length >= 4 && new TextDecoder().decode(pcm.subarray(0,4)) === 'RIFF') throw new Error('Decode the WAV container before sending PCM');
  return pcm;
}

/** Strict PCM WAV extraction. Decode/resample other formats with ffmpeg first. */
export function wavToPCM(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer,data.byteOffset,data.byteLength);
  const tag = n => new TextDecoder().decode(data.subarray(n,n+4));
  if (data.length < 12 || tag(0)!=='RIFF' || tag(8)!=='WAVE' || view.getUint32(4,true)+8!==data.length) throw new Error('Invalid or truncated RIFF WAV');
  let format,pcm;
  for (let at=12;at<data.length;) {
    if (at+8>data.length) throw new Error('Truncated WAV chunk');
    const name=tag(at),length=view.getUint32(at+4,true),start=at+8,end=start+length;
    if (end>data.length) throw new Error('Truncated WAV payload');
    if (name==='fmt ') {
      if (format || length<16) throw new Error('Invalid WAV format chunk');
      format=[view.getUint16(start,true),view.getUint16(start+2,true),view.getUint32(start+4,true),view.getUint32(start+8,true),view.getUint16(start+12,true),view.getUint16(start+14,true)];
    }
    if (name==='data') { if(pcm) throw new Error('Multiple WAV data chunks'); pcm=data.slice(start,end); }
    at=end+(length%2);
    if(at>data.length) throw new Error('Missing WAV padding');
  }
  if (!format || format.join(',')!=='1,1,16000,32000,2,16' || !pcm) throw new Error('WAV must be PCM16 mono at 16000 Hz; decode/resample first');
  return validatePCM(pcm);
}

/** Already resampled mono Float32 samples; out-of-range finite values are clipped. */
export function floatToPCM(samples,sampleRate=16000,channels=1) {
  if (sampleRate!==16000 || channels!==1) throw new Error('Resample to mono 16000 Hz first');
  const bytes=new Uint8Array(samples.length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++) {
    if(!Number.isFinite(samples[i])) throw new Error('Nonfinite audio sample');
    const value=Math.max(-1,Math.min(1,samples[i]));view.setInt16(i*2,Math.round(value*(value<0?32768:32767)),true);
  }
  return validatePCM(bytes);
}
