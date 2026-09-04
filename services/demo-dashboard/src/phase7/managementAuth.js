export const MANAGEMENT_ROLES = Object.freeze([
  'SALES',
  'MANAGEMENT',
  'DATA_ADMIN',
  'FINANCE',
  'MANAGEMENT_APPROVER',
  'OUTREACH_APPROVER',
  'SENDER_OPERATOR'
]);

/**
 * Supplies the audit identity used by the single-company workspace.
 *
 * This is deliberately not an authentication mechanism: there is no browser
 * token, bearer token, CSRF challenge or verification dialog. A future public
 * deployment can replace this adapter with the company's normal account login
 * without changing the business services that consume req.managementUser.
 */
export function createManagementAuth(env = process.env) {
  const identity = String(env.DPV_WORKSPACE_ACTOR || 'dpv-workspace').trim() || 'dpv-workspace';
  const configuredRole = String(env.DPV_WORKSPACE_ROLE || 'MANAGEMENT').trim().toUpperCase();
  const role = MANAGEMENT_ROLES.includes(configuredRole) ? configuredRole : 'MANAGEMENT';
  const user = Object.freeze({ identity, role });

  function attachWorkspaceUser(req, _res, next) {
    req.managementUser = user;
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
    configured: true,
    authenticate: attachWorkspaceUser,
    tryAuthenticate: attachWorkspaceUser,
    requireRoles
  });
}
