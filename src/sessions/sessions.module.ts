import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ShiftsModule } from 'src/shifts/shifts.module';

@Module({
  imports: [ShiftsModule],
  controllers: [SessionsController],
  providers: [SessionsService, PrismaService],
  exports: [SessionsService],
})
export class SessionsModule {}
