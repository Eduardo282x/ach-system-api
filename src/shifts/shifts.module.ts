import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
	controllers: [ShiftsController],
	providers: [ShiftsService, PrismaService],
	exports: [ShiftsService],
})
export class ShiftsModule {}
