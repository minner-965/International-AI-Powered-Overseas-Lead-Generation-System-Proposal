#!/usr/bin/env node
// Creates (or resets) the SIM administrator account for the workspace sign-in.
//   node scripts/create-admin.mjs --email simon@example.com --password '<10+ chars, letters and digits>' [--name Simon]
// The password may instead come from CREATE_ADMIN_PASSWORD so it stays out of shell history.
//   node scripts/create-admin.mjs --check   -> {"status":"ADMIN_EXISTS"} exit 0, or {"status":"ADMIN_MISSING"} exit 3
//   node scripts/create-admin.mjs --email simon@example.com --reset-2fa   -> two-step sign-in off (lost phone); set up again at next sign-in
// Database settings: DATABASE_URL, or POSTGRES_HOST/PORT/DB/USER/PASSWORD as for the server.
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';
import {TwoFactorService} from '../src/merchant/twoFactor.js';

function argument(name){
  const index=process.argv.indexOf(`--${name}`);
  if(index>=0&&process.argv[index+1]&&!process.argv[index+1].startsWith('--'))return process.argv[index+1];
  const inline=process.argv.find(value=>value.startsWith(`--${name}=`));
  return inline?inline.slice(name.length+3):null;
}
const check=process.argv.includes('--check');
// --reset-2fa: switch two-step sign-in off for this account (lost phone and recovery codes). Only
// someone with access to this computer can run it; the next sign-in asks to set it up again.
const resetTwoFactor=process.argv.includes('--reset-2fa');
const email=argument('email')||process.env.CREATE_ADMIN_EMAIL;
const password=argument('password')||process.env.CREATE_ADMIN_PASSWORD;
const name=argument('name')||null;
if(!check&&(!email||(!password&&!resetTwoFactor))){
  console.error('Usage: node scripts/create-admin.mjs --email <address> --password <password> [--name <display name>]\n       node scripts/create-admin.mjs --email <address> --reset-2fa');
  process.exit(2);
}
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:2}):new pg.Pool({
  host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'leadgen',
  user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,max:2});
try{
  if(check){
    // Before migration 066 the users table does not exist yet: the admin is missing.
    const exists=(await pool.query(`SELECT to_regclass('leadgen.workspace_users') IS NOT NULL ready`)).rows[0].ready
      &&(await pool.query(`SELECT 1 FROM leadgen.workspace_users WHERE role='ADMIN' AND disabled_at IS NULL LIMIT 1`)).rowCount>0;
    console.log(JSON.stringify({status:exists?'ADMIN_EXISTS':'ADMIN_MISSING'}));
    process.exitCode=exists?0:3;
  }else if(resetTwoFactor){
    const user=(await pool.query('SELECT id,email FROM leadgen.workspace_users WHERE lower(email)=lower($1)',[email])).rows[0];
    if(!user)throw Object.assign(new Error('No account with this email'),{code:'USER_NOT_FOUND'});
    await new TwoFactorService({pool,env:process.env}).clear(user.id,'RESET_BY_SCRIPT','create-admin-script');
    console.log(JSON.stringify({status:'TWO_FACTOR_RESET',email:user.email}));
  }else{
  const user=await new MerchantService({pool,env:process.env}).createAdmin({email,password,display_name:name,actor:'create-admin-script'});
  console.log(JSON.stringify({status:'ADMIN_READY',email:user.email,id:user.id}));
  }
}catch(error){
  console.error(JSON.stringify({status:'FAILED',code:error.code||'CREATE_ADMIN_FAILED',message:error.message}));
  process.exitCode=1;
}finally{await pool.end();}
