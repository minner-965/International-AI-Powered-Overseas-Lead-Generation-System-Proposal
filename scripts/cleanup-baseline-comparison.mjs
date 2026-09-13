// Compare both directions so a missing table cannot silently pass a cleanup check.
export function compareTableFingerprints(before, after) {
  const previous=new Map(before.map(row=>[row.table,row]));
  const current=new Map(after.map(row=>[row.table,row]));
  const changed=after.filter(row=>JSON.stringify(row)!==JSON.stringify(previous.get(row.table)));
  const removed_tables=before.filter(row=>!current.has(row.table)).map(row=>row.table);
  return {changed,removed_tables};
}
