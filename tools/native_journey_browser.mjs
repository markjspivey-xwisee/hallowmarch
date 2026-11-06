/** Owns one fresh headless Edge process for the Python journey's exact driver version. */
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';

const [mode,packagePath,seconds='840',kind='msedge',executable='']=process.argv.slice(2);
if(!['--describe','--serve'].includes(mode)||!packagePath)throw Error('Expected --describe/--serve and the installed Python driver package path');
if(!['msedge','chromium'].includes(kind)||kind==='msedge'&&executable)throw Error('Native Edge uses its installed channel and no executable override');
const pkg=resolve(packagePath);
const metadata=JSON.parse(await readFile(join(pkg,'package.json'),'utf8'));
const {chromiumSwitches}=await import(pathToFileURL(join(pkg,'lib/server/chromium/chromiumSwitches.js')));
const ignored=[...chromiumSwitches(false,kind==='msedge'?'msedge':undefined),'--hide-scrollbars','--mute-audio',
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'];
const options={host:'127.0.0.1',...(kind==='msedge'?{channel:'msedge'}:{}),...(executable?{executablePath:executable}:{}),headless:true,chromiumSandbox:true,ignoreDefaultArgs:ignored,timeout:45000};
const description={packageVersion:metadata.version,driverPackage:pkg,channel:kind,headless:true,chromiumSandbox:true,
  freshEphemeralProfile:true,defaultFeatureAndProtectionDisableFlagsExcluded:true,gpuOverrideFlags:[],ignoredDefaultArgs:ignored};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(mode==='--describe'){emit(description);process.exit(0);}
const {chromium}=await import(pathToFileURL(join(pkg,'index.mjs')));
const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned browser cleanup timed out')),ms);})]).finally(()=>clearTimeout(timer));};
let server,closing,lifetime,input;
async function close(){
  if(closing)return closing;
  closing=(async()=>{
    clearTimeout(lifetime);let killUsed=false;
    if(server){try{await bounded(server.close(),10000);}catch{killUsed=true;await bounded(server.kill(),10000);}}
    emit({type:'closed',killUsed,ownedBrowserPid:server?.process().pid});
  })();
  return closing;
}
try{
  server=await chromium.launchServer(options);
  const actualArgs=server.process().spawnargs;
  if(actualArgs.some(arg=>/^--(?:disable-|no-sandbox|use-angle|ignore-gpu-blocklist|enable-unsafe-swiftshader|unsafely-disable)/.test(arg)))throw Error('Unexpected native GPU/security override in the owned browser command line');
  emit({type:'ready',endpoint:server.wsEndpoint(),ownedBrowserPid:server.process().pid,
    ownedUserDataDir:actualArgs.find(arg=>arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length),...description});
  lifetime=setTimeout(()=>{input?.close();process.stdin.destroy();},Math.max(60,Number(seconds))*1000);
  input=createInterface({input:process.stdin,terminal:false});
  for await(const line of input){if(JSON.parse(line).op==='close'){input.close();break;}}
}catch(error){emit({type:'error',message:String(error.stack||error)});process.exitCode=1;}
finally{
  input?.close();process.stdin.destroy();
  try{await close();}
  catch(error){
    emit({type:'cleanup-error',message:String(error)});
    // Keep this owned helper alive long enough for the parent's bounded exact
    // process-tree fallback; exiting here could orphan an unresponsive browser.
    await new Promise(resolve=>setTimeout(resolve,30000));process.exitCode=1;
  }
}
