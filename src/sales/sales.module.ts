import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [SalesController],
  providers: [SalesService, PrismaService],
})
export class SalesModule {}
