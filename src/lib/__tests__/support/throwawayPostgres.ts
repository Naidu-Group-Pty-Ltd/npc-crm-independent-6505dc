/**
 * A THROWAWAY POSTGRES FOR A SPEC THAT HAS TO RUN SQL.
 *
 * Some behaviour cannot be established by reading a migration — a converger
 * that must leave the same rows behind after a replay, a reorder or a removal
 * is a claim about what the database DOES. This starts a private cluster from
 * the server binaries every Ubuntu image carries, hands the spec a `sql()`
 * function, and removes the cluster afterwards.
 *
 * It never skips silently in CI: a runner without the binaries fails, because
 * a behavioural spec that quietly did not run is the same as no spec. Locally
 * it skips with a message, as `scripts/aml/didit-migration-check.sh` does.
 */
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ThrowawayPostgres {
  /** Run SQL; returns stdout rows, `|`-separated, trimmed. */
  sql(statement: string): string;
  /** The same, in its own session without blocking this one — for races. */
  sqlAsync(statement: string): Promise<string>;
  /** Run a file of SQL, stopping on the first error. */
  file(path: string): void;
  stop(): void;
}

function serverBinaries(): string | null {
  const candidates: string[] = [];
  for (const root of ['/usr/lib/postgresql']) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root).sort().reverse()) {
      candidates.push(join(root, version, 'bin'));
    }
  }
  candidates.push('/usr/local/pgsql/bin', '/usr/bin');
  return candidates.find((dir) =>
    existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) ?? null;
}

export function postgresAvailable(): boolean {
  if (serverBinaries()) return true;
  if (process.env.CI) {
    throw new Error('No PostgreSQL server binaries on this CI runner; a behavioural SQL spec cannot be skipped in CI.');
  }
  return false;
}

export function startThrowawayPostgres(): ThrowawayPostgres {
  const bin = serverBinaries();
  if (!bin) throw new Error('PostgreSQL server binaries not found');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  // initdb refuses root; the postgres account needs a directory it can enter.
  const base = mkdtempSync(join(asRoot ? '/var/tmp' : tmpdir(), 'pg-spec-'));
  if (asRoot) chmodSync(base, 0o777);
  const data = join(base, 'data');
  const port = String(55000 + Math.floor(Math.random() * 4000));
  const run = (tool: string, args: string[]) => {
    const command = join(bin, tool);
    if (asRoot) {
      const quoted = [command, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
      execFileSync('su', ['postgres', '-c', quoted], { stdio: 'pipe' });
    } else {
      execFileSync(command, args, { stdio: 'pipe' });
    }
  };
  run('initdb', ['-U', 'postgres', '-A', 'trust', '-D', data]);
  run('pg_ctl', ['-D', data, '-o', `-p ${port} -k ${base} -c fsync=off`, '-l', join(base, 'log'), '-w', 'start']);

  const psql = existsSync(join(bin, 'psql')) ? join(bin, 'psql') : 'psql';
  const connection = ['-h', base, '-p', port, '-U', 'postgres', '-d', 'postgres'];
  const exec = (args: string[]) => execFileSync(psql, [...connection, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    sql: (statement) => exec(['-qAt', '-c', statement]).trim(),
    sqlAsync: (statement) => new Promise((resolve, reject) => {
      execFile(psql, [...connection, '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', statement], { encoding: 'utf8' },
        (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
    }),
    file: (path) => { exec(['-q', '-f', path]); },
    stop: () => {
      try { run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); } catch { /* already down */ }
      rmSync(base, { recursive: true, force: true });
    },
  };
}
