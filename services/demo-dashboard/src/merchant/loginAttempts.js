// Durable sign-in failure limiter backed by leadgen.login_attempts (migration 067).
// Replaces the per-process in-memory map: counters survive restarts and are shared
// across workers. One row per (kind, identifier); `kind` is 'email' or 'ip'. The
// interface matches the old limiter ({blocked, fail, reset}) but is async.
const norm=value=>String(value||'').toLowerCase().slice(0,320);

export function createLoginAttempts({pool,max=8,windowMs=15*60_000}={}){
  if(!pool)throw new Error('createLoginAttempts requires a PostgreSQL pool');
  const windowSecs=Math.max(1,Math.round(windowMs/1000));
  // Count one more failure for an identifier, restarting the count when the window has
  // elapsed, and lock the identifier once it reaches `max` within the window.
  async function bump(identifier,kind){
    const id=kind==='email'?norm(identifier):String(identifier||'').slice(0,120);
    if(!id)return;
    await pool.query(`INSERT INTO leadgen.login_attempts(identifier,kind,attempts,locked_until,updated_at)
      VALUES($1,$2,1,NULL,now())
      ON CONFLICT(kind,identifier) DO UPDATE SET
        attempts=CASE WHEN leadgen.login_attempts.updated_at < now()-make_interval(secs=>$3) THEN 1 ELSE leadgen.login_attempts.attempts+1 END,
        locked_until=CASE WHEN (CASE WHEN leadgen.login_attempts.updated_at < now()-make_interval(secs=>$3) THEN 1 ELSE leadgen.login_attempts.attempts+1 END) >= $4
          THEN now()+make_interval(secs=>$3) ELSE NULL END,
        updated_at=now()`,[id,kind,windowSecs,max]);
  }
  return{
    async blocked(email,ip){
      const row=(await pool.query(`SELECT EXISTS(SELECT 1 FROM leadgen.login_attempts
        WHERE locked_until IS NOT NULL AND locked_until>now()
          AND ((kind='email' AND identifier=$1) OR (kind='ip' AND identifier=$2))) blocked`,
        [norm(email),String(ip||'').slice(0,120)])).rows[0];
      return Boolean(row?.blocked);
    },
    async fail(email,ip){await bump(email,'email');await bump(ip,'ip');},
    // A successful sign-in clears the email's counter (the IP counter ages out on its own).
    async reset(email){await pool.query(`DELETE FROM leadgen.login_attempts WHERE kind='email' AND identifier=$1`,[norm(email)]);}
  };
}
