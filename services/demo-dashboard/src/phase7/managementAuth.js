import crypto, { timingSafeEqual } from 'node:crypto';

export const MANAGEMENT_ROLES = Object.freeze([
  'SALES',
  'MANAGEMENT',
  'DATA_ADMIN',
  'FINANCE',
  'MANAGEMENT_APPROVER',
  'OUTREACH_APPROVER',
  'SENDER_OPERATOR'
]);

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(req) {
  const value = String(req.get('authorization') || '');
  return value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
}

export function csrfFor({ secret, token, identity, role }) {
  return crypto
    .createHmac('sha256', String(secret || token || ''))
    .update(`${String(identity || '').trim()}|${String(role || '').trim().toUpperCase()}|dpv-phase7`)
    .digest('base64url');
}

export function createManagementAuth(env = process.env) {
  const fallbackToken = String(env.DPV_MANAGEMENT_API_TOKEN || '');
  const csrfSecret = String(env.DPV_MANAGEMENT_CSRF_SECRET || fallbackToken);
  const bindings = new Map();
  if (fallbackToken) {
    bindings.set(fallbackToken, Object.freeze({
      identity: String(env.DPV_MANAGEMENT_API_ACTOR || 'local-demo').trim(),
      role: String(env.DPV_MANAGEMENT_API_ROLE || 'MANAGEMENT').trim().toUpperCase()
    }));
  }
  if (env.DPV_MANAGEMENT_TOKEN_BINDINGS) {
    let configured;
    try { configured = JSON.parse(String(env.DPV_MANAGEMENT_TOKEN_BINDINGS)); }
    catch { configured = null; }
    const entries = Array.isArray(configured)
      ? configured.map(item => [item?.token, item])
      : Object.entries(configured && typeof configured === 'object' ? configured : {});
    for (const [boundToken, value] of entries) {
      const identity = String(value?.identity || value?.actor || '').trim();
      const role = String(value?.role || '').trim().toUpperCase();
      if (boundToken && identity && MANAGEMENT_ROLES.includes(role)) {
        bindings.set(String(boundToken), Object.freeze({ identity, role }));
      }
    }
  }

  function bindingFor(req) {
    const presented = bearerToken(req);
    for (const [candidate, binding] of bindings) {
      if (constantTimeEqual(presented, candidate)) return binding;
    }
    return null;
  }

  function authenticate(req, res, next) {
    if (!bindings.size) {
      return res.status(503).json({
        error: 'Management authentication is not configured',
        code: 'MANAGEMENT_AUTH_NOT_CONFIGURED'
      });
    }
    const binding = bindingFor(req);
    if (!binding) {
      return res.status(401).json({ error: 'Authentication required', code: 'MANAGEMENT_AUTH_REQUIRED' });
    }
    const identity = binding.identity;
    const role = binding.role;
    if (!identity || !MANAGEMENT_ROLES.includes(role)) {
      return res.status(403).json({ error: 'Management identity or role is invalid', code: 'MANAGEMENT_ROLE_INVALID' });
    }
    req.managementUser = Object.freeze({ identity, role });
    next();
  }

  function tryAuthenticate(req, res, next) {
    if (!bearerToken(req)) return next();
    return authenticate(req, res, next);
  }

  function requireCsrf(req, res, next) {
    const expected = csrfFor({ secret: csrfSecret, ...req.managementUser });
    if (!constantTimeEqual(req.get('x-dpv-csrf'), expected)) {
      return res.status(403).json({ error: 'Request verification failed', code: 'MANAGEMENT_CSRF_INVALID' });
    }
    next();
  }

  function requireRoles(...allowed) {
    const roles = new Set(allowed.map(value => String(value).toUpperCase()));
    return (req, res, next) => {
      if (!roles.has(req.managementUser?.role)) {
        return res.status(403).json({ error: 'Role is not permitted for this operation', code: 'MANAGEMENT_ROLE_FORBIDDEN' });
      }
      next();
    };
  }

  return Object.freeze({
    configured: bindings.size > 0,
    authenticate,
    tryAuthenticate,
    requireCsrf,
    requireRoles,
    session(req, res) {
      res.json({
        identity: req.managementUser.identity,
        role: req.managementUser.role,
        csrf_token: csrfFor({ secret: csrfSecret, ...req.managementUser })
      });
    }
  });
}
