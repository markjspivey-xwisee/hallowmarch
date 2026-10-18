import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The real controller and directory run in Chromium. Only the fixed directory
// asset's transport factory is supplied by a local fixture. No sign-in, native
// signing, registry mutation, game admission or external request is available.
test('actual companion directory controls keep discovery explicit and authorization scoped', async t => {
  assert(process.env.HM_PLAYWRIGHT_MODULE, 'Set HM_PLAYWRIGHT_MODULE to the installed Playwright index.mjs');
  const { chromium } = await import(process.env.HM_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.HM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.HM_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const root = new URL('../../', import.meta.url), origin = 'https://game.example';
  const controller = await readFile(new URL('src/14w_worldagents.js', root), 'utf8');
  const directory = await readFile(new URL('client/native-pod/agent-directory.mjs', root), 'utf8');
  const vendor = await readFile(new URL('client/native-pod/vendor/interego-browser.mjs', root), 'utf8');
  const owner = 'u-pk-1234567890ab', podUrl = 'https://gate.example/' + owner + '/';
  const ownerDid = 'did:web:identity.example:users:' + owner;
  const browserDid = 'did:web:identity.example:agents:hallowmarch-' + owner;
  const chatgpt = 'did:web:identity.example:agents:chatgpt-' + owner;
  const external = 'did:web:identity.example:agents:independent-agent';
  const webId = 'https://identity.example/users/' + owner + '/profile#me';
  const applicationId = 'did:web:identity.example:users:hallowmarch';
  const entityId = 'owner-1:companion:1647775c-22c7-4a79-8a45-d55cfe101b42';
  const binding = { subjectDid: ownerDid, webId, podUrl, authenticatedAgentDid: browserDid };
  async function pageFixture() {
    const page = await browser.newPage(), errors = [], network = [];
    t.after(() => page.close()); page.on('pageerror', error => errors.push(error.message));
    const html = `<!doctype html><meta charset="utf-8"><div id="world-agent-mount"></div><script type="module">
      const binding=${JSON.stringify(binding)},origin=${JSON.stringify(origin)},browserDid=${JSON.stringify(browserDid)},chatgpt=${JSON.stringify(chatgpt)};
      const webId=${JSON.stringify(webId)},podUrl=${JSON.stringify(podUrl)},applicationId=${JSON.stringify(applicationId)};
      const GAME={started:true,player:{alive:true,cls:'warrior'}},SAVE={native:true,readConfirmed:true,pending:false,nativeFlight:false};
      const NETWS={acct:{id:'owner-1'},token:'PRIVATE_GAME_TOKEN',generation:1,reload:false,state:'on',worldRoom:'march'};
      const UI={modal:'menu',menuTab:'companion'},CLASSES={warrior:{name:'Warrior'}},PARTY_COMPANION={record:{role:'follow'}},ENT=[];
      const party={id:${JSON.stringify(entityId)},name:'Rowan',entity:{alive:true,removed:false,cls:'warrior'}};
      const $=id=>document.getElementById(id),partyCompanionBodies=()=>[party],partyCompanionMember=()=>party,anCompanions=()=>[];
      const partyCompanionStop=()=>{},partyCompanionOwned=entity=>entity===party.entity,netWsSend=()=>true,openPlayerIdentity=()=>{};
      // Suppress only the unrelated 500ms world-frame timer in this controller fixture.
      const setInterval=()=>0;
      const counters={identity:0,modules:0,cacheList:0,cacheGet:0,transport:0,list:0,verify:0,cleared:0,publish:0,register:0};
      const NATIVE_PLAYER={status:{bound:true,verified:true,binding:structuredClone(binding)},cache:{
        async list(){counters.cacheList++;return[{ownerDid:binding.subjectDid,podUrl,relayUrl:'https://relay.example',expiresAt:Date.now()+600000}]},
        async get(){counters.cacheGet++;return{credential:{kind:'relay-oauth-bearer',method:'webauthn',accessToken:'PRIVATE_NATIVE_ACCESS_TOKEN',expiresAt:Date.now()+600000}}}
      }};
      const nativePlayerRequest=async()=>{counters.identity++;return{account:{id:'owner-1'},bound:true,verified:true,binding:structuredClone(binding)}};
      const nativePlayerModules=async()=>{counters.modules++};
      window.__hm={};window.__HM_GAMING={mainWorldAgents:{enabled:true,applicationId,audience:origin,affordances:origin+'/world/native-agents'}};
      const expectedStatus=()=>({pod:podUrl,userId:${JSON.stringify(owner)},identity:{did:binding.subjectDid,webId},sessionAgent:{did:browserDid},agentsSource:'identity-server',
        agents:[{did:browserDid,label:'Hallowmarch browser',surface:'hallowmarch'},{did:chatgpt,label:'ChatGPT',surface:'chatgpt'}],
        delegationRegistry:{owner:webId,url:podUrl+'agents',count:2,rows:[{agentId:browserDid,scope:'ReadWrite'},{agentId:chatgpt,scope:'ReadOnly'}]}});
      const expectedVerdict=did=>({subjectPodUrl:podUrl,subject_pod_url:podUrl,subject_pod_name:${JSON.stringify(owner)},subject_pod_selected_by:'pod_url',
        owner:webId,agent:did,valid:true,verified:true,trustLevel:'CryptographicallyVerified',chainLength:1,scope:'ReadOnly',
        delegationChain:{owner:webId,agent:did,anchored:true,length:1,scope:'ReadOnly'},
        signing:{credentialAgentId:did,relayAnchor:'0x'+'1'.repeat(40),credentialAnchor:'0x'+'1'.repeat(40),canSignDelegatedRequests:true},
        enforcement:{enforced:true,scope:'ReadOnly',basis:'signed-chain',writeEligible:false}});
      Object.defineProperty(navigator,'clipboard',{value:{async writeText(text){if(window.fixture.blockClipboard)throw Error('fixture clipboard blocked');window.fixture.copied=text}}});
      ${controller}
      const fixture=window.fixture={counters,net:NETWS,native:NATIVE_PLAYER,state:MAIN_WORLD_AGENTS,events:[],copied:'',hold:false,waiting:false,badVerdict:false,
        transport(){counters.transport++;return{async connect(required){if(required.join(',')!=='get_pod_status,verify_agent')throw Error('unexpected capability');return{granted:required}},
          async callTool(name,args){fixture.events.push(name);if(name==='get_pod_status'){counters.list++;if(fixture.hold){fixture.hold=false;fixture.waiting=true;await new Promise(resolve=>fixture.release=resolve)}return expectedStatus()}
            if(name==='verify_agent'){counters.verify++;if(args.agent_id!==chatgpt||args.pod_url!==podUrl)throw Error('unexpected verifier target');const result=expectedVerdict(args.agent_id);if(fixture.badVerdict)result.verified=false;return result}
            throw Error('write or unexpected native operation refused')},setCredential(value){if(value.accessToken!=='')throw Error('credential not cleared');counters.cleared++}}},
        async publish(){return mainWorldAgentPublish({current(){if(NETWS.token!=='PRIVATE_GAME_TOKEN'||NETWS.generation!==1)throw Error('fixture owner changed')},client:{
          async publish(value){counters.publish++;fixture.events.push('publish');fixture.published=structuredClone(value);const record=[...MAIN_WORLD_AGENTS.records.values()].at(-1);return{saved:false,operationId:'fixture-pending',reference:record.reference}}
        }})},
        addConfirmed(){const grantId='urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';MAIN_WORLD_AGENTS.records.set(grantId,{registered:true,reference:{grantId},grant:{
          actor:chatgpt,applicationId,audience:origin,roomId:'march',entityId:party.id,role:'teammate',actions:['observe','move','attack'],revoked:false,expiresAt:new Date(Date.now()+600000).toISOString()}});mainWorldAgentRender()},
        render:mainWorldAgentRender,
      };
      MAIN_WORLD_AGENTS.lastGeneration=1;mainWorldAgentRender();window.fixtureReady=true;
    </script>`;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()); network.push(url.href);
      assert.equal(url.origin, origin, 'fixture may not contact any external service'); assert.equal(route.request().method(), 'GET');
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (url.pathname === '/gaming/identity/assets/agent-directory.mjs') return route.fulfill({ contentType: 'text/javascript', body:
        `import {createOwnerAgentDirectory as actual} from '/fixture/agent-directory.mjs';export const createOwnerAgentDirectory=options=>actual({...options,createTransport:(...args)=>window.fixture.transport(...args)});` });
      if (url.pathname === '/fixture/agent-directory.mjs') return route.fulfill({ contentType: 'text/javascript', body: directory });
      if (url.pathname === '/fixture/vendor/interego-browser.mjs') return route.fulfill({ contentType: 'text/javascript', body: vendor });
      assert.fail('Unexpected fixture request: ' + url.pathname);
    });
    await page.goto(origin); await page.waitForFunction(() => window.fixtureReady);
    await page.locator('#world-agent-advanced > summary').click();
    const find = async () => {
      await page.locator('#world-agent-find').click();
      await page.waitForFunction(() => !window.fixture.state.busy);
    };
    return { page, errors, network, find };
  }

  await t.test('opening controls is inert; explicit Find lists agents without selecting or authorizing one', async () => {
    const f = await pageFixture();
    assert.deepEqual(await f.page.evaluate(() => fixture.counters), { identity: 0, modules: 0, cacheList: 0, cacheGet: 0, transport: 0, list: 0, verify: 0, cleared: 0, publish: 0, register: 0 });
    await f.find();
    assert.deepEqual(await f.page.locator('#world-agent-choice option').evaluateAll(options => options.map(option => option.value)), ['', chatgpt, 'manual']);
    assert.equal(await f.page.locator('#world-agent-choice').inputValue(), '');
    assert.equal(await f.page.locator('#world-agent-did').inputValue(), '');
    const counts = await f.page.evaluate(() => fixture.counters);
    assert.equal(counts.list, 1); assert.equal(counts.verify, 0); assert.equal(counts.publish, 0);
    assert.equal((await f.page.locator('#world-agent-choice').textContent()).includes(browserDid), false);
    assert.deepEqual(f.errors, []);
  });

  await t.test('registered choice is freshly verified before the actual publish function can run', async () => {
    const f = await pageFixture(); await f.find();
    await f.page.locator('#world-agent-choice').selectOption(chatgpt); await f.page.locator('#world-agent-public').check();
    await f.page.evaluate(() => fixture.publish());
    const result = await f.page.evaluate(() => ({ events: fixture.events, published: fixture.published, counts: fixture.counters }));
    assert.deepEqual(result.events, ['get_pod_status', 'get_pod_status', 'verify_agent', 'get_pod_status', 'publish']);
    assert.equal(result.published.actor, chatgpt); assert.equal(result.published.publicDisclosureAccepted, true);
    assert.equal(result.published.lifetimeMs, 900000); assert.equal(result.counts.verify, 1); assert.equal(result.counts.publish, 1);
    assert.deepEqual(f.errors, []);
  });

  await t.test('failed registered verification cannot publish or fall back to the manual field', async () => {
    const f = await pageFixture(); await f.find();
    await f.page.locator('#world-agent-choice').selectOption(chatgpt); await f.page.locator('#world-agent-public').check();
    const refused = await f.page.evaluate(async external => { fixture.badVerdict=true;document.getElementById('world-agent-did').value=external;
      try{await fixture.publish();return false}catch{return true} }, external);
    assert.equal(refused, true); assert.equal(await f.page.evaluate(() => fixture.counters.publish), 0);
    assert.deepEqual(f.errors, []);
  });

  for (const changed of ['token', 'generation', 'subjectDid', 'podUrl', 'webId', 'authenticatedAgentDid']) {
    await t.test('a changed ' + changed + ' fences an in-flight directory read', async () => {
      const f = await pageFixture(); await f.page.evaluate(() => { fixture.hold=true; });
      await f.page.locator('#world-agent-find').click(); await f.page.waitForFunction(() => window.fixture.waiting);
      await f.page.evaluate(changed => { if(changed==='token')fixture.net.token='DIFFERENT_TOKEN';else if(changed==='generation')fixture.net.generation++;
        else fixture.native.status.binding[changed]+='-changed';fixture.release(); }, changed);
      await f.page.waitForFunction(() => !window.fixture.state.busy);
      assert.equal(await f.page.locator('#world-agent-choice').inputValue(), '');
      assert.equal(await f.page.locator('#world-agent-choice option').count(), 2);
      assert.equal(await f.page.evaluate(() => fixture.counters.publish), 0);
      assert.equal(await f.page.evaluate(() => fixture.counters.cleared), 1);
      assert.deepEqual(f.errors, []);
    });
  }

  await t.test('advanced manual identity stays explicit and does not pretend to verify an external agent', async () => {
    const f = await pageFixture();
    await f.page.locator('#world-agent-choice').selectOption('manual');
    await f.page.locator('#world-agent-did').fill(external); await f.page.locator('#world-agent-public').check();
    await f.page.evaluate(() => fixture.publish());
    const result = await f.page.evaluate(() => ({ actor: fixture.published.actor, counters: fixture.counters }));
    assert.equal(result.actor, external); assert.equal(result.counters.list, 0); assert.equal(result.counters.verify, 0);
    assert.equal(result.counters.publish, 1); assert.deepEqual(f.errors, []);
  });

  await t.test('manual entry of this game browser signer is refused before publication', async () => {
    const f = await pageFixture();
    await f.page.locator('#world-agent-choice').selectOption('manual');
    await f.page.locator('#world-agent-did').fill(browserDid); await f.page.locator('#world-agent-public').check();
    const refusal = await f.page.evaluate(async () => {
      try { await fixture.publish(); return null; } catch (error) { return error.message; }
    });
    assert.equal(refusal, 'Use your AI app’s agent identity, not this game browser’s identity.');
    const counts = await f.page.evaluate(() => fixture.counters);
    assert.equal(counts.publish, 0); assert.equal(counts.verify, 0); assert.equal(counts.list, 0);
    assert.equal(await f.page.evaluate(() => fixture.state.records.size), 0);
    assert.deepEqual(f.errors, []);
  });

  await t.test('copy controls contain only a static identity request or the confirmed public grant fields', async () => {
    const f = await pageFixture(); await f.page.locator('#world-agent-choice').selectOption('manual');
    await f.page.locator('#world-agent-copy-identity').click();
    let copied = await f.page.evaluate(() => fixture.copied);
    assert.ok(copied.includes('sessionAgent.did') && copied.includes('Do not register'));
    assert.equal(copied.includes('PRIVATE_'), false); assert.equal(await f.page.evaluate(() => fixture.counters.identity), 0);
    await f.page.evaluate(() => fixture.addConfirmed());
    await f.page.getByRole('button', { name: 'Copy setup instructions for my agent', exact: true }).click();
    copied = await f.page.evaluate(() => fixture.copied);
    const connection = JSON.parse(copied.slice(copied.indexOf('{')));
    assert.deepEqual(Object.keys(connection).sort(), ['origin','applicationId','agentDid','grantId','roomId','entityId','module'].sort());
    assert.equal(connection.agentDid, chatgpt); assert.equal(connection.entityId, entityId); assert.equal(copied.includes('PRIVATE_'), false);
    assert.deepEqual(f.errors, []);
  });

  await t.test('a blocked clipboard opens the actual fallback and selects only public setup text', async () => {
    const f = await pageFixture(); await f.page.evaluate(() => { fixture.blockClipboard=true;fixture.addConfirmed(); });
    await f.page.getByRole('button', { name: 'Copy setup instructions for my agent', exact: true }).click();
    const fallback = await f.page.locator('#world-agent-records textarea').evaluate(field => ({ text: field.value,
      expanded: field.closest('details').open, visible: !field.hidden && field.getClientRects().length > 0,
      focused: document.activeElement === field, selected: field.selectionStart === 0 && field.selectionEnd === field.value.length }));
    assert.ok(fallback.expanded && fallback.visible && fallback.focused && fallback.selected);
    assert.ok(fallback.text.includes('Use your own Interego signing identity')); assert.equal(fallback.text.includes('PRIVATE_'), false);
    assert.deepEqual(f.errors, []);
  });
});
