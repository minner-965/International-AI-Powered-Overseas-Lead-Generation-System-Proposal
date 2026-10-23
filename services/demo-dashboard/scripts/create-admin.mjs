#!/usr/bin/env node
// Creates (or resets) the SIM administrator account for the workspace sign-in.
//   node scripts/create-admin.mjs --email simon@example.com --password '<10+ chars, letters and digits>' [--name Simon]
// The password may instead come from CREATE_ADMIN_PASSWORD so it stays out of shell history.
// Database settings: DATABASE_URL, or POSTGRES_HOST/PORT/DB/USER/PASSWORD as for the server.
import pg from 'pg';
import {MerchantService} from '../src/merchant/MerchantService.js';

function argument(name){
  const index=process.argv.indexOf(`--${name}`);
  if(index>=0&&process.argv[index+1]&&!process.argv[index+1].startsWith('--'))return process.argv[index+1];
  const inline=process.argv.find(value=>value.startsWith(`--${name}=`));
  return inline?inline.slice(name.length+3):null;
}
const email=argument('email')||process.env.CREATE_ADMIN_EMAIL;
const password=argument('password')||process.env.CREATE_ADMIN_PASSWORD;
const name=argument('name')||null;
if(!email||!password){
  console.error('Usage: node scripts/create-admin.mjs --email <address> --password <password> [--name <display name>]');
  process.exit(2);
}
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:2}):new pg.Pool({
  host:process.env.POSTGRES_HOST||'postgres',port:Number(process.env.POSTGRES_PORT||5432),database:process.env.POSTGRES_DB||'leadgen',
  user:process.env.POSTGRES_USER||'leadgen',password:process.env.POSTGRES_PASSWORD,max:2});
try{
  const user=await new MerchantService({pool,env:process.env}).createAdmin({email,password,display_name:name,actor:'create-admin-script'});
  console.log(JSON.stringify({status:'ADMIN_READY',email:user.email,id:user.id}));
}catch(error){
  console.error(JSON.stringify({status:'FAILED',code:error.code||'CREATE_ADMIN_FAILED',message:error.message}));
  process.exitCode=1;
}finally{await pool.end();}
