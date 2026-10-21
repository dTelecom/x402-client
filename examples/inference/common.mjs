import {readFile} from 'node:fs/promises';
import {validatePCM,wavToPCM} from './audio.mjs';
export function required(name) {const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
export function origin(name) {const url=new URL(required(name));if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error(`${name} must be an explicit HTTP origin`);return url.origin;}
export async function input(kind) {let bytes=await readFile(required('INPUT_FILE'));if(kind==='audio')bytes=process.env.AUDIO_FORMAT==='wav'?wavToPCM(bytes):validatePCM(bytes);return new Blob([bytes]);}
export function completed(value) {if(value.status==='failed'||value.status==='cancelled')throw new Error(`Inference ${value.status}: ${value.error??'see result'}`);return value;}
export async function json(response) {const body=await response.json();if(!response.ok)throw Object.assign(new Error(body.error??`HTTP ${response.status}`),{status:response.status});return body;}
export async function poll(value,get,seconds) {const deadline=Date.now()+seconds*1000;while(['running','queued','prepared','processing','pending'].includes(value.status)){if(Date.now()>deadline)throw new Error(`Polling deadline; retain request ID ${value.id}`);await new Promise(r=>setTimeout(r,500));value=await get(value.id);}return completed(value);}
export function describeError(error) {const status=error.status;console.error(JSON.stringify({error:error.message,status,...(status===402?{action:'Fund the account explicitly; this example never purchases credits'}:{}),...([429,503,504].includes(status)?{action:'Back off; check durable paid request status or retry the identical bytes/options with the SAME key'}:{})}));process.exitCode=1;}

/** Direct service has no auth frame, durable billing cache or paid retry guarantees. */
export async function directStream(base,kind,media,id,language='en') {
  const url=new URL('/moderate/stream',base);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const socket=new WebSocket(url);let timer;
  try{return await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error('Direct moderation deadline exceeded')),35000);
    socket.addEventListener('error',()=>reject(new Error('Direct socket error')));
    socket.addEventListener('close',()=>reject(new Error('Direct socket closed before result')));
    socket.addEventListener('message',async event=>{
      try{const message=JSON.parse(String(event.data));
        if(message.type==='ready') {if(message.protocol!=='dtelecom.moderation.v1')throw new Error('Unsupported protocol');socket.send(JSON.stringify({id,kind,...(kind==='audio'?{language}:{})}));socket.send(await media.arrayBuffer());}
        else if(message.type==='result'&&message.id===id)resolve(message.result);
        else throw new Error(message.error??'Unexpected direct response');
      }catch(error){reject(error);}
    });
  });}finally{clearTimeout(timer);socket.close();}
}
