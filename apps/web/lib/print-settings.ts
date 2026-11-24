/**
 * Ajustes de impressão valem por aparelho: o computador do balcão pode imprimir sozinho
 * e o tablet da cozinha não. Ficam guardados no navegador.
 */
export interface PrintSettings {
  /** Largura do papel da impressora térmica, em milímetros. */
  paper: '80' | '58';
  /** Via da cozinha: itens em letra grande, sem valores. */
  kitchen: boolean;
  /** Via do cliente: valores, endereço e forma de pagamento. */
  customer: boolean;
  /** Imprime sozinho quando chega um pedido novo neste aparelho. */
  auto: boolean;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { paper: '80', kitchen: true, customer: true, auto: false };

const KEY = 'onefood:print';

export function loadPrintSettings(): PrintSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<PrintSettings>;
    return {
      paper: saved.paper === '58' ? '58' : '80',
      kitchen: saved.kitchen ?? true,
      customer: saved.customer ?? true,
      auto: saved.auto ?? false,
    };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(settings: PrintSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Sem armazenamento: os ajustes valem só enquanto a página estiver aberta.
  }
}
