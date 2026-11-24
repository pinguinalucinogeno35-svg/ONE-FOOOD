/**
 * Observabilidade. Carregado antes de qualquer outro módulo:
 *   node --import ./dist/telemetry.js dist/main.api.js
 * Só liga quando OTEL_EXPORTER_OTLP_ENDPOINT (ou um exportador explícito) está definido,
 * então desenvolvimento e testes não pagam esse custo.
 */
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

const enabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_TRACES_EXPORTER);

if (enabled) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'onefood',
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ruído sem valor para diagnóstico.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
