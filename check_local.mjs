import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeSourceDates,validateInputs,chooseWork,classifyExpected,parseModelResponse,decisionUpdate,isReady} from './portfolio_core.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
const fixture=await read('demo_fixture.json');
const checks=[];
function check(name,fn){fn();checks.push({name,status:'PASS'});}
const normalized=normalizeSourceDates(fixture.crm,fixture.delivery,'Europe/London');
const accounts=validateInputs(normalized.crm,normalized.delivery,34);
check('34 unique fictional inputs join with matching assessment dates',()=>assert.equal(new Set(accounts.map(a=>a.account_id)).size,34));
check('All manually specified scenario labels and urgent flags match the rubric',()=>{
  for(const s of fixture.scenarios)assert.deepEqual(classifyExpected(accounts.find(a=>a.account_id===s.account_id)),{risk_class:s.expected_risk,urgent_flag:s.expected_urgent});
});
check('London summer-midnight timestamp restores the intended date',()=>{
  const crm=structuredClone(fixture.crm);crm[1].renewal_date='2026-10-14T23:00:00.000Z';
  assert.equal(normalizeSourceDates(crm,fixture.delivery,'Europe/London').crm[1].renewal_date,'2026-10-15');
});
check('Date-only input is preserved and invalid calendar dates are rejected',()=>{
  assert.equal(normalized.crm[1].renewal_date,'2026-10-15');
  const crm=structuredClone(fixture.crm);crm[0].review_date='2026-02-30';
  assert.throws(()=>normalizeSourceDates(crm,fixture.delivery,'Europe/London'),/invalid calendar date/);
});
check('Missing delivery input stops before a model request can be prepared',()=>assert.throws(()=>validateInputs(fixture.crm,fixture.delivery.slice(1),34),/expected 34 delivery rows/));
check('Duplicate accounts and mismatched review dates are rejected',()=>{
  const duplicate=structuredClone(fixture.crm);duplicate[1].account_id=duplicate[0].account_id;
  assert.throws(()=>validateInputs(duplicate,fixture.delivery,34),/duplicate CRM account/);
  const delivery=structuredClone(fixture.delivery);delivery[0].review_date='2026-09-01';
  assert.throws(()=>validateInputs(fixture.crm,delivery,34),/review dates differ/);
});
const config={expected_account_count:34,batch_size:8,batch_key:'LOCAL_CHECK',force_run_key:''};
const newQueue=()=>accounts.map((a,i)=>({id:i+1,account_id:a.account_id,client_name:a.client_name,draft_version:null,version_token:null}));
let completedQueue;
check('Five simulated successful batches cover all 34 accounts once then stop',()=>{
  const queue=newQueue(),audit=[],ids=[],sizes=[];
  for(let i=0;i<5;i++){
    const work=chooseWork(queue,audit,config);assert.ok(work);sizes.push(work.selected.length);
    audit.push({run_id:work.run_id,event_type:'RUN_STARTED'});
    assert.equal(chooseWork(queue,audit,config),null);
    for(const row of work.selected){ids.push(row.account_id);Object.assign(row,{draft_version:1,version_token:'LOCAL-'+row.account_id,approval_status:'Awaiting review',delivery_status:'Not ready'});}
    audit.push({run_id:work.run_id,event_type:'RUN_COMPLETED'});
  }
  assert.deepEqual(sizes,[8,8,8,8,2]);assert.equal(new Set(ids).size,34);assert.equal(ids.length,34);
  assert.equal(chooseWork(queue,audit,config),null);completedQueue=queue;
});
check('An initial failed attempt is not silently retried',()=>{
  const queue=newQueue(),work=chooseWork(queue,[],config);
  const audit=['RUN_STARTED','RUN_FAILED'].map(event_type=>({run_id:work.run_id,event_type}));
  assert.equal(chooseWork(queue,audit,config),null);
  assert.equal(chooseWork(queue,audit,{...config,force_run_key:'RECOVERY-01'}).run_kind,'forced');
});
check('Only the returned draft is selected for revision',()=>{
  const queue=structuredClone(completedQueue);queue[3].approval_status='Returned for revision';
  const work=chooseWork(queue,[],config);assert.equal(work.run_kind,'revision');assert.deepEqual(work.selected.map(x=>x.account_id),['C004']);
});
const kinds={Green:'none',Amber:'amber_email',Red:'red_plan','Review Pending':'health_update'};
const fakeRows=accounts.map(a=>{
  const risk=classifyExpected(a),kind=kinds[risk.risk_class];
  const text=kind==='none'?'':kind==='amber_email'?`Hi ${a.client_contact},\nThis is a local mock for validation only.\nBest,\n${a.account_manager}`:kind==='red_plan'?`Issue: local mock only. Owner: ${a.account_manager}. Manager: ${a.manager_name}.`:`Hi ${a.account_manager},\nPlease supply the missing current health information for this local mock.`;
  return {account_id:a.account_id,...risk,reason:'Local mock rationale only.',draft_kind:kind,subject:kind==='none'?'':'Local mock only',draft_text:text};
});
const response=rows=>({status:'completed',id:'mock-response-not-from-openai',model:'local-mock',output:[{content:[{type:'output_text',text:JSON.stringify({accounts:rows})}]}]});
check('Validator accepts a correctly shaped local mock, not a real model result',()=>assert.equal(parseModelResponse(response(fakeRows),accounts).length,34));
check('Wrong risk, extra approval fields and the known unsupported sign-off are blocked',()=>{
  let rows=structuredClone(fakeRows);rows[1].risk_class='Green';assert.throws(()=>parseModelResponse(response(rows),accounts),/rubric mismatch/);
  rows=structuredClone(fakeRows);rows[1].approval_status='Approved';assert.throws(()=>parseModelResponse(response(rows),accounts),/unexpected output fields/);
  rows=structuredClone(fakeRows);rows[3].draft_text+='\nThanks,\nLeo Martin';assert.throws(()=>parseModelResponse(response(rows),accounts),/must remain unsigned/);
});
check('Current-version approval requires authenticated identity and explicit acknowledgement',()=>{
  const user={id:'local-reviewer',email:'reviewer@example.test',firstName:'Local',lastName:'Reviewer'};
  const row={...completedQueue[1],draft_kind:'amber_email',draft_text:'Local mock draft for verification.'};
  const bound={row,reviewer:{id:user.id}};
  const submission={user,decision:'Approve',comment:'Local mock approval only.',reviewed:['I reviewed this exact version']};
  const decision=decisionUpdate(bound,submission,row,user.email,'2026-09-19T00:00:00Z');
  assert.ok(isReady({...row,...decision.patch}));
  assert.throws(()=>decisionUpdate(bound,{...submission,reviewed:[]},row,user.email,'now'),/confirm/);
  assert.throws(()=>decisionUpdate(bound,submission,{...row,version_token:'NEW-VERSION'},user.email,'now'),/REVIEW_STALE/);
  assert.throws(()=>decisionUpdate(bound,{...submission,user:{...user,email:'other@example.test'}},row,user.email,'now'),/REVIEW_AUTH/);
});
const workflows=await Promise.all(['01_Setup_34_Accounts.json','02_Scheduled_Processing.json','03_Human_Review.json'].map(read));
check('All generated node code parses and connections reference existing nodes',()=>{
  for(const w of workflows){
    const names=new Set(w.nodes.map(n=>n.name));assert.equal(names.size,w.nodes.length);
    for(const n of w.nodes)if(n.type==='n8n-nodes-base.code')new Function(n.parameters.jsCode);
    for(const [name,outputs] of Object.entries(w.connections)){assert.ok(names.has(name));for(const ports of Object.values(outputs))for(const links of ports)for(const link of links)assert.ok(names.has(link.node));}
  }
});
check('Imports are inactive, contain no old table IDs/credentials or messaging nodes, and retain review authentication',()=>{
  const serialized=JSON.stringify(workflows);
  for(const value of ['@gmail.com','app.n8n.cloud'])assert.ok(!serialized.includes(value));
  for(const w of workflows){assert.equal(w.active,false);for(const n of w.nodes){assert.equal(n.credentials,undefined);assert.ok(!/gmail|sendEmail|microsoftOutlook|slack|telegram/i.test(n.type));}}
  const form=workflows[2].nodes.find(n=>n.name==='Authenticated review form').parameters;
  assert.equal(form.authentication,'n8nUserAuth');assert.equal(form.requireExecuteAccess,true);assert.equal(form.options.includeUserInOutput,true);
  const settings=workflows[1].nodes.find(n=>n.name==='Run settings').parameters.assignments.assignments;
  assert.equal(settings.find(x=>x.name==='force_run_key').value,'');assert.equal(settings.find(x=>x.name==='simulate_input_failure').value,false);
});
const result={scope:'Local logic, mocked responses and import structure only. No n8n execution or OpenAI call.',passed:checks.length,failed:0,checks,n8n_runtime:'NOT_RUN',observed_model_accuracy:null};
await fs.writeFile(path.join(root,'local_checks.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,failed:0,n8n_runtime:'NOT_RUN',observed_model_accuracy:null}));
