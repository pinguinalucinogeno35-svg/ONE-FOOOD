/** Interface pública do módulo de entrega. Outros módulos importam só daqui. */
export { CourierGuard, CurrentCourier } from './courier.guard.js';
export { type CourierIdentity, CouriersService } from './couriers.service.js';
export { DeliveryModule } from './delivery.module.js';
