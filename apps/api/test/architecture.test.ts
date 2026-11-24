import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const MODULES = join(SRC, 'modules');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => resolve(dirname(file), match[1] as string));
}

/** Para um caminho dentro de src/modules, devolve [módulo, resto]. */
function moduleOf(path: string): [string, string] | null {
  const rel = relative(MODULES, path);
  if (rel.startsWith('..')) return null;
  const [name, ...rest] = rel.split(sep);
  return name ? [name, rest.join('/')] : null;
}

describe('fronteiras do monólito modular', () => {
  it('um módulo só importa outro módulo pela interface pública (index.ts)', () => {
    const violations: string[] = [];
    for (const file of filesUnder(SRC)) {
      const from = moduleOf(file);
      for (const target of importsOf(file)) {
        const to = moduleOf(target);
        if (!to) continue;
        const sameModule = from !== null && from[0] === to[0];
        if (!sameModule && to[1] !== 'index.js') {
          violations.push(`${relative(SRC, file)} -> ${relative(SRC, target)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('a plataforma não depende de módulos de negócio', () => {
    const violations = filesUnder(join(SRC, 'platform')).flatMap((file) =>
      importsOf(file)
        .filter((target) => moduleOf(target) !== null)
        .map((target) => `${relative(SRC, file)} -> ${relative(SRC, target)}`),
    );
    expect(violations).toEqual([]);
  });

  it('SQL de tabelas de um módulo não aparece em outro módulo', () => {
    const owners: Record<string, string> = {
      menu_categories: 'catalog',
      products: 'catalog',
      product_option_groups: 'catalog',
      product_options: 'catalog',
      orders: 'orders',
      order_items: 'orders',
      order_events: 'orders',
      payments: 'orders',
      idempotency_keys: 'orders',
      customers: 'orders',
      outbox: 'outbox',
      users: 'identity',
      sessions: 'identity',
      memberships: 'identity',
    };
    const violations: string[] = [];
    for (const file of filesUnder(MODULES)) {
      if (file.endsWith('.test.ts')) continue;
      const from = moduleOf(file)?.[0];
      const source = readFileSync(file, 'utf8');
      for (const [table, owner] of Object.entries(owners)) {
        if (owner === from) continue;
        if (new RegExp(`\\b(FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`).test(source)) {
          violations.push(`${relative(SRC, file)} usa a tabela ${table} (do módulo ${owner})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
