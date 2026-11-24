import type { Metadata } from 'next';
import { CourierHome } from './courier-home';

// O endereço desta página carrega o token do entregador: não deve ser indexado nem
// repassado como referência para os sites abertos a partir dela (o mapa, por exemplo).
export const metadata: Metadata = {
  title: 'Minhas entregas',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function CourierPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CourierHome token={token} />;
}
