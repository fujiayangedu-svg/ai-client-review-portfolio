// DATEFIX-01 — replace all JavaScript in Validate and snapshot inputs.
// Business dates use Europe/London for this fixture; the scheduler timezone is unchanged.
function normalizeSourceDates(crm, delivery, sourceTimezone) {
  const fail = message => { throw new Error('INPUT_VALIDATION: DATEFIX-01: ' + message); };
  if (!Array.isArray(crm) || !Array.isArray(delivery)) fail('both connected sources must be arrays');
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: sourceTimezone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { fail('unsupported source calendar timezone: ' + sourceTimezone); }
  const conversions = [];
  const normalize = (raw, source, accountId, field, optional) => {
    const blank = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
    let normalized, representation;
    if (blank) {
      if (!optional) fail(`${source} ${accountId}: missing ${field}`);
      normalized = null;
      representation = 'missing_optional';
    } else {
      if (typeof raw !== 'string') fail(`${source} ${accountId}: ${field} must be an ISO date string`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const check = new Date(raw + 'T00:00:00.000Z');
        if (Number.isNaN(check.getTime()) || check.toISOString().slice(0,10) !== raw) {
          fail(`${source} ${accountId}: invalid calendar date in ${field}`);
        }
        normalized = raw;
        representation = 'date_only';
      } else {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw)) {
          fail(`${source} ${accountId}: ${field} must be YYYY-MM-DD or a UTC ISO timestamp`);
        }
        const instant = new Date(raw);
        if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0,19) !== raw.slice(0,19)) {
          fail(`${source} ${accountId}: invalid timestamp in ${field}`);
        }
        const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type,p.value]));
        if (parts.hour !== '00' || parts.minute !== '00' || parts.second !== '00' || instant.getUTCMilliseconds() !== 0) {
          fail(`${source} ${accountId}: ${field} is not midnight in ${sourceTimezone}; inspect source date encoding`);
        }
        normalized = `${parts.year.padStart(4,'0')}-${parts.month}-${parts.day}`;
        representation = 'timestamp_at_source_midnight';
      }
    }
    conversions.push({source,account_id:accountId,field,original_value:raw ?? null,normalized_date:normalized,representation,utc_date_changed:representation === 'timestamp_at_source_midnight' && normalized !== raw.slice(0,10)});
    return normalized;
  };
  const convertRows = (rows, source, fields) => rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail(`${source}: invalid row`);
    const converted = {...row};
    for (const field of fields) converted[field] = normalize(row[field],source,row.account_id || 'unknown',field,field === 'health_updated_date');
    return converted;
  });
  const normalizedCrm = convertRows(crm,'crm',['review_date','last_interaction_date','renewal_date','health_updated_date']);
  const normalizedDelivery = convertRows(delivery,'delivery',['review_date','milestone_date']);
  return {
    crm: normalizedCrm, delivery: normalizedDelivery,
    evidence: {
      patch_id: 'DATEFIX-01', source_calendar_timezone: sourceTimezone,
      policy: 'Preserve valid date-only strings; decode UTC timestamps only when they represent midnight in the configured source calendar timezone; reject unexpected times. Raw read-node snapshots remain unchanged.',
      timezone_basis: 'Prototype policy checked against all original CSV dates; workspace import timezone has not been inspected.',
      date_field_count: conversions.length,
      nonblank_date_count: conversions.filter(c => c.normalized_date !== null).length,
      utc_date_change_count: conversions.filter(c => c.utc_date_changed).length,
      conversions,
    },
  };
}

function validateInputs(crm, delivery, expectedCount) {
  const fail = message => { throw new Error('INPUT_VALIDATION: ' + message); };
  const blank = value => value === null || value === undefined || String(value).trim() === '';
  const text = (row, key) => {
    if (blank(row[key])) fail(`${row.account_id || 'unknown'}: missing ${key}`);
    if (typeof row[key] !== 'string') fail(`${row.account_id || 'unknown'}: ${key} must be text`);
    return row[key].trim();
  };
  const integer = (row, key, nullable = false) => {
    if (blank(row[key])) {
      if (nullable) return null;
      fail(`${row.account_id}: missing ${key}`);
    }
    if (!['string', 'number'].includes(typeof row[key])) fail(`${row.account_id}: invalid ${key}`);
    const n = Number(row[key]);
    if (!Number.isInteger(n) || n < 0) fail(`${row.account_id}: ${key} must be a non-negative integer`);
    return n;
  };
  const date = (row, key, nullable = false) => {
    if (blank(row[key])) {
      if (nullable) return null;
      fail(`${row.account_id}: missing ${key}`);
    }
    const raw = String(row[key]);
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(raw)) fail(`${row.account_id}: invalid ISO date in ${key}`);
    const day = raw.slice(0, 10);
    const parsed = new Date(day + 'T00:00:00.000Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) fail(`${row.account_id}: invalid calendar date in ${key}`);
    return day;
  };
  if (!Array.isArray(crm) || crm.length !== expectedCount) fail(`expected ${expectedCount} CRM rows; found ${crm?.length ?? 'no array'}`);
  if (!Array.isArray(delivery) || delivery.length !== expectedCount) fail(`expected ${expectedCount} delivery rows; found ${delivery?.length ?? 'no array'}`);
  const crmIds = new Set();
  const deliveryById = new Map();
  for (const row of delivery) {
    const id = text(row, 'account_id');
    if (deliveryById.has(id)) fail(`duplicate delivery account ${id}`);
    const d = {account_id:id, review_date:date(row,'review_date'), delivery_status:text(row,'delivery_status'), project_name:text(row,'project_name'), recent_milestone:text(row,'recent_milestone'), milestone_date:date(row,'milestone_date'), delivery_note:text(row,'delivery_note')};
    if (!['on_track','at_risk','blocked'].includes(d.delivery_status)) fail(`${id}: invalid delivery_status`);
    if (d.milestone_date > d.review_date) fail(`${id}: milestone_date is after review_date`);
    deliveryById.set(id, d);
  }
  const accounts = crm.map(row => {
    const id = text(row, 'account_id');
    if (crmIds.has(id)) fail(`duplicate CRM account ${id}`);
    crmIds.add(id);
    const d = deliveryById.get(id);
    if (!d) fail(`missing delivery match for ${id}`);
    const c = {account_id:id};
    for (const key of ['client_name','account_manager','manager_name','client_contact','last_interaction_type','open_issue_severity','issue_summary','relationship_note']) c[key] = text(row,key);
    for (const key of ['review_date','last_interaction_date','renewal_date']) c[key] = date(row,key);
    c.health_updated_date = date(row,'health_updated_date',true);
    for (const key of ['interactions_count','open_issue_count','oldest_open_issue_days']) c[key] = integer(row,key);
    c.health_score = integer(row,'health_score',true);
    if (c.health_score !== null && (c.health_score < 1 || c.health_score > 5)) fail(`${id}: health_score must be 1–5 or blank`);
    if (!['none','low','medium','high','critical'].includes(c.open_issue_severity)) fail(`${id}: invalid open_issue_severity`);
    if (c.open_issue_count === 0 && (c.open_issue_severity !== 'none' || c.oldest_open_issue_days !== 0)) fail(`${id}: contradictory issue fields`);
    if (c.open_issue_count > 0 && c.open_issue_severity === 'none') fail(`${id}: open issues require a severity`);
    if (c.review_date !== d.review_date) fail(`${id}: CRM and delivery review dates differ`);
    if (c.last_interaction_date > c.review_date || (c.health_updated_date && c.health_updated_date > c.review_date)) fail(`${id}: activity or health update is after review_date`);
    if (c.interactions_count === 0 && c.last_interaction_date >= c.review_date.slice(0,7)+'-01') fail(`${id}: zero interactions contradict last interaction date`);
    return {...c,...d};
  });
  if (new Set(accounts.map(a=>a.review_date)).size !== 1) fail('accounts have different review dates');
  return accounts;
}

function chooseWork(queue,audit,config){
 const count=Number(config.expected_account_count),size=Number(config.batch_size);
 if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(size)||size<1||size>8)throw new Error('CONFIGURATION: use 1-100 accounts and batches of 1-8.');
 if(queue.length!==count||new Set(queue.map(r=>r.account_id)).size!==count)throw new Error('QUEUE_VALIDATION: expected '+count+' unique account slots');
 for(const r of queue)if(!Number.isInteger(Number(r.id))||Number(r.id)<=0)throw new Error('QUEUE_VALIDATION: storage row ID missing');
 if(!/^[A-Za-z0-9_-]{1,60}$/.test(config.batch_key))throw new Error('CONFIGURATION: invalid batch_key');
 if(config.force_run_key&&!/^[A-Za-z0-9_-]{1,60}$/.test(config.force_run_key))throw new Error('CONFIGURATION: invalid force_run_key');
 const rows=[...queue].sort((a,b)=>a.account_id.localeCompare(b.account_id));
 const starts=id=>audit.filter(e=>e.run_id===id&&e.event_type==='RUN_STARTED');
 const started=id=>starts(id).length>0;
 const completed=id=>audit.some(e=>e.run_id===id&&e.event_type==='RUN_COMPLETED');
 const failureEvidence=id=>{
   const direct=audit.find(e=>e.run_id===id&&e.event_type==='RUN_FAILED');
   if(direct)return {kind:'direct',event:direct};
   // FIX02: reconcile the observed legacy UNASSIGNED failure only by a unique
   // execution ID. Never infer failure from elapsed time or an absent event.
   const s=starts(id);if(s.length!==1||completed(id))return null;
   const execution=String(s[0].execution_id??'');if(!/^\d+$/.test(execution))return null;
   if(audit.filter(e=>e.event_type==='RUN_STARTED'&&String(e.execution_id)===execution).length!==1)return null;
   const f=audit.filter(e=>e.event_type==='RUN_FAILED'&&e.run_id==='UNASSIGNED-'+execution&&String(e.execution_id)===execution);
   if(f.length!==1)return null;
   let payload;try{payload=JSON.parse(f[0].payload_json);}catch{return null;}
   if(payload.run_id!==f[0].run_id||!Array.isArray(payload.errors)||payload.errors.length===0)return null;
   return {kind:'execution_id_reconciliation',event:f[0]};
 };
 const failed=id=>Boolean(failureEvidence(id));
 const terminalProcessingRow=r=>{
   if(r.approval_status!=='Processing'||!r.run_id||completed(r.run_id))return false;
   const s=starts(r.run_id),f=failureEvidence(r.run_id);if(s.length!==1||!f)return false;
   const execution=String(s[0].execution_id??'');
   return /^\d+$/.test(execution)&&String(f.event.execution_id)===execution&&
     Number.isInteger(r.draft_version)&&r.draft_version>0&&
     r.version_token==='GEN-'+execution+'-'+r.account_id+'-V'+r.draft_version&&r.delivery_status==='Not ready';
 };
 // A genuinely unfinished or ambiguous attempt still blocks new work.
 if(audit.some(e=>e.event_type==='RUN_STARTED'&&!completed(e.run_id)&&!failed(e.run_id)))return null;
 const make=(selected,run_id,run_kind)=>{
   const result={run_id,run_kind,selected,queue_snapshot:queue,configuration:config};
   if(run_kind==='recovery')result.recovery_context={
     policy:'PORTFOLIO-FIX02',
     source_failures:[...new Set(selected.map(r=>r.run_id).filter(Boolean))].map(id=>{
       const f=failureEvidence(id),s=starts(id)[0];
       return {original_run_id:id,original_execution_id:s?.execution_id??null,
         started_audit_row_id:s?.id??null,failed_audit_row_id:f?.event.id??null,
         recorded_failure_run_id:f?.event.run_id??null,match_method:f?.kind??'unavailable'};
     }),
     previous_statuses:selected.map(r=>({account_id:r.account_id,version_token:r.version_token,approval_status:r.approval_status})),
     note:'Original audit and queue snapshots are retained. The next version is claimed conditionally against each unchanged previous row.'
   };
   return result;
 };
 const resume=typeof config.force_run_key==='string'&&config.force_run_key.startsWith('RESUME-');
 const recoveryId=i=>config.force_run_key+'-B'+String(i/size+1).padStart(2,'0');
 if(rows.some(r=>r.approval_status==='Processing'&&!terminalProcessingRow(r)))return null;
 if(config.force_run_key&&!resume){
   // Legacy full regeneration cannot override any outstanding Processing row.
   if(rows.some(r=>r.approval_status==='Processing'))return null;
   for(let i=0;i<rows.length;i+=size){
     const id='FORCE-'+config.force_run_key+'-B'+String(i/size+1).padStart(2,'0');
     if(failed(id))return null;
     if(completed(id))continue;
     if(started(id))return null;
     return make(rows.slice(i,i+size),id,'forced');
   }
   return null;
 }
 if(rows.some(r=>r.approval_status==='Processing failed'||terminalProcessingRow(r))){
   if(!resume)return null;
   for(let i=0;i<rows.length;i+=size){
     const part=rows.slice(i,i+size).filter(r=>r.approval_status==='Processing failed'||terminalProcessingRow(r));
     if(!part.length)continue;
     const id=recoveryId(i);if(started(id))return null;
     return make(part,id,'recovery');
   }
 }
 for(let i=0;i<rows.length;i+=size){
   const part=rows.slice(i,i+size),id='INITIAL-'+config.batch_key+'-B'+String(i/size+1).padStart(2,'0');
   if(part.every(r=>r.version_token))continue;
   if(started(id)){
     if(!resume||!failed(id))return null;
     const retry=recoveryId(i);if(started(retry))return null;
     return make(part,retry,'recovery');
   }
   if(part.some(r=>r.version_token))throw new Error('QUEUE_VALIDATION: partially initialized batch; investigate before using a full force key');
   return make(part,id,'initial');
 }
 const returned=rows.filter(r=>r.approval_status==='Returned for revision');
 if(!returned.length)return null;
 const id='REV-'+returned[0].version_token;
 return started(id)?null:make([returned[0]],id,'revision');
}
function classifyExpected(a) {
  const day = value => Date.parse(value+'T00:00:00.000Z') / 86400000;
  const contactAge = day(a.review_date)-day(a.last_interaction_date);
  const renewalDays = day(a.renewal_date)-day(a.review_date);
  const red = (a.health_score !== null && a.health_score <= 2) || a.interactions_count === 0 || contactAge >= 30 || (a.open_issue_count > 0 && (['high','critical'].includes(a.open_issue_severity) || a.oldest_open_issue_days >= 14)) || a.delivery_status === 'blocked';
  const pending = a.health_score === null || !a.health_updated_date || a.health_updated_date < a.review_date.slice(0,7)+'-01';
  const amber = a.health_score === 3 || (a.interactions_count >= 1 && a.interactions_count <= 2) || (contactAge >= 14 && contactAge < 30) || a.open_issue_count > 0 || renewalDays <= 60 || a.delivery_status === 'at_risk';
  return {risk_class:pending?'Review Pending':red?'Red':amber?'Amber':'Green',urgent_flag:red};
}
function parseModelResponse(response, accounts) {
  if(response.status!=='completed' || !response.model || !response.id) throw new Error('AI_VALIDATION: response is incomplete or lacks model/response ID');
  const text=(response.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n');
  let result;
  try {result=JSON.parse(text);} catch {throw new Error('AI_VALIDATION: response is not valid JSON');}
  if(!result || Array.isArray(result) || Object.keys(result).join(',')!=='accounts' || !Array.isArray(result.accounts) || result.accounts.length!==accounts.length) throw new Error('AI_VALIDATION: wrong result shape or account count');
  const fields=['account_id','risk_class','reason','urgent_flag','draft_kind','subject','draft_text'].sort();
  const seen=new Set();
  const expectedKinds={Green:'none',Amber:'amber_email',Red:'red_plan','Review Pending':'health_update'};
  for(const row of result.accounts) {
    if(!row || Array.isArray(row) || JSON.stringify(Object.keys(row).sort())!==JSON.stringify(fields)) throw new Error('AI_VALIDATION: missing or unexpected output fields');
    const a=accounts.find(x=>x.account_id===row.account_id);
    if(!a || seen.has(row.account_id)) throw new Error('AI_VALIDATION: unknown or duplicate account');
    seen.add(row.account_id);
    const expected=classifyExpected(a);
    if(row.risk_class!==expected.risk_class || row.urgent_flag!==expected.urgent_flag) throw new Error('AI_VALIDATION: rubric mismatch for '+row.account_id);
    if(row.draft_kind!==expectedKinds[row.risk_class]) throw new Error('AI_VALIDATION: wrong draft kind for '+row.account_id);
    if(typeof row.reason!=='string' || row.reason.trim().length<8 || row.reason.length>1500) throw new Error('AI_VALIDATION: missing or excessive rationale');
    if(typeof row.subject!=='string' || row.subject.length>200 || typeof row.draft_text!=='string' || row.draft_text.length>4500) throw new Error('AI_VALIDATION: invalid draft text');
    if(row.draft_kind==='none') {
      if(row.subject!=='' || row.draft_text!=='') throw new Error('AI_VALIDATION: Green must not have outreach text');
    } else if(!row.subject.trim() || row.draft_text.trim().length<20) throw new Error('AI_VALIDATION: empty draft');
    if(row.risk_class==='Red' && (!row.draft_text.includes(a.account_manager) || !row.draft_text.includes(a.manager_name))) throw new Error('AI_VALIDATION: Red plan must identify the supplied owner and manager');
  }
  for(const row of result.accounts){
    const a=accounts.find(x=>x.account_id===row.account_id);
    if(row.draft_kind==='health_update'){
      if(!row.draft_text.startsWith('Hi '+a.account_manager+','))throw new Error('AI_VALIDATION: health request must address the supplied account manager');
      if(/(?:^|\n)\s*(?:thanks|thank you|best|regards|kind regards|sincerely)[,!]?\s*(?:\n|$)/i.test(row.draft_text))throw new Error('AI_VALIDATION: internal health requests must remain unsigned');
      const foreignNames=accounts.filter(x=>x.account_id!==a.account_id).flatMap(x=>[x.account_manager,x.manager_name,x.client_contact]).filter(n=>![a.account_manager,a.manager_name,a.client_contact].includes(n));
      if(foreignNames.some(n=>row.draft_text.includes(n)))throw new Error('AI_VALIDATION: name from a different account in health request');
    }
    if(row.draft_kind==='amber_email'&&row.draft_text.trim().split(/\r?\n/).at(-1).trim()!==a.account_manager)throw new Error('AI_VALIDATION: Amber email must end with its account manager name');
  }
  return result.accounts;
}
function reviewerIdentity(user, allowedEmail) {
  if(!allowedEmail || allowedEmail.includes('ENTER_')) throw new Error('REVIEW_CONFIGURATION: enter your n8n sign-in email in Reviewer settings');
  if(!user || typeof user.id!=='string' || !user.id || typeof user.email!=='string') throw new Error('REVIEW_AUTH: authenticated n8n user identity is missing');
  if(user.email.trim().toLowerCase()!==allowedEmail.trim().toLowerCase()) throw new Error('REVIEW_AUTH: this account is not the configured test reviewer');
  return {id:user.id,email:user.email,name:[user.firstName,user.lastName].filter(Boolean).join(' ')||user.email};
}
function assertCurrentDraft(bound, current) {
  if(!current || current.approval_status!=='Awaiting review') throw new Error('REVIEW_STALE: this version is no longer awaiting review; reopen the review queue');
  const protectedFields=['id','account_id','client_name','draft_version','version_token','run_id','risk_class','reason','draft_kind','draft_subject','draft_text','source_json'];
  for(const k of protectedFields) if(current[k]!==bound[k]) throw new Error('REVIEW_STALE: the account or draft changed after you opened it; reopen the review queue');
}
function decisionUpdate(bound, submission, current, allowedEmail, recordedAt) {
  const who=reviewerIdentity(submission.user,allowedEmail);
  if(who.id!==bound.reviewer.id) throw new Error('REVIEW_AUTH: reviewer changed during this review');
  if(!['Approve','Return for revision'].includes(submission.decision)) throw new Error('REVIEW_INPUT: choose Approve or Return for revision');
  if(!Array.isArray(submission.reviewed) || !submission.reviewed.includes('I reviewed this exact version')) throw new Error('REVIEW_INPUT: confirm that you reviewed this exact version');
  const comment=typeof submission.comment==='string'?submission.comment.trim():'';
  if(!comment || comment.length>2000) throw new Error('REVIEW_INPUT: provide a review comment of 1–2000 characters');
  assertCurrentDraft(bound.row,current);
  const approved=submission.decision==='Approve';
  return {reviewer:who,decision:submission.decision,comment,row_before:bound.row,patch:{approval_status:approved?'Approved':'Returned for revision',delivery_status:approved?(bound.row.draft_kind==='none'?'No action':'Ready for manual sending'):'Not ready',reviewer_id:who.id,reviewer_name:who.name,reviewed_at:recordedAt,review_comment:comment}};
}
function isReady(row) {
  return row.approval_status==='Approved' && row.delivery_status==='Ready for manual sending' && Boolean(row.version_token) && Number(row.draft_version)>0 && ['amber_email','red_plan','health_update'].includes(row.draft_kind) && Boolean(row.draft_text) && Boolean(row.reviewer_id) && Boolean(row.reviewed_at);
}
function policyDecision(a){
 const decision=classifyExpected(a),dates=calendarFacts(a);
 const pending=[],red=[],amber=[];
 if(a.health_score===null)pending.push('health_score is missing');
 if(!a.health_updated_date)pending.push('health_updated_date is missing');
 else if(dates.health_update_relative_to_month_start==='before')pending.push('health_updated_date is before '+dates.review_month_start);
 if(a.health_score!==null&&a.health_score<=2)red.push('health_score is '+a.health_score+' (Red: 1 or 2)');
 if(a.interactions_count===0)red.push('interactions_count is zero');
 if(dates.days_since_last_interaction>=30)red.push('last contact is '+dates.days_since_last_interaction+' days ago (Red: 30 or more)');
 if(a.open_issue_count>0&&['high','critical'].includes(a.open_issue_severity))red.push('an open issue has '+a.open_issue_severity+' severity');
 if(a.open_issue_count>0&&a.oldest_open_issue_days>=14)red.push('oldest open issue is '+a.oldest_open_issue_days+' days old (Red: 14 or more)');
 if(a.delivery_status==='blocked')red.push('project delivery is blocked');
 if(a.health_score===3)amber.push('health_score is 3');
 if(a.interactions_count>=1&&a.interactions_count<=2)amber.push('interactions_count is '+a.interactions_count+' (Amber: 1 or 2)');
 if(dates.days_since_last_interaction>=14&&dates.days_since_last_interaction<30)amber.push('last contact is '+dates.days_since_last_interaction+' days ago (Amber: 14 through 29 inclusive)');
 if(a.open_issue_count>0)amber.push('open_issue_count is '+a.open_issue_count);
 if(dates.days_until_renewal<=60)amber.push('renewal is '+dates.days_until_renewal+' days from review_date (Amber: 60 or fewer, including overdue)');
 if(a.delivery_status==='at_risk')amber.push('project delivery is at_risk');
 return {policy_version:'rubric-v1',classification_method:'deterministic_code',...decision,
   draft_kind:({Green:'none',Amber:'amber_email',Red:'red_plan','Review Pending':'health_update'})[decision.risk_class],
   matched_signals:{review_pending:pending,red,amber}};
}
function calendarFacts(account){
 const day=value=>Date.parse(value+'T00:00:00.000Z')/86400000;
 const first=account.review_date.slice(0,7)+'-01';
 const health=account.health_updated_date;
 return {
   review_month_start:first,
   health_update_relative_to_month_start:!health?'missing':health<first?'before':health===first?'equal':'after',
   days_since_last_interaction:day(account.review_date)-day(account.last_interaction_date),
   days_until_renewal:day(account.renewal_date)-day(account.review_date)
 };
}
export {policyDecision,calendarFacts,normalizeSourceDates,validateInputs,chooseWork,classifyExpected,parseModelResponse,reviewerIdentity,assertCurrentDraft,decisionUpdate,isReady};
