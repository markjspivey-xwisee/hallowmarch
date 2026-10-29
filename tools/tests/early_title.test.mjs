import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
const read=n=>readFileSync(new URL('../../src/'+n,import.meta.url),'utf8');
function actual(file,names){const s=read(file);return parse(s,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>names.includes(d.id.name))).map(n=>s.slice(n.start,n.end)).join('\n');}
const ui=read('10_ui.js').split('/* HUD construction')[0];
const identity=actual('14v_nativeidentity.js',['nativePlayerRender','nativePlayerBegin','nativePlayerSaveRef','nativePlayerChanged','nativePlayerCanPlayNow']);
class Node {
  constructor(tag='div',id=''){this.tagName=tag;this.id=id;this.children=[];this.parentNode=null;this.className='';this.hidden=false;this.disabled=false;this.value='';this.style={};this.dataset={};this.attributes={};this.listeners={};}
  get parentElement(){return this.parentNode;} get nextSibling(){return this.parentNode?.children[this.parentNode.children.indexOf(this)+1]||null;}
  get classList(){return{contains:k=>this.className.split(' ').includes(k),add:k=>{if(!this.className.split(' ').includes(k))this.className+=' '+k;},remove:k=>{this.className=this.className.split(' ').filter(v=>v!==k).join(' ');},toggle:(k,on)=>{if(on)this.classList.add(k);else this.classList.remove(k);}};}
  appendChild(n){n.remove();this.children.push(n);n.parentNode=this;return n;} prepend(n){n.remove();this.children.unshift(n);n.parentNode=this;}
  insertBefore(n,next){n.remove();this.children.splice(this.children.indexOf(next),0,n);n.parentNode=this;}
  remove(){if(this.parentNode){const p=this.parentNode;this.parentNode=null;p.children.splice(p.children.indexOf(this),1);}}
  replaceChildren(...children){for(const n of [...this.children])n.remove();children.forEach(n=>this.appendChild(n));}
  contains(n){return n===this||this.children.some(child=>child.contains(n));}
  setAttribute(k,v){this.attributes[k]=String(v);} addEventListener(k,fn){this.listeners[k]=fn;} focus(){}
  querySelectorAll(selector){const [tag,cls]=selector.startsWith('.')?['',selector.slice(1)]:selector.split('.');const out=[];const visit=n=>{for(const child of n.children){if((!tag||child.tagName===tag)&&(!cls||child.classList.contains(cls)))out.push(child);visit(child);}};visit(this);return out;}
  querySelector(s){return this.querySelectorAll(s)[0]||null;} click(){if(!this.disabled)this.onclick?.();}
}
function fixture({career=null,native=true}={}){
  const ids=['realm-pick','class-pick','realm-blurb','class-blurb','btn-dice','name-input','btn-begin','btn-continue','character-create-fields','continue','continue-desc','season-title','save-note','title','loading'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id.includes('btn-')?'button':'div',id)]));
  const body=new Node(),cardBody=new Node(),foot=new Node();cardBody.className='card-body';foot.className='card-foot';
  body.appendChild(nodes.loading);body.appendChild(nodes.title);nodes.title.appendChild(cardBody);nodes.title.appendChild(foot);foot.appendChild(nodes['btn-begin']);
  const calls={random:0,audio:0,sound:0,tasks:0,actions:0,peek:0,resume:0,bootstrap:0,settings:0,world:0,season:0};
  const state={keyPresent:true,hasRecord:!!career,pending:false},profile={status:()=>state};
  const status={enabled:true,bound:true,verified:true,binding:{subjectDid:'did:fixture:owner',podUrl:'https://pod.example/owner/'},recordLinks:{}};
  const SAVE={ref:{},lsKey:'fixture',native,loaded:career?{v:1,char:career}:null,readConfirmed:true,loading:{settled:true,active:true,owner:'owner',host:'fixture'},pending:null,nativeFlight:null};
  const NATIVE_PLAYER={status,profile,busy:false,switching:false,draftPreview:null};
  const c=vm.createContext({console,URL,AbortSignal,GAME:{ready:false,started:false},SAVE,NATIVE_PLAYER,NETWS:{host:'fixture',acct:{id:'owner'},reload:false},
    GRAPHICS_CONTEXT_LOST:false,GRAPHICS_STARTUP:{stopped:false},document:{body,activeElement:null,getElementById:id=>nodes[id]||null,createElement:tag=>new Node(tag),querySelector:s=>s==='#create .card-body'?cardBody:s==='#create .card-foot'?foot:null},
    REALMS:['Logres','Ériu','Thule'].map((name,id)=>({name,id,color:'#fff'})),CLASSES:Object.fromEntries(['warrior','archer','mage','priest'].map(k=>[k,{name:k,blurb:k,icon:k,role:k}])),
    randomName:()=>{calls.random++;return'Generated name';},audioUnlock:()=>{calls.audio++;},sfx:()=>{calls.sound++;},iconSvg:()=>'',emblemSvg:()=>'',realmRank:()=>1,seasonTitleText:()=>{calls.season++;return'';},
    loreCancelBegin(){},loreRequestBegin:()=>{calls.actions++;},netServerUrl:()=> 'wss://fixture/ws',
    nativePlayerSaveMessage:()=> 'Private character kept',nativePlayerGuestExpired:()=>false,nativePlayerIsProvisional:()=>false,nativePlayerQuotaExhausted:()=>false,
    nativePlayerFreshAllowed:()=>false,nativePlayerNewAdventureAllowed:()=>false,nativePlayerExpiredAdventureAllowed:()=>false,
    nativePlayerConnect:()=>{calls.actions++;},nativePlayerRecovery:()=>{calls.actions++;},nativePlayerRestore:()=>{calls.actions++;},
    nativePlayerTask:async()=>{calls.tasks++;},fetch:async()=>({ok:true,status:200,json:async()=>({playerIdentity:{provisionalPlay:{enabled:true}}})}),
    netLinkWS:async()=>true,nativePlayerRequest:async()=>c.serverStatus,nativePlayerError:(code,message)=>Object.assign(Error(message),{code}),
    applySettings:()=>{calls.settings++;},applyWorldSave:()=>{calls.world++;},setTimeout:()=>1,clearTimeout(){},
  });
  vm.runInContext(actual('12_save.js',['saveLoadOwned','saveLoadTitle'])+'\n'+ui+'\n'+actual('10_ui.js',['menuRadioKey'])+'\n'+identity+'\nglobalThis.view=UI;globalThis.draft=()=>TITLE_DRAFT;',c);
  const session={peek:async()=>{calls.peek++;if(c.peekError)throw Error('private read unavailable');return c.metadata;},resume:async()=>{calls.resume++;return{};},bootstrap:async()=>{calls.bootstrap++;throw Error('UI must not bootstrap');},profile:()=>profile,claimProfile:()=>null,status:()=>({})};
  c.nativePlayerProvisionalSession=async()=>{NATIVE_PLAYER.provisional=session;NATIVE_PLAYER.provisionalContext={host:'fixture',accountId:'owner'};return session;};
  c.nativePlayerProvisionalRef=()=>({native:true});
  return{c,nodes,body,cardBody,foot,calls,state,session,
    prepare:()=>c.prepareTitleDraft(SAVE.loaded),finish:()=>{c.GAME.ready=true;return c.finishTitleDraft();},
    realm:id=>nodes['realm-pick'].listeners.click({target:{closest:()=>({dataset:{realm:String(id)}})}}),
    calling:cls=>nodes['class-pick'].listeners.click({target:{closest:()=>({dataset:{cls}})}}),
    type:name=>{nodes['name-input'].value=name;nodes['name-input'].listeners.input();},
    async anonymous(...args){c.metadata=args.length?args[0]:null;c.serverStatus={enabled:true,bound:false,verified:false,provisionalPlay:{enabled:true},recordLinks:{}};NATIVE_PLAYER.profile=null;SAVE.readConfirmed=false;SAVE.loaded=null;SAVE.loading.settled=false;SAVE.ref=await c.nativePlayerSaveRef(SAVE.loading);SAVE.loading.settled=true;},
  };
}
test('same-owner early edits are DOM-only and finish with the original single default-name draw',async()=>{
  const f=fixture();assert.equal(f.prepare(),true);f.realm(2);f.calling('mage');f.type('Typed recruit');
  f.nodes['btn-dice'].onclick();f.nodes['btn-begin'].onclick();f.nodes['btn-continue'].onclick();
  f.nodes['name-input'].listeners.keydown({key:'Enter'});await f.c.nativePlayerBegin({fresh:true});
  assert.deepEqual([f.calls.random,f.calls.audio,f.calls.sound,f.calls.tasks,f.calls.actions],[0,0,0,0,0]);
  assert.equal(f.nodes.loading.parentNode,f.foot);assert(f.body.classList.contains('title-preparing'));
  assert.equal(f.finish(),true);assert.equal(f.calls.random,1);assert.equal(f.nodes['name-input'].value,'Typed recruit');
  assert.equal(f.c.view.realm,2);assert.equal(f.c.view.cls,'mage');assert.equal(f.nodes.loading.parentNode,f.body);
  assert.equal(f.nodes['btn-begin'].disabled,false);assert(!f.body.classList.contains('title-preparing'));
});
test('untouched early and ordinary paths each draw one default name only at Ready',()=>{
  const early=fixture();early.prepare();assert.equal(early.calls.random,0);early.finish();assert.equal(early.calls.random,1);assert.equal(early.nodes['name-input'].value,'Generated name');
  const ordinary=fixture();ordinary.c.GAME.ready=true;ordinary.c.setupTitle(null);assert.equal(ordinary.calls.random,1);
});
test('confirmed returning summary remains unchanged and creation fields stay concealed',()=>{
  const career={name:'Earned veteran',realm:1,cls:'priest',level:37,rp:900,xp:141};const f=fixture({career});const before=JSON.stringify(career);
  f.prepare();f.realm(2);f.calling('mage');assert.equal(f.nodes['character-create-fields'].hidden,true);
  assert.match(f.nodes['continue-desc'].textContent,/Earned veteran, level 37 priest/);assert.equal(f.calls.season,0);f.finish();assert.equal(f.calls.season,1);assert.equal(JSON.stringify(career),before);
  assert.equal(f.c.view.realm,1);assert.equal(f.c.view.cls,'priest');
});
test('async identity rerenders retain the draft while every entry/account control stays locked',()=>{
  const f=fixture();f.c.NATIVE_PLAYER.recoveryOpen=true;f.prepare();f.type('Keep this draft');
  for(const busy of[true,false]){f.c.NATIVE_PLAYER.busy=busy;f.c.NATIVE_PLAYER.message='Connection update';f.c.nativePlayerRender();
    assert.equal(f.nodes['btn-begin'].disabled,true);for(const b of f.cardBody.querySelectorAll('button')){assert.equal(b.disabled,true);b.onclick?.();}
    for(const input of f.cardBody.querySelectorAll('input'))assert.equal(input.disabled,true);
    assert.equal(f.nodes['name-input'].value,'Keep this draft');}
  assert.equal(f.calls.actions,0);assert.equal(f.calls.tasks,0);f.finish();
  assert(f.cardBody.querySelectorAll('button').some(b=>!b.disabled));assert.equal(f.nodes['btn-begin'].disabled,false);
});
for(const change of['account','host','ref','key','profile','saved','unconfirmed','failure'])test('draft cancels rather than crossing '+change,()=>{
  const f=fixture();f.prepare();f.type('Private draft');
  if(change==='account')f.c.NETWS.acct={id:'foreign'};if(change==='host')f.c.NETWS.host='foreign';if(change==='ref')f.c.SAVE.ref={};
  if(change==='key')f.c.SAVE.lsKey='foreign';if(change==='profile')f.c.NATIVE_PLAYER.profile={status:()=>f.state};
  if(change==='saved')f.c.SAVE.loaded={char:{name:'Recovered'}};if(change==='unconfirmed')f.c.SAVE.readConfirmed=false;
  if(change==='failure')f.c.GRAPHICS_STARTUP.stopped=true;f.c.nativePlayerRender();
  assert.equal(f.c.draft(),null);assert.equal(f.nodes.title.hidden,true);assert.equal(f.nodes['name-input'].value,'');
  assert.equal(f.nodes.loading.parentNode,f.body);assert.equal(f.calls.random,0);assert.equal(f.calls.tasks,0);
});
test('only a real successful null peek mints an anonymous preview; it never confirms absence or admission',async()=>{
  const f=fixture();await f.anonymous(null);assert.equal(f.prepare(),true);f.type('Preview recruit');
  assert.equal(f.c.SAVE.readConfirmed,false);assert.equal(f.c.NATIVE_PLAYER.status.verified,false);
  assert.match(f.nodes['save-note'].textContent,/Preview/);assert.equal(f.calls.peek,1);assert.equal(f.calls.bootstrap,0);assert.equal(f.calls.resume,0);
  f.c.NATIVE_PLAYER.claimConfirmationPending=true;f.c.nativePlayerRender();assert.equal(f.c.draft(),null);
});
test('cancelled realm and calling choices do not carry into another owner\'s confirmed fresh title',()=>{
  const f=fixture();f.prepare();f.realm(2);f.calling('mage');f.type('Old owner draft');
  f.c.NETWS.acct={id:'replacement'};f.c.nativePlayerRender();assert.equal(f.c.draft(),null);
  f.c.SAVE.loading.owner='replacement';f.c.SAVE.ref={};f.c.GAME.ready=true;f.c.setupTitle(null);
  assert.equal(f.c.view.realm,0);assert.equal(f.c.view.cls,'warrior');
  assert.equal(f.nodes['name-input'].value,'Generated name');assert.equal(f.calls.random,1);
});
for(const mode of['undefined','error','timedout','bound','private','provisional','session','init','owner'])test('anonymous preview fails closed for '+mode,async()=>{
  const f=fixture();if(mode==='error')f.c.peekError=true;await f.anonymous(mode==='undefined'?undefined:mode==='private'?{ownerDid:'kept'}:null);
  if(mode==='timedout')f.c.SAVE.loading.timedOut=true;if(mode==='bound')f.c.NATIVE_PLAYER.status.bound=true;
  if(mode==='provisional')f.c.NATIVE_PLAYER.status.provisional=true;
  if(mode==='session')f.c.NATIVE_PLAYER.provisional={};if(mode==='init')f.c.SAVE.loading={...f.c.SAVE.loading};if(mode==='owner')f.c.NETWS.acct={id:'foreign'};
  assert.equal(f.prepare(),false);assert.equal(f.calls.random,0);assert.equal(f.calls.bootstrap,0);
});
test('late private read retains its original Ready deferral and hydration ordering',()=>{
  const f=fixture();f.c.saveLoadTitle(f.c.SAVE.loading);assert.equal(f.calls.settings,0);assert.equal(f.calls.world,0);assert.equal(f.calls.random,0);
});
test('a real accepted Begin keeps its captured intent through the expected provisional-to-owned transition',async()=>{
  const f=fixture();await f.anonymous(null);f.prepare();f.type('Chosen recruit');f.finish();
  f.c.LORE={begin:null};vm.runInContext(actual('10c_lore.js',['loreRequestBegin','loreCancelBegin','loreConsumeBegin']),f.c);
  f.c.nativePlayerTask=async run=>run();
  f.session.bootstrap=async()=>{f.calls.bootstrap++;f.c.NETWS.acct={id:'accepted-owner'};
    f.c.NATIVE_PLAYER.status={enabled:true,bound:true,verified:true,recordLinks:{}};
    f.c.nativePlayerChanged({state:'owned'});};
  f.c.nativePlayerProvisionalRef=()=>({get:async()=>({exists:true,data:()=>({v:1,char:null})})});
  f.c.validSave=value=>value;let accepted=null;
  f.c.startGame=(request,mayStart)=>{assert.equal(mayStart(),true);accepted={name:request.name,prologue:f.c.loreConsumeBegin(request)};};
  const begin=f.c.nativePlayerBegin;f.c.nativePlayerBegin=request=>f.c.flight=begin(request);
  f.nodes['btn-begin'].onclick();await f.c.flight;
  assert.deepEqual(accepted,{name:'Chosen recruit',prologue:true});assert.equal(f.calls.bootstrap,1);
  assert.equal(f.c.draft(),null);assert.equal(f.c.SAVE.readConfirmed,true);
});
