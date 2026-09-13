const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Direct application detail routes use PostgreSQL UUID identifiers.
// Validate before SQL; never echo untrusted parameter values in the response.
export function validateDetailId(req, res, next, value) {
  if (req.method !== 'GET' || uuid.test(value)) return next();
  return res.status(400).json({error: 'Invalid record identifier', code: 'INVALID_RECORD_ID'});
}
