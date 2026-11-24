import { OrderTracker } from './tracker';

export const metadata = { title: 'Acompanhar pedido' };

export default async function OrderPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <OrderTracker slug={slug} orderId={id} />;
}
