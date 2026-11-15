/** Real Progress/dashboard DOM with synthetic character state and no services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';
const read = name => readFile(new URL('../../' + name, import.meta.url), 'utf8');
const [consulting, dashboard, learning, renderer] = await Promise.all([
  read('src/14x_consulting.js'), read('src/14y_activitydashboard.js'), read('src/14z_learningdelivery.js'), read('client/native-pod/activity-dashboard.mjs')]);
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] }); });
test.after(async () => { await browser?.close(); });
async function fixture(t, width) {
  const page = await browser.newPage({ viewport: { width, height: 850 } }); t.after(() => page.close());
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;padding:12px;font:16px/1.5 system-ui;background:#111920;color:#eee4d0}
    main{max-width:850px;margin:auto;min-width:0}h2,h3,h4,p{margin:0 0 10px}button{font:inherit}
    .btn{padding:10px 14px;min-height:44px;border:1px solid #9a8457;border-radius:7px;color:#eee4d0;background:#26323b;cursor:pointer}
    .btn.primary{background:#8a6c38;color:#fff7db;font-weight:700}details{padding:10px 0;border-top:1px solid #786746}
    [hidden]{display:none!important}pre{overflow:auto;max-width:100%}progress{max-width:100%}
  </style><main><div id="march-coach-mount"></div></main>`);
  await page.addScriptTag({ type: 'module', content: renderer + '\nwindow.__dashboardModule={mountActivityDashboard};' });
  await page.waitForFunction(() => window.__dashboardModule);
  await page.addScriptTag({ content: `
    window.__calls={path:[],identity:0,network:0,saves:0}; window.__hm={};
    window.UI={modal:'menu',menuTab:'progress'};window.LORE={chronSec:'path'};
    window.GAME={started:true,t:1,player:{name:'Fixture adventurer',alive:true}};
    window.SAVE={native:false,readConfirmed:false};window.NETWS={acct:{id:'fixture-character'},generation:1};
    window.NET={party:''};window.NATIVE_PLAYER={status:{verified:false,bound:false,binding:null}};
    window.__scope={identity:'fixture',native:false,ownerDid:'urn:local:fixture',characterId:'fixture-character',body:GAME.player};
    window.__snapshot={available:true,revision:1,eventCount:3,current:{id:'gather-one',title:'Collect a resource',desiredResult:'Collect goods nearby.',observedResult:'0 / 1 observed',
      interventions:[{id:'gather-field-guide',title:'Find materials nearby',note:'Check a ripe plant.'},{id:'craft-reference',title:'Open the crafting book',note:'Check the recipe.'},
        {id:'third',title:'A third useful support',note:'Still available under more help.'}]},milestones:[],history:{recent:[]},summary:{counters:{},bodyObservations:[]}};
    window.GAME_ACTIVITY={scope:__scope,module:null,profile:{save:()=>({recent:[]}),snapshot:()=>structuredClone(__snapshot)}};
    window.__hm.activity={snapshot:()=>structuredClone(__snapshot),resource:id=>({id,title:id,destination:'guide:gathering'}),interventionStart:()=>{},trajectory:()=>null};
    window.activityScope=()=>__scope;window.activityCurrent=held=>held===__scope;
    window.registerSavePart=()=>{};window.chronAdd=()=>{};window.setInterval=()=>0;
    window.openChronicle=section=>__calls.path.push(section);window.openPlayerIdentity=()=>__calls.identity++;
    window.uiToast=()=>{};window.$=id=>document.getElementById(id);
    window.nativePlayerRequest=()=>{__calls.network++;throw Error('No network allowed');};window.saveNow=()=>{__calls.saves++;throw Error('No writes allowed');};
    window.nativePlayerModules=()=>{__calls.network++;throw Error('No network allowed');};
  ` });
  await page.addScriptTag({ content: consulting });
  await page.addScriptTag({ content: dashboard.replace("import('/gaming/identity/assets/activity-dashboard.mjs')", 'Promise.resolve(window.__dashboardModule)') });
  await page.addScriptTag({ content: learning });
  await page.evaluate(() => marchConsultingRender());
  return { page, requests, errors };
}
for (const width of [320, 390, 1280]) test(`Progress has one main action and read-only history navigation at ${width}px`, async t => {
  const { page, requests, errors } = await fixture(t, width);
  assert.equal(await page.locator('.btn.primary:visible').count(), 1);
  assert.equal(await page.locator('.btn.primary:visible').innerText(), 'View objectives');
  assert.equal(await page.getByRole('button', { name: 'View objectives', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Next practice milestone', exact: true }).count(), 1);
  assert.match(await page.locator('#march-coach-milestones').innerText(), /View objectives opens your guided objective list in the Chronicle/);
  assert.equal(await page.locator('#march-progress-optional').evaluate(node => node.open), false);
  if (process.env.HM_PROGRESS_QA_OUT) { await mkdir(process.env.HM_PROGRESS_QA_OUT, { recursive: true }); await page.screenshot({ path: resolve(process.env.HM_PROGRESS_QA_OUT, 'progress-default-' + width + '.png'), fullPage: true }); }
  await page.getByRole('button', { name: 'View activity history', exact: true }).click();
  await page.getByRole('heading', { name: 'Your activity', exact: true }).waitFor();
  assert.equal(await page.locator('#march-consulting').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Back to Progress', exact: true }).count(), 1);
  await page.evaluate(() => { window.__firstDashboardView = ACTIVITY_DASHBOARD_UI.view; });
  await page.evaluate(() => window.__hm.activityDashboard.open());
  assert.equal(await page.locator('#march-activity-dashboard').isVisible(), true, 'open is idempotent');
  assert.equal(await page.locator('[data-hm-activity-dashboard]').count(), 1);
  assert.equal(await page.evaluate(() => __firstDashboardView === ACTIVITY_DASHBOARD_UI.view), true);
  await page.getByRole('button', { name: 'Back to Progress', exact: true }).click();
  assert.equal(await page.locator('#march-consulting').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'march-activity-open');
  await page.locator('#march-progress-optional > summary').click();
  assert.equal(await page.getByRole('button', { name: 'Open identity settings', exact: true }).isVisible(), true);
  assert.equal(await page.locator('#march-progress-options').isVisible(), false);
  await page.getByRole('button', { name: 'View objectives', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => __calls), { path: ['path'], identity: 0, network: 0, saves: 0 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const smallTargets = await page.locator('button:visible, summary:visible').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent));
  assert.deepEqual(smallTargets, []);
  if (process.env.HM_PROGRESS_QA_OUT) { await mkdir(process.env.HM_PROGRESS_QA_OUT, { recursive: true }); await page.screenshot({ path: resolve(process.env.HM_PROGRESS_QA_OUT, 'progress-' + width + '.png'), fullPage: true }); }
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});

test('busy guidance does not disable local navigation and pending recording has one reachable recovery action', async t => {
  const { page, requests, errors } = await fixture(t, 320);
  await page.evaluate(() => {
    SAVE.native=true;SAVE.readConfirmed=true;NATIVE_PLAYER.status={verified:true,bound:true,binding:{subjectDid:'did:example:fixture'}};
    __scope.native=true;__scope.ownerDid='did:example:fixture';
    MARCH_CONSULTING.busy=true;MARCH_CONSULTING.enabled=true;
    document.getElementById('march-progress-optional').open=true;marchConsultingRender();
  });
  assert.equal(await page.locator('#march-progress-path').isEnabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Find materials nearby', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('#march-consulting-request').isEnabled(), false);
  await page.evaluate(() => {
    MARCH_CONSULTING.busy=false;MARCH_CONSULTING.enabled=false;
    MARCH_LEARNING.stored={schema:'hallowmarch.gameplay-learning-delivery/v1',ownerDid:'did:example:fixture',characterId:'fixture-character',throughOrdinal:0,
      acknowledgedCount:0,closedUnconfirmedCount:0,pending:{events:[{id:'fixture'}]}};
    marchConsultingRender();
  });
  assert.match(await page.locator('#march-progress-optional > summary').innerText(), /needs attention/);
  assert.equal(await page.locator('#march-learning-check').isVisible(), true);
  assert.equal(await page.locator('#march-learning-enable').isEnabled(), false);
  await page.getByRole('button', { name: 'View activity history', exact: true }).click();
  await page.getByRole('button', { name: 'Manage optional recording', exact: true }).click();
  assert.equal(await page.locator('#march-consulting').isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'march-learning-check');
  assert.deepEqual(await page.evaluate(() => __calls), { path: [], identity: 0, network: 0, saves: 0 });
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});

test('no-data Progress gives a usable next step instead of permanent opening language', async t => {
  const { page, errors } = await fixture(t, 390);
  await page.evaluate(() => { __snapshot={available:false,revision:2,current:null,milestones:[],history:{},summary:{}};marchConsultingRender(); });
  assert.match(await page.locator('#march-coach-milestones').innerText(), /Your path is ready/);
  assert.equal(await page.getByRole('button', { name: 'View objectives', exact: true }).isEnabled(), true);
  assert.equal(await page.locator('#march-consulting-connect').isEnabled(), false);
  assert.match(await page.locator('#march-consulting-note').textContent(), /Play a little/);
  assert.deepEqual(errors, []);
});

test('a guidance failure stays visible without freezing local play navigation', async t => {
  const { page, requests, errors } = await fixture(t, 390);
  await page.evaluate(async () => {
    SAVE.native=true;SAVE.readConfirmed=true;NATIVE_PLAYER.status={verified:true,bound:true,binding:{subjectDid:'did:example:fixture'}};
    await marchConsultingRun(async () => { throw Error('Synthetic guidance is unavailable.'); });
  });
  assert.equal(await page.locator('#march-progress-optional').evaluate(node => node.open), true);
  assert.match(await page.locator('#march-consulting-note').textContent(), /Synthetic guidance is unavailable/);
  assert.equal(await page.locator('#march-consulting-note').isVisible(), true);
  assert.equal(await page.locator('#march-progress-path').isEnabled(), true);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
});

test('a stopped review before delivery permits a fresh explicit Start without clearing or restarting anything on render', async t => {
  const { page, requests, errors } = await fixture(t,390);
  await page.evaluate(() => {
    SAVE.native=true;SAVE.readConfirmed=true;NATIVE_PLAYER.status={verified:true,bound:true,binding:{subjectDid:'did:example:fixture'}};
    MARCH_CONSULTING.journal={status:()=>({pending:false})};
    MARCH_CONSULTING.reviewed={cancelled:true,progress:{requestAttempted:false}};
    window.__stoppedReview=MARCH_CONSULTING.reviewed;
    document.getElementById('march-progress-optional').open=true;
    marchConsultingRender();
  });
  assert.equal(await page.locator('#march-consulting-connect').isVisible(),true);
  assert.equal(await page.locator('#march-consulting-connect').isEnabled(),true);
  assert.equal(await page.locator('#march-coach-recovery').isVisible(),false);
  assert.equal(await page.locator('#march-coach-close-pending').isVisible(),false);
  assert.doesNotMatch(await page.locator('#march-progress-optional > summary').innerText(),/needs attention/);
  assert.equal(await page.locator('#march-progress-path').isEnabled(),true);
  assert.equal(await page.evaluate(() => MARCH_CONSULTING.reviewed===__stoppedReview
    && MARCH_CONSULTING.reviewed.cancelled && !MARCH_CONSULTING.enabled),true);
  await page.evaluate(() => {MARCH_CONSULTING.issue=true;MARCH_CONSULTING.note='Fixture error remains visible.';marchConsultingRender()});
  assert.match(await page.locator('#march-progress-optional > summary').innerText(),/needs attention/);
  assert.equal(await page.locator('#march-consulting-note').innerText(),'Fixture error remains visible.');
  assert.equal(await page.locator('#march-coach-recovery').isVisible(),false);
  assert.deepEqual(await page.evaluate(() => __calls),{path:[],identity:0,network:0,saves:0});
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

for (const blocker of ['uncancelled-review','attempted-delivery','journal-pending','delivery-pending','delivery-blocked']) {
  test(`${blocker} still blocks a fresh Start and cannot be cleared by a cancelled-review render`,async t => {
    const { page, requests, errors } = await fixture(t,390);
    await page.evaluate(blocker => {
      SAVE.native=true;SAVE.readConfirmed=true;NATIVE_PLAYER.status={verified:true,bound:true,binding:{subjectDid:'did:example:fixture'}};
      MARCH_CONSULTING.journal={status:()=>({pending:blocker==='journal-pending'})};
      MARCH_CONSULTING.reviewed={cancelled:blocker!=='uncancelled-review',progress:{requestAttempted:blocker==='attempted-delivery'}};
      MARCH_COACH_DELIVERY.pending=blocker==='delivery-pending'?{id:'urn:fixture:pending',stage:'intent'}:null;
      MARCH_COACH_DELIVERY.blocked=blocker==='delivery-blocked';
      window.__guardedReview=MARCH_CONSULTING.reviewed;window.__guardedPending=MARCH_COACH_DELIVERY.pending;
      window.__guardedBlocked=MARCH_COACH_DELIVERY.blocked;
      marchConsultingRender();marchConsultingRender();
    },blocker);
    assert.equal(await page.locator('#march-consulting-connect').isDisabled(),true);
    assert.equal(await page.locator('#march-coach-recovery').isVisible(),true);
    assert.equal(await page.locator('#march-coach-close-pending').isVisible(),true);
    assert.match(await page.locator('#march-progress-optional > summary').innerText(),/needs attention/);
    assert.equal(await page.locator('#march-progress-path').isEnabled(),true);
    assert.equal(await page.evaluate(() => MARCH_CONSULTING.reviewed===__guardedReview
      && MARCH_COACH_DELIVERY.pending===__guardedPending && MARCH_COACH_DELIVERY.blocked===__guardedBlocked && !MARCH_CONSULTING.enabled),true);
    assert.deepEqual(await page.evaluate(() => __calls),{path:[],identity:0,network:0,saves:0});
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  });
}

test('one sticky back action returns from a long history to a visible focused Progress entry', async t => {
  const { page, requests, errors } = await fixture(t, 320);
  await page.evaluate(() => {
    GAME_ACTIVITY.profile.save=()=>({recent:Array.from({length:16},(_,index)=>({id:'urn:uuid:event-'+index,type:'resource.gathered',
      ordinal:index+1,observedAt:'2026-10-27T12:00:00.000Z',body:{kind:'character'},actor:{kind:'unattributed'},object:{id:'Stone'},result:{quantity:1}}))});
  });
  await page.getByRole('button', { name: 'View activity history', exact: true }).click();
  await page.getByRole('heading', { name: 'Your activity', exact: true }).waitFor();
  await page.evaluate(() => scrollTo(0,900));
  const back=page.getByRole('button', { name: 'Back to Progress', exact: true }),bounds=await back.boundingBox();
  assert.equal(await back.count(),1);assert.ok(bounds.y>=0&&bounds.y+bounds.height<=850);
  await back.click();assert.equal(await page.evaluate(()=>document.activeElement.id),'march-activity-open');
  const entry=await page.locator('#march-activity-open').boundingBox();assert.ok(entry.y>=0&&entry.y+entry.height<=850);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});

test('an automatic progress update preserves keyboard focus on an expanded milestone disclosure', async t => {
  const { page, errors } = await fixture(t,390);
  await page.locator('#march-progress-milestones-summary').click();
  await page.evaluate(()=>{__snapshot.revision++;marchConsultingRender();});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'march-progress-milestones-summary');
  assert.equal(await page.locator('#march-progress-milestones-summary').evaluate(node=>node.parentElement.open),true);
  assert.deepEqual(errors,[]);
});

test('recreating the Progress overview removes its old history host and back controls', async t => {
  const {page,requests,errors}=await fixture(t,390);
  await page.evaluate(()=>{document.getElementById('march-consulting').remove();marchConsultingRender();});
  for(const id of ['march-activity-open','march-activity-back','march-activity-dashboard'])assert.equal(await page.locator('#'+id).count(),1);
  await page.getByRole('button',{name:'View activity history',exact:true}).click();
  await page.getByRole('heading',{name:'Your activity',exact:true}).waitFor();
  assert.equal(await page.locator('[data-hm-activity-dashboard]').count(),1);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
