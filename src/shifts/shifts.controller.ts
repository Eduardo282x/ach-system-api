import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CreateShiftDto, UpdateShiftDto } from './shifts.dto';
import { ShiftsService } from './shifts.service';

@Controller('shifts')
export class ShiftsController {
	constructor(private readonly shiftsService: ShiftsService) {}

	@Get()
	async getShifts() {
		return await this.shiftsService.getShifts();
	}

	@Post()
	async createShift(@Body() dto: CreateShiftDto) {
		return await this.shiftsService.createShift(dto);
	}

	@Put('/:id')
	async updateShifts(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShiftDto) {
		return await this.shiftsService.updateShifts(id, dto);
	}

	@Delete('/:id')
	async remove(@Param('id', ParseIntPipe) id: number) {
		return await this.shiftsService.remove(id);
	}
}
