const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const XLSX = require('xlsx');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const payload = '<img src=x onerror="window.__xss=1"> & "한글"';
const row = overrides => ({ id: 'legacy-1', date: '2026-11-02', amount: 12000, item: '문구 & 종이', store: '상호', category: 'supplies', memo: '', ...overrides });
function app() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://sec2.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w.document, 'readyState', { value: 'complete' });
  w.scrollTo = () => {}; w.structuredClone = structuredClone;
  w.setTimeout = () => 1; w.confirm = () => true;
  w.HTMLAnchorElement.prototype.click = function () {};
  w.Blob = Blob;
  const blobs = [];
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:sec2'; };
  w.URL.revokeObjectURL = () => {};
  w.fetch = () => { throw new Error('Unexpected network request'); };
  for (const file of ['data-safety', 'storage', 'excel-export', 'pages', 'app']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), dom.getInternalVMContext());
  const api = vm.runInContext('({Storage, DataSafety, ExcelExport, Pages, App})', dom.getInternalVMContext());
  const seed = (receipts, settings = {}) => {
    w.localStorage.setItem('classbudget_receipts', JSON.stringify(receipts));
    w.localStorage.setItem('classbudget_settings', JSON.stringify({ budgetName: '학급비', totalBudget: 500000, schoolName: '', className: '', teacherName: '', ...settings }));
  };
  return { w, dom, blobs, seed, ...api };
}
test('all display routes, edit attributes, modal and toast keep XSS as text', () => {
  const a = app(); a.seed([row({ item: payload, store: payload, memo: payload, imageName: payload, imageData: 'data:image/png;base64,AA==' })], { budgetName: payload, schoolName: payload, teacherName: payload, geminiApiKey: payload });
  for (const route of ['#/', '#/list', '#/edit/legacy-1', '#/settings', '#/edit/\" autofocus onfocus=window.__xss=1 x=\"']) {
    a.App.navigate(route);
    assert.equal(a.w.document.querySelectorAll('[onerror]:not([src="./public/assets/bosco-budget-hero.png"]),[onfocus],script').length, 0);
    assert.equal(a.w.__xss, undefined);
  }
  a.App.navigate('#/list');
  assert.ok(a.w.document.querySelector('tbody').textContent.includes(payload));
  a.w.document.querySelector('.receipt-thumb').click();
  assert.ok(a.w.document.querySelector('.modal__title').textContent.includes(payload));
  assert.equal(a.w.document.querySelector('#image-modal-overlay [onerror]'), null);
  a.App.showToast(payload); assert.ok(a.w.document.querySelector('#toast-container').textContent.includes(payload));
  assert.equal(a.w.document.querySelector('#toast-container img'), null);
  a.seed([row({ imageData: 'https://attacker.invalid/x', imageName: payload })]);
  a.App.navigate('#/list'); assert.equal(a.w.document.querySelector('.receipt-thumb'), null);
  a.Storage.setCloudView({ receipts: [row({ item: payload })], general: { budgetName: payload, totalBudget: 500000 } });
  a.App.navigate('#/list'); assert.ok(a.w.document.querySelector('tbody').textContent.includes(payload));
  assert.equal(a.w.document.querySelector('tbody [onerror]'), null);
  a.dom.window.close();
});
test('backup roundtrip preserves raw text, legacy keys, numeric strings, PDF and current key', () => {
  const a = app(); a.seed([row({ item: payload, amount: '12000', imageData: 'PDF_FILE', imageName: 'test.pdf' })], { geminiApiKey: 'synthetic-current' });
  const backup = a.Storage.exportData(); assert.ok(!backup.includes('synthetic-current'));
  a.Storage.deleteReceipt('legacy-1');
  assert.equal(a.Storage.importData(backup).success, true);
  assert.equal(a.Storage.getReceipts()[0].item, payload);
  assert.equal(a.Storage.getReceipts()[0].amount, 12000);
  assert.equal(a.Storage.getDeviceGeminiApiKey(), 'synthetic-current');
  assert.equal(a.Storage.importData(JSON.stringify({ receipts: [row()], settings: { geminiApiKey: 'synthetic-old' } })).success, true);
  assert.equal(a.Storage.getDeviceGeminiApiKey(), 'synthetic-current');
  a.dom.window.close();
});
test('invalid backups are rejected before any existing data changes', () => {
  const a = app(); a.seed([row()]);
  const before = JSON.stringify({ ...a.w.localStorage });
  const invalid = [null, [], {}, {version:2,receipts:[]}, {receipts:{}}, {receipts:[row(),row()]},
    ...[{date:'2026-02-30'}, {date:'invalid'}, {amount:-1}, {amount:'Infinity'}, {amount:true}, {amount:{v:1}}, {store:{t:'n',f:'1+1'}}, {item:[]}, {item:''}, {category:'bad'}, {id:'bad/uid'}, {imageData:'javascript:alert(1)'}, {extra:'bad'}].map(v=>({settings:{budgetName:'changed'},receipts:[row(v)]})),
    JSON.parse('{"receipts":[],"settings":{"__proto__":{"bad":true}}}')];
  for (const value of invalid) {
    assert.equal(a.Storage.importData(JSON.stringify(value)).success, false, JSON.stringify(value));
    assert.equal(JSON.stringify({...a.w.localStorage}), before);
  }
  assert.equal(a.Storage.importData('{bad JSON').success, false);
  a.dom.window.close();
});
test('storage quota failure after receipt write rolls back original bytes', () => {
  const a = app(); a.seed([row()]); const before = JSON.stringify({...a.w.localStorage});
  const proto = a.w.Storage.prototype, original = proto.setItem;
  let failed = false;
  proto.setItem = function (key, value) { if (key==='classbudget_settings' && !failed) { failed=true; throw new Error('quota'); } return original.call(this,key,value); };
  assert.equal(a.Storage.importData(JSON.stringify({receipts:[row({item:'new'})],settings:{budgetName:'new'}})).success,false);
  assert.equal(JSON.stringify({...a.w.localStorage}),before);
  proto.setItem = original; a.dom.window.close();
});
test('manual save, edit, filter and delete work with literal special characters', async () => {
  const a = app(); a.seed([]); a.App.navigate('#/add');
  for (const [id,value] of [['receipt-date','2026-11-02'],['receipt-amount','24000'],['receipt-item',payload],['receipt-store','테스트 상호']]) a.w.document.getElementById(id).value=value;
  a.w.document.querySelector('#receipt-form').dispatchEvent(new a.w.Event('submit', {bubbles:true,cancelable:true}));
  await Promise.resolve(); assert.equal(a.Storage.getReceipts().length,1);
  const id = a.Storage.getReceipts()[0].id;
  a.App.navigate('#/edit/'+id); assert.equal(a.w.document.getElementById('receipt-item').value,payload);
  a.w.document.getElementById('receipt-amount').value='25000';
  a.w.document.querySelector('#receipt-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
  await Promise.resolve(); assert.equal(a.Storage.getReceipts()[0].amount,25000);
  a.App.navigate('#/list');
  const filter=a.w.document.getElementById('filter-category');
  filter.value='food'; filter.dispatchEvent(new a.w.Event('change')); assert.equal(a.w.document.querySelectorAll('tbody tr').length,0);
  filter.value=''; filter.dispatchEvent(new a.w.Event('change')); assert.equal(a.w.document.querySelectorAll('tbody tr').length,1);
  a.w.document.querySelector('.btn-delete-receipt').click();
  await Promise.resolve(); assert.equal(a.Storage.getReceipts().length,0);
  a.dom.window.close();
});
test('cloud CRUD adapter receives validated raw text and local import is blocked in cloud mode', async () => {
  const a=app(); a.seed([row()]); let operation;
  a.Storage.setCloudView({receipts:[],general:{budgetName:'학급비',totalBudget:500000}}, async (op,id,input)=>{operation={op,id,input};return {id:'cloud-test',...input};});
  const input=a.w.JSON.parse(JSON.stringify(row({item:payload})));
  await a.Storage.addReceipt(input); assert.equal(operation.op,'create'); assert.equal(operation.input.item,payload);
  await a.Storage.updateReceipt('cloud-test',input); assert.equal(operation.op,'update'); assert.equal(operation.id,'cloud-test');
  await a.Storage.deleteReceipt('cloud-test'); assert.equal(operation.op,'delete');
  assert.equal(a.Storage.importData(JSON.stringify({receipts:[]})).success,false);
  a.Storage.setCloudView(null); assert.equal(a.Storage.getReceipts().length,1);
  a.dom.window.close();
});
test('CSV guards formula text, delimiters, quotes and line breaks in both exports', async () => {
  const a=app();
  for (const text of ['=1+1','+1+1','-1+1','@SUM(1)', '\t=1+1', '\r=1+1', '  =1+1', 'a,"b"\nc']) {
    a.seed([row({store:text,item:text,memo:text,proofType:text})], {budgetName:text,schoolName:text,className:text,teacherName:text});
    assert.equal(a.ExcelExport.downloadSettlement().success,true); assert.equal(a.ExcelExport.downloadReceiptList().success,true);
    for (const blob of a.blobs.splice(0)) {
      const csv = await blob.text();
      if (/^[\s]*[=+@-]/.test(text)) assert.ok(csv.includes('"\''+text.replace(/"/g,'""')+'"'));
      else assert.ok(csv.includes('"a,""b""\nc"'));
    }
  }
  a.dom.window.close();
});
test('synthetic PDF upload with mocked Gemini fills form safely without real API', async () => {
  const a = app(); a.seed([], {geminiApiKey:'synthetic-not-a-real-key'}); a.App.navigate('#/add');
  let calls=0;
  a.w.fetch = async (url, options) => {
    calls++; assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
    const request=JSON.parse(options.body); assert.equal(request.contents[0].parts[1].inline_data.mime_type,'application/pdf');
    return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({date:'2026-11-02',amount:32100,item:payload,store:'합성 상호',category:'food'})}]}}]})};
  };
  const input=a.w.document.getElementById('receipt-file');
  const fileInput=input || a.w.document.querySelector('input[type=file]');
  Object.defineProperty(fileInput,'files',{value:[new a.w.File(['synthetic PDF fixture only'],'synthetic.pdf',{type:'application/pdf'})]});
  fileInput.dispatchEvent(new a.w.Event('change'));
  for(let i=0;i<30 && a.w.document.getElementById('ai-consent').hidden;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,0);
  a.w.document.getElementById('btn-run-ai').click();
  for(let i=0;i<30 && a.w.document.getElementById('receipt-item').value!==payload;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,1); assert.equal(a.w.document.getElementById('receipt-item').value,payload);
  assert.equal(a.w.document.getElementById('receipt-amount').value,'32100');
  assert.equal(a.w.document.querySelector('#receipt-form [onerror]'),null);
  a.w.document.querySelector('#receipt-form').dispatchEvent(new a.w.Event('submit',{bubbles:true,cancelable:true}));
  await Promise.resolve(); assert.equal(a.Storage.getReceipts()[0].item,payload);
  assert.equal(a.Storage.getReceipts()[0].imageData,'PDF_FILE');
  a.dom.window.close();
});
test('actual SheetJS XLSX roundtrip has no formula cells; amount remains numeric', () => {
  const a=app(); a.seed([row({store:'=1+1',item:payload,memo:'@SUM(1)'})]); let bytes;
  a.w.XLSX={...XLSX,writeFile: wb => {bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}};
  assert.equal(a.ExcelExport.downloadEdufineXLS().success,true);
  const wb=XLSX.read(bytes,{type:'buffer'}), ws=wb.Sheets['정산내역'];
  assert.equal(ws.B2.t,'s'); assert.equal(ws.B2.v,'=1+1'); assert.equal(ws.C2.t,'n'); assert.equal(ws.C2.v,12000);
  assert.equal(ws.A2.v,'2026-11-02'); assert.ok(ws.E2.v.includes(payload));
  for (const cell of Object.values(ws)) assert.equal(cell?.f,undefined);
  a.seed([row({store:{t:'n',f:'1+1'}})]); assert.equal(a.ExcelExport.downloadEdufineXLS().success,false);
  a.dom.window.close();
});
test('HTML XLS fallback escapes text including proof type; invalid legacy data gives a readable error', async () => {
  const a=app(); a.seed([row({store:payload,item:payload,proofType:payload})]);
  assert.equal(a.ExcelExport.downloadEdufineXLS().success,true);
  const html=await a.blobs[0].text(); assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img src=x'));
  for (const changes of [{date:'2026-02-30'},{amount:-1},{store:{f:'1+1'}}]) {
    a.seed([row(changes)]); assert.equal(a.ExcelExport.downloadSettlement().success,false); assert.equal(a.ExcelExport.downloadReceiptList().success,false);
  }
  a.dom.window.close();
});
