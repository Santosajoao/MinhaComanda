import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AuthGuard } from './common/authorization/auth.guard';
import { DatabaseModule } from './common/database/database.service';
import { AdjustmentsModule } from './modules/adjustments/adjustments.module';
import { AuditModule } from './modules/audit/audit.service';
import { AuthModule } from './modules/auth/auth.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { ConsumersModule } from './modules/consumers/consumers.module';
import { EstablishmentsModule } from './modules/establishments/establishments.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TabsModule } from './modules/tabs/tabs.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, UsersModule, EstablishmentsModule, ConsumersModule, TabsModule, CatalogModule, OrdersModule,
    AdjustmentsModule, CheckoutModule, PaymentsModule, CashRegisterModule, ReportsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
