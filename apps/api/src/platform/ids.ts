import { v7 as uuidv7, validate, version } from 'uuid';

/** Novo identificador ordenável no tempo (UUID versão 7). */
export function newId(): string {
  return uuidv7();
}

export function isUuidV7(id: string): boolean {
  return validate(id) && version(id) === 7;
}

/**
 * Instante embutido em um UUID versão 7. É o created_at dos pedidos e, por isso,
 * a chave que leva direto à partição certa. Espelha app.uuid_v7_time() no banco.
 */
export function timeOfId(id: string): Date {
  if (!isUuidV7(id)) throw new TypeError(`não é um UUID versão 7: ${id}`);
  return new Date(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16));
}
