/**
 * Quantos saltos do cabeçalho X-Forwarded-For são confiáveis, contando a partir da conexão.
 * Com 0, nenhum: o IP do cliente é o de quem conectou, e o cabeçalho é ignorado.
 */
export function trustProxyHops(hops: number): (address: string, hop: number) => boolean {
  return (_address, hop) => hop < hops;
}
