import { Worker } from 'node:worker_threads';
import { DurableStoreError } from './interego-store.js';
const failed=()=>new DurableStoreError('Rolling storage processing is unavailable.','DURABILITY_UNAVAILABLE',503);
const diagnostic=value=>{
  if(!value||typeof value!=='object')return {};
  const out={};
  for(const [key,v] of Object.entries(value))
    if(key==='phase'&&typeof v==='string'&&/^[a-z-]{1,40}$/.test(v)
      || ['streams','checkpoints','inputCheckpoints','checkpointsDropped','receipts','writeBudgetBuckets','bindings','rawBytes','wireBytes','compressedBytes'].includes(key)
      &&Number.isSafeInteger(v)&&v>=0)out[key]=v;
  return out;
};
/** One bounded CPU lane per process. No credentials, native I/O or mutable
 * prepared document live here; each request carries its exact scope/context. */
export class RollingStorageWorker {
  constructor({capacity=64,idleMs=1000,workerUrl=new URL('./rolling-storage-worker.js',import.meta.url)}={}) {
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>64||!Number.isSafeInteger(idleMs)||idleMs<0||idleMs>60000)throw failed();
    this.capacity=capacity;this.idleMs=idleMs;this.workerUrl=workerUrl;this.retiring=null;this.retiringCount=0;this.fenced=false;
    this.queue=[];this.active=null;this.worker=null;this.sequence=0;this.timer=null;
  }
  run(operation,payload) {
    if(this.fenced)return Promise.reject(failed());
    if(this.queue.length+(this.active?1:0)+this.retiringCount>=this.capacity)
      return Promise.reject(new DurableStoreError('Rolling storage admission is at capacity.','NATIVE_COMMIT_CAPACITY',503));
    // Immediate postMessage captures synchronously. Pending requests require
    // their own capture now so caller mutation cannot alter a queued job.
    const immediate=!this.active&&!this.retiring&&!this.queue.length;
    let captured;
    try {captured=immediate?payload:structuredClone(payload);}catch{return Promise.reject(failed())}
    return new Promise((resolve,reject)=>{
      this.queue.push({id:++this.sequence,operation,payload:captured,resolve,reject});this.next();
    });
  }
  next() {
    if(this.fenced||this.active||this.retiring||!this.queue.length)return;
    clearTimeout(this.timer);this.timer=null;
    if(!this.worker) {
      let worker;
      try {worker=new Worker(this.workerUrl,{env:{},resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32,stackSizeMb:8}});}
      catch {this.fail();return}
      this.worker=worker;
      worker.on('message',message=>this.receive(worker,message));
      worker.on('error',()=>this.fail(worker));
      worker.on('messageerror',()=>this.fail(worker));
      worker.on('exit',()=>{if(this.worker===worker)this.fail(worker)});
    }
    const task=this.active=this.queue.shift();this.worker.ref();
    const worker=this.worker;task.timer=setTimeout(()=>this.fail(worker),30000);task.timer.unref();
    try {this.worker.postMessage({id:task.id,operation:task.operation,payload:task.payload});}
    catch {this.fail(this.worker)}
  }
  receive(worker,message) {
    if(this.worker!==worker)return;
    const task=this.active;
    if(!task||message?.id!==task.id||message.operation!==task.operation){this.fail(worker);return}
    this.active=null;clearTimeout(task.timer);
    if(message.ok===true)task.resolve(message.value);
    else {
      const code=['PAYLOAD_TOO_LARGE','CORRUPT_DURABLE_STATE','INVALID_INPUT'].includes(message.error?.code)
        ?message.error.code:'DURABILITY_UNAVAILABLE';
      const e=new DurableStoreError('Rolling storage processing failed.',code,code==='PAYLOAD_TOO_LARGE'?413:code==='INVALID_INPUT'?400:503);
      e.measured=diagnostic(message.error?.measured);task.reject(e);
    }
    if(this.queue.length)this.next();
    else {
      worker.unref();
      this.timer=setTimeout(()=>{
        if(this.worker!==worker||this.active||this.queue.length)return;
        this.worker=null;this.retire(worker,[]);
      },this.idleMs);this.timer.unref();
    }
  }
  retire(worker,tasks) {
    // A rejected CPU job retains its caller's native permit until the old
    // thread has actually stopped. New jobs cannot overlap a retiring thread.
    this.retiringCount+=tasks.length;
    this.retiring=Promise.resolve().then(()=>worker?.terminate()).then(()=>{
      for(const task of tasks)task.reject(failed());
      this.retiringCount-=tasks.length;this.retiring=null;this.next();
    },()=>{
      // A failed termination is not proof that the old CPU thread stopped.
      // Fence this lane rather than overlap it with a replacement.
      this.fenced=true;
      for(const task of [...tasks,...this.queue])task.reject(failed());
      this.queue=[];this.retiringCount=0;this.retiring=null;
    });
    return this.retiring;
  }
  fail(worker=this.worker) {
    if(worker&&this.worker!==worker)return this.retiring;
    if(this.retiring&&!worker)return this.retiring;
    clearTimeout(this.timer);this.timer=null;this.worker=null;
    const tasks=[...(this.active?[this.active]:[]),...this.queue];this.active=null;this.queue=[];
    for(const task of tasks)clearTimeout(task.timer);
    return this.retire(worker,tasks);
  }
}
export const rollingStorageWorker=new RollingStorageWorker();
