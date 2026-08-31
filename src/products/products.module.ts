import { Module, forwardRef } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsSchedulerService } from './products.scheduler.service';
import { WebSocketModule } from 'src/web-socket/web-socket.module';
import { SessionsService } from 'src/sessions/sessions.service';
import { ExcelModule } from 'src/excel/excel.module';

@Module({
  imports: [WebSocketModule, forwardRef(() => ExcelModule)],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsSchedulerService, SessionsService],
  exports: [ProductsService],
})
export class ProductsModule {}
