import { parentPort } from 'node:worker_threads';
import { encodeRollingDocument,finishRollingDocument,decodeRollingDocument,validateRollingDocument } from './rolling-document-codec.js';
parentPort.on('message',message=>{
  const {id,operation,payload}=message;
  try {
    let value;
    if(operation==='encode')value=encodeRollingDocument(payload.doc,payload.context);
    else if(operation==='finish')value=finishRollingDocument(payload.wire,payload.writeBudget,payload.context,payload.measured);
    else if(operation==='decode')value=decodeRollingDocument(payload.bytes,payload.contentType,payload.context);
    else if(operation==='validate')value=validateRollingDocument(payload.doc,payload.context);
    else throw Object.assign(new Error('Unknown storage operation'),{code:'INVALID_INPUT'});
    // Never transfer a Buffer slab or memory owned by the native SDK/cache.
    const transfer=[];
    if(value?.compressed){value.compressed=Uint8Array.from(value.compressed);transfer.push(value.compressed.buffer)}
    parentPort.postMessage({id,operation,ok:true,value},transfer);
  } catch(e) {parentPort.postMessage({id,operation,ok:false,error:{code:e?.code,measured:e?.measured}})}
});
