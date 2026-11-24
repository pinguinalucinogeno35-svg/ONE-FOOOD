import { formatBRL, type SettlementTotals, settlementNetCents } from '@onefood/shared';

/** A linha que resume o acerto: quem paga quanto a quem. */
export function settlementLine(totals: SettlementTotals, courierName: string | null): string {
  const net = settlementNetCents(totals);
  if (net === 0) return 'Ninguém deve nada.';
  if (courierName === null) {
    return net > 0 ? `Você repassa ${formatBRL(net)} ao restaurante` : `Você recebe ${formatBRL(-net)} do restaurante`;
  }
  return net > 0
    ? `${courierName} repassa ${formatBRL(net)} ao restaurante`
    : `O restaurante paga ${formatBRL(-net)} a ${courierName}`;
}

export function deliveriesLabel(count: number): string {
  return `${count} ${count === 1 ? 'entrega' : 'entregas'}`;
}
