const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function fixture(saved={}){
 const dom=new JSDOM('<div></div>',{url:'https://sec3b.invalid/',runScripts:'outside-only'}),w=dom.window;
 w.structuredClone=structuredClone;for(const [k,v]of Object.entries(saved))w.localStorage.setItem(k,v);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/data-safety.js'),'utf8'),dom.getInternalVMContext());
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/storage.js'),'utf8'),dom.getInternalVMContext());
 const api=vm.runInContext('Storage',dom.getInternalVMContext());
 return {w,api,close:()=>w.close(),row:()=>w.JSON.parse(JSON.stringify({date:'2026-11-02',amount:100,item:'synthetic',store:'',memo:'',category:'other'}))};
}
test('account local data is isolated, logout deletes current scope only, preserves local-only source',()=>{
 const a=fixture({'classbudget_receipts':'[{"id":"legacy"}]','classbudget_settings':'{"geminiApiKey":"synthetic-legacy","budgetName":"legacy"}'});
 a.api.switchAccount('A');assert.equal(a.api.getReceipts().length,0);a.api.addReceipt(a.row());
 a.api.saveCloudAttachment('A','r1',{imageData:'data:image/png;base64,AA==',imageName:'synthetic'});
 a.w.localStorage.setItem('classbudget_user:B:receipts','[{"id":"B"}]');
 a.api.saveDeviceGeminiApiKey('synthetic-A',true);a.api.switchAccount(null);
 assert.equal(a.api.getReceipts().length,0);assert.equal(a.api.getDeviceGeminiApiKey(),'');assert.equal(a.api.isLocked(),true);
 assert.deepEqual(Object.keys(a.w.localStorage).filter(k=>k.startsWith('classbudget_user:A:')||k.startsWith('classbudget_cloud_attachment:A:')),[]);
 assert.ok(a.w.localStorage.getItem('classbudget_receipts').includes('legacy'));
 assert.ok(!a.w.localStorage.getItem('classbudget_settings').includes('synthetic-legacy'));
 a.api.switchAccount('B');assert.equal(a.api.getReceipts()[0].id,'B');assert.equal(a.api.getCloudAttachment('A','r1'),null);
 assert.throws(()=>a.api.saveCloudAttachment('A','r1',{imageData:'x',imageName:'x'}));
 a.close();
});
test('memory-only default survives ordinary settings save but not a fresh tab',()=>{
 const a=fixture();a.api.switchAccount('A');a.api.saveDeviceGeminiApiKey('synthetic-memory');
 assert.equal(a.api.isKeyRemembered(),false);a.api.saveSettings(a.w.JSON.parse('{"budgetName":"test","totalBudget":100,"geminiApiKey":"synthetic-memory"}'));
 assert.equal(a.api.getDeviceGeminiApiKey(),'synthetic-memory');
 const saved={...a.w.localStorage};assert.equal(JSON.stringify(saved).includes('synthetic-memory'),false);
 const b=fixture(saved);b.api.switchAccount('A');assert.equal(b.api.getDeviceGeminiApiKey(),'');a.close();b.close();
});
test('opt-in remember reload and deletion; legacy key is migrated to memory without data loss',()=>{
 const a=fixture({'classbudget_settings':'{"geminiApiKey":"synthetic-old","schoolName":"synthetic"}'});
 assert.equal(a.api.getDeviceGeminiApiKey(),'synthetic-old');assert.ok(!a.w.localStorage.getItem('classbudget_settings').includes('synthetic-old'));
 assert.equal(a.api.getSettings().schoolName,'synthetic');
 a.api.switchAccount('A');a.api.saveDeviceGeminiApiKey('synthetic-remember',true);const b=fixture({...a.w.localStorage});b.api.switchAccount('A');
 assert.equal(b.api.getDeviceGeminiApiKey(),'synthetic-remember');b.api.saveDeviceGeminiApiKey('',false);
 assert.equal(JSON.stringify({...b.w.localStorage}).includes('synthetic-remember'),false);a.close();b.close();
});
test('migration cannot read anonymous legacy data or use a stale account snapshot',()=>{
 const a=fixture({'classbudget_receipts':'[{"id":"legacy"}]'});a.api.switchAccount('A');
 const source=a.api.migrationStorage();assert.equal(source.getItem('classbudget_receipts'),null);
 a.api.addReceipt(a.row());assert.ok(!source.getItem('classbudget_receipts').includes('legacy'));
 a.api.switchAccount('B');assert.throws(()=>source.getItem('classbudget_receipts'));a.close();
});
test('storage cleanup error fails closed rather than retaining a readable old account',()=>{
 const a=fixture();a.api.switchAccount('A');a.api.addReceipt(a.row());a.api.saveDeviceGeminiApiKey('synthetic-A');
 const proto=a.w.Storage.prototype,remove=proto.removeItem;proto.removeItem=()=>{throw new Error('synthetic storage failure');};
 assert.throws(()=>a.api.switchAccount(null));assert.equal(a.api.isLocked(),true);assert.equal(a.api.getReceipts().length,0);assert.equal(a.api.getDeviceGeminiApiKey(),'');
 proto.removeItem=remove;a.close();
});
test('another tab locks local-only view when an account session begins',()=>{
 const a=fixture({'classbudget_receipts':'[{"id":"legacy"}]'});assert.equal(a.api.getReceipts().length,1);
 a.w.dispatchEvent(new a.w.StorageEvent('storage',{key:'classbudget_local_locked',newValue:'1'}));
 assert.equal(a.api.getReceipts().length,0);assert.equal(a.api.isLocked(),true);a.close();
});
