import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile} from 'node:fs/promises';
import pg from 'pg';
import {createLoginAttempts} from '../src/merchant/loginAttempts.js';

// Durable sign-in limiter against a throwaway PostgreSQL database built from the
// migration files (including 067). Zero external calls.
//   MERCHANT_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:55432/postgres
const adminUrl=process.env.MERCHANT_TEST_ADMIN_URL||process.env.GLOBAL_MARKETS_TEST_ADMIN_URL||process.env.CRM_PIPELINE_TEST_ADMIN_URL||'';
const migrations=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../database/migrations');

async function withDatabase(run){
  const name=`login_it_${crypto.randomBytes(4).toString('hex')}`;
  const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE DATABASE ${name}`);}finally{await admin.end();}
  const url=new URL(adminUrl);url.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:url.toString(),max:8});
  try{
    const files=(await readdir(migrations)).filter(file=>/^\d{3}_.*\.sql$/.test(file)).sort();
    for(const file of files)await pool.query(await readFile(path.join(migrations,file),'utf8'));
    return await run(pool,url.toString());
  }finally{
    await pool.end();
    const cleanup=new pg.Client({connectionString:adminUrl});await cleanup.connect();
    try{await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);}finally{await cleanup.end();}
  }
}

test('login lockout triggers after N failures and persists across a limiter rebuild (restart)',{skip:!adminUrl},async()=>{
  await withDatabase(async(pool,url)=>{
    const email='attacker@example.test',ip='203.0.113.9';
    const limiter=createLoginAttempts({pool,max:8,windowMs:15*60_000});
    assert.equal(await limiter.blocked(email,ip),false);
    for(let i=0;i<7;i++)await limiter.fail(email,ip);
    assert.equal(await limiter.blocked(email,ip),false,'seven failures stay under the threshold');
    await limiter.fail(email,ip);
    assert.equal(await limiter.blocked(email,ip),true,'the eighth failure locks the identifier');

    // Simulate a process restart: a brand-new pool and limiter instance against the same DB.
    const pool2=new pg.Pool({connectionString:url,max:4});
    try{
      const rebuilt=createLoginAttempts({pool:pool2,max:8,windowMs:15*60_000});
      assert.equal(await rebuilt.blocked(email,ip),true,'lockout survives the restart because it is stored in PostgreSQL');
      const stored=(await pool2.query(`SELECT attempts,locked_until FROM leadgen.login_attempts WHERE kind='email' AND identifier=$1`,[email])).rows[0];
      assert.ok(stored.attempts>=8&&stored.locked_until);
    }finally{await pool2.end();}
  });
});

test('a successful sign-in clears the email counter',{skip:!adminUrl},async()=>{
  await withDatabase(async pool=>{
    const email='user@example.test',ip='203.0.113.50';
    const limiter=createLoginAttempts({pool,max:8,windowMs:15*60_000});
    for(let i=0;i<3;i++)await limiter.fail(email,ip);
    assert.equal((await pool.query(`SELECT attempts FROM leadgen.login_attempts WHERE kind='email' AND identifier=$1`,[email])).rows[0].attempts,3);
    await limiter.reset(email);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leadgen.login_attempts WHERE kind='email' AND identifier=$1`,[email])).rows[0].n,0);
    assert.equal(await limiter.blocked(email,ip),false);
  });
});
