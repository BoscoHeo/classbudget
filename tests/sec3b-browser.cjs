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
  const page=await context.newPage();let accept=true;page.on('dialog',d=>accept?d.accept():d.dismiss());page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://sec3b.invalid/');await page.locator('#account-login').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('account-login').disabled);
  await page.evaluate(()=>{
   localStorage.setItem('classbudget_receipts',JSON.stringify([{id:'legacy',date:'2026-11-02',amount:1,item:'local-only preserved',store:'',memo:'',category:'other'}]));
   App.navigate('#/list');
  });
  assert.ok((await page.locator('tbody').textContent()).includes('local-only preserved'));
  await page.locator('#account-login').click();await page.waitForFunction(()=>Storage.currentUid()==='A');
  assert.equal(await page.evaluate(()=>Storage.getReceipts().length),0);
  await page.evaluate(()=>{
   Storage.addReceipt({date:'2026-11-02',amount:100,item:'A only',store:'synthetic',category:'other',memo:'',imageData:'data:image/png;base64,AA==',imageName:'A image'});
   Storage.saveCloudAttachment('A','r1',{imageData:'data:image/png;base64,AA==',imageName:'A image'});
   App.navigate('#/settings');
  });
  assert.equal(await page.locator('#remember-api-key').isChecked(),false);
  await page.locator('#setting-gemini-key').fill('synthetic-memory-key');await page.locator('#btn-save-apikey').click();
  assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('synthetic-memory-key'))),false);
  await page.locator('#remember-api-key').check();await page.locator('#setting-gemini-key').fill('synthetic-remembered-key');await page.locator('#btn-save-apikey').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('classbudget_user:A:settings')).geminiApiKey),'synthetic-remembered-key');
  await page.locator('#setting-gemini-key').fill('');await page.locator('#btn-save-apikey').click();
  assert.equal(await page.evaluate(()=>Storage.getDeviceGeminiApiKey()),'');
  await page.locator('#remember-api-key').uncheck();await page.locator('#setting-gemini-key').fill('synthetic-memory-key');await page.locator('#btn-save-apikey').click();
  await page.evaluate(()=>App.navigate('#/list'));await page.locator('.receipt-thumb').click();
  await page.evaluate(()=>{
   const marker=URL.createObjectURL(new Blob(['synthetic'],{type:'image/png'}));
   const revoke=URL.revokeObjectURL.bind(URL);window.__revoked=false;
   URL.revokeObjectURL=url=>{if(url===marker)window.__revoked=true;revoke(url);};
   document.querySelector('#image-modal-overlay img').src=marker;
  });
  // Cancelling logout must preserve the user's still-active session and data.
  accept=false;await page.locator('#account-logout').click();assert.equal(await page.evaluate(()=>Storage.currentUid()),'A');
  assert.equal(await page.evaluate(()=>Storage.getReceipts().length),1);
  accept=true;await page.locator('#account-logout').click();await page.waitForFunction(()=>Storage.currentUid()===null);
  assert.equal(await page.locator('#image-modal-overlay').count(),0);assert.equal(await page.locator('#app img').count(),0);
  assert.equal(await page.evaluate(()=>window.__revoked),true);
  assert.ok(!(await page.locator('#app').textContent()).includes('A only'));
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('classbudget_user:A:')||k.startsWith('classbudget_cloud_attachment:A:'))),[]);
  assert.equal(await page.evaluate(()=>Storage.getDeviceGeminiApiKey()),'');
  assert.ok(await page.evaluate(()=>localStorage.getItem('classbudget_receipts').includes('local-only preserved')));
  await page.evaluate(()=>window.__nextUid='B');await page.locator('#account-login').click();await page.waitForFunction(()=>Storage.currentUid()==='B');
  assert.equal(await page.evaluate(()=>Storage.getReceipts().length),0);assert.equal(await page.evaluate(()=>Storage.getCloudAttachment('A','r1')),null);
  await page.evaluate(()=>{Storage.saveDeviceGeminiApiKey('synthetic-B');App.navigate('#/add');});
  const file={name:'synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic PDF fixture only')};
  await page.locator('input[type=file]').setInputFiles(file);await page.locator('#ai-consent').waitFor({state:'visible'});assert.equal(calls,0);
  accept=false;await page.locator('#btn-run-ai').click();assert.equal(calls,0);
  accept=true;await page.locator('#btn-cancel-ai').click();assert.equal(calls,0);assert.equal(await page.locator('#upload-preview').isVisible(),true);
  await page.locator('input[type=file]').setInputFiles(file);await page.locator('#ai-consent').waitFor({state:'visible'});
  await page.locator('#btn-run-ai').click();await page.waitForFunction(()=>document.getElementById('receipt-item').value==='synthetic OCR');assert.equal(calls,1);
  // Ignore abort in a synthetic response to prove stale results cannot enter a new account.
  await page.evaluate(()=>{
   window.fetch=async(url,{signal})=>{window.__ocrSignal=signal;return new Promise(resolve=>{window.__finishOCR=()=>resolve({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"date":"2026-11-02","amount":1,"item":"stale B"}'}]}}]})});});};
  });
  await page.locator('#btn-run-ai').click();await page.waitForFunction(()=>!!window.__ocrSignal);
  await page.locator('#btn-cancel-ai').click();assert.equal(await page.evaluate(()=>window.__ocrSignal.aborted),true);
  await page.evaluate(()=>window.__finishOCR());
  assert.notEqual(await page.locator('#receipt-item').inputValue(),'stale B');
  await page.locator('input[type=file]').setInputFiles(file);await page.locator('#ai-consent').waitFor({state:'visible'});await page.locator('#btn-run-ai').click();
  await page.locator('#account-logout').click();await page.waitForFunction(()=>Storage.currentUid()===null);
  assert.equal(await page.evaluate(()=>window.__ocrSignal.aborted),true);await page.evaluate(()=>window.__finishOCR());
  assert.equal(await page.locator('#app input[type=file]').count(),0);
  assert.ok(!(await page.locator('#app').textContent()).includes('stale B'));
  await page.evaluate(()=>window.__nextUid='A');await page.locator('#account-login').click();await page.waitForFunction(()=>Storage.currentUid()==='A');
  assert.equal(await page.evaluate(()=>Storage.getReceipts().length),0);
  assert.equal(await page.evaluate(()=>Storage.getDeviceGeminiApiKey()),'');
  // A pending old-account save must not block the new user's local save.
  await page.evaluate(()=>{
   Storage.setCloudView({receipts:[],general:{totalBudget:100}},()=>new Promise(resolve=>{window.__finishCloudSave=()=>resolve({id:'old-A'});}));
   App.navigate('#/add');
   document.getElementById('receipt-date').value='2026-11-02';document.getElementById('receipt-amount').value='100';document.getElementById('receipt-item').value='pending A';
   document.getElementById('receipt-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   window.__setUser('B');
  });
  await page.waitForFunction(()=>Storage.currentUid()==='B');
  await page.evaluate(()=>{
   App.navigate('#/add');document.getElementById('receipt-date').value='2026-11-02';document.getElementById('receipt-amount').value='100';document.getElementById('receipt-item').value='new B';
   document.getElementById('receipt-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  assert.equal(await page.evaluate(()=>Storage.getReceipts()[0]?.item),'new B');
  await page.evaluate(()=>window.__finishCloudSave());
  assert.equal(await page.evaluate(()=>Storage.getReceipts().some(r=>r.item==='pending A')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Auth module with synthetic SDK; A/B isolation, logout cancel/delete, preserved legacy data, memory/remember/delete keys, preview-only zero calls, consent cancel, OCR success/cancel/stale response cleanup. Real external API calls: 0');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
