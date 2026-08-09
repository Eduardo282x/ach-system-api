import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from 'src/generated/prisma/client';
import { ExchangeRateType, ReturnCondition } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { SessionsService } from 'src/sessions/sessions.service';
import {
	CreateChangeDto,
	CreateInvoiceDto,
	CreateReturnDto,
	GetInvoicesFilterDto,
	RefundPaymentDto,
	ReturnItemDto,
} from './sales.dto';
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
}

@Injectable()
export class SalesService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly sessionsService: SessionsService,
		private readonly configService: ConfigService,
	) { }

	private invoiceInclude = {
		customer: {
			select: {
				id: true,
				fullName: true,
				identify: true,
			},
		},
		user: {
			select: {
				id: true,
				name: true,
				role: true,
			},
		},
		session: {
			select: {
				id: true,
				cashDrawerId: true,
			},
		},
		items: {
			select: {
				id: true,
				productId: true,
				quantity: true,
				unitPrice: true,
				hasDiscount: true,
				subtotal: true,
				product: {
					select: {
						id: true,
						name: true,
						barcode: true,
						stock: true,
						currency: true,
					},
				},
			},
		},
		paymentDetails: {
			include: {
				paymentType: {
					select: {
						id: true,
						name: true,
						currency: true,
					},
				},
			},
		},
	} as const;

	private toTwoDecimals(value: number) {
		return Math.round(value * 100) / 100;
	}

	private getStartOfDayUtc(date: string) {
		return new Date(`${date}T00:00:00.000Z`);
	}

	private getEndOfDayUtc(date: string) {
		return new Date(`${date}T23:59:59.999Z`);
	}

	private async getShiftDateRange(date: string): Promise<{ start: Date; end: Date }> {
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
				'Se alcanzó el límite máximo de recibos (8 dígitos)',
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
			throw new BadRequestException('No se pudo generar un número de recibo único');
		}

		return available;
	}

	async getInvoices(filter: GetInvoicesFilterDto) {
		const where: any = {};

		const { search, startDate, endDate, sessionId, userId, page = 1, size = 20, credit } = filter;

		if (search) {
			where.OR = [
				{ invoiceNumber: { contains: search, mode: 'insensitive' } },
				{ customer: { fullName: { contains: search, mode: 'insensitive' } } },
				{ customer: { identify: { contains: search, mode: 'insensitive' } } },
			];
		}

		if (credit && credit.toLowerCase() === 'true') {
			where.status = 'PENDING';
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
						items: {
							select: {
								id: true,
								quantity: true,
								unitPrice: true,
								hasDiscount: true,
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
				`Error al obtener recibos: ${error.message || 'Error desconocido'}`,
			);
		}
	}

	async getResumenSales(filter: ResumenFilter) {
		try {
			const { date, sessionId, cashDrawerId } = filter;
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

			const { start: startDate, end: endDate } = await this.getShiftDateRange(date);

			if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
				throw new BadRequestException('Formato de fecha inválido. Use YYYY-MM-DD');
			}


			const invoiceWhere: any = {
				createdAt: {
					gte: startDate,
					lte: endDate,
				},
				...(parsedSessionId ? { sessionId: parsedSessionId } : {}),
				...(cashDrawerId ? { session: { cashDrawerId: Number(cashDrawerId) } } : {}),
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

	async getResumenSalesExcel(filter: ResumenFilter, res: Response) {
		try {
			const resumenData = await this.getResumenSales(filter);
			const invoices = await this.getInvoices({
				startDate: filter.date,
				endDate: filter.date,
				sessionId: filter.sessionId ? Number(filter.sessionId) : undefined,
			});

			const workbook = new ExcelJS.Workbook();
			const resumenSheet = workbook.addWorksheet('Resumen de Pagos');
			const detalleSheet = workbook.addWorksheet('Detalle de Recibos');

			resumenSheet.addRow(['Fecha', this.formatDateWithTime(resumenData.date)]);
			resumenSheet.addRow(['Sesión', resumenData.sessionId ?? 'TODAS']);
			resumenSheet.addRow(['Cantidad de recibos', resumenData.totalInvoice]);
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
				'Recibo',
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
				'Descuento (Bs)',
				'Descuento (USD)',
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
					Number(invoice.totalAmountBs),
					Number(invoice.totalAmountUsd),
					Number(invoice.totalReceivedBs),
					Number(invoice.totalReceivedUsd),
					Number(invoice.totalChangeBs),
					Number(invoice.totalChangeUsd),
					Number(invoice.discountBs),
					Number(invoice.discountUsd),
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
					id: 'asc',
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

			if (createInvoiceDto.hasDiscount) {
				if (createInvoiceDto.payments.length !== 1) {
					throw new BadRequestException(
						'El descuento solo se puede aplicar cuando la venta tiene un único método de pago',
					);
				}

				const singlePayment = createInvoiceDto.payments[0];
				const singlePaymentType = paymentTypeMap.get(singlePayment.paymentTypeId);

				if (!singlePaymentType || singlePaymentType.currency !== 'USD') {
					throw new BadRequestException(
						'El descuento solo se puede aplicar cuando el pago se realiza en dólares (USD)',
					);
				}
			}

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
			let listTotalBs = 0;
			const invoiceItemsData = createInvoiceDto.items.map((item) => {
				const product = productsMap.get(item.productId);

				if (!product) {
					throw new BadRequestException(
						`Producto con id ${item.productId} no existe`,
					);
				}

				const listPrice = Number(product.price);
				let unitPrice = listPrice;
				let hasDiscount = false;

				if (item.unitPrice !== undefined) {
					if (item.unitPrice > listPrice) {
						throw new BadRequestException(
							`El precio unitario no puede ser mayor al precio de lista para ${product.name}`,
						);
					}

					if (item.unitPrice < listPrice && !createInvoiceDto.hasDiscount) {
						throw new BadRequestException(
							`No se puede aplicar descuento a ${product.name} sin indicar hasDiscount en la venta`,
						);
					}

					unitPrice = item.unitPrice;
					hasDiscount = unitPrice < listPrice;
				}

				const factor = getFactorByCurrency(product.currency as ExchangeRateType);
				const subtotal = this.toTwoDecimals(unitPrice * item.quantity * factor);
				const listSubtotal = this.toTwoDecimals(listPrice * item.quantity * factor);

				totalAmountBs += subtotal;
				listTotalBs += listSubtotal;

				return {
					productId: item.productId,
					quantity: item.quantity,
					unitPrice,
					hasDiscount,
					subtotal,
					productName: product.name,
				};
			});

			totalAmountBs = this.toTwoDecimals(totalAmountBs);
			const totalAmountUsd =
				ratesToBs.USD > 0 ? this.toTwoDecimals(totalAmountBs / ratesToBs.USD) : 0;

			const discountBs = createInvoiceDto.hasDiscount
				? this.toTwoDecimals(listTotalBs - totalAmountBs)
				: 0;
			const discountUsd =
				createInvoiceDto.hasDiscount && ratesToBs.USD > 0
					? this.toTwoDecimals(discountBs / ratesToBs.USD)
					: 0;

			if (createInvoiceDto.hasDiscount && listTotalBs > 0) {
				const maxDiscountPercentage = Number(
					this.configService.get<number>('MAX_DISCOUNT_PERCENTAGE') ?? 25,
				);

				const discountPercent = (discountBs / listTotalBs) * 100;

				if (discountPercent > maxDiscountPercentage) {
					throw new BadRequestException(
						`El descuento aplicado (${this.toTwoDecimals(discountPercent)}%) supera el límite permitido (${maxDiscountPercentage}%)`,
					);
				}
			}

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
						'Los pagos en EUR no están soportados para registrar montos físicos en recibos',
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
					`Pago insuficiente. Total Recibo: ${totalAmountBs}, neto recibido: ${totalNetBs}`,
				);
			}

			const invoiceNumber = await this.generateInvoiceNumber();

			let isCreditPayment = false;
			if (paymentTypeIds.length == 1) {
				isCreditPayment = paymentTypes[0].name.includes('Credito');
			}

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
						hasDiscount: createInvoiceDto.hasDiscount,
						discountBs: new Prisma.Decimal(discountBs),
						discountUsd: new Prisma.Decimal(discountUsd),
						userId,
						status: isCreditPayment ? 'PENDING' : 'PAID',
						customerId: createInvoiceDto.customerId,
						sessionId: createInvoiceDto.sessionId,
						createdAt: this.getVenezuelaNow(),
					},
				});

				await tx.invoiceItem.createMany({
					data: invoiceItemsData.map((item) => ({
						invoiceId: createdInvoice.id,
						productId: item.productId,
						unitPrice: new Prisma.Decimal(item.unitPrice),
						hasDiscount: item.hasDiscount,
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
						reason: `Venta en recibo ${invoiceNumber} - ${item.productName}`,
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
						items: {
							select: {
								id: true,
								quantity: true,
								unitPrice: true,
								hasDiscount: true,
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
				message: 'Recibo creado correctamente',
				invoice,
			};
		} catch (error: Error | any) {
			console.log('error creating invoice:', error);
			throw new BadRequestException(
				`Error al crear Recibo: ${error.message || 'Error desconocido'}`,
			);
		}
	}

	async getInvoiceById(invoiceId: number) {
		try {
			const invoice = await this.prismaService.invoice.findUnique({
				where: { id: invoiceId },
				include: this.invoiceInclude,
			});

			if (!invoice) {
				throw new NotFoundException(`Recibo con id ${invoiceId} no encontrado`);
			}

			return {
				invoice,
			};
		} catch (error) {
			throw error;
		}
	}

	private async validateReturnItems(invoice: any, items: ReturnItemDto[]) {
		const invoiceItemsMap = new Map<number, any>(
			invoice.items.map((item: any) => [item.id, item]),
		);

		const aggregated = new Map<number, { quantity: number; condition: ReturnCondition }>();
		for (const item of items) {
			const invoiceItem = invoiceItemsMap.get(item.invoiceItemId);
			if (!invoiceItem) {
				throw new BadRequestException(
					`El ítem ${item.invoiceItemId} no pertenece al recibo`,
				);
			}

			const existing = aggregated.get(item.invoiceItemId);
			if (existing && existing.condition !== item.condition) {
				throw new BadRequestException(
					`El ítem ${item.invoiceItemId} no puede agregarse con condiciones distintas en una misma devolución`,
				);
			}

			const current = existing ?? {
				quantity: 0,
				condition: item.condition,
			};
			current.quantity += item.quantity;
			aggregated.set(item.invoiceItemId, current);
		}

		const result: {
			invoiceItemId: number;
			productId: number;
			productName: string;
			quantity: number;
			condition: ReturnCondition;
		}[] = [];

		for (const [invoiceItemId, data] of aggregated.entries()) {
			const invoiceItem = invoiceItemsMap.get(invoiceItemId);
			if (data.quantity > Number(invoiceItem.quantity)) {
				throw new BadRequestException(
					`La cantidad a devolver (${data.quantity}) supera la cantidad vendida (${invoiceItem.quantity}) para ${invoiceItem.product.name}`,
				);
			}

			result.push({
				invoiceItemId,
				productId: invoiceItem.productId,
				productName: invoiceItem.product.name,
				quantity: this.toTwoDecimals(data.quantity),
				condition: data.condition,
			});
		}

		return result;
	}

	private async validateRefundPayments(invoice: any, payments: RefundPaymentDto[]) {
		const paymentTypeIds = [
			...new Set(payments.map((payment) => payment.paymentTypeId)),
		];

		const paymentTypes = await this.prismaService.typePayment.findMany({
			where: { id: { in: paymentTypeIds } },
		});

		if (paymentTypes.length !== paymentTypeIds.length) {
			throw new BadRequestException('Uno o más tipos de pago de devolución no existen');
		}

		const paymentTypeMap = new Map(paymentTypes.map((paymentType) => [paymentType.id, paymentType]));
		const usdRate = Number(invoice.exchangeRateUsd?.rate ?? 0);

		if (payments.some((payment) => {
			const paymentType = paymentTypeMap.get(payment.paymentTypeId);
			return paymentType?.currency === 'USD' && usdRate <= 0;
		})) {
			throw new BadRequestException(
				'No existe una tasa USD válida para convertir el monto de devolución',
			);
		}

		return payments.map((payment) => {
			const paymentType = paymentTypeMap.get(payment.paymentTypeId);
			if (!paymentType) {
				throw new BadRequestException(
					`Tipo de pago con id ${payment.paymentTypeId} no existe`,
				);
			}

			const currency = paymentType.currency as ExchangeRateType;

			if (currency === 'EUR') {
				throw new BadRequestException(
					'Los pagos en EUR no están soportados para devoluciones',
				);
			}

			if (currency === 'USD' && usdRate <= 0) {
				throw new BadRequestException(
					'No existe una tasa USD válida para convertir el monto de devolución',
				);
			}

			const factor = currency === 'BS' ? 1 : usdRate;
			const amountBs = this.toTwoDecimals(payment.amount * factor);

			return {
				paymentTypeId: payment.paymentTypeId,
				currency,
				amount: this.toTwoDecimals(payment.amount),
				amountBs,
			};
		});
	}

	async returnInvoice(createReturnDto: CreateReturnDto, userId: number) {
		try {
			const invoice = await this.prismaService.invoice.findUnique({
				where: { id: createReturnDto.invoiceId },
				include: {
					...this.invoiceInclude,
					exchangeRateUsd: {
						select: { id: true, rate: true },
					},
					exchangeRateEur: {
						select: { id: true, rate: true },
					},
				},
			});

			if (!invoice) {
				throw new NotFoundException(
					`Recibo con id ${createReturnDto.invoiceId} no encontrado`,
				);
			}

			if (invoice.status !== 'PAID') {
				throw new BadRequestException(
					'Solo se puede devolver un recibo en estado Pagada',
				);
			}

			const session = await this.prismaService.cashDrawerSession.findUnique({
				where: { id: invoice.sessionId },
			});

			if (!session) {
				throw new NotFoundException(
					`Sesión de caja con id ${invoice.sessionId} no encontrada`,
				);
			}

			if (session.closedAt !== null) {
				throw new BadRequestException(
					'La sesión de caja de la factura ya está cerrada, no se puede devolver',
				);
			}

			const validatedItems = await this.validateReturnItems(invoice, createReturnDto.items);
			const refundPayments = await this.validateRefundPayments(invoice, createReturnDto.payments);

			const result = await this.prismaService.$transaction(async (tx) => {
				const createdReturn = await tx.return.create({
					data: {
						invoiceId: invoice.id,
						type: 'RETURN',
						reason: createReturnDto.reason,
						userId,
					},
				});

				await tx.returnItem.createMany({
					data: validatedItems.map((item) => ({
						returnId: createdReturn.id,
						productId: item.productId,
						quantity: new Prisma.Decimal(item.quantity),
						condition: item.condition,
					})),
				});

				const goodItems = validatedItems.filter(
					(item) => item.condition === 'GOOD',
				);

				if (goodItems.length > 0) {
					await Promise.all(
						goodItems.map((item) =>
							tx.product.update({
								where: { id: item.productId },
								data: {
									stock: {
										increment: item.quantity,
									},
								},
							}),
						),
					);

					await tx.inventoryMovement.createMany({
						data: goodItems.map((item) => ({
							productId: item.productId,
							quantity: item.quantity,
							type: 'RETURN',
							userId,
							reason: `Devolución en recibo ${invoice.invoiceNumber} - ${item.productName}`,
						})),
					});
				}

				await tx.paymentDetail.createMany({
					data: refundPayments.map((payment) => ({
						invoiceId: invoice.id,
						paymentTypeId: payment.paymentTypeId,
						amountReceived: new Prisma.Decimal(-payment.amount),
						amountChange: new Prisma.Decimal(0),
						amountNet: new Prisma.Decimal(-payment.amount),
						amountNetBs: new Prisma.Decimal(-payment.amountBs),
						currency: payment.currency as ExchangeRateType,
						denominations: undefined,
					})),
				});

				const updatedInvoice = await tx.invoice.update({
					where: { id: invoice.id },
					data: { status: 'RETURN' },
					include: this.invoiceInclude,
				});

				return { createdReturn, updatedInvoice };
			});

			try {
				await this.sessionsService.refreshSessionTotals(invoice.sessionId);
			} catch (error: Error | any) {
				console.log('error refreshing session totals:', error);
			}

			return {
				message: 'Devolución registrada correctamente',
				return: result.createdReturn,
				invoice: result.updatedInvoice,
			};
		} catch (error: Error | any) {
			console.log('error creating return:', error);
			throw new BadRequestException(
				`Error al registrar devolución: ${error.message || 'Error desconocido'}`,
			);
		}
	}

	async changeInvoice(createChangeDto: CreateChangeDto, userId: number) {
		try {
			const invoice = await this.prismaService.invoice.findUnique({
				where: { id: createChangeDto.invoiceId },
				include: {
					...this.invoiceInclude,
					exchangeRateUsd: {
						select: { id: true, rate: true },
					},
					exchangeRateEur: {
						select: { id: true, rate: true },
					},
				},
			});

			if (!invoice) {
				throw new NotFoundException(
					`Recibo con id ${createChangeDto.invoiceId} no encontrado`,
				);
			}

			if (invoice.status !== 'PAID') {
				throw new BadRequestException(
					'Solo se puede cambiar un recibo en estado Pagada',
				);
			}

			const targetSession = await this.prismaService.cashDrawerSession.findUnique({
				where: { id: createChangeDto.sessionId },
			});

			if (!targetSession) {
				throw new NotFoundException(
					`Sesión de caja con id ${createChangeDto.sessionId} no encontrada`,
				);
			}

			if (targetSession.closedAt !== null) {
				throw new BadRequestException(
					'La sesión de caja destino está cerrada',
				);
			}

			const validatedItems = await this.validateReturnItems(invoice, createChangeDto.returnedItems);

			const requiredByProduct = new Map<number, number>();
			for (const item of createChangeDto.replacementItems) {
				requiredByProduct.set(
					item.productId,
					(requiredByProduct.get(item.productId) ?? 0) + item.quantity,
				);
			}

			const productIds = Array.from(requiredByProduct.keys());

			const replacementProducts = await this.prismaService.product.findMany({
				where: { id: { in: productIds } },
			});

			if (replacementProducts.length !== productIds.length) {
				throw new BadRequestException('Uno o más productos de reemplazo no existen');
			}

			const replacementProductMap = new Map(
				replacementProducts.map((product) => [product.id, product]),
			);

			for (const [productId, quantity] of requiredByProduct.entries()) {
				const product = replacementProductMap.get(productId)!;
				if (Number(product.stock) < quantity) {
					throw new BadRequestException(
						`Stock insuficiente para ${product.name}. Disponible: ${Number(product.stock)}`,
					);
				}
			}

			let usdRate: { id: number; rate: number } | undefined;
			let eurRate: { id: number; rate: number } | undefined;

			const hasManualRateIds =
				createChangeDto.exchangeRateUsdId !== undefined ||
				createChangeDto.exchangeRateEurId !== undefined;

			if (hasManualRateIds) {
				if (!createChangeDto.exchangeRateUsdId || !createChangeDto.exchangeRateEurId) {
					throw new BadRequestException(
						'Si envías tasas manuales, debes enviar exchangeRateUsdId y exchangeRateEurId',
					);
				}

				const rates = await this.prismaService.exchangeRate.findMany({
					where: {
						id: {
							in: [
								createChangeDto.exchangeRateUsdId,
								createChangeDto.exchangeRateEurId,
							],
						},
					},
				});

				const usdRateRecord = rates.find(
					(rate) =>
						rate.id === createChangeDto.exchangeRateUsdId &&
						rate.currency === 'USD',
				);
				const eurRateRecord = rates.find(
					(rate) =>
						rate.id === createChangeDto.exchangeRateEurId &&
						rate.currency === 'EUR',
				);

				if (!usdRateRecord || !eurRateRecord) {
					throw new BadRequestException('Una o ambas tasas enviadas no son válidas');
				}

				usdRate = { id: usdRateRecord.id, rate: Number(usdRateRecord.rate) };
				eurRate = { id: eurRateRecord.id, rate: Number(eurRateRecord.rate) };
			} else {
				const latestRatesByCurrency = await this.getLatestExchangeRatesByCurrency();
				usdRate = latestRatesByCurrency.get('USD');
				eurRate = latestRatesByCurrency.get('EUR');
			}

			if (!usdRate || usdRate.rate <= 0) {
				throw new BadRequestException('No existe una tasa USD válida');
			}

			if (!eurRate || eurRate.rate <= 0) {
				throw new BadRequestException('No existe una tasa EUR válida');
			}

			const invoiceNumber = await this.generateInvoiceNumber();

			const result = await this.prismaService.$transaction(async (tx) => {
				const createdReturn = await tx.return.create({
					data: {
						invoiceId: invoice.id,
						type: 'CHANGE',
						reason: createChangeDto.reason,
						userId,
					},
				});

				await tx.returnItem.createMany({
					data: validatedItems.map((item) => ({
						returnId: createdReturn.id,
						productId: item.productId,
						quantity: new Prisma.Decimal(item.quantity),
						condition: item.condition,
					})),
				});

				const goodItems = validatedItems.filter(
					(item) => item.condition === 'GOOD',
				);

				if (goodItems.length > 0) {
					await Promise.all(
						goodItems.map((item) =>
							tx.product.update({
								where: { id: item.productId },
								data: {
									stock: {
										increment: item.quantity,
									},
								},
							}),
						),
					);

					await tx.inventoryMovement.createMany({
						data: goodItems.map((item) => ({
							productId: item.productId,
							quantity: item.quantity,
							type: 'RETURN',
							userId,
							reason: `Cambio en recibo ${invoice.invoiceNumber} - ${item.productName}`,
						})),
					});
				}

				const newInvoice = await tx.invoice.create({
					data: {
						invoiceNumber,
						totalAmountBs: new Prisma.Decimal(0),
						totalAmountUsd: new Prisma.Decimal(0),
						totalReceivedBs: new Prisma.Decimal(0),
						totalReceivedUsd: new Prisma.Decimal(0),
						totalChangeBs: new Prisma.Decimal(0),
						totalChangeUsd: new Prisma.Decimal(0),
						hasDiscount: false,
						discountBs: new Prisma.Decimal(0),
						discountUsd: new Prisma.Decimal(0),
						exchangeRateUsdId: usdRate.id,
						exchangeRateEurId: eurRate.id,
						status: 'CHANGE',
						userId,
						customerId: invoice.customerId,
						sessionId: createChangeDto.sessionId,
						createdAt: this.getVenezuelaNow(),
					},
				});

				const replacementItemsData = Array.from(
					requiredByProduct.entries(),
				).map(([productId, quantity]) => {
					const product = replacementProductMap.get(productId)!;
					return {
						productId,
						productName: product.name,
						quantity,
						unitPrice: Number(product.price),
					};
				});

				await tx.invoiceItem.createMany({
					data: replacementItemsData.map((item) => ({
						invoiceId: newInvoice.id,
						productId: item.productId,
						unitPrice: new Prisma.Decimal(item.unitPrice),
						hasDiscount: false,
						quantity: new Prisma.Decimal(item.quantity),
						subtotal: new Prisma.Decimal(0),
					})),
				});

				await Promise.all(
					replacementItemsData.map((item) =>
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
					data: replacementItemsData.map((item) => ({
						productId: item.productId,
						quantity: -item.quantity,
						type: 'SALE',
						userId,
						reason: `Cambio recibo ${invoice.invoiceNumber} - salida recibo ${newInvoice.invoiceNumber} - ${item.productName}`,
					})),
				});

				const updatedOriginalInvoice = await tx.invoice.update({
					where: { id: invoice.id },
					data: { status: 'CHANGE' },
					include: this.invoiceInclude,
				});

				const fullNewInvoice = await tx.invoice.findUnique({
					where: { id: newInvoice.id },
					include: this.invoiceInclude,
				});

				return {
					createdReturn,
					newInvoice: fullNewInvoice,
					updatedOriginalInvoice,
				};
			});

			try {
				await this.sessionsService.refreshSessionTotals(invoice.sessionId);
				if (invoice.sessionId !== createChangeDto.sessionId) {
					await this.sessionsService.refreshSessionTotals(createChangeDto.sessionId);
				}
			} catch (error: Error | any) {
				console.log('error refreshing session totals:', error);
			}

			return {
				message: 'Cambio registrado correctamente',
				return: result.createdReturn,
				invoice: result.updatedOriginalInvoice,
				newInvoice: result.newInvoice,
			};
		} catch (error: Error | any) {
			console.log('error creating change:', error);
			throw new BadRequestException(
				`Error al registrar cambio: ${error.message || 'Error desconocido'}`,
			);
		}
	}

	async payInvoiceCredit(invoiceId: number, userId: number) {
		try {
			const invoice = await this.prismaService.invoice.findUnique({
				where: { id: invoiceId },
			});

			if (!invoice) {
				throw new NotFoundException(`Recibo con id ${invoiceId} no encontrado`);
			}

			await this.prismaService.invoice.update({
				where: { id: invoiceId },
				data: { status: 'PAID', userId },
			});

			return {
				message: 'Crédito pagado correctamente.',
				invoice
			};

		} catch (error: Error | any) {
			console.log('error updating invoice:', error);
			throw new BadRequestException(
				`Error al actualizar recibo: ${error.message || 'Error desconocido'}`,
			);
		}
	}
}
