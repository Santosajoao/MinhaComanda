import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { env } from './config/env';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { requestMiddleware } from './common/logging/request.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(requestMiddleware);
  app.enableCors({ origin: env.corsOrigin, exposedHeaders: ['x-request-id', 'content-disposition'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Terminal-Id', 'X-Request-Id'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen(env.port);
  console.log(`API de comandas em http://localhost:${env.port}/api/v1  (saúde: /api/v1/health)`);
}
bootstrap();
