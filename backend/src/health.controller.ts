import { Controller, Get } from '@nestjs/common';
import { Public } from './common/authorization/context';
import { DatabaseService } from './common/database/database.service';

@Controller('health')
export class HealthController {
  constructor(private db: DatabaseService) {}
  @Public() @Get()
  async health() {
    const r = await this.db.query('SELECT now() AS now');
    return { status: 'ok', database: 'ok', time: r.rows[0].now };
  }
}
