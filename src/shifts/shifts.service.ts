import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateShiftDto, UpdateShiftDto } from './shifts.dto';

@Injectable()
export class ShiftsService {
	constructor(private readonly prismaService: PrismaService) {}

	private timeToMinutes(time: string): number {
		const [hours, minutes] = time.split(':').map(Number);
		return hours * 60 + minutes;
	}

	private shiftsOverlap(
		start1: string,
		end1: string,
		start2: string,
		end2: string,
	): boolean {
		const s1 = this.timeToMinutes(start1);
		const e1 = this.timeToMinutes(end1);
		const s2 = this.timeToMinutes(start2);
		const e2 = this.timeToMinutes(end2);

		const isNightShift1 = s1 > e1;
		const isNightShift2 = s2 > e2;

		if (isNightShift1 && isNightShift2) {
			return true;
		}

		if (isNightShift1) {
			return s1 < e2 || s2 < e1;
		}

		if (isNightShift2) {
			return s2 < e1 || s1 < e2;
		}

		return s1 < e2 && s2 < e1;
	}

	private async checkOverlap(
		startTime: string,
		endTime: string,
		excludeId?: number,
	): Promise<void> {
		const where: any = { active: true };
		if (excludeId) {
			where.id = { not: excludeId };
		}

		const existingShifts = await this.prismaService.shift.findMany({ where });

		for (const shift of existingShifts) {
			if (this.shiftsOverlap(startTime, endTime, shift.startTime, shift.endTime)) {
				throw new BadRequestException(
					`El turno se superpone con "${shift.name}" (${shift.startTime} - ${shift.endTime})`,
				);
			}
		}
	}

	async findCurrentShift(): Promise<number | undefined> {
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();

		const shifts = await this.prismaService.shift.findMany({
			where: { active: true },
		});

		for (const shift of shifts) {
			const startMinutes = this.timeToMinutes(shift.startTime);
			const endMinutes = this.timeToMinutes(shift.endTime);

			if (startMinutes <= endMinutes) {
				if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
					return shift.id;
				}
			} else {
				if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
					return shift.id;
				}
			}
		}

		return undefined;
	}

	async getShifts() {
		try {
			const shifts = await this.prismaService.shift.findMany({
				orderBy: { id: 'asc' },
			});

			return { shifts };
		} catch (error) {
			throw error;
		}
	}

	async createShift(dto: CreateShiftDto) {
		try {
			if (dto.startTime === dto.endTime) {
				throw new BadRequestException('La hora de inicio y fin no pueden ser iguales');
			}

			await this.checkOverlap(dto.startTime, dto.endTime);

			const shift = await this.prismaService.shift.create({
				data: {
					name: dto.name,
					startTime: dto.startTime,
					endTime: dto.endTime,
				},
			});

			return {
				message: 'Turno creado correctamente',
				shift,
			};
		} catch (error) {
			throw error;
		}
	}

	async updateShifts(id: number, dto: UpdateShiftDto) {
		try {
			const existing = await this.prismaService.shift.findUnique({ where: { id } });

			if (!existing) {
				throw new NotFoundException(`Turno con id ${id} no encontrado`);
			}

			const startTime = dto.startTime ?? existing.startTime;
			const endTime = dto.endTime ?? existing.endTime;

			if (startTime === endTime) {
				throw new BadRequestException('La hora de inicio y fin no pueden ser iguales');
			}

			if (dto.startTime || dto.endTime) {
				await this.checkOverlap(startTime, endTime, id);
			}

			if (dto.name && dto.name !== existing.name) {
				const nameExists = await this.prismaService.shift.findFirst({
					where: {
						name: { equals: dto.name, mode: 'insensitive' },
						id: { not: id },
					},
				});

				if (nameExists) {
					throw new BadRequestException('Ya existe un turno con ese nombre');
				}
			}

			const shift = await this.prismaService.shift.update({
				where: { id },
				data: {
					...(dto.name !== undefined && { name: dto.name }),
					...(dto.startTime !== undefined && { startTime: dto.startTime }),
					...(dto.endTime !== undefined && { endTime: dto.endTime }),
					...(dto.active !== undefined && { active: dto.active }),
				},
			});

			return {
				message: 'Turno actualizado correctamente',
				shift,
			};
		} catch (error) {
			throw error;
		}
	}

	async remove(id: number) {
		try {
			const shift = await this.prismaService.shift.findUnique({ where: { id } });

			if (!shift) {
				throw new NotFoundException(`Turno con id ${id} no encontrado`);
			}

			const hasOpenSessions = await this.prismaService.cashDrawerSession.findFirst({
				where: {
					shiftId: id,
					status: 'OPEN',
				},
			});

			if (hasOpenSessions) {
				throw new BadRequestException(
					'No se puede desactivar un turno que tiene sesiones abiertas',
				);
			}

			await this.prismaService.shift.update({
				where: { id },
				data: { active: false },
			});

			return { message: 'Turno desactivado correctamente' };
		} catch (error) {
			throw error;
		}
	}
}
