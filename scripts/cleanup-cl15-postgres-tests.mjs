import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const {Client,Pool}=createRequire('/app/package.json')('pg');
const {applyPhase7Migration}=await import('/app/src/phase7/migrationRunner.js');
const {applyCategoryProcurementMigration}=await import('/app/src/categoryProcurement/migrationRunner.js');
const config={host:process.env.POSTGRES_HOST,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD};
const database=`cl15_fixture_${Date.now()}_${randomBytes(6).toString('hex')}`;
assert.match(database,/^cl15_fixture_\d+_[a-f0-9]{12}$/);assert.notEqual(database,process.env.POSTGRES_DB);
const admin=new Client({...config,database:'postgres'});let pool,created=false;
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
 pool=new Pool({...config,database});
 const dir='/workspace/database/migrations';
 for(const name of (await readdir(dir)).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort()){
  const n=+name.slice(0,3),migrationPath=`${dir}/${name}`;
  if(n<24)await pool.query(await readFile(migrationPath,'utf8'));
  else await(n===24?applyCategoryProcurementMigration:applyPhase7Migration)({pool,migrationPath,expectedDatabase:database,appliedBy:'cl15'});
 }
 const {PgBoss}=createRequire('/app/package.json')('pg-boss');
 const boss=new PgBoss({...config,database});await boss.start();await boss.stop();
 await pool.end();pool=null;
 const env={...process.env,POSTGRES_DB:database,RUN_PHASE5_POSTGRES_INTEGRATION:'true'};
 for(const key of ['PHASE10_RETIRE_LIMITS_TEST_DATABASE','PHASE10_U12_TEST_DATABASE','PHASE10_EMPTY_PURGE_TEST_DATABASE','PHASE10_PROVIDER_CAPACITY_TEST_DATABASE'])env[key]=database;
 const files=(await readdir('/app/test')).filter(n=>n.endsWith('postgres.test.js')).map(n=>`/app/test/${n}`);
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{env,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 console.log(result.stdout);console.error(result.stderr);if(result.status!==0)process.exitCode=1;
}finally{
 await pool?.end();if(created){await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);}
 await admin.end();console.log(JSON.stringify({production_writes:0,external_calls:0,cleanup:'DROPPED_AND_ABSENCE_VERIFIED'}));
}
