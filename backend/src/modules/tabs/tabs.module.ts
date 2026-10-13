import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import { Ctx, CurrentCtx, Roles } from '../../common/authorization/context';
import { ConsumersModule } from '../consumers/consumers.module';
import { TabsService } from './tabs.service';

@Controller('tabs')
export class TabsController {
  constructor(private svc: TabsService) {}
  @Post() @Roles('recepcao', 'caixa', 'supervisor', 'gerente', 'admin')
  open(@CurrentCtx() ctx: Ctx, @Body() b: unknown) { return this.svc.open(ctx, b); }
  @Get() list(@CurrentCtx() ctx: Ctx, @Query() q: any) { return this.svc.list(ctx, q); }
  @Get(':key') get(@CurrentCtx() ctx: Ctx, @Param('key') key: string) { return this.svc.get(ctx, key); }
  @Post(':id/block') @HttpCode(200) @Roles('supervisor', 'gerente', 'admin')
  block(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.block(ctx, id, b); }
  @Post(':id/unblock') @HttpCode(200) @Roles('supervisor', 'gerente', 'admin')
  unblock(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.unblock(ctx, id, b); }
  @Post(':id/cancel') @HttpCode(200) @Roles('recepcao', 'caixa', 'supervisor', 'gerente', 'admin')
  cancel(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: unknown) { return this.svc.cancel(ctx, id, b); }
}

@Module({ imports: [ConsumersModule], providers: [TabsService], controllers: [TabsController], exports: [TabsService] })
export class TabsModule {}
