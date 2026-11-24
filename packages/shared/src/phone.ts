/**
 * Converte um telefone brasileiro digitado de qualquer jeito ("(11) 99999-0000",
 * "11 3333 4444", "+55 11 99999-0000") para E.164. Devolve null se não tiver DDD e número válidos.
 */
export function toE164BR(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11) return null;
  // Celular tem 11 dígitos e começa com 9; fixo tem 10 e começa com 2 a 5.
  const first = digits[2] as string;
  if (digits.length === 11 && first !== '9') return null;
  if (digits.length === 10 && (first < '2' || first > '5')) return null;
  return `+55${digits}`;
}

/** +5511999990000 -> "(11) 99999-0000" */
export function formatPhoneBR(e164: string): string {
  const digits = e164.replace(/\D/g, '').replace(/^55/, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return e164;
}
