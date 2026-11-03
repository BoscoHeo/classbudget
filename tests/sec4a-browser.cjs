// Real application modules, isolated Chrome, synthetic Auth/Firestore/Gemini only.
const {chromium}=require('playwright-core');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.newContext();let calls=0;const errors=[];
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url==='http://sec3b.invalid/'){
    let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<link[^>]*>/g,'').replace(/<script src="https:[^>]*><\/script>/g,'');
    return route.fulfill({contentType:'text/html',body:html});
   }
   if(url==='http://sec3b.invalid/js/firebase-config.js') return route.fulfill({contentType:'text/javascript',body:"export const firebaseConfig={apiKey:'synthetic',authDomain:'synthetic.invalid',projectId:'demo-sec3b',appId:'synthetic'};"});
   if(url.startsWith('http://sec3b.invalid/js/')){
    const name=url.split('/').pop(); if(!/^[a-z-]+\.js$/.test(name))return route.abort();
    return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'js',name),'utf8')});
   }
   if(url.includes('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:"export const initializeApp=()=>({}); export const getApp=()=>({});"});
   if(url.includes('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:`
    const auth={currentUser:null};let callback;
    export const getAuth=()=>auth;export const browserLocalPersistence='synthetic';export const setPersistence=async()=>{};
    export class GoogleAuthProvider{setCustomParameters(){}}
    export function onAuthStateChanged(a,fn){callback=fn;window.__setUser=uid=>{auth.currentUser=uid?{uid,email:uid+'@synthetic.invalid'}:null;callback(auth.currentUser);};callback(null);}
    export const signInWithPopup=async()=>window.__setUser(window.__nextUid||'A');
    export const signOut=async()=>window.__setUser(null);
   `});
   if(url.includes('firebase-firestore.js'))return route.fulfill({contentType:'text/javascript',body:"export const getFirestore=()=>({});export const doc=(...x)=>x;export const getDocFromServer=async()=>({exists:()=>false});"});
   if(url.startsWith('https://generativelanguage.googleapis.com/')){calls++;return route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({date:'2026-11-02',amount:100,item:'synthetic OCR',store:'synthetic',category:'other'})}]}}]})});}
   return route.abort();
  });

  const page=await context.newPage();let accept=true;const results=[];
  page.on('dialog',d=>accept?d.accept():d.dismiss());page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://sec3b.invalid/');await page.waitForFunction(()=>!document.getElementById('account-login').disabled);
  await page.locator('#account-login').click();await page.waitForFunction(()=>Storage.currentUid()==='A');
  await page.evaluate(()=>{
    Storage.saveDeviceGeminiApiKey('synthetic-only');App.navigate('#/add');window.__queue=[];
    window.fetch=async(url,{signal})=>new Promise(resolve=>window.__queue.push({signal,finish:(status,item)=>resolve({ok:status===200,status,statusText:'synthetic',json:async()=>status===200?{candidates:[{content:{parts:[{text:JSON.stringify({date:'2026-11-03',amount:100,item,category:'other'})}]}}]}:{error:{message:'synthetic HTTP '+status}}})}));
  });
  const select=async name=>{
    await page.locator('input[type=file]').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('synthetic fixture only')});
    await page.locator('#ai-consent').waitFor({state:'visible'});
  };
  const size=()=>page.evaluate(()=>window.__queue.length);
  const settle=async(index,status,item)=>page.evaluate(async args=>{
    window.__queue[args.index].finish(args.status,args.item);
    await new Promise(resolve=>setTimeout(resolve,0));
  },{index,status,item});
  const run=async expected=>{await page.locator('#btn-run-ai').click();assert.equal(await size(),expected);};
  const duplicate=async expected=>{
    // Both ordinary repeated clicks and an accidentally enabled DOM button must
    // still be blocked by execution ownership, independent of presentation.
    await page.evaluate(()=>document.getElementById('btn-run-ai').click());assert.equal(await size(),expected);
    await page.evaluate(()=>{const b=document.getElementById('btn-run-ai');b.disabled=false;b.click();b.disabled=true;});assert.equal(await size(),expected);
  };
  await select('normal.pdf');assert.equal(await size(),0);
  accept=false;await page.locator('#btn-run-ai').click();assert.equal(await size(),0);accept=true;
  results.push({case:'preview and rejected consent send zero requests',status:'PASS'});
  await run(1);await duplicate(1);await settle(0,200,'normal synthetic');
  assert.equal(await page.locator('#receipt-item').inputValue(),'normal synthetic');assert.equal(await page.locator('#btn-run-ai').isDisabled(),false);
  results.push({case:'normal recognition once and duplicate clicks blocked',status:'PASS'});
  await select('cancel-A.pdf');await run(2);await page.locator('#btn-cancel-ai').click();assert.equal(await page.evaluate(()=>window.__queue[1].signal.aborted),true);
  await select('new-B.pdf');await run(3);await settle(1,200,'must not apply A');
  assert.equal(await page.locator('#btn-run-ai').isDisabled(),true);assert.equal(await page.locator('#receipt-item').inputValue(),'normal synthetic');
  await duplicate(3);await settle(2,200,'current B');assert.equal(await page.locator('#receipt-item').inputValue(),'current B');assert.equal(await page.locator('#btn-run-ai').isDisabled(),false);
  results.push({case:'cancel A then run B; late A cannot unlock B or overwrite fields',status:'PASS'});
  await select('replace-A.pdf');await run(4);await select('replace-B.pdf');await run(5);await settle(3,200,'must not apply replaced A');
  assert.equal(await page.locator('#btn-run-ai').isDisabled(),true);await duplicate(5);await settle(4,200,'replacement B');
  assert.equal(await page.locator('#receipt-item').inputValue(),'replacement B');
  results.push({case:'original file-replacement race stays locked until B completes',status:'PASS'});
  await select('error.pdf');await run(6);await settle(5,429,'');assert.equal(await page.locator('#btn-run-ai').isDisabled(),false);
  assert.ok((await page.locator('#toast-container').textContent()).includes('synthetic HTTP 429'));
  await run(7);await settle(6,200,'retried synthetic');assert.equal(await page.locator('#receipt-item').inputValue(),'retried synthetic');
  results.push({case:'error releases current ownership and allows explicit retry',status:'PASS'});
  await select('logout.pdf');await run(8);await page.locator('#account-logout').click();await page.waitForFunction(()=>Storage.currentUid()===null);
  assert.equal(await page.evaluate(()=>window.__queue[7].signal.aborted),true);await settle(7,200,'late logout data');
  assert.ok(!(await page.locator('#app').textContent()).includes('late logout data'));assert.equal(await page.locator('#receipt-form').count(),0);
  results.push({case:'logout aborts and invalidates the old owner and response',status:'PASS'});
  await page.evaluate(()=>window.__nextUid='B');await page.locator('#account-login').click();await page.waitForFunction(()=>Storage.currentUid()==='B');
  await page.evaluate(()=>{Storage.saveDeviceGeminiApiKey('synthetic-B');App.navigate('#/add');});await select('switch.pdf');await run(9);
  await page.evaluate(()=>window.__setUser('C'));await page.waitForFunction(()=>Storage.currentUid()==='C');
  assert.equal(await page.evaluate(()=>window.__queue[8].signal.aborted),true);await settle(8,200,'late B data');assert.ok(!(await page.locator('#app').textContent()).includes('late B data'));
  results.push({case:'direct account switch invalidates late B response',status:'PASS'});
  await page.evaluate(()=>{Storage.saveDeviceGeminiApiKey('synthetic-C');App.navigate('#/add');});await select('current-C.pdf');await run(10);await settle(9,200,'current C');
  assert.equal(await page.locator('#receipt-item').inputValue(),'current C');assert.equal(await page.locator('#btn-run-ai').isDisabled(),false);
  results.push({case:'new account can run normally after old account cancellation',status:'PASS'});
  assert.deepEqual(errors,[]);
  if(process.env.SEC4A_RESULTS)fs.writeFileSync(process.env.SEC4A_RESULTS,JSON.stringify({results,mockRequests:await size(),realGeminiCalls:0},null,2));
  console.log(JSON.stringify({pass:results.length,fail:0,mockRequests:await size(),realGeminiCalls:0}));
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
