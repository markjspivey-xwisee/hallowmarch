/** Actual Companion renderer with synthetic owners, bodies and records only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const read = name => readFile(new URL('../../' + name, import.meta.url), 'utf8');
const [source, shell] = await Promise.all([read('src/14w_worldagents.js'), read('src/page.html')]);
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url))));
const styles = shell.match(/<style>([\s\S]*?)<\/style>/)[1];
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined }); });
test.after(async () => { await browser?.close(); });
async function fixture(t, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } }); t.after(() => page.close());
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>
    <div id="menu" class="overlay"><div class="sheet"><div id="menu-body"><div id="world-agent-mount"></div></div></div></div>`);
  await page.addScriptTag({ content: `
    window.__HM_GAMING={mainWorldAgents:{enabled:true,applicationId:'urn:fixture:game',audience:location.origin,affordances:location.origin+'/world/native-agents'}};
    window.__hm={};const GAME={started:true,player:{alive:true}},NETWS={acct:{id:'fixture-account'},token:'fixture-only-token',state:'on',worldRoom:'march',generation:1},UI={modal:'menu',menuTab:'companion'};
    const binding={subjectDid:'did:example:fixture-owner',podUrl:'https://pod.invalid/fixture-owner/'};
    const NATIVE_PLAYER={status:{bound:true,verified:true,binding}},SAVE={native:true,readConfirmed:true,ref:{}},$=id=>document.getElementById(id),anCompanions=()=>[];
    const calls={identity:0,publish:0,context:0,load:0,save:0,dismiss:0,revoke:[]};
    const openPlayerIdentity=()=>calls.identity++,CLASSES={warrior:{name:'Warrior'}},PARTY_COMPANION={record:{role:'follow'}};
    const originalParty={id:'fixture-account:companion:one',name:'Rowan',entity:{alive:true,cls:'warrior',removed:false,hp:100,maxHp:100}};
    let party=originalParty;const history=[{kind:'earned-fixture-history',value:17}];
    const partyCompanionMember=()=>party,partyCompanionBodies=()=>party&&!party.entity.removed?[party]:[],partyCompanionStop=()=>{},partyCompanionOwned=()=>true;
    const partyCompanionDismiss=()=>{calls.dismiss++;party=null},saveNow=async()=>calls.save++;
    const ENT=[],netWsSend=()=>true;window.setInterval=()=>0;
    window.fetch=()=>{throw Error('External requests are forbidden')};
  ` });
  await page.addScriptTag({ content: source });
  await page.addScriptTag({ content: `
    const record={registered:true,reference:{grantId:'urn:uuid:fixture-one'},grant:{actor:'did:example:fixture-agent',applicationId:'urn:fixture:game',audience:location.origin,roomId:'march',entityId:originalParty.id,role:'teammate',revoked:false,expiresAt:new Date(Date.now()+600000).toISOString()}};
    const actualContext=mainWorldAgentContext,actualLoad=mainWorldAgentLoad,actualRevoke=mainWorldAgentRevoke;
    window.companionFixture={calls,history,set(kind){party=kind==='absent'?null:originalParty;originalParty.entity.alive=true;
      MAIN_WORLD_AGENTS.records.clear();MAIN_WORLD_AGENTS.allowed.clear();MAIN_WORLD_AGENTS.dismissConfirm=null;MAIN_WORLD_AGENTS.needsIdentity=false;
      MAIN_WORLD_AGENTS.paused=true;MAIN_WORLD_AGENTS.companionPaused=true;MAIN_WORLD_AGENTS.note='';MAIN_WORLD_AGENTS.busy=false;
      NETWS.acct={id:'fixture-account'};NETWS.state='on';NETWS.reload=false;NETWS.worldPauseReason='';NATIVE_PLAYER.status.verified=true;
      if(['active','paused','disconnected','pending'].includes(kind))MAIN_WORLD_AGENTS.records.set(record.reference.grantId,structuredClone(record));
      if(['active','disconnected'].includes(kind)){MAIN_WORLD_AGENTS.paused=false;MAIN_WORLD_AGENTS.companionPaused=false;MAIN_WORLD_AGENTS.allowed.add(originalParty.id)}
      if(kind==='builtin'){MAIN_WORLD_AGENTS.companionPaused=false}
      if(kind==='disconnected')NETWS.state='off';if(kind==='recovery')NETWS.worldPauseReason='Fixture world recovery';
      if(kind==='pending')MAIN_WORLD_AGENTS.records.get(record.reference.grantId).phase='register';
      if(kind==='signed-out')NATIVE_PLAYER.status.verified=false;
      mainWorldAgentRender()},render:mainWorldAgentRender,
      mockContext(){mainWorldAgentContext=async()=>{calls.context++;return{current(){},request:async()=>{throw Error('No requests permitted')}}};
        mainWorldAgentLoad=async()=>{calls.load++};mainWorldAgentRevoke=async(context,record)=>{calls.revoke.push(record.reference.grantId);record.grant.revoked=true}},
      replaceBody(){party={...originalParty,entity:{...originalParty.entity}}},
      snapshot(){return{party:party&&party.id,history:structuredClone(history),records:[...MAIN_WORLD_AGENTS.records.values()].map(record=>structuredClone(record)),calls:structuredClone(calls),publicChoice:$('world-agent-public').checked}}};
    companionFixture.set('paused');
  ` });
  return { page, errors, requests };
}
async function primary(page, label) {
  assert.equal(await page.locator('#world-agent-controls button.primary:visible').count(), 1);
  assert.equal(await page.locator('#world-agent-controls button.primary:visible').innerText(), label);
}
for (const width of [320, 390, 1280]) test(`Companion has a contextual action for absent, active, paused and pending states at ${width}px`, async t => {
  const { page, errors, requests } = await fixture(t, width);
  for (const [state, label] of [['absent','Add companion'],['active','Pause immediately'],['paused','Resume companion'],['pending','Confirm pending change'],['builtin','Pause immediately'],['signed-out','Open identity settings']]) {
    await page.evaluate(state => companionFixture.set(state), state); await primary(page, label);
    if (state === 'active' || state === 'builtin') assert(await page.locator('#world-agent-resume').isHidden());
    if (state === 'paused' || state === 'absent') assert(await page.locator('#world-agent-pause').isHidden());
    assert(await page.locator('#world-agent-dismiss-confirm').isHidden());
    assert.equal(await page.locator('#world-agent-options').evaluate(node => node.open), false);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  assert.deepEqual(await page.evaluate(() => companionFixture.calls), { identity:0,publish:0,context:0,load:0,save:0,dismiss:0,revoke:[] });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
});
test('an interrupted connection cannot claim Ready or resume control, and offers an explicit Players handoff', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.evaluate(() => companionFixture.set('disconnected')); await primary(page, 'Open Players');
  assert(await page.locator('#world-agent-resume').isDisabled());
  const before = await page.evaluate(() => ({paused:MAIN_WORLD_AGENTS.paused,companionPaused:MAIN_WORLD_AGENTS.companionPaused,allowed:[...MAIN_WORLD_AGENTS.allowed]}));
  await page.evaluate(() => document.getElementById('world-agent-resume').onclick());
  assert.match(await page.locator('#world-agent-note').innerText(), /connection is interrupted/);
  assert.doesNotMatch(await page.locator('#world-agent-note').innerText(), /Ready|resume agent access/);
  assert.deepEqual(await page.evaluate(() => ({paused:MAIN_WORLD_AGENTS.paused,companionPaused:MAIN_WORLD_AGENTS.companionPaused,allowed:[...MAIN_WORLD_AGENTS.allowed]})), before);
  await page.locator('#world-agent-identity').click(); assert.equal(await page.evaluate(() => companionFixture.calls.identity), 1);
  await page.evaluate(() => { companionFixture.set('recovery'); document.getElementById('world-agent-resume').onclick(); });
  assert(await page.locator('#world-agent-resume').isDisabled());
  assert.match(await page.locator('#world-agent-note').innerText(), /World recovery is in progress/);
  assert.doesNotMatch(await page.locator('#world-agent-note').innerText(), /Ready/);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
test('a typed pod-access error exposes identity recovery and an explicit read-only retry without creating access', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.evaluate(async () => {
    companionFixture.set('active');
    mainWorldAgentContext=async()=>{throw Object.assign(new Error('Reconnect your identity to access your pod.'),{code:'needs_reauth'})};
    await mainWorldAgentRun(()=>{calls.publish++});
  });
  await primary(page, 'Open identity settings');
  assert(await page.locator('#world-agent-prerequisite').isVisible());
  assert(await page.locator('#world-agent-retry-identity').isVisible());
  assert(await page.evaluate(()=>MAIN_WORLD_AGENTS.paused&&MAIN_WORLD_AGENTS.companionPaused), 'identity failure stops existing control until an explicit resume');
  assert.match(await page.locator('#world-agent-prerequisite-note').innerText(), /then choose Retry companion connection/);
  await page.locator('#world-agent-identity').click(); assert.equal(await page.evaluate(() => companionFixture.calls.identity), 1);
  await page.evaluate(() => companionFixture.mockContext());
  await page.locator('#world-agent-retry-identity').click(); await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy);
  await primary(page, 'Resume companion');
  assert(await page.locator('#world-agent-prerequisite').isHidden());
  assert.equal(await page.evaluate(() => MAIN_WORLD_AGENTS.needsIdentity), false);
  assert.deepEqual(await page.evaluate(() => ({publish:calls.publish,save:calls.save,dismiss:calls.dismiss,load:calls.load})), {publish:0,save:0,dismiss:0,load:1});
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
test('review and cancel dismissal have no record, permission, history or save side effects', async t => {
  const { page, errors, requests } = await fixture(t);
  const before=await page.evaluate(()=>companionFixture.snapshot());
  await page.locator('#world-agent-options > summary').click();
  await page.locator('#world-agent-dismiss').click();
  await primary(page, 'Dismiss companion and revoke its access');
  assert.equal(await page.evaluate(()=>document.activeElement.id), 'world-agent-dismiss-cancel');
  assert.match(await page.locator('#world-agent-dismiss-warning').innerText(), /Rowan.*revokes its current agent access.*earned progress and past activity records stay intact/);
  assert.deepEqual(await page.evaluate(()=>companionFixture.snapshot()), before);
  await page.locator('#world-agent-dismiss-cancel').click();
  assert(await page.locator('#world-agent-dismiss-confirm').isHidden());
  assert.deepEqual(await page.evaluate(()=>companionFixture.snapshot()), before);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
test('explicit dismissal revokes only the selected synthetic companion access and retains all history and unrelated permissions', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.evaluate(()=>{
    companionFixture.mockContext();
    const other=structuredClone([...MAIN_WORLD_AGENTS.records.values()][0]);other.reference.grantId='urn:uuid:unrelated-fixture';other.grant.entityId='fixture-account:animal:other';MAIN_WORLD_AGENTS.records.set(other.reference.grantId,other);mainWorldAgentRender();
  });
  const before=await page.evaluate(()=>companionFixture.snapshot());
  await page.locator('#world-agent-options > summary').click(); await page.locator('#world-agent-dismiss').click();
  await page.locator('#world-agent-dismiss-confirm-button').click(); await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy);
  const after=await page.evaluate(()=>companionFixture.snapshot());
  assert.equal(after.party,null);assert.equal(after.calls.dismiss,1);assert.equal(after.calls.save,1);
  assert.deepEqual(after.calls.revoke,['urn:uuid:fixture-one']);assert.deepEqual(after.history,before.history);
  assert.equal(after.records.length,2,'revocation retains the existing reference/history instead of erasing it');
  assert.deepEqual(after.records.find(record=>record.reference.grantId==='urn:uuid:unrelated-fixture'),before.records.find(record=>record.reference.grantId==='urn:uuid:unrelated-fixture'));
  assert.equal(after.publicChoice,false);assert.equal(after.calls.publish,0);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
test('a stale dismissal cannot remove a replacement body or a different account’s companion', async t => {
  const { page, errors, requests } = await fixture(t);
  for(const change of ['body','owner']){
    await page.evaluate(()=>companionFixture.set('paused'));
    await page.locator('#world-agent-options').evaluate(node=>{node.open=true});
    assert(await page.locator('#world-agent-dismiss').isVisible(), JSON.stringify(await page.evaluate(()=>({optionsOpen:$('world-agent-options').open,optionsHidden:$('world-agent-options').hidden,reviewHidden:$('world-agent-dismiss').hidden,confirm:!!MAIN_WORLD_AGENTS.dismissConfirm,party:!!party,modal:UI.modal}))));
    await page.locator('#world-agent-dismiss').click();
    await page.evaluate(change=>{
      const confirm=document.getElementById('world-agent-dismiss-confirm-button').onclick;
      if(change==='body')companionFixture.replaceBody();else NETWS.acct={id:'different-fixture-account'};
      confirm();
    },change);
    assert.equal(await page.evaluate(()=>companionFixture.calls.context),0);
    assert.equal(await page.evaluate(()=>companionFixture.calls.dismiss),0);
    assert(await page.locator('#world-agent-dismiss-confirm').isHidden());
  }
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
test('an owner change while dismissal is waiting for its context cannot revoke access or remove a body', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.evaluate(()=>{
    companionFixture.mockContext();
    mainWorldAgentContext=()=>{calls.context++;return new Promise(resolve=>{window.releaseDismiss=()=>resolve({current(){}})})};
  });
  await page.locator('#world-agent-options > summary').click(); await page.locator('#world-agent-dismiss').click();
  await page.locator('#world-agent-dismiss-confirm-button').click(); await page.waitForFunction(()=>MAIN_WORLD_AGENTS.busy);
  await page.evaluate(()=>{NETWS.acct={id:'different-fixture-account'};releaseDismiss()});
  await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy);
  assert.deepEqual(await page.evaluate(()=>({load:calls.load,save:calls.save,dismiss:calls.dismiss,revoke:calls.revoke})),{load:0,save:0,dismiss:0,revoke:[]});
  assert(await page.locator('#world-agent-dismiss-confirm').isHidden());
  assert.match(await page.locator('#world-agent-note').innerText(),/companion or owner changed/);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});
test('Revoke context reauthentication failure keeps its disclosure open and moves focus to explicit identity recovery', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.locator('#world-agent-records summary').click();
  await page.evaluate(()=>{mainWorldAgentContext=async()=>{throw Object.assign(new Error('Reconnect to your pod.'),{code:'needs_reauth'})}});
  await page.getByRole('button',{name:'Revoke access',exact:true}).focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy&&MAIN_WORLD_AGENTS.needsIdentity);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'world-agent-identity');
  assert(await page.locator('#world-agent-records details').evaluate(node=>node.open));
  assert.deepEqual(await page.evaluate(()=>calls.revoke),[]);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
test('busy Revoke retains its node, focuses status before disabling and restores the exact action after a retryable failure', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.locator('#world-agent-records summary').click();
  await page.evaluate(()=>{
    window.originalRevoke=document.querySelector('[data-world-agent-action="revoke"]');
    mainWorldAgentContext=()=>new Promise((resolve,reject)=>{window.finishRevoke=()=>reject(new Error('Fixture connection unavailable'))});
  });
  await page.getByRole('button',{name:'Revoke access',exact:true}).click();await page.waitForFunction(()=>MAIN_WORLD_AGENTS.busy);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'world-agent-note');
  assert(await page.evaluate(()=>originalRevoke.isConnected&&originalRevoke.disabled));
  assert.match(await page.locator('#world-agent-note').innerText(),/Confirming companion access/);
  await page.evaluate(()=>finishRevoke());await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy);
  assert(await page.evaluate(()=>document.activeElement===originalRevoke));
  assert(await page.locator('#world-agent-records details').evaluate(node=>node.open));
  assert.deepEqual(await page.evaluate(()=>calls.revoke),[]);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
test('finishing an async Revoke never takes focus back after the player navigates elsewhere', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.evaluate(()=>{mainWorldAgentContext=()=>new Promise((resolve,reject)=>{window.finishRevoke=()=>reject(Object.assign(new Error('Sign in again'),{code:'needs_reauth'}))})});
  await page.getByRole('button',{name:'Revoke access',exact:true}).click();await page.waitForFunction(()=>MAIN_WORLD_AGENTS.busy);
  await page.locator('#world-agent-advanced > summary').focus();
  await page.evaluate(()=>finishRevoke());await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy);
  assert(await page.locator('#world-agent-advanced > summary').evaluate(node=>document.activeElement===node));
  assert.deepEqual(await page.evaluate(()=>calls.revoke),[]);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
test('record content, pending and confirmation redraws retain only the exact grant disclosure and safe semantic focus', async t => {
  const { page, errors, requests } = await fixture(t);
  await page.locator('#world-agent-records summary').click();
  await page.locator('#world-agent-records summary').focus();
  await page.evaluate(()=>{[...MAIN_WORLD_AGENTS.records.values()][0].lastCommandAt=Date.now();mainWorldAgentRender()});
  assert(await page.locator('#world-agent-records details').evaluate(node=>node.open));
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.worldAgentAction),'details');
  await page.evaluate(()=>{[...MAIN_WORLD_AGENTS.records.values()][0].phase='register';mainWorldAgentRender()});
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.worldAgentAction),'status','missing details must not retarget to Confirm');
  await page.evaluate(()=>{[...MAIN_WORLD_AGENTS.records.values()][0].phase='';mainWorldAgentRender()});
  assert(await page.locator('#world-agent-records details').evaluate(node=>node.open),'successful confirmation restores the explicitly opened disclosure');
  await page.evaluate(()=>{
    companionFixture.mockContext();
    mainWorldAgentRevoke=async(context,record)=>{calls.revoke.push(record.reference.grantId);record.phase='stop';mainWorldAgentRender();record.phase='';record.grant.revoked=true};
  });
  await page.getByRole('button',{name:'Revoke access',exact:true}).click();await page.waitForFunction(()=>!MAIN_WORLD_AGENTS.busy);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.worldAgentAction),'status');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-world-agent-grant]').dataset.worldAgentGrant),'urn:uuid:fixture-one');
  assert.match(await page.locator('#world-agent-records').innerText(),/Access revoked/);
  assert.deepEqual(await page.evaluate(()=>calls.revoke),['urn:uuid:fixture-one']);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
test('owner, body and grant changes never restore focus or an open disclosure to an unrelated action', async t => {
  const { page, errors, requests } = await fixture(t);
  for(const change of ['owner','body','grant']){
    await page.evaluate(()=>companionFixture.set('paused'));
    await page.locator('#world-agent-records summary').click();
    await page.getByRole('button',{name:'Revoke access',exact:true}).focus();
    await page.evaluate(change=>{
      if(change==='owner')NETWS.acct={id:'different-fixture-account'};
      else if(change==='body')companionFixture.replaceBody();
      else{
        const other=structuredClone([...MAIN_WORLD_AGENTS.records.values()][0]);other.reference.grantId='urn:uuid:different-fixture-grant';other.grant.actor='did:example:different-fixture-agent';
        MAIN_WORLD_AGENTS.records.clear();MAIN_WORLD_AGENTS.records.set(other.reference.grantId,other);
      }
      mainWorldAgentRender();
    },change);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'world-agent-note',change);
    assert(await page.locator('#world-agent-records details').evaluate(node=>!node.open));
  }
  assert.deepEqual(await page.evaluate(()=>calls.revoke),[]);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
