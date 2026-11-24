/** Interface pública do módulo de identidade. Outros módulos importam só daqui. */
export { IdentityModule } from './identity.module.js';
export { type AuthContext, IdentityService, type StoreAccess } from './identity.service.js';
export {
  CurrentStore,
  CurrentUser,
  RequireRole,
  SESSION_COOKIE,
  SessionGuard,
  type StoreAuth,
} from './session.guard.js';
