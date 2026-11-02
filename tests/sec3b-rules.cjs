const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict');
const project='demo-classbudget-sec3a';
const rules=require('path').join(__dirname,'../security/firestore.sec3b.rules');
const base='http://127.0.0.1:8788/v1/projects/'+project+'/databases/(default)/documents';
const results=[];
const emulator=cp.spawn('java',['-jar',process.env.FIRESTORE_EMULATOR_JAR || require('path').join(require('os').homedir(),'.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar'),'--host','127.0.0.1','--port','8788','--project_id',project,'--single_project_mode','--single_project_mode_error','--rules',rules]);
let ready=false;emulator.stdout.on('data',d=>{if(d.toString().includes('Dev App Server is now running'))ready=true;});emulator.stderr.on('data',()=>{});
const fields=obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):{stringValue:v}]));
function jwt(uid){const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');return enc({alg:'none',typ:'JWT'})+'.'+enc({iss:'https://securetoken.google.com/'+project,aud:project,sub:uid,user_id:uid,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,firebase:{sign_in_provider:'google.com'}})+'.';}
async function req(path,method='GET',uid,body){
  const headers={};if(uid)headers.Authorization='Bearer '+(uid==='owner'?'owner':jwt(uid));if(body)headers['Content-Type']='application/json';
  const r=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(4000)});return r;
}
async function check(label,path,method,uid,status,body){const r=await req(path,method,uid,body);results.push({label,expected:status,actual:r.status,pass:r.status===status});}
const receipt=id=>({id,date:'2026-11-02',amount:100,item:'synthetic',store:'synthetic',category:'other',memo:''});
(async()=>{
  for(let i=0;i<100&&!ready;i++)await new Promise(r=>setTimeout(r,100));
  if(!ready)throw new Error('emulator startup timeout');
  for(const uid of ['A','B']){
    assert.equal((await req('/users/'+uid+'/migrations/initial-local','PATCH','owner',{fields:fields({status:'complete',receiptCount:1})})).status,200);
    assert.equal((await req('/users/'+uid+'/settings/general','PATCH','owner',{fields:fields({budgetName:'synthetic',totalBudget:500000,schoolName:'',teacherName:'',className:''})})).status,200);
    assert.equal((await req('/users/'+uid+'/receipts/r1','PATCH','owner',{fields:fields(receipt('r1'))})).status,200);
  }
  for(const user of [undefined,'A','B','NEW']){
    const own=user==='A';const label=user||'logged-out';
    for(const collection of ['receipts/r1','settings/general','migrations/initial-local'])await check(label+' read A '+collection,'/users/A/'+collection,'GET',user,own?200:403);
    await check(label+' list A','/users/A/receipts','GET',user,own?200:403);
    await check(label+' update A','/users/A/receipts/r1','PATCH',user,own?200:403,{fields:fields(receipt('r1'))});
    await check(label+' create A','/users/A/receipts/new-'+label,'PATCH',user,own?200:403,{fields:fields(receipt('new-'+label))});
    if(!own)await check(label+' delete A','/users/A/receipts/r1','DELETE',user,403);
  }
  await check('new account own missing receipt read','/users/NEW/receipts/missing','GET','NEW',404);
  await check('new account write before migration','/users/NEW/receipts/r1','PATCH','NEW',403,{fields:fields(receipt('r1'))});
  await check('owner delete settings denied','/users/A/settings/general','DELETE','A',403);
  await check('owner delete migration denied','/users/A/migrations/initial-local','DELETE','A',403);
  await check('unknown path denied','/anything/test','GET','A',403);
  await check('attachment field rejected','/users/A/receipts/r1','PATCH','A',403,{fields:fields({...receipt('r1'),imageData:'synthetic'})});
  await check('candidate rejects negative amount/date/category','/users/A/receipts/invalid','PATCH','A',403,{fields:fields({...receipt('invalid'),amount:-1,date:'not-a-date',category:'not-a-category'})});
  await check('owner receipt delete allowed','/users/A/receipts/r1','DELETE','A',200);
  await check('A cannot read B','/users/B/receipts/r1','GET','A',403);
  await check('A cannot update B','/users/B/receipts/r1','PATCH','A',403,{fields:fields(receipt('r1'))});
  await check('A cannot delete B','/users/B/receipts/r1','DELETE','A',403);
  await check('B data survives A deletion','/users/B/receipts/r1','GET','B',200);
  for (const date of ['2024-02-29','2000-02-29','2026-04-30','2026-12-31']) await check('valid date '+date,'/users/A/receipts/dates','PATCH','A',200,{fields:fields({...receipt('dates'),date})});
  for (const date of ['2026-02-29','1900-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','0000-01-01','x']) await check('invalid date '+date,'/users/A/receipts/dates','PATCH','A',403,{fields:fields({...receipt('dates'),date})});
  await check('negative amount alone','/users/A/receipts/dates','PATCH','A',403,{fields:fields({...receipt('dates'),amount:-1})});
  await check('unknown category alone','/users/A/receipts/dates','PATCH','A',403,{fields:fields({...receipt('dates'),category:'unknown'})});
  await check('empty item','/users/A/receipts/dates','PATCH','A',403,{fields:fields({...receipt('dates'),item:''})});
  await check('normal fractional amount','/users/A/receipts/dates','PATCH','A',200,{fields:fields({...receipt('dates'),amount:100.5})});
  await check('string amount rejected on server','/users/A/receipts/dates','PATCH','A',403,{fields:fields({...receipt('dates'),amount:'100'})});
  await check('negative budget rejected','/users/A/settings/general','PATCH','A',403,{fields:fields({budgetName:'synthetic',totalBudget:-1,schoolName:'',teacherName:'',className:''})});
  await req('/users/A/receipts/legacy-invalid','PATCH','owner',{fields:fields({...receipt('legacy-invalid'),date:'bad',amount:-1})});
  await check('existing invalid record still readable','/users/A/receipts/legacy-invalid','GET','A',200);
  await check('existing invalid record can be corrected','/users/A/receipts/legacy-invalid','PATCH','A',200,{fields:fields(receipt('legacy-invalid'))});
  await check('existing record can still be deleted','/users/A/receipts/legacy-invalid','DELETE','A',200);
  const prefix='projects/'+project+'/databases/(default)/documents/users/NEW/';
  await check('initial import batch with marker count 0 and one receipt',':commit','POST','NEW',200,{writes:[
    {update:{name:prefix+'migrations/initial-local',fields:fields({status:'complete',receiptCount:0})},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:prefix+'settings/general',fields:fields({budgetName:'synthetic',totalBudget:500000,schoolName:'',teacherName:'',className:''})}},
    {update:{name:prefix+'receipts/r1',fields:fields(receipt('r1'))}}
  ]});
  if(process.env.SEC3B_RESULTS) fs.writeFileSync(process.env.SEC3B_RESULTS,JSON.stringify({project,rulesSHA256:require('crypto').createHash('sha256').update(fs.readFileSync(rules)).digest('hex'),results},null,2));
  if(results.some(r=>!r.pass)) process.exitCode=1;
  console.log(JSON.stringify({pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass),tests:results.length}));
})().catch(e=>{console.log(JSON.stringify({status:'BLOCKED',reason:e.name+': '+e.message}));process.exitCode=1;}).finally(()=>emulator.kill());
