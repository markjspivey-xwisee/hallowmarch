// Realm-funded actions share one bounded acceptance lane and native receipt ledger.
import { createHash } from 'node:crypto';
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const validRealm=n=>Number.isSafeInteger(n)&&n>=0&&n<3;
export function createRealmManagementProtocol({season,commanderFor,confirm,publish,send,contextFor=()=>({}),canMutate=()=>true,delegates={}}){
  let tail=Promise.resolve(),queued=0;const reserved=new Set(),confirming=new Map();
  const keyOf=r=>r.owner+':'+r.id;
  function reply(c,m,value){send(c,{t:'order',kind:m?.o?.kind||'manage',q:m?.q,nonce:m?.o?.nonce,...value});}
  function refuse(c,m,why,code='refused'){reply(c,m,{ok:false,why,code});}
  function checked(m){
    const o=m?.o;
    if(!o||!(o.kind==='manage'||Object.hasOwn(delegates,o.kind))||typeof o.nonce!=='string'||!/^[a-zA-Z0-9:_-]{8,100}$/.test(o.nonce)
      ||!Number.isSafeInteger(o.season)||o.season<1||!Number.isSafeInteger(o.revision)||o.revision<0
      ||(o.kind==='manage'&&(!Number.isSafeInteger(o.hall)||o.hall<0))||!o.args||typeof o.args!=='object'||Array.isArray(o.args))return null;
    const serial=canonical({kind:o.kind,season:o.season,revision:o.revision,hall:o.kind==='manage'?o.hall:null,args:o.args});
    if(Buffer.byteLength(serial)>2048)return null;
    return{o:JSON.parse(JSON.stringify(o)),digest:createHash('sha256').update(serial).digest('hex')};
  }
  function accept(c,m,input){
    const{o,digest}=input,RS=season.RS,delegate=o.kind==='manage'?null:delegates[o.kind];
    const actor=delegate?delegate.actorFor(c,o):commanderFor(c,o.hall);
    if(!actor||!validRealm(actor.realm)||actor.realm!==c.realm||!c.acct?.id)
      return refuse(c,m,delegate?'The current battlefield keeper is required.':'Take a high seat of your realm before managing it.',delegate?'keeper_required':'throne_required');
    if(!RS||!season.M?.realmManageAction||!season.M?.realmManageView)return refuse(c,m,'Realm management is unavailable.','unavailable');
    if(o.season!==RS.n)return refuse(c,m,'The season changed. Refresh the realm view.','stale_season');
    const records=RS.managementReceipts||[],prior=records.find(r=>r.owner===c.acct.id&&r.id===o.nonce);
    if(prior&&(prior.digest!==digest||prior.realm!==actor.realm))return refuse(c,m,'This command reference belongs to different input or realm.','nonce_conflict');
    if(!canMutate())return refuse(c,m,'The world is waiting for its owned save. Retry after recovery.','world_paused');
    if(!prior&&reserved.size>=24)return refuse(c,m,'Waiting for accepted realm orders to save.','queue_full');
    if(!prior&&o.revision!==RS.management?.revision)
      return reply(c,m,{ok:false,code:'stale_revision',why:'The realm changed. Review its current state before trying again.',management:season.M.realmManageView(RS,actor.realm)});
    let receipt=prior,saveFailed=false;
    if(!receipt){
      // Failed/throwing actions cannot partially charge canonical stores.
      const candidate=JSON.parse(JSON.stringify(RS));
      const context={...contextFor(c),owner:c.acct.id,name:c.slow?.n||c.acct.name||'Commander',hall:o.hall,nonce:o.nonce,digest};
      const result=delegate?delegate.apply(candidate,actor,o.args,context):season.M.realmManageAction(candidate,actor.realm,{...o.args,expectedRevision:o.revision},context);
      if(!result||result.ok!==true)return reply(c,m,{ok:false,code:'refused',why:result?.why||'That action is no longer available.',management:season.M.realmManageView(RS,actor.realm)});
      if(!Number.isSafeInteger(candidate.management?.revision)||candidate.management.revision<=o.revision)throw Error('Realm action did not advance revision');
      let data;
      if(result.data!==undefined){const serial=JSON.stringify(result.data);if(Buffer.byteLength(serial)>2048)throw Error('Realm result exceeds capacity');data=JSON.parse(serial);}
      receipt={owner:c.acct.id,id:o.nonce,digest,season:RS.n,realm:actor.realm,revision:candidate.management.revision,
        result:{ok:true,message:String(result.message||'Realm order accepted.').slice(0,160),revision:candidate.management.revision,...(data!==undefined?{data}:{})}};
      candidate.managementReceipts=[...records,receipt].slice(-32);season.RS=candidate;season.dirty=true;reserved.add(keyOf(receipt));
      try{season.save();}catch{saveFailed=true;}
    }
    return{receipt,delegate,actor,prior:!!prior,saveFailed};
  }
  async function settle(c,m,outcome){
    if(!outcome)return;
    const{receipt,delegate,actor,prior,saveFailed}=outcome,key=keyOf(receipt);
    try{
      if(saveFailed)throw Error('Realm save is pending');
      let wait=confirming.get(key);
      if(!wait){
        wait=Promise.resolve().then(()=>confirm(receipt,{deferred:delegate?.deferred===true,prior}));
        confirming.set(key,wait);wait.then(()=>{confirming.delete(key);reserved.delete(key);},()=>{confirming.delete(key);reserved.delete(key);});
      }
      await wait;
      reply(c,m,{...receipt.result,confirmed:true,pending:false,management:season.M.realmManageView(season.RS,actor.realm),...(delegate?.view?{logistics:delegate.view(season.RS)}:{})});
      if(!delegate?.deferred)publish?.();
    }catch{
      reserved.delete(key);reply(c,m,{ok:false,pending:true,confirmed:false,code:'checkpoint_unconfirmed',revision:receipt.revision,
        why:'This order is waiting for its native save. Retry the same command after recovery.'});
    }
  }
  function handle(c,m){
    let input;try{input=checked(m);}catch{return refuse(c,m,'Malformed realm command.','invalid_input');}
    if(!input)return refuse(c,m,'Malformed realm command.','invalid_input');
    if(c?.room?.diagnostic)return refuse(c,m,'Realm management is unavailable in diagnostic rooms.','diagnostic_room');
    if(queued>=16)return refuse(c,m,'Realm orders are busy. Try again shortly.','queue_full');
    queued++;
    const accepted=tail.then(()=>accept(c,m,input)).catch(()=>{refuse(c,m,'The realm order could not complete.','unavailable');}).finally(()=>{queued--;});
    // Native confirmation deliberately does not hold the acceptance lane.
    tail=accepted.then(()=>{},()=>{});return accepted.then(outcome=>settle(c,m,outcome));
  }
  return{handle,status:()=>({queued,pending:reserved.size})};
}
export const realmManagementReloadRequired=(slow,nativeRequired)=>nativeRequired===true&&slow?.on===1&&slow.realmManagement!==1;
