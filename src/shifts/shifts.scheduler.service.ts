import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WebsocketGateway } from 'src/web-socket/web-socket.service';
import { ShiftsService } from './shifts.service';

export interface ShiftWarning {
	type: '5min' | '1min';
	shiftName: string;
	endTime: string;
}

@Injectable()
export class TasksService {
	private readonly logger = new Logger(TasksService.name);

	constructor(
		private readonly websocketGateway: WebsocketGateway,
		private readonly shiftsService: ShiftsService,
	) {}

	@Cron('* * * * *')
	async handleShiftWarnings() {
		try {
			const now = new Date();
			const currentMinutes = now.getHours() * 60 + now.getMinutes();

			const { shifts } = await this.shiftsService.getShifts();
			const activeShifts = shifts.filter((s) => s.active);

			for (const shift of activeShifts) {
				const endMinutes = this.timeToMinutes(shift.endTime);

				let remaining = endMinutes - currentMinutes;
				if (remaining < 0) {
					remaining += 1440;
				}

				if (remaining === 5) {
					this.emitWarning('5min', shift);
				} else if (remaining === 1) {
					this.emitWarning('1min', shift);
				}
			}
		} catch (error: Error | any) {
			this.logger.error(
				'Error en handleShiftWarnings',
				error?.stack || error?.message,
			);
		}
	}

	private timeToMinutes(time: string): number {
		const [hours, minutes] = time.split(':').map(Number);
		return hours * 60 + minutes;
	}

	private emitWarning(
		type: '5min' | '1min',
		shift: { name: string; endTime: string },
	) {
		const warning: ShiftWarning = {
			type,
			shiftName: shift.name,
			endTime: shift.endTime,
		};

		if (this.websocketGateway.server) {
			this.websocketGateway.emitReminder('shift-warning', warning);
			this.logger.log(`Shift warning emitted: ${type} for ${shift.name}`);
		}
	}
}
