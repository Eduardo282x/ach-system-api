import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { SessionStatus } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { ShiftsService } from 'src/shifts/shifts.service';
import {
	CloseSessionDto,
	OpenSessionDto,
	UpdateOpeningSessionDto,
} from './sessions.dto';

interface SessionFilter {
	status?: SessionStatus;
	startDate?: string;
	endDate?: string;
	cashDrawerId?: number;
	shiftId?: number;
	userId?: number;
}

interface SessionGroupFilter {
	date: string;
	shiftId?: number;
}

@Injectable()
export class SessionsService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly shiftsService: ShiftsService,
	) { }

	private getStartOfDayUtc(date: string) {
		return new Date(`${date}T00:00:00.000Z`);
	}

	private getEndOfDayUtc(date: string) {
		return new Date(`${date}T23:59:59.999Z`);
	}

	private toNumber(value: Prisma.Decimal | null | undefined) {
		return Number(value ?? 0);
	}

	async refreshSessionTotals(sessionId: number) {
		const invoicesTotals = await this.prismaService.invoice.aggregate({
			where: {
				sessionId,
			},
			_sum: {
				totalAmountBs: true,
			},
		});

		const paymentsTotalsBs = await this.prismaService.paymentDetail.aggregate({
			where: {
				invoice: {
					sessionId,
				},
				currency: 'BS',
			},
			_sum: {
				amountNet: true,
			},
		});

		const paymentsTotalsUsd = await this.prismaService.paymentDetail.aggregate({
			where: {
				invoice: {
					sessionId,
				},
				currency: 'USD',
			},
			_sum: {
				amountNet: true,
			},
		});

		const totalSales = this.toNumber(invoicesTotals._sum.totalAmountBs);
		const totalInBs = this.toNumber(paymentsTotalsBs._sum.amountNet);
		const totalInUsd = this.toNumber(paymentsTotalsUsd._sum.amountNet);

		return this.prismaService.cashDrawerSession.update({
			where: { id: sessionId },
			data: {
				totalSales: new Prisma.Decimal(totalSales),
				totalInBs: new Prisma.Decimal(totalInBs),
				totalInUsd: new Prisma.Decimal(totalInUsd),
			},
		});
	}

	async getCashDrawer() {
		try {
			const cashDrawers = await this.prismaService.cashDrawer.findMany({
				orderBy: {
					name: 'asc',
				},
			});

			return {
				cashDrawers
			}
		} catch (error) {
			throw error;
		}
	}

	async createCashDrawer(name: string) {
		try {
			const existing = await this.prismaService.cashDrawer.findFirst({
				where: {
					name: {
						equals: name,
						mode: 'insensitive',
					},
				},
			});

			if (existing) {
				throw new BadRequestException('Ya existe una caja con ese nombre');
			}

			const cashDrawer = await this.prismaService.cashDrawer.create({
				data: {
					name,
				},
			});

			return {
				message: 'Caja creada correctamente',
				cashDrawer,
			};
		} catch (error) {
			throw error;
		}
	}

	async updateCashDrawer(id: number, name: string) {
		try {
			const cashDrawer = await this.prismaService.cashDrawer.findUnique({
				where: { id },
			});

			if (!cashDrawer) {
				throw new NotFoundException(`Caja con id ${id} no encontrada`);
			}

			const existing = await this.prismaService.cashDrawer.findFirst({
				where: {
					name: {
						equals: name,
						mode: 'insensitive',
					},
					id: {
						not: id,
					},
				},
			});

			if (existing) {
				throw new BadRequestException('Ya existe una caja con ese nombre');
			}

			const updatedCashDrawer = await this.prismaService.cashDrawer.update({
				where: { id },
				data: { name },
			});

			return {
				message: 'Caja actualizada correctamente',
				cashDrawer: updatedCashDrawer,
			};
		} catch (error) {
			throw error;
		}
	}

	async getSessions(filter?: SessionFilter) {
		const { status, startDate, endDate, cashDrawerId, shiftId, userId } = filter || {};

		const where: any = {};

		if (startDate && endDate) {
			const start = this.getStartOfDayUtc(startDate);
			const end = this.getEndOfDayUtc(endDate);

			where.OR = [
				{
					openedAt: {
						gte: start,
						lte: end,
					}
				},
				{
					closedAt: {
						gte: start,
						lte: end,
					}
				}
			];
		}

		if(cashDrawerId){
			where.cashDrawerId = cashDrawerId;
		}

		if (shiftId) {
			where.shiftId = shiftId;
		}

		if (userId) {
			where.userId = userId;
		}

		if (status) {
			where.status = status;
		}

		try {
			const sessions = await this.prismaService.cashDrawerSession.findMany({
				where,
				orderBy: {
					openedAt: 'desc',
				},
				include: {
					cashDrawer: {
						select: {
							id: true,
							name: true,
						},
					},
					user: {
						select: {
							id: true,
							name: true,
						},
					},
					shift: {
						select: {
							id: true,
							name: true,
							startTime: true,
							endTime: true,
						},
					},
				},
			});

			const sessionEvents = sessions.flatMap((session) => {
				const openEvent = {
					id: `${session.id}-OPEN`,
					sessionId: session.id,
					eventType: 'OPEN',
					eventAt: session.openedAt,
					status: session.status,
					openingBalance: session.openingBalance,
					closingBalance: null,
					totalSales: session.totalSales,
					totalInBs: session.totalInBs,
					totalInUsd: session.totalInUsd,
					cashDrawer: session.cashDrawer,
					user: session.user,
					shift: session.shift,
				};

				if (!session.closedAt) {
					return [openEvent];
				}

				const closeEvent = {
					id: `${session.id}-CLOSE`,
					sessionId: session.id,
					eventType: 'CLOSE',
					eventAt: session.closedAt,
					status: session.status,
					openingBalance: session.openingBalance,
					closingBalance: session.closingBalance,
					totalSales: session.totalSales,
					totalInBs: session.totalInBs,
					totalInUsd: session.totalInUsd,
					cashDrawer: session.cashDrawer,
					user: session.user,
					shift: session.shift,
				};

				return [closeEvent, openEvent];
			});

			return {
				sessions: sessionEvents,
			};
		} catch (error) {
			throw error;
		}
	}

	async getSessionsGroup(filter: SessionGroupFilter) {
		const { date, shiftId } = filter || {};

		const where: any = {};

		if (date) {
			const start = this.getStartOfDayUtc(date);
			const end = this.getEndOfDayUtc(date);

			where.OR = [
				{
					openedAt: {
						gte: start,
						lte: end,
					}
				},
				{
					closedAt: {
						gte: start,
						lte: end,
					}
				}
			];
		}

		if (shiftId) {
			where.shiftId = shiftId;
		}

		try {
			const sessions = await this.prismaService.cashDrawerSession.findMany({
				where,
				orderBy: {
					openedAt: 'desc',
				},
				include: {
					cashDrawer: {
						select: {
							id: true,
							name: true,
						},
					},
					user: {
						select: {
							id: true,
							name: true,
						},
					},
					shift: {
						select: {
							id: true,
							name: true,
							startTime: true,
							endTime: true,
						},
					},
				},
			});

			return {
				sessions: sessions,
			};
		} catch (error) {
			throw error;
		}
	}

	async getSessionById(id: number) {
		try {
			const session = await this.prismaService.cashDrawerSession.findUnique({
				where: { id },
				include: {
					user: true,
					invoices: {
						include: {
							paymentDetails: {
								include: {
									paymentType: true,
								},
							},
							items: {
								include: {
									product: true,
								},
							},
						},
					},
				},
			});

			if (!session) {
				throw new NotFoundException(`Sesión con id ${id} no encontrada`);
			}

			return {
				session,
			};
		} catch (error) {
			throw error;
		}
	}

	async openSession(openSessionDto: OpenSessionDto, userId: number) {
		try {
			const currentOpenSession = await this.prismaService.cashDrawerSession.findFirst({
				where: {
					userId,
					status: 'OPEN',
				},
			});

			if (currentOpenSession) {
				throw new BadRequestException(
					`Ya tienes una caja abierta (sesión #${currentOpenSession.id})`,
				);
			}

			const existingCashDrawerSession = await this.prismaService.cashDrawerSession.findFirst({
				where: {
					cashDrawerId: openSessionDto.cashDrawerId,
					status: 'OPEN',
					userId: { not: userId },
				},
			});

			if (existingCashDrawerSession) {
				throw new BadRequestException(
					`La caja con id ${openSessionDto.cashDrawerId} ya está abierta por otro usuario`,
				);
			}

			const shiftId = await this.shiftsService.findCurrentShift();

			const session = await this.prismaService.cashDrawerSession.create({
				data: {
					userId,
					cashDrawerId: openSessionDto.cashDrawerId,
					openingBalance: new Prisma.Decimal(openSessionDto.openingBalance),
					openingBalanceUsd: new Prisma.Decimal(openSessionDto.openingBalanceUsd),
					...(shiftId && { shiftId }),
				},
				include: {
					cashDrawer: {
						select: {
							id: true,
							name: true,
						},
					},
					user: {
						select: {
							id: true,
							name: true,
						}
					},
					shift: {
						select: {
							id: true,
							name: true,
							startTime: true,
							endTime: true,
						},
					},
				},
			});

			const openEvent = {
				id: `${session.id}-OPEN`,
				sessionId: session.id,
				eventType: 'OPEN',
				eventAt: session.openedAt,
				status: session.status,
				openingBalance: session.openingBalance,
				closingBalance: null,
				totalSales: session.totalSales,
				totalInBs: session.totalInBs,
				totalInUsd: session.totalInUsd,
				cashDrawer: session.cashDrawer,
				user: session.user,
				shift: session.shift,
			};

			return {
				message: 'Apertura de caja creada correctamente',
				sessions: [openEvent],
			};
		} catch (error) {
			throw error;
		}
	}

	async updateSessionOpening(
		id: number,
		updateOpeningSessionDto: UpdateOpeningSessionDto,
		userId: number,
	) {
		try {
			const session = await this.prismaService.cashDrawerSession.findUnique({
				where: { id },
			});

			if (!session) {
				throw new NotFoundException(`Sesión con id ${id} no encontrada`);
			}

			if (session.status === 'CLOSED') {
				throw new BadRequestException('No puedes modificar una caja ya cerrada');
			}

			if (session.userId !== userId) {
				throw new BadRequestException(
					'No tienes permisos para modificar la apertura de esta caja',
				);
			}

			const updatedSession = await this.prismaService.cashDrawerSession.update({
				where: { id },
				data: {
					openingBalance: new Prisma.Decimal(updateOpeningSessionDto.openingBalance),
				},
				include: {
					user: true,
				},
			});

			return {
				message: 'Apertura de caja actualizada correctamente',
				session: updatedSession,
			};
		} catch (error) {
			throw error;
		}
	}

	async closeSession(id: number, closeSessionDto: CloseSessionDto, userId: number) {
		try {
			const session = await this.prismaService.cashDrawerSession.findUnique({
				where: { id },
			});

			if (!session) {
				throw new NotFoundException(`Sesión con id ${id} no encontrada`);
			}

			if (session.status === 'CLOSED') {
				throw new BadRequestException('La caja ya está cerrada');
			}

			if (session.userId !== userId) {
				throw new BadRequestException('No tienes permisos para cerrar esta caja');
			}

			await this.refreshSessionTotals(id);

			const refreshedSession = await this.prismaService.cashDrawerSession.findUnique({
				where: { id },
				select: {
					totalSales: true,
					totalInBs: true,
					totalInUsd: true,
				},
			});

		const updatedSession = await this.prismaService.cashDrawerSession.update({
			where: { id },
			data: {
				closedAt: new Date(),
				closingBalance: new Prisma.Decimal(closeSessionDto.closingBalance),
				closingBalanceUsd: new Prisma.Decimal(closeSessionDto.closingBalanceUsd),
				totalSales: new Prisma.Decimal(this.toNumber(refreshedSession?.totalSales)),
				totalInBs: new Prisma.Decimal(this.toNumber(refreshedSession?.totalInBs)),
				totalInUsd: new Prisma.Decimal(this.toNumber(refreshedSession?.totalInUsd)),
				status: 'CLOSED',
			},
				include: {
					cashDrawer: {
						select: {
							id: true,
							name: true,
						},
					},
					user: {
						select: {
							id: true,
							name: true,
						},
					},
					shift: {
						select: {
							id: true,
							name: true,
							startTime: true,
							endTime: true,
						},
					},
				},
			});

			const closeEvent = {
				id: `${updatedSession.id}-CLOSE`,
				sessionId: updatedSession.id,
				eventType: 'CLOSE',
				eventAt: updatedSession.closedAt,
				status: updatedSession.status,
				openingBalance: updatedSession.openingBalance,
				closingBalance: updatedSession.closingBalance,
				totalSales: updatedSession.totalSales,
				totalInBs: updatedSession.totalInBs,
				totalInUsd: updatedSession.totalInUsd,
				cashDrawer: updatedSession.cashDrawer,
				user: updatedSession.user,
				shift: updatedSession.shift,
			};

			return {
				message: 'Cierre de caja realizado correctamente',
				sessions: [closeEvent],
			};
		} catch (error) {
			throw error;
		}
	}

	async closeSessionByUserId(userId: number): Promise<void> {
		const openSession = await this.prismaService.cashDrawerSession.findFirst({
			where: {
				userId,
				status: 'OPEN',
			},
		});

		if (!openSession) return;

		await this.refreshSessionTotals(openSession.id);

		await this.prismaService.cashDrawerSession.update({
			where: { id: openSession.id },
			data: {
				closedAt: new Date(),
				status: 'CLOSED',
			},
		});
	}
}
