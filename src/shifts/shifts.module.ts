import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TasksService } from './shifts.scheduler.service';
import { WebSocketModule } from 'src/web-socket/web-socket.module';

@Module({
	imports: [WebSocketModule],
	controllers: [ShiftsController],
	providers: [ShiftsService, PrismaService, TasksService],
	exports: [ShiftsService],
})
export class ShiftsModule {}
