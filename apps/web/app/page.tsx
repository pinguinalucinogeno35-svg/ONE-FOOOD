import Link from 'next/link';
import { IconForward } from '../components/icons';

export default function Home() {
  return (
    <main>
      <h1>ONE Food</h1>
      <p className="muted">Cardápio digital e pedidos para o seu restaurante, sem comissão por pedido.</p>
      <div className="stack" style={{ marginTop: 24 }}>
        <Link className="btn btn-primary" href="/cadastro">
          Criar minha loja
          <IconForward />
        </Link>
        <Link className="btn" href="/entrar">
          Já tenho conta
        </Link>
      </div>
    </main>
  );
}
