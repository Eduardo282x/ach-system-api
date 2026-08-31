import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClientsModule } from './clients/clients.module';
import { ProductsModule } from './products/products.module';
import { SalesModule } from './sales/sales.module';
import { SessionsModule } from './sessions/sessions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ConfigModule } from '@nestjs/config';
import { ExcelModule } from './excel/excel.module';
import { ScheduleModule } from '@nestjs/schedule';
import { WebSocketModule } from './web-socket/web-socket.module';
import { FileLoggerService } from './common/logger/file-logger.service';
import { PrismaModule } from './prisma/prisma.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ClientsModule,
    ProductsModule,
    SalesModule,
    SessionsModule,
    DashboardModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ExcelModule,
    ScheduleModule.forRoot(),
    WebSocketModule,
    InventoryModule,
  ],
  controllers: [AppController],
  providers: [AppService, FileLoggerService],
  exports: [FileLoggerService],
})
export class AppModule { }
