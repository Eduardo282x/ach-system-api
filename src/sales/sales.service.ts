import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { ExchangeRateType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { SessionsService } from 'src/sessions/sessions.service';
import { ShiftsService } from 'src/shifts/shifts.service';
import { CreateInvoiceDto, GetInvoicesFilterDto } from './sales.dto';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

interface ResumenFilter {
	date: string;
	cashDrawerId?: string;
	sessionId?: string;
	shiftId?: string;
}

@Injectable()
export class SalesService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly sessionsService: SessionsService,
		private readonly shiftsService: ShiftsService,
	) { }

	private toTwoDecimals(value: number) {
		return Math.round(value * 100) / 100;
	}

	private getStartOfDayUtc(date: string) {
		return new Date(`${date}T00:00:00.000Z`);
	}

	private getEndOfDayUtc(date: string) {
		return new Date(`${date}T23:59:59.999Z`);
	}

	private async getShiftDateRange(date: string, shiftId?: number): Promise<{ start: Date; end: Date }> {
		if (!shiftId) {
			return {
				start: this.getStartOfDayUtc(date),
				end: this.getEndOfDayUtc(date),
			};
		}

		const shift = await this.prismaService.shift.findUnique({
			where: { id: shiftId },
		});

		if (!shift) {
			return {
				start: this.getStartOfDayUtc(date),
				end: this.getEndOfDayUtc(date),
			};
		}

		const [startHour, startMin] = shift.startTime.split(':').map(Number);
		const [endHour, endMin] = shift.endTime.split(':').map(Number);

		if (endHour < startHour) {
			const startDate = new Date(date);
			startDate.setUTCHours(startHour, startMin, 0, 0);
			startDate.setUTCDate(startDate.getUTCDate() - 1);

			const endDate = new Date(date);
			endDate.setUTCHours(endHour, endMin, 0, 0);

			return { start: startDate, end: endDate };
		}

		return {
			start: this.getStartOfDayUtc(date),
			end: this.getEndOfDayUtc(date),
		};
	}

	private async getLatestExchangeRatesByCurrency() {
		const [usdRecord, eurRecord] = await Promise.all([
			this.prismaService.exchangeRate.findFirst({
				where: { currency: 'USD' },
				orderBy: { createdAt: 'desc' },
				select: { id: true, rate: true },
			}),
			this.prismaService.exchangeRate.findFirst({
				where: { currency: 'EUR' },
				orderBy: { createdAt: 'desc' },
				select: { id: true, rate: true },
			}),
		]);

		const latestByCurrency = new Map<ExchangeRateType, { id: number; rate: number }>();
		if (usdRecord) latestByCurrency.set('USD', { id: usdRecord.id, rate: Number(usdRecord.rate) });
		if (eurRecord) latestByCurrency.set('EUR', { id: eurRecord.id, rate: Number(eurRecord.rate) });

		return latestByCurrency;
	}

	private async generateInvoiceNumber() {
		const maxAttempts = 20;
		const maxInvoiceNumber = 99_999_999;

		const lastInvoice = await this.prismaService.invoice.findFirst({
			orderBy: { id: 'desc' },
			select: {
				id: true,
				invoiceNumber: true,
			},
		});

		const lastId = lastInvoice?.id ?? 0;
		const lastNumericInvoice =
			lastInvoice && /^\d+$/.test(lastInvoice.invoiceNumber)
				? Number(lastInvoice.invoiceNumber)
				: 0;

		let nextNumber = Math.max(lastId, lastNumericInvoice) + 1;

		if (nextNumber + maxAttempts - 1 > maxInvoiceNumber) {
			throw new BadRequestException(
				'Se alcanzó el límite máximo de facturas (8 dígitos)',
			);
		}

		const candidates = Array.from({ length: maxAttempts }, (_, i) =>
			(nextNumber + i).toString().padStart(8, '0'),
		);

		const existing = await this.prismaService.invoice.findMany({
			where: { invoiceNumber: { in: candidates } },
			select: { invoiceNumber: true },
		});

		const existingSet = new Set(existing.map((e) => e.invoiceNumber));
		const available = candidates.find((c) => !existingSet.has(c));

		if (!available) {
			throw new BadRequestException('No se pudo generar un número de factura único');
		}

		return available;
	}

	async getInvoices(filter: GetInvoicesFilterDto) {
		const where: any = {};

		const { search, startDate, endDate, sessionId, userId, shiftId, page = 1, size = 20 } = filter;

		if (search) {
			where.OR = [
				{ invoiceNumber: { contains: search, mode: 'insensitive' } },
				{ customer: { fullName: { contains: search, mode: 'insensitive' } } },
				{ customer: { identify: { contains: search, mode: 'insensitive' } } },
			];
		}

		if (startDate && endDate) {
			const start = this.getStartOfDayUtc(startDate);
			const end = this.getEndOfDayUtc(endDate);

			where.createdAt = {
				gte: start,
				lte: end,
			};
		}

		if (sessionId !== undefined && sessionId !== null) {
			where.sessionId = sessionId;
		}

		if (userId !== undefined && userId !== null) {
			where.userId = userId;
		}

		if (shiftId !== undefined && shiftId !== null) {
			where.shiftId = shiftId;
		}

		try {
			const skip = (page - 1) * size;

			const [invoices, total] = await Promise.all([
				this.prismaService.invoice.findMany({
					where,
					orderBy: {
						createdAt: 'desc',
					},
					skip,
					take: size,
					include: {
						customer: {
							select: {
								id: true,
								fullName: true,
								identify: true
							}
						},
						user: {
							select: {
								id: true,
								name: true,
								role: true
							}
						},
						session: {
							select: {
								id: true,
								cashDrawerId: true,
								cashDrawer: {
									select: {
										id: true,
										name: true,
									}
								}
							}
						},
						shift: {
							select: {
								id: true,
								name: true,
								startTime: true,
								endTime: true,
							}
						},
						items: {
							select: {
								id: true,
								quantity: true,
								unitPrice: true,
								subtotal: true,
								product: {
									select: {
										id: true,
										name: true,
										barcode: true,
										stock: true,
										currency: true
									}
								},
							},
						},
						paymentDetails: {
							include: {
								paymentType: {
									select: {
										id: true,
										name: true,
										currency: true
									}
								},
							},
						},
					},
				}),
				this.prismaService.invoice.count({ where }),
			]);

			return {
				invoices,
				pagination: {
					page,
					size,
					total,
					totalPages: Math.ceil(total / size),
				},
			};
		} catch (error: Error | any) {
			throw new BadRequestException(
				`Error al obtener facturas: ${error.message || 'Error desconocido'}`,
			);
		}
	}

	async getResumenSales(filter: ResumenFilter) {
		try {
			const { date, sessionId, cashDrawerId, shiftId } = filter;
			if (!date) {
				throw new BadRequestException('La fecha es requerida');
			}

			let parsedSessionId: number | undefined;
			if (sessionId !== undefined && sessionId !== '') {
				parsedSessionId = Number(sessionId);

				if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
					throw new BadRequestException('sessionId inválido');
				}
			}

			let parsedShiftId: number | undefined;
			if (shiftId !== undefined && shiftId !== '') {
				parsedShiftId = Number(shiftId);

				if (!Number.isInteger(parsedShiftId) || parsedShiftId <= 0) {
					throw new BadRequestException('shiftId inválido');
				}
			}

			console.log(parsedShiftId);
			console.log({ date: date });
			const { start: startDate, end: endDate } = await this.getShiftDateRange(date, parsedShiftId);
			console.log({ start: startDate, end: endDate });

			if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
				throw new BadRequestException('Formato de fecha inválido. Use YYYY-MM-DD');
			}

			const invoiceWhere: any = {
				createdAt: {
					gte: startDate,
					lte: endDate,
				},
				...(parsedSessionId ? { sessionId: parsedSessionId } : {}),
				...(cashDrawerId ? { cashDrawerId: Number(cashDrawerId) } : {}),
				...(parsedShiftId ? { shiftId: parsedShiftId } : {}),
			};

			const [invoices, invoiceCount, paymentDetails, paymentTypes] = await Promise.all([
				this.prismaService.invoice.findMany({ where: invoiceWhere }),
				this.prismaService.invoice.count({ where: invoiceWhere }),
				this.prismaService.paymentDetail.findMany({
					where: {
						invoice: invoiceWhere,
					},
					select: {
						currency: true,
						amountReceived: true,
						amountChange: true,
						invoice: {
							select: {
								exchangeRateUsd: {
									select: {
										rate: true,
									},
								},
								exchangeRateEur: {
									select: {
										rate: true,
									},
								},
							},
						},
						paymentType: {
							select: {
								id: true,
								name: true,
								currency: true
							},
						},
					},
				}),
				this.prismaService.typePayment.findMany({
					orderBy: {
						createdAt: 'asc',
					},
					select: {
						id: true,
						name: true,
						currency: true,
					},
				}),
			]);

			const grouped = new Map<number, {
				payment: string;
				currency: string;
				amountBs: number;
				amountUsd: number;
				changeAmountBs: number;
				changeAmountUsd: number;
			}>();

			for (const paymentType of paymentTypes) {
				grouped.set(paymentType.id, {
					payment: paymentType.name,
					currency: paymentType.currency,
					amountBs: 0,
					amountUsd: 0,
					changeAmountBs: 0,
					changeAmountUsd: 0,
				});
			}

			for (const paymentDetail of paymentDetails) {
				const paymentTypeId = paymentDetail.paymentType.id;
				const paymentCurrency = paymentDetail.currency as ExchangeRateType;
				const amount = Number(paymentDetail.amountReceived);
				const changeAmount = Number(paymentDetail.amountChange);
				const usdRate = Number(paymentDetail.invoice.exchangeRateUsd.rate ?? 0);
				const eurRate = Number(paymentDetail.invoice.exchangeRateEur.rate ?? 0);

				const current = grouped.get(paymentTypeId) ?? {
					payment: paymentDetail.paymentType.name,
					currency: paymentDetail.paymentType.currency,
					amountBs: 0,
					amountUsd: 0,
					changeAmountBs: 0,
					changeAmountUsd: 0,
				};

				let amountBs = 0;
				let changeAmountBs = 0;

				if (paymentCurrency === 'BS') {
					amountBs = amount;
					changeAmountBs = changeAmount;
				} else if (paymentCurrency === 'USD') {
					amountBs = amount * usdRate;
					changeAmountBs = changeAmount * usdRate;
				} else {
					amountBs = amount * eurRate;
					changeAmountBs = changeAmount * eurRate;
				}

				const amountUsd = usdRate > 0 ? amountBs / usdRate : 0;
				const changeAmountUsd = usdRate > 0 ? changeAmountBs / usdRate : 0;

				current.amountBs += amountBs;
				current.amountUsd += amountUsd;
				current.changeAmountBs += changeAmountBs;
				current.changeAmountUsd += changeAmountUsd;

				grouped.set(paymentTypeId, current);
			}

			const resumen = Array.from(grouped.entries()).map(([paymentTypeId, data]) => ({
				paymentTypeId,
				payment: data.payment,
				currency: data.currency,
				amount: this.toTwoDecimals(data.amountBs),
				amountUsd: this.toTwoDecimals(data.amountUsd),
				changeAmount: this.toTwoDecimals(data.changeAmountBs),
				changeAmountUsd: this.toTwoDecimals(data.changeAmountUsd),
				totalAmount: this.toTwoDecimals(data.amountBs - data.changeAmountBs),
				totalAmountUsd: this.toTwoDecimals(data.amountUsd - data.changeAmountUsd),
			}));

			const totalAmountBs = resumen.reduce((sum, item) => sum + item.amount, 0);
			const totalChangeAmountBs = resumen.reduce((sum, item) => sum + item.changeAmount, 0);
			const totalAmountUsd = resumen.reduce((sum, item) => sum + item.amountUsd, 0);
			const totalChangeAmountUsd = resumen.reduce((sum, item) => sum + item.changeAmountUsd, 0);

			return {
				date,
				sessionId: parsedSessionId ?? null,
				shiftId: parsedShiftId ?? null,
				totalInvoice: invoiceCount,
				total: {
					amount: this.toTwoDecimals(totalAmountBs),
					changeAmount: this.toTwoDecimals(totalChangeAmountBs),
					totalAmount: this.toTwoDecimals(totalAmountBs - totalChangeAmountBs),
					amountBs: this.toTwoDecimals(totalAmountBs),
					changeAmountBs: this.toTwoDecimals(totalChangeAmountBs),
					totalAmountBs: this.toTwoDecimals(totalAmountBs - totalChangeAmountBs),
					amountUsd: this.toTwoDecimals(totalAmountUsd),
					changeAmountUsd: this.toTwoDecimals(totalChangeAmountUsd),
					totalAmountUsd: this.toTwoDecimals(totalAmountUsd - totalChangeAmountUsd),
				},
				resumen,
				invoices: invoices
			};
		} catch (error) {
			throw error;
		}
	}

	private formatDateWithTime(dateString: Date | string) {
		const date = new Date(dateString);
		const hours24 = date.getHours();
		const period = hours24 >= 12 ? 'pm' : 'am';
		const hours12 = hours24 % 12 || 12;
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(hours12).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${day}/${month}/${year} ${hours}:${minutes} ${period}`;
	}

	private formatNumberWithDots(number: number | string, prefix?: string, suffix?: string, isRif?: boolean): string {
		const text = isRif ?
			`${number.toString().slice(0, 1)}-${number.toString().slice(1).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`
			:
			number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
		return `${prefix}${text}${suffix}`;
	}

	private convertAmountByCurrency(
		amount: number,
		currency: ExchangeRateType,
		ratesToBs: Record<ExchangeRateType, number>,
	) {
		const usdRate = ratesToBs.USD;
		const eurRate = ratesToBs.EUR;

		if (currency === 'BS') {
			return {
				amountBs: amount,
				amountUsd: usdRate > 0 ? amount / usdRate : 0,
			};
		}

		if (currency === 'USD') {
			return {
				amountBs: amount * usdRate,
				amountUsd: amount,
			};
		}

		const amountBs = amount * eurRate;
		return {
			amountBs,
			amountUsd: usdRate > 0 ? amountBs / usdRate : 0,
		};
	}

	async getResumenSalesExcel(filter: ResumenFilter, res: Response) {
		try {
			const resumenData = await this.getResumenSales(filter);
			const invoices = await this.getInvoices({
				startDate: filter.date,
				endDate: filter.date,
				sessionId: filter.sessionId ? Number(filter.sessionId) : undefined,
				shiftId: filter.shiftId ? Number(filter.shiftId) : undefined,
			});

			const workbook = new ExcelJS.Workbook();
			const resumenSheet = workbook.addWorksheet('Resumen de Pagos');
			const detalleSheet = workbook.addWorksheet('Detalle de Facturas');

			resumenSheet.addRow(['Fecha', this.formatDateWithTime(resumenData.date)]);
			resumenSheet.addRow(['Sesión', resumenData.sessionId ?? 'TODAS']);
			resumenSheet.addRow(['Turno', resumenData.shiftId ?? 'TODOS']);
			resumenSheet.addRow(['Cantidad de facturas', resumenData.totalInvoice]);
			resumenSheet.addRow([]);

			resumenSheet.addRow([
				'Método de pago',
				'Moneda',
				'Monto (Bs)',
				'Monto (USD)',
				'Vuelto (Bs)',
				'Vuelto (USD)',
				'Total (Bs)',
				'Total (USD)',
			]);

			for (const item of resumenData.resumen) {
				resumenSheet.addRow([
					item.payment,
					item.currency,
					item.amount,
					item.amountUsd,
					item.changeAmount,
					item.changeAmountUsd,
					item.totalAmount,
					item.totalAmountUsd,
				]);
			}

			resumenSheet.addRow([]);
			resumenSheet.addRow([
				'TOTAL GENERAL',
				'',
				resumenData.total.amountBs,
				resumenData.total.amountUsd,
				resumenData.total.changeAmountBs,
				resumenData.total.changeAmountUsd,
				resumenData.total.totalAmountBs,
				resumenData.total.totalAmountUsd,
			]);

			resumenSheet.getRow(5).font = { bold: true };
			resumenSheet.getRow(resumenSheet.rowCount).font = { bold: true };

			resumenSheet.columns = [
				{ width: 24 },
				{ width: 12 },
				{ width: 15 },
				{ width: 15 },
				{ width: 15 },
				{ width: 15 },
				{ width: 15 },
				{ width: 15 },
			];

			detalleSheet.addRow([
				'Factura',
				'Fecha',
				'Cliente',
				'Cédula/RIF',
				'Cajero',
				'Caja',
				'Sesión',
				'Turno',
				'Total (Bs)',
				'Total (USD)',
				'Recibido (Bs)',
				'Recibido (USD)',
				'Vuelto (Bs)',
				'Vuelto (USD)',
				'Pagos',
				'Productos',
			]);

			for (const invoice of invoices.invoices) {
				const payments = invoice.paymentDetails
					.map((p) => `${p.paymentType.name}: ${Number(p.amountNet)} ${p.currency}`)
					.join(' | ');

				const products = invoice.items
					.map((item) => `${item.product.name} x${item.quantity}`)
					.join(' | ');

				detalleSheet.addRow([
					invoice.invoiceNumber,
					this.formatDateWithTime(invoice.createdAt),
					invoice.customer.fullName,
					this.formatNumberWithDots(invoice.customer.identify, '', '', true),
					invoice.user.name,
					invoice.session.cashDrawer.name,
					invoice.session.id,
					invoice.shift?.name ?? 'Sin turno',
					Number(invoice.totalAmountBs),
					Number(invoice.totalAmountUsd),
					Number(invoice.totalReceivedBs),
					Number(invoice.totalReceivedUsd),
					Number(invoice.totalChangeBs),
					Number(invoice.totalChangeUsd),
					payments,
					products,
				]);
			}

			detalleSheet.getRow(1).font = { bold: true };
			detalleSheet.columns = [
				{ width: 14 },
				{ width: 24 },
				{ width: 26 },
				{ width: 18 },
				{ width: 20 },
				{ width: 10 },
				{ width: 14 },
				{ width: 18 },
				{ width: 14 },
				{ width: 14 },
				{ width: 14 },
				{ width: 14 },
				{ width: 14 },
				{ width: 14 },
				{ width: 50 },
				{ width: 50 },
			];

			const fileName = `resumen-ventas-${filter.date}${filter.sessionId ? `-session-${filter.sessionId}` : ''}.xlsx`;
			res.setHeader(
				'Content-Type',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			);
			res.setHeader(
				'Content-Disposition',
				`attachment; filename="${fileName}"`,
			);

			await workbook.xlsx.write(res);
			res.end();
		} catch (error: Error | any) {
			throw new BadRequestException(
				`Error al generar reporte: ${error.message || 'Error desconocido'}`,
			);
		}
	}

	async getPaymentTypes() {
		try {
			const paymentTypes = await this.prismaService.typePayment.findMany({
				orderBy: {
					createdAt: 'asc',
				},
			});

			return {
				paymentTypes,
			};
		} catch (error) {
			throw error;
		}
	}

	private getVenezuelaNow(): Date {
		const today = new Date();
		const todayVenezuela = dayjs(today).add(-4, 'hour').format('YYYY-MM-DDTHH:mm:ss.SSSZ');
		return new Date(todayVenezuela);
	}

	async createInvoice(createInvoiceDto: CreateInvoiceDto, userId: number) {
		try {
			const [customer, session] = await Promise.all([
				this.prismaService.clients.findUnique({
					where: { id: createInvoiceDto.customerId },
				}),
				this.prismaService.cashDrawerSession.findUnique({
					where: { id: createInvoiceDto.sessionId },
				}),
			]);

			if (!customer) {
				throw new NotFoundException(
					`Cliente con id ${createInvoiceDto.customerId} no encontrado`,
				);
			}

			if (!session) {
				throw new NotFoundException(
					`Sesión de caja con id ${createInvoiceDto.sessionId} no encontrada`,
				);
			}

			if (session.closedAt !== null) {
				throw new BadRequestException(
					`La sesión de caja con id ${createInvoiceDto.sessionId} ya está cerrada`,
				);
			}

			let resolvedShiftId = createInvoiceDto.shiftId;

			if (!resolvedShiftId) {
				resolvedShiftId = await this.shiftsService.findCurrentShift();
			}

			if (resolvedShiftId) {
				const shift = await this.prismaService.shift.findUnique({
					where: { id: resolvedShiftId },
				});

				if (!shift) {
					throw new NotFoundException(
						`Turno con id ${resolvedShiftId} no encontrado`,
					);
				}

				if (!shift.active) {
					throw new BadRequestException(
						`El turno "${shift.name}" está desactivado`,
					);
				}
			}

			const paymentTypeIds = [
				...new Set(createInvoiceDto.payments.map((payment) => payment.paymentTypeId)),
			];

			const requiredByProduct = new Map<number, number>();
			for (const item of createInvoiceDto.items) {
				requiredByProduct.set(
					item.productId,
					(requiredByProduct.get(item.productId) ?? 0) + item.quantity,
				);
			}
			const productIds = Array.from(requiredByProduct.keys());

			const hasManualRateIds =
				createInvoiceDto.exchangeRateUsdId !== undefined ||
				createInvoiceDto.exchangeRateEurId !== undefined;

			const [paymentTypes, products, ratesResult] = await Promise.all([
				this.prismaService.typePayment.findMany({
					where: { id: { in: paymentTypeIds } },
				}),
				this.prismaService.product.findMany({
					where: { id: { in: productIds } },
				}),
				hasManualRateIds
					? (async () => {
						if (!createInvoiceDto.exchangeRateUsdId || !createInvoiceDto.exchangeRateEurId) {
							throw new BadRequestException(
								'Si envías tasas manuales, debes enviar exchangeRateUsdId y exchangeRateEurId',
							);
						}
						return this.prismaService.exchangeRate.findMany({
							where: {
								id: {
									in: [createInvoiceDto.exchangeRateUsdId, createInvoiceDto.exchangeRateEurId],
								},
							},
						});
					})()
					: this.getLatestExchangeRatesByCurrency(),
			]);

			if (paymentTypes.length !== paymentTypeIds.length) {
				throw new BadRequestException('Uno o más tipos de pago no existen');
			}

			if (products.length !== productIds.length) {
				throw new BadRequestException('Uno o más productos no existen');
			}

			const productsMap = new Map(products.map((product) => [product.id, product]));

			for (const [productId, quantity] of requiredByProduct.entries()) {
				const product = productsMap.get(productId);
				if (!product) {
					throw new BadRequestException(`Producto con id ${productId} no existe`);
				}

				if (Number(product.stock) < quantity) {
					throw new BadRequestException(
						`Stock insuficiente para ${product.name}. Disponible: ${Number(product.stock)}`,
					);
				}
			}

			const paymentTypeMap = new Map(
				paymentTypes.map((paymentType) => [paymentType.id, paymentType]),
			);

			let usdRate: { id: number; rate: number } | undefined;
			let eurRate: { id: number; rate: number } | undefined;

			if (hasManualRateIds) {
				const selectedRates = ratesResult as { id: number; currency: string; rate: Prisma.Decimal }[];

				if (selectedRates.length !== 2) {
					throw new BadRequestException('Una o ambas tasas enviadas no existen');
				}

				const usdRateRecord = selectedRates.find(
					(rate) => rate.id === createInvoiceDto.exchangeRateUsdId,
				);
				const eurRateRecord = selectedRates.find(
					(rate) => rate.id === createInvoiceDto.exchangeRateEurId,
				);

				if (!usdRateRecord || usdRateRecord.currency !== 'USD') {
					throw new BadRequestException('exchangeRateUsdId no corresponde a una tasa USD');
				}

				if (!eurRateRecord || eurRateRecord.currency !== 'EUR') {
					throw new BadRequestException('exchangeRateEurId no corresponde a una tasa EUR');
				}

				usdRate = { id: usdRateRecord.id, rate: Number(usdRateRecord.rate) };
				eurRate = { id: eurRateRecord.id, rate: Number(eurRateRecord.rate) };
			} else {
				const latestRatesByCurrency = ratesResult as Map<ExchangeRateType, { id: number; rate: number }>;
				usdRate = latestRatesByCurrency.get('USD');
				eurRate = latestRatesByCurrency.get('EUR');
			}

			if (!usdRate || usdRate.rate <= 0) {
				throw new BadRequestException('No existe una tasa USD válida');
			}

			if (!eurRate || eurRate.rate <= 0) {
				throw new BadRequestException('No existe una tasa EUR válida');
			}

			const ratesToBs: Record<ExchangeRateType, number> = {
				BS: 1,
				USD: usdRate.rate,
				EUR: eurRate.rate,
			};

			const getFactorByCurrency = (currency: ExchangeRateType) => {
				if (currency === 'BS') {
					return 1;
				}

				const factor = ratesToBs[currency];
				if (!factor || factor <= 0) {
					throw new BadRequestException(
						`No existe una tasa válida para la moneda ${currency}`,
					);
				}

				return factor;
			};

			let totalAmountBs = 0;
			const invoiceItemsData = createInvoiceDto.items.map((item) => {
				const product = productsMap.get(item.productId);

				if (!product) {
					throw new BadRequestException(
						`Producto con id ${item.productId} no existe`,
					);
				}

				const unitPrice = Number(product.price);
				const factor = getFactorByCurrency(product.currency as ExchangeRateType);
				const subtotal = this.toTwoDecimals(unitPrice * item.quantity * factor);

				totalAmountBs += subtotal;

				return {
					productId: item.productId,
					quantity: item.quantity,
					unitPrice,
					subtotal,
					productName: product.name,
				};
			});

			totalAmountBs = this.toTwoDecimals(totalAmountBs);
			const totalAmountUsd =
				ratesToBs.USD > 0 ? this.toTwoDecimals(totalAmountBs / ratesToBs.USD) : 0;

			const paymentsData = createInvoiceDto.payments.map((payment) => {
				const received = Number(payment.amountReceived);
				const change = Number(payment.amountChange ?? 0);
				const net = received - change;
				const paymentType = paymentTypeMap.get(payment.paymentTypeId);

				if (!paymentType) {
					throw new BadRequestException(
						`Tipo de pago con id ${payment.paymentTypeId} no existe`,
					);
				}

				if (received < 0 || change < 0) {
					throw new BadRequestException(
						'Los montos recibidos y de vuelto no pueden ser negativos',
					);
				}

				if (received != 0 && net < 0) {
					throw new BadRequestException(
						'El monto neto de un pago no puede ser negativo',
					);
				}

				const paymentCurrency = paymentType.currency as ExchangeRateType;

				if (paymentCurrency === 'EUR') {
					throw new BadRequestException(
						'Los pagos en EUR no están soportados para registrar montos físicos en factura',
					);
				}

				const factor = getFactorByCurrency(paymentCurrency);
				const netBs = net * factor;

				return {
					paymentTypeId: payment.paymentTypeId,
					currency: paymentCurrency,
					amountReceived: this.toTwoDecimals(received),
					amountChange: this.toTwoDecimals(change),
					amountNet: this.toTwoDecimals(net),
					amountNetBs: this.toTwoDecimals(netBs),
					denominations: payment.denominations,
				};
			});

			if (!paymentsData.some((payment) => payment.amountReceived > 0)) {
				throw new BadRequestException(
					'Debe existir al menos un método de pago con monto recibido mayor a 0',
				);
			}

			const totalNetBsRaw = paymentsData.reduce(
				(sum, payment) => sum + payment.amountNetBs,
				0,
			);

			const totalNetBs = this.toTwoDecimals(totalNetBsRaw);
			const totalReceivedBs = this.toTwoDecimals(
				paymentsData.reduce(
					(sum, payment) => sum + (payment.currency === 'BS' ? payment.amountReceived : 0),
					0,
				),
			);
			const totalReceivedUsd = this.toTwoDecimals(
				paymentsData.reduce(
					(sum, payment) => sum + (payment.currency === 'USD' ? payment.amountReceived : 0),
					0,
				),
			);
			const totalChangeBs = this.toTwoDecimals(
				paymentsData.reduce(
					(sum, payment) => sum + (payment.currency === 'BS' ? payment.amountChange : 0),
					0,
				),
			);
			const totalChangeUsd = this.toTwoDecimals(
				paymentsData.reduce(
					(sum, payment) => sum + (payment.currency === 'USD' ? payment.amountChange : 0),
					0,
				),
			);

			const tolerance = 0.01;
			if (totalNetBs + tolerance < totalAmountBs) {
				throw new BadRequestException(
					`Pago insuficiente. Total factura: ${totalAmountBs}, neto recibido: ${totalNetBs}`,
				);
			}

			const invoiceNumber = await this.generateInvoiceNumber();

			const invoice = await this.prismaService.$transaction(async (tx) => {
				const createdInvoice = await tx.invoice.create({
					data: {
						invoiceNumber,
						totalAmountBs: new Prisma.Decimal(totalAmountBs),
						exchangeRateUsdId: usdRate.id,
						exchangeRateEurId: eurRate.id,
						totalAmountUsd: new Prisma.Decimal(totalAmountUsd),
						totalReceivedBs: new Prisma.Decimal(totalReceivedBs),
						totalReceivedUsd: new Prisma.Decimal(totalReceivedUsd),
						totalChangeBs: new Prisma.Decimal(totalChangeBs),
						totalChangeUsd: new Prisma.Decimal(totalChangeUsd),
						userId,
						customerId: createInvoiceDto.customerId,
						sessionId: createInvoiceDto.sessionId,
						createdAt: this.getVenezuelaNow(),
						...(resolvedShiftId && { shiftId: resolvedShiftId }),
					},
				});

				await tx.invoiceItem.createMany({
					data: invoiceItemsData.map((item) => ({
						invoiceId: createdInvoice.id,
						productId: item.productId,
						unitPrice: new Prisma.Decimal(item.unitPrice),
						quantity: item.quantity,
						subtotal: new Prisma.Decimal(item.subtotal),
					})),
				});

				await Promise.all(
					invoiceItemsData.map((item) =>
						tx.product.update({
							where: { id: item.productId },
							data: {
								stock: {
									decrement: item.quantity,
								},
							},
						}),
					),
				);

				await tx.inventoryMovement.createMany({
					data: invoiceItemsData.map((item) => ({
						productId: item.productId,
						quantity: -item.quantity,
						type: 'SALE' as const,
						userId,
						reason: `Venta en factura ${invoiceNumber} - ${item.productName}`,
					})),
				});

				await tx.paymentDetail.createMany({
					data: paymentsData.map((payment) => ({
						invoiceId: createdInvoice.id,
						paymentTypeId: payment.paymentTypeId,
						amountReceived: new Prisma.Decimal(payment.amountReceived),
						amountChange: new Prisma.Decimal(payment.amountChange),
						amountNet: new Prisma.Decimal(payment.amountNet),
						amountNetBs: new Prisma.Decimal(payment.amountNetBs),
						currency: payment.currency as ExchangeRateType,
						denominations: payment.denominations ?? undefined,
					})),
				});

				return tx.invoice.findUnique({
					where: { id: createdInvoice.id },
					include: {
						customer: {
							select: {
								id: true,
								fullName: true,
								identify: true
							}
						},
						user: {
							select: {
								id: true,
								name: true,
								role: true
							}
						},
						session: {
							select: {
								id: true,
								cashDrawerId: true
							}
						},
						shift: {
							select: {
								id: true,
								name: true,
								startTime: true,
								endTime: true,
							}
						},
						items: {
							select: {
								id: true,
								quantity: true,
								unitPrice: true,
								subtotal: true,
								product: {
									select: {
										id: true,
										name: true,
										barcode: true,
										stock: true,
										currency: true
									}
								},
							},
						},
						paymentDetails: {
							include: {
								paymentType: {
									select: {
										id: true,
										name: true,
										currency: true
									}
								},
							},
						},
					},
				});
			});


			try {
				await this.sessionsService.refreshSessionTotals(createInvoiceDto.sessionId);
			} catch (error: Error | any) {
				console.log('error refreshing session totals:', error);
				throw new BadRequestException(
					`Error al actualizar totales de sesión: ${error.message || 'Error desconocido'}`,
				);
			}

			return {
				message: 'Factura creada correctamente',
				invoice,
			};
		} catch (error: Error | any) {
			console.log('error creating invoice:', error);
			throw new BadRequestException(
				`Error al crear factura: ${error.message || 'Error desconocido'}`,
			);
		}
	}
}
