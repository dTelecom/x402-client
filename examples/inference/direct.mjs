import {readFile} from 'node:fs/promises';
import {origin,required,input,json,poll,directStream,describeError} from './common.mjs';
try {
  const base=origin('DIRECT_ORIGIN'),service=required('SERVICE');
  let result;
  if(service==='text') result=await json(await fetch(new URL('/moderate/text',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:await readFile(required('INPUT_FILE'),'utf8'),lang:process.env.LANGUAGE??'en'}),signal:AbortSignal.timeout(30000)}));
  else {
    const media=await input(service);
    if(process.env.TRANSPORT==='ws') {
      if(!['audio','video'].includes(service))throw new Error('WebSocket example accepts audio or video');
      result=await directStream(base,service,media,process.env.REQUEST_ID??'direct-example',process.env.LANGUAGE??'en');
    } else {
      const paths={vision:'/v1/vision/snapshot',image:'/moderate/image',audio:'/moderate/audio',video:'/moderate/video-frame',file:'/transcriptions/jobs'};
      if(!paths[service])throw new Error('SERVICE must be text/image/vision/audio/video/file');
      const form=new FormData();form.append(service==='audio'?'audio':service==='file'?'file':'image',media,'input.media');
      if(service==='vision'&&process.env.QUESTION)form.append('question',process.env.QUESTION);
      if(['audio','file'].includes(service))form.append('language',process.env.LANGUAGE??'en');
      if(service==='file')form.append('diarize','true');
      result=await json(await fetch(new URL(paths[service],base),{method:'POST',body:form,signal:AbortSignal.timeout(30000)}));
      if(service==='file')result=await poll(result,id=>fetch(new URL('/transcriptions/jobs/'+encodeURIComponent(id),base),{signal:AbortSignal.timeout(10000)}).then(json),900);
    }
  }
  console.log(JSON.stringify(result,null,2));
} catch(error) {describeError(error);}
