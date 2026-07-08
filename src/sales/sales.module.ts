import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { SessionsModule } from 'src/sessions/sessions.module';
import { ShiftsModule } from 'src/shifts/shifts.module';

@Module({
  imports: [SessionsModule, ShiftsModule],
  controllers: [SalesController],
  providers: [SalesService, PrismaService],
})
export class SalesModule {}
