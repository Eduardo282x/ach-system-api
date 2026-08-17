import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsSchedulerService } from './products.scheduler.service';
import { WebSocketModule } from 'src/web-socket/web-socket.module';
import { SessionsService } from 'src/sessions/sessions.service';

@Module({
  imports: [WebSocketModule],
  controllers: [ProductsController],
  providers: [ProductsService, PrismaService, ProductsSchedulerService, SessionsService],
})
export class ProductsModule {}
