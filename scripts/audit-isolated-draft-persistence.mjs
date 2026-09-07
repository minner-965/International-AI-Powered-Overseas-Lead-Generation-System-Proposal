import fs from 'node:fs/promises';

// Extend the reviewed temporary-database runner. Never call a provider or operational write API.
// Run in the dashboard container (its database environment stays private):
// docker compose exec -T -e PHASE11_APP_ROOT=/app demo-dashboard node /app/project-scripts/audit-isolated-draft-persistence.mjs
// For an unbuilt script, docker compose cp this file and the two phase11-*isolated*.mjs siblings to /tmp first.
if(!process.env.POSTGRES_USER||!process.env.POSTGRES_PASSWORD||!process.env.POSTGRES_DB){
  console.error('Database environment required. Run inside the dashboard container with PHASE11_APP_ROOT=/app; do not print or pass credentials on the command line.');
  process.exit(1);
}
async function draftCases({pool,repository,check,pg,config,assert,hash,report}) {
  const source=new pg.Client({...config,database:process.env.POSTGRES_DB,options:'-c default_transaction_read_only=on'});
  await source.connect();
  const qid=x=>{assert.match(x,/^[a-z_][a-z0-9_]*$/);return `"${x}"`;};
  let seed;
  try {
    const candidates=(await source.query("SELECT id FROM leadgen.outreach_drafts WHERE draft_status='APPROVED' ORDER BY updated_at DESC")).rows;
    const reader=new repository.constructor({pool:{query:(sql,values)=>source.query(sql.replace(/FOR UPDATE OF d,s,r,q/g,''),values)}});
    for(const candidate of candidates){try{await reader.assertCurrentDraftGate(candidate.id);seed=await reader.getDraft(candidate.id);break;}catch(error){if(error.code!=='DRAFT_CURRENT_GATE_BLOCKED')throw error;}}
    assert.ok(seed,'A currently eligible approved source draft is required');
    const fks=(await source.query(`SELECT c.conrelid::regclass::text child,c.confrelid::regclass::text parent,
      array_agg(a.attname::text ORDER BY u.ord) cols,array_agg(b.attname::text ORDER BY u.ord) refs
      FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY u(k,r,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.k
      JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=u.r
      WHERE c.contype='f' AND c.connamespace='leadgen'::regnamespace GROUP BY c.oid`)).rows;
    const rows=new Map();
    const collect=async(table,where,params)=>{
      assert.match(table,/^leadgen\.[a-z_][a-z0-9_]*$/);
      let selected;try{selected=await source.query(`SELECT * FROM ${table} WHERE ${where}`,params);}catch(e){throw Object.assign(new Error(`Fixture read ${table} (${where}): ${e.message}`),{code:e.code});}
      for(const row of selected.rows){
        const key=table+JSON.stringify(row);if(rows.has(key))continue;rows.set(key,{table,row});
        assert.ok(rows.size<2000,'Fixture closure exceeded 2000 rows');
        for(const fk of fks.filter(f=>f.child===table)){
          if(fk.cols.some(c=>row[c]==null))continue;
          await collect(fk.parent,fk.refs.map((c,i)=>`${qid(c)}=$${i+1}`).join(' AND '),fk.cols.map(c=>row[c]));
        }
      }
    };
    await collect('leadgen.outreach_drafts','id=$1',[seed.id]);
    for(const table of ['business_opportunity_decision_snapshots','business_opportunity_management_events','contact_work_queue','outreach_eligibility_snapshots','company_suppressions','contact_suppressions','outreach_recipient_suppressions'])await collect(`leadgen.${table}`,'company_id=$1',[seed.company_id]);
    await collect('leadgen.marketing_context_approvals','marketing_context_version_id IN (SELECT id FROM leadgen.marketing_context_versions WHERE version=$1)',[seed.marketing_context_version]);
    // Source fixture is copied in memory only. Restore ordinary triggers before every tested operation.
    const loader=await pool.connect();
    try{await loader.query('SET session_replication_role=replica');
      for(const {table,row} of rows.values()){
        const cols=(await loader.query('SELECT attname::text FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND attgenerated=\'\' ORDER BY attnum',[table])).rows.map(r=>qid(r.attname)).join(',');
        await loader.query(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM json_populate_record(NULL::${table},$1::json) ON CONFLICT DO NOTHING`,[JSON.stringify(row)]);
      }
    }finally{await loader.query('SET session_replication_role=origin');loader.release();}
    await check('Copied fixture FK closure has zero missing referenced rows with triggers restored',async()=>{
      assert.equal((await pool.query('SHOW session_replication_role')).rows[0].session_replication_role,'origin');
      for(const fk of fks){
        assert.match(fk.child,/^leadgen\.[a-z_][a-z0-9_]*$/);assert.match(fk.parent,/^leadgen\.[a-z_][a-z0-9_]*$/);
        const present=fk.cols.map(c=>`c.${qid(c)} IS NOT NULL`).join(' AND ');
        const match=fk.cols.map((c,i)=>`p.${qid(fk.refs[i])}=c.${qid(c)}`).join(' AND ');
        assert.equal((await pool.query(`SELECT count(*)::int n FROM ${fk.child} c WHERE ${present} AND NOT EXISTS(SELECT 1 FROM ${fk.parent} p WHERE ${match})`)).rows[0].n,0,`Foreign-key closure ${fk.child} -> ${fk.parent}`);
      }
    });
    report.draft_fixture={source:'read-only current eligible draft and FK closure',copied_rows:rows.size,payloads_logged:false};
  }finally{await source.end();}
  await repository.assertCurrentDraftGate(seed.id);
  const input={...seed,version:1000,draft_status:'DRAFT',subject:'Audit isolated draft',body_text:'Audit isolated category introduction.',content_hash:hash('audit-v1000'),followups:[],skill_versions:{},policy_warnings:[],products:[],evidence:[],supersedes_draft_id:null,created_by:'isolated.audit'};
  let created,approval,revised;
  const fresh=async fn=>{const connection=new pg.Pool({...config,database:pool.options.database,max:1});try{return await fn(new repository.constructor({pool:connection}));}finally{await connection.end();}};
  await check('Real SQL createDraft persists content across a new connection',async()=>{
    created=(await repository.createDraft(input)).draft;
    const read=await fresh(r=>r.getDraft(created.id));assert.equal(read.subject,input.subject);assert.equal(read.body_text,input.body_text);assert.equal(read.draft_status,'DRAFT');assert.equal(read.version,1000);
  });
  await check('Wrong content hash fails submission without changing persisted state',async()=>{
    await assert.rejects(repository.submitDraft(created.id,{contentHash:hash('wrong')}),e=>e.code==='DRAFT_SUBMIT_VALIDATION_FAILED');assert.equal((await fresh(r=>r.getDraft(created.id))).draft_status,'DRAFT');
  });
  await check('Approval before submission is rejected without approval rows',async()=>{
    await assert.rejects(repository.createDraftApproval({draft_id:created.id,decision:'APPROVED'}),e=>e.code==='DRAFT_SUBMISSION_REQUIRED');assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outreach_approvals WHERE draft_id=$1',[created.id])).rows[0].n,0);
  });
  await check('Submission and exact-version approval survive reconnect',async()=>{
    await repository.submitDraft(created.id,{contentHash:input.content_hash});
    const contract=await repository.getDraftValidationContract(created.id);
    approval=(await repository.createDraftApproval({draft_id:created.id,decision:'APPROVED',approval_digest:hash('isolated-approved-v1000'),evidence_snapshot_hash:hash('evidence'),from_identity:'audit@example.test',reply_to:'audit@example.test',actor:'isolated.audit',role:'MANAGEMENT',reason:'Isolated persistence check',opportunity_snapshot_id:contract.current_opportunity_snapshot_id,management_event_id:contract.current_management_event_id,recipient_route_snapshot_hash:hash('route'),provider_purpose:'COLD_OUTREACH',expires_at:new Date(Date.now()+86400000)})).approval;
    const read=await fresh(r=>r.getDraft(created.id));assert.equal(read.draft_status,'APPROVED');assert.ok(read.submitted_at);assert.equal(approval.draft_version,1000);assert.equal(approval.content_hash,input.content_hash);
  });
  await check('Approved draft edit creates new version and preserves the approved body',async()=>{
    revised=await repository.reviseDraft(created.id,{...input,subject:'Revised isolated draft',body_text:'Revised audit body.',content_hash:hash('audit-v1001'),draft_status:'PENDING_REVIEW'});
    const old=await fresh(r=>r.getDraft(created.id));const current=await fresh(r=>r.getDraft(revised.id));assert.equal(old.body_text,input.body_text);assert.equal(old.draft_status,'SUPERSEDED');assert.equal(current.version,1001);assert.equal(current.body_text,'Revised audit body.');
    assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outreach_approvals WHERE draft_id=$1',[revised.id])).rows[0].n,0);
    const previous=await repository.getApprovalForEnqueue(approval.id);assert.equal(previous.draft_status,'SUPERSEDED');assert.equal(previous.content_hash,input.content_hash);
  });
  await check('Repeated stale save is rejected and creates no duplicate revision',async()=>{
    await assert.rejects(repository.reviseDraft(created.id,input),e=>e.code==='DRAFT_REVISION_FORBIDDEN');assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outreach_drafts WHERE supersedes_draft_id=$1',[created.id])).rows[0].n,1);
  });
  await check('Invalid empty-subject revision rolls back status and child insert atomically',async()=>{
    await assert.rejects(repository.reviseDraft(revised.id,{...input,subject:''}),e=>e.code==='23514');assert.equal((await fresh(r=>r.getDraft(revised.id))).draft_status,'PENDING_REVIEW');assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outreach_drafts WHERE supersedes_draft_id=$1',[revised.id])).rows[0].n,0);
  });
  await check('Recipient invalidation blocks save and approval without persisted changes',async()=>{
    await pool.query("UPDATE leadgen.outreach_recipients SET verification_status='INVALID' WHERE id=$1",[seed.recipient_id]);
    await assert.rejects(repository.reviseDraft(revised.id,input),e=>e.code==='DRAFT_CURRENT_GATE_BLOCKED');await assert.rejects(repository.createDraftApproval({draft_id:revised.id,decision:'APPROVED'}),e=>e.code==='DRAFT_CURRENT_GATE_BLOCKED');
    assert.equal((await fresh(r=>r.getDraft(revised.id))).draft_status,'PENDING_REVIEW');await pool.query("UPDATE leadgen.outreach_recipients SET verification_status='VALID' WHERE id=$1",[seed.recipient_id]);
  });
  await check('Company opt-out blocks creation submission and revision after persistence',async()=>{
    await pool.query("INSERT INTO leadgen.company_suppressions(company_id,suppression_type,reason) VALUES($1,'OPT_OUT','Isolated audit')",[seed.company_id]);
    await assert.rejects(repository.createDraft({...input,version:2000}),e=>e.code==='DRAFT_CURRENT_GATE_BLOCKED');
    await assert.rejects(repository.submitDraft(revised.id,{contentHash:revised.content_hash}),e=>e.code==='DRAFT_CURRENT_GATE_BLOCKED');
    await assert.rejects(repository.reviseDraft(revised.id,input),e=>e.code==='DRAFT_CURRENT_GATE_BLOCKED');
    assert.equal((await fresh(r=>r.getDraft(revised.id))).draft_status,'PENDING_REVIEW');
  });
  await check('No messages or provider attempts created by draft persistence checks',async()=>{assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outbound_messages')).rows[0].n,0);assert.equal((await pool.query('SELECT count(*)::int n FROM leadgen.outbound_message_attempts')).rows[0].n,0);});
}

let runner=await fs.readFile(new URL('./phase11-oq14-isolated-regression.mjs',import.meta.url),'utf8');
runner=runner.replace("import('./phase11-controlled-crm-isolated-cases.mjs')",`import(${JSON.stringify(new URL('./phase11-controlled-crm-isolated-cases.mjs',import.meta.url).href)})`);
runner=runner.replace("  report.result=report.checks.every",()=>`  await (${draftCases.toString()})({pool,repository,check,pg,config,assert,hash,report});\n  report.result=report.checks.every`);
await import(`data:text/javascript;base64,${Buffer.from(runner).toString('base64')}`);
