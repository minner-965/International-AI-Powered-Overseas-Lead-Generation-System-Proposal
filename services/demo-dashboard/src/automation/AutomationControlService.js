const clean=value=>String(value??'').trim();
const keyPattern=/^[A-Z][A-Z0-9_]{2,79}$/;
const fail=(code,status=422)=>Object.assign(new Error(code),{code,status});
const canonical=value=>JSON.stringify(value,Object.keys(value||{}).sort());

export const AUTOMATION_CONTROLS=Object.freeze({
  RESEARCH_PROVIDER_EXECUTION:'RESEARCH_PROVIDER_EXECUTION',
  PHASE13_AUTO_FIRST_TOUCH:'PHASE13_AUTO_FIRST_TOUCH',
  // Migration 068: contact research (decision-maker search + Hunter) has its own switch, default off.
  CONTACT_RESEARCH_EXECUTION:'CONTACT_RESEARCH_EXECUTION'
});

export class AutomationControlService {
  constructor({pool}={}) {
    if(!pool)throw new Error('AutomationControlService requires a PostgreSQL pool');
    this.pool=pool;
  }

  normalizeKey(value){
    const key=clean(value).toUpperCase();
    if(!keyPattern.test(key))throw fail('AUTOMATION_CONTROL_KEY_INVALID',400);
    return key;
  }

  async get(controlKey,queryable=this.pool){
    const key=this.normalizeKey(controlKey);
    const result=await queryable.query('SELECT * FROM leadgen.automation_controls WHERE control_key=$1',[key]);
    if(!result.rowCount)throw fail('AUTOMATION_CONTROL_NOT_FOUND',404);
    return result.rows[0];
  }

  async isEnabled(controlKey,queryable=this.pool){return (await this.get(controlKey,queryable)).enabled===true;}

  async requireEnabled(controlKey,queryable=this.pool){
    const control=await this.get(controlKey,queryable);
    if(control.enabled!==true)throw fail('AUTOMATION_CONTROL_DISABLED',503);
    return control;
  }

  async set({controlKey,enabled,settings={},actor,reason,idempotencyKey}={}){
    const key=this.normalizeKey(controlKey);
    if(typeof enabled!=='boolean')throw fail('AUTOMATION_CONTROL_ENABLED_INVALID',400);
    if(!settings||Array.isArray(settings)||typeof settings!=='object')throw fail('AUTOMATION_CONTROL_SETTINGS_INVALID',400);
    actor=clean(actor);reason=clean(reason);idempotencyKey=clean(idempotencyKey);
    if(!actor||!reason||!idempotencyKey||idempotencyKey.length>200)throw fail('AUTOMATION_CONTROL_AUDIT_CONTEXT_REQUIRED',400);
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const replay=await client.query('SELECT * FROM leadgen.automation_control_events WHERE idempotency_key=$1',[idempotencyKey]);
      if(replay.rowCount){
        const event=replay.rows[0];
        if(event.control_key!==key||event.enabled!==enabled||event.actor!==actor
          ||canonical(event.settings_snapshot)!==canonical(settings))throw fail('AUTOMATION_CONTROL_IDEMPOTENCY_CONFLICT',409);
        await client.query('COMMIT');
        return {...event,idempotent_replay:true};
      }
      const currentResult=await client.query('SELECT * FROM leadgen.automation_controls WHERE control_key=$1 FOR UPDATE',[key]);
      if(!currentResult.rowCount)throw fail('AUTOMATION_CONTROL_NOT_FOUND',404);
      const current=currentResult.rows[0],revision=Number(current.revision)+1;
      const event=(await client.query(`INSERT INTO leadgen.automation_control_events
        (control_key,revision,previous_enabled,enabled,settings_snapshot,actor,change_reason,idempotency_key)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,[
        key,revision,current.enabled,enabled,JSON.stringify(settings),actor,reason,idempotencyKey])).rows[0];
      await client.query(`UPDATE leadgen.automation_controls SET enabled=$2,revision=$3,settings=$4::jsonb,
        updated_by=$5,change_reason=$6,updated_at=now() WHERE control_key=$1`,[
        key,enabled,revision,JSON.stringify(settings),actor,reason]);
      await client.query('COMMIT');
      return {...event,idempotent_replay:false};
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }
}
