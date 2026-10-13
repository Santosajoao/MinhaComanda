import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, types } from 'pg';
import { env } from '../../config/env';

types.setTypeParser(20, (v) => parseInt(v, 10)); // bigint -> number (valores em centavos)
types.setTypeParser(1700, (v) => parseFloat(v)); // numeric -> number

export interface Q { query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number | null }>; }

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: env.databaseUrl, max: 20 });
  query(text: string, params?: any[]) { return this.pool.query(text, params); }
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() { await this.pool.end(); }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
