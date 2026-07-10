import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsSchedulerService } from './products.scheduler.service';
import { WebSocketModule } from 'src/web-socket/web-socket.module';
import { SessionsService } from 'src/sessions/sessions.service';
import { ShiftsModule } from 'src/shifts/shifts.module';

@Module({
  imports: [WebSocketModule, ShiftsModule],
  controllers: [ProductsController],
  providers: [ProductsService, PrismaService, ProductsSchedulerService, SessionsService],
})
export class ProductsModule {}
