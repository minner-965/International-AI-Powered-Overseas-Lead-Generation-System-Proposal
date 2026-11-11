// Two-step sign-in with an authenticator app (TOTP, RFC 6238; migration 078). Required for the SIM
// administrator (ADMIN_2FA_REQUIRED, default on), optional for merchants (Simon 2026-11-11).
// Reused: otpauth (codes and otpauth:// links), qrcode (setup QR as a data URL, no external request),
// secretBox (AES-256-GCM with MERCHANT_SECRET_KEY) for the stored secret, argon2 for recovery codes.
import {randomInt} from 'node:crypto';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import {hash as argonHash,verify as argonVerify} from '@node-rs/argon2';
import {createSecretBox} from './secretBox.js';

export const TWO_FACTOR_ISSUER='SIM Prospecting';
export const RECOVERY_CODE_COUNT=10;
const PERIOD=30,WINDOW=1;
// Recovery codes: 10 characters in two groups, no look-alike characters (0/o, 1/l/i).
const ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
const bool=(value,fallback)=>value===undefined||value===null||value===''?fallback:/^(1|true|yes|on)$/i.test(String(value));
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});

export const twoFactorRequired=(user,env=process.env)=>user?.role==='ADMIN'&&bool(env.ADMIN_2FA_REQUIRED,true);
export const normalizeRecoveryCode=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function newRecoveryCode(){
  const chars=Array.from({length:10},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');
  return`${chars.slice(0,5)}-${chars.slice(5)}`;
}
/** Base32 secret in groups of four, for typing into an app by hand. */
export const groupedSecret=secret=>String(secret).replace(/(.{4})/g,'$1 ').trim();

export class TwoFactorService{
  constructor({pool,env=process.env,now=()=>Date.now()}={}){
    Object.assign(this,{pool,env,now});
    this.secretBox=createSecretBox(env.MERCHANT_SECRET_KEY);
  }
  totp(secret,label){
    return new OTPAuth.TOTP({issuer:TWO_FACTOR_ISSUER,label:String(label||'account'),algorithm:'SHA1',digits:6,period:PERIOD,
      secret:OTPAuth.Secret.fromBase32(secret)});
  }
  /** The 30-second step a correct code belongs to, or null. A step at or before lastStep is a replay. */
  codeStep(secret,label,code,lastStep=null){
    const token=String(code||'').replace(/\s/g,'');
    if(!/^\d{6}$/.test(token))return null;
    const now=this.now();
    const delta=this.totp(secret,label).validate({token,timestamp:now,window:WINDOW});
    if(delta===null)return null;
    const step=Math.floor(now/1000/PERIOD)+delta;
    if(lastStep!==null&&lastStep!==undefined&&step<=Number(lastStep))return null;
    return step;
  }
  context(userId){return`workspace-user-totp:${userId}`;}
  decrypt(ciphertext,userId){return this.secretBox.decrypt(ciphertext,this.context(userId));}
  async event(queryable,userId,type,actor){
    await queryable.query('INSERT INTO leadgen.two_factor_events(user_id,event_type,actor) VALUES($1,$2,$3)',[userId,type,String(actor||'workspace').slice(0,320)]);
  }
  async recoveryCodesLeft(userId){
    return Number((await this.pool.query(`SELECT count(*)::int n FROM leadgen.user_recovery_codes WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[userId])).rows[0]?.n||0);
  }
  async status(user){
    const enabled=Boolean(user?.totp_enabled_at);
    return{enabled,required:twoFactorRequired(user,this.env),enabled_at:user?.totp_enabled_at||null,
      recovery_codes_left:enabled?await this.recoveryCodesLeft(user.id):0};
  }
  async user(id,queryable=this.pool){return(await queryable.query('SELECT * FROM leadgen.workspace_users WHERE id=$1',[id])).rows[0]||null;}

  /** Step 1 of setup: a new secret, kept as pending until one correct code confirms the app has it. */
  async beginSetup(user){
    if(user.totp_enabled_at)throw fail('TWO_FACTOR_ALREADY_ENABLED','Two-step sign-in is already on',409);
    const secret=new OTPAuth.Secret({size:20}).base32;
    await this.pool.query('UPDATE leadgen.workspace_users SET totp_pending_ciphertext=$2,updated_at=now() WHERE id=$1',
      [user.id,this.secretBox.encrypt(secret,this.context(user.id))]);
    const uri=this.totp(secret,user.email).toString();
    return{otpauth_uri:uri,qr_data_url:await QRCode.toDataURL(uri,{margin:1,width:240,errorCorrectionLevel:'M'}),
      secret:groupedSecret(secret),issuer:TWO_FACTOR_ISSUER,account:user.email};
  }
  async issueRecoveryCodes(client,userId){
    await client.query('UPDATE leadgen.user_recovery_codes SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[userId]);
    const codes=Array.from({length:RECOVERY_CODE_COUNT},newRecoveryCode);
    for(const code of codes)await client.query('INSERT INTO leadgen.user_recovery_codes(user_id,code_hash) VALUES($1,$2)',[userId,await argonHash(normalizeRecoveryCode(code))]);
    return codes;
  }
  async transaction(fn){const c=await this.pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}

  /** Step 2 of setup: one correct code switches it on; the recovery codes are returned once. */
  async enable(user,code,actor){
    if(user.totp_enabled_at)throw fail('TWO_FACTOR_ALREADY_ENABLED','Two-step sign-in is already on',409);
    if(!user.totp_pending_ciphertext)throw fail('TWO_FACTOR_SETUP_NOT_STARTED','Start the setup first',409);
    const secret=this.decrypt(user.totp_pending_ciphertext,user.id);
    const step=this.codeStep(secret,user.email,code);
    if(step===null)throw fail('TWO_FACTOR_CODE_INVALID','The code is not correct; check the time on your phone and try again',400);
    return this.transaction(async client=>{
      await client.query(`UPDATE leadgen.workspace_users SET totp_secret_ciphertext=totp_pending_ciphertext,totp_pending_ciphertext=NULL,
        totp_enabled_at=now(),totp_last_step=$2,updated_at=now() WHERE id=$1`,[user.id,step]);
      const codes=await this.issueRecoveryCodes(client,user.id);
      await this.event(client,user.id,'ENABLED',actor);
      return{recovery_codes:codes};
    });
  }

  /** Second sign-in step. Returns the method used; throws TWO_FACTOR_CODE_INVALID otherwise. */
  async verifySignIn(user,{code=null,recovery_code=null}={}){
    if(!user?.totp_enabled_at)throw fail('TWO_FACTOR_NOT_ENABLED','Two-step sign-in is not on',409);
    if(recovery_code){
      const wanted=normalizeRecoveryCode(recovery_code);
      if(wanted.length===10){
        const open=(await this.pool.query(`SELECT id,code_hash FROM leadgen.user_recovery_codes WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL`,[user.id])).rows;
        for(const row of open){
          if(!await argonVerify(row.code_hash,wanted))continue;
          // Marked used once: two requests with the same code cannot both pass.
          const used=await this.pool.query('UPDATE leadgen.user_recovery_codes SET used_at=now() WHERE id=$1 AND used_at IS NULL RETURNING id',[row.id]);
          if(!used.rowCount)break;
          await this.event(this.pool,user.id,'RECOVERY_CODE_USED',user.email);
          return{method:'RECOVERY_CODE',recovery_codes_left:await this.recoveryCodesLeft(user.id)};
        }
      }
      throw fail('TWO_FACTOR_CODE_INVALID','The recovery code is not correct or was already used',401);
    }
    const step=this.codeStep(this.decrypt(user.totp_secret_ciphertext,user.id),user.email,code,user.totp_last_step);
    // The step only moves forward, so the same code cannot be used twice even by two parallel requests.
    if(step===null||!(await this.pool.query(`UPDATE leadgen.workspace_users SET totp_last_step=$2 WHERE id=$1 AND (totp_last_step IS NULL OR totp_last_step<$2) RETURNING id`,[user.id,step])).rowCount)
      throw fail('TWO_FACTOR_CODE_INVALID','The code is not correct or was already used',401);
    return{method:'AUTHENTICATOR'};
  }

  async renewRecoveryCodes(user,code,actor){
    await this.verifySignIn(user,{code});
    return this.transaction(async client=>{
      const codes=await this.issueRecoveryCodes(client,user.id);
      await this.event(client,user.id,'RECOVERY_CODES_RENEWED',actor);
      return{recovery_codes:codes};
    });
  }

  async disable(user,{password,code},actor){
    if(!user.totp_enabled_at)throw fail('TWO_FACTOR_NOT_ENABLED','Two-step sign-in is not on',409);
    if(twoFactorRequired(user,this.env))throw fail('TWO_FACTOR_REQUIRED','Two-step sign-in is required for the administrator',409);
    if(!password||!await argonVerify(user.password_hash,String(password)))throw fail('AUTH_INVALID_CREDENTIALS','Password is incorrect',401);
    await this.verifySignIn(user,{code});
    await this.clear(user.id,'DISABLED',actor);
  }

  /** Switch off for one user (admin reset of a merchant, or the create-admin script on the PC). */
  async clear(userId,eventType,actor){
    return this.transaction(async client=>{
      const result=await client.query(`UPDATE leadgen.workspace_users SET totp_secret_ciphertext=NULL,totp_pending_ciphertext=NULL,totp_enabled_at=NULL,
        totp_last_step=NULL,updated_at=now() WHERE id=$1 RETURNING id,totp_enabled_at`,[userId]);
      if(!result.rowCount)throw fail('USER_NOT_FOUND','Account not found',404);
      await client.query('UPDATE leadgen.user_recovery_codes SET revoked_at=now() WHERE user_id=$1 AND used_at IS NULL AND revoked_at IS NULL',[userId]);
      await this.event(client,userId,eventType,actor);
      return{reset:true};
    });
  }
}
