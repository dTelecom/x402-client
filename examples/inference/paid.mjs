import {privateKeyToAccount} from 'viem/accounts';
import {DtelecomGateway,ModerationStream} from '../../dist/index.mjs';
import {origin,required,input,poll,describeError} from './common.mjs';
try {
  const gatewayUrl=origin('GATEWAY_ORIGIN'),service=required('SERVICE'),idempotencyKey=process.env.REQUEST_ID?undefined:required('IDEMPOTENCY_KEY');
  const client=new DtelecomGateway({account:privateKeyToAccount(required('WALLET_PRIVATE_KEY')),gatewayUrl});
  let result;
  // A known ID can be polled without resubmitting media or creating a new charge.
  if(process.env.REQUEST_ID) {
    const get=service==='vision'?id=>client.getVisionSnapshot(id):service==='file'?id=>client.getFileTranscription(id):id=>client.getModerationRequest(id);
    result=await poll(await get(process.env.REQUEST_ID),get,service==='file'?900:45);
  } else {
    const media=await input(service);
    if(process.env.TRANSPORT==='ws') {
      if(!['audio','video'].includes(service))throw new Error('WebSocket example accepts audio or video');
      const stream=await ModerationStream.connect(await client.createModerationStream());
      try {result=service==='audio'?await stream.sendAudio(idempotencyKey,media,process.env.LANGUAGE??'en'):await stream.sendVideoFrame(idempotencyKey,media);}finally{stream.close();}
      result=await poll(result,id=>client.getModerationRequest(id),45);
    } else if(service==='vision')result=await poll(await client.createVisionSnapshot({image:media,question:process.env.QUESTION,idempotencyKey}),id=>client.getVisionSnapshot(id),45);
    else if(service==='audio')result=await poll(await client.moderateAudio({audio:media,language:process.env.LANGUAGE??'en',idempotencyKey}),id=>client.getModerationRequest(id),45);
    else if(service==='video')result=await poll(await client.moderateVideoFrame({image:media,idempotencyKey}),id=>client.getModerationRequest(id),45);
    else if(service==='file')result=await poll(await client.createFileTranscription({file:media,language:process.env.LANGUAGE??'en',diarize:true,idempotencyKey}),id=>client.getFileTranscription(id),900);
    else throw new Error('SERVICE must be vision/audio/video/file');
  }
  console.log(JSON.stringify(result,null,2));
} catch(error) {describeError(error);}
