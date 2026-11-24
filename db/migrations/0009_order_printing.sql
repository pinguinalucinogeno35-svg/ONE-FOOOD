-- Quando o pedido foi impresso pela primeira vez. Serve para o painel mostrar o que já saiu
-- na impressora e para a impressão automática não repetir um pedido.
-- Coluna nova e anulável: não reescreve a tabela particionada.
ALTER TABLE orders ADD COLUMN printed_at timestamptz;
