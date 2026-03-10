import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { ExchangeRateType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { SessionsService } from 'src/sessions/sessions.service';
import { CreateInvoiceDto } from './sales.dto';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';

interface ResumenFilter {
	date: string;
	sessionId?: string;
}

@Injectable()
export class SalesService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly sessionsService: SessionsService,
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

	private async getLatestExchangeRatesByCurrency() {
		const rates = await this.prismaService.exchangeRate.findMany({
			orderBy: {
				createdAt: 'desc',
			},
		});

		const latestByCurrency = new Map<ExchangeRateType, number>();

		for (const rate of rates) {
			const currency = rate.currency as ExchangeRateType;

			if ((currency === 'USD' || currency === 'EUR') && !latestByCurrency.has(currency)) {
				latestByCurrency.set(currency, Number(rate.rate));
			}

			if (latestByCurrency.has('USD') && latestByCurrency.has('EUR')) {
				break;
			}
		}

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

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			if (nextNumber > maxInvoiceNumber) {
				throw new BadRequestException(
					'Se alcanzó el límite máximo de facturas (8 dígitos)',
				);
			}

			const generated = nextNumber.toString().padStart(8, '0');

			const exists = await this.prismaService.invoice.findUnique({
				where: { invoiceNumber: generated },
				select: { id: true },
			});

			if (!exists) {
				return generated;
			}

			nextNumber += 1;
		}

		throw new BadRequestException('No se pudo generar un número de factura único');
	}

	async getInvoices(search?: string, date?: string, sessionId?: string) {
		const where: any = {};

		if (search) {
			where.OR = [
				{ invoiceNumber: { contains: search, mode: 'insensitive' } },
			]
		}

		if (date) {
			const startDate = this.getStartOfDayUtc(date);
			const endDate = this.getEndOfDayUtc(date);

			where.createdAt = {
				gte: startDate,
				lte: endDate,
			};
		}

		if (sessionId !== undefined && sessionId !== '') {
			const parsedSessionId = Number(sessionId);

			if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
				throw new BadRequestException('sessionId inválido');
			}

			where.sessionId = parsedSessionId;
		}

		try {
			const invoices = await this.prismaService.invoice.findMany({
				where,
				orderBy: {
					createdAt: 'desc',
				},
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

			return {
				invoices,
			};
		} catch (error) {
			throw error;
		}
	}

	async getResumenSales(filter: ResumenFilter) {
		try {
			const { date, sessionId } = filter;
			if (!date) {
				throw new BadRequestException('La fecha es requerida');
			}

			const startDate = this.getStartOfDayUtc(date);
			const endDate = this.getEndOfDayUtc(date);

			if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
				throw new BadRequestException('Formato de fecha inválido. Use YYYY-MM-DD');
			}

			let parsedSessionId: number | undefined;
			if (sessionId !== undefined && sessionId !== '') {
				parsedSessionId = Number(sessionId);

				if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
					throw new BadRequestException('sessionId inválido');
				}
			}

			const invoiceWhere: any = {
				createdAt: {
					gte: startDate,
					lte: endDate,
				},
				...(parsedSessionId ? { sessionId: parsedSessionId } : {}),
			};

			const [invoiceCount, paymentDetails, paymentTypes] = await Promise.all([
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
								exchangeRateUsd: true,
								exchangeRateEur: true,
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
				const usdRate = Number(paymentDetail.invoice.exchangeRateUsd);
				const eurRate = Number(paymentDetail.invoice.exchangeRateEur);

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
			const invoices = await this.getInvoices('', filter.date, filter.sessionId);

			const workbook = new ExcelJS.Workbook();
			const resumenSheet = workbook.addWorksheet('Resumen de Pagos');
			const detalleSheet = workbook.addWorksheet('Detalle de Facturas');

			resumenSheet.addRow(['Fecha', this.formatDateWithTime(resumenData.date)]);
			resumenSheet.addRow(['Sesión', resumenData.sessionId ?? 'TODAS']);
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
				'Total (Bs)',
				'Total (USD)',
				'Recibido (Bs)',
				'Vuelto (Bs)',
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
					Number(invoice.totalChangeBs),
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
		} catch (error) {
			{
				throw error;
			}
		}
	}

	async getPaymentTypes() {
		try {
			const paymentTypes = await this.prismaService.typePayment.findMany({
				orderBy: {
					createdAt: 'desc',
				},
			});

			return {
				paymentTypes,
			};
		} catch (error) {
			throw error;
		}
	}

	async createInvoice(createInvoiceDto: CreateInvoiceDto, userId: number) {
		try {
			const customer = await this.prismaService.clients.findUnique({
				where: { id: createInvoiceDto.customerId },
			});

			if (!customer) {
				throw new NotFoundException(
					`Cliente con id ${createInvoiceDto.customerId} no encontrado`,
				);
			}

			const session = await this.prismaService.cashDrawerSession.findUnique({
				where: { id: createInvoiceDto.sessionId },
			});

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
			const paymentTypes = await this.prismaService.typePayment.findMany({
				where: {
					id: {
						in: paymentTypeIds,
					},
				},
			});

			if (paymentTypes.length !== paymentTypeIds.length) {
				throw new BadRequestException('Uno o más tipos de pago no existen');
			}

			const requiredByProduct = new Map<number, number>();
			for (const item of createInvoiceDto.items) {
				requiredByProduct.set(
					item.productId,
					(requiredByProduct.get(item.productId) ?? 0) + item.quantity,
				);
			}

			const productIds = Array.from(requiredByProduct.keys());
			const products = await this.prismaService.product.findMany({
				where: {
					id: {
						in: productIds,
					},
				},
			});

			if (products.length !== productIds.length) {
				throw new BadRequestException('Uno o más productos no existen');
			}

			const productsMap = new Map(products.map((product) => [product.id, product]));

			for (const [productId, quantity] of requiredByProduct.entries()) {
				const product = productsMap.get(productId);
				if (!product) {
					throw new BadRequestException(`Producto con id ${productId} no existe`);
				}

				if (product.stock < quantity) {
					throw new BadRequestException(
						`Stock insuficiente para ${product.name}. Disponible: ${product.stock}`,
					);
				}
			}

			const paymentTypeMap = new Map(
				paymentTypes.map((paymentType) => [paymentType.id, paymentType]),
			);

			const latestRatesByCurrency = await this.getLatestExchangeRatesByCurrency();

			const ratesToBs: Record<ExchangeRateType, number> = {
				BS: 1,
				USD: latestRatesByCurrency.get('USD') ?? 0,
				EUR: latestRatesByCurrency.get('EUR') ?? 0,
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

			const paymentTotalsByCurrency: Record<ExchangeRateType, number> = {
				BS: 0,
				USD: 0,
				EUR: 0,
			};

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

				if (net < 0) {
					throw new BadRequestException(
						'El monto neto de un pago no puede ser negativo',
					);
				}

				const paymentCurrency = paymentType.currency as ExchangeRateType;
				paymentTotalsByCurrency[paymentCurrency] += net;
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

			const totalNetBsRaw =
				paymentTotalsByCurrency.BS +
				paymentTotalsByCurrency.USD * getFactorByCurrency('USD') +
				paymentTotalsByCurrency.EUR * getFactorByCurrency('EUR');

			const totalNetBs = this.toTwoDecimals(totalNetBsRaw);
			const totalReceivedBs = this.toTwoDecimals(
				paymentsData.reduce((sum, payment) => sum + payment.amountReceived * getFactorByCurrency(payment.currency as ExchangeRateType), 0),
			);
			const totalChangeBs = this.toTwoDecimals(
				paymentsData.reduce((sum, payment) => sum + payment.amountChange * getFactorByCurrency(payment.currency as ExchangeRateType), 0),
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
						exchangeRateUsd: new Prisma.Decimal(ratesToBs.USD),
						exchangeRateEur: new Prisma.Decimal(ratesToBs.EUR),
						totalAmountUsd: new Prisma.Decimal(totalAmountUsd),
						totalReceivedBs: new Prisma.Decimal(totalReceivedBs),
						totalChangeBs: new Prisma.Decimal(totalChangeBs),
						userId,
						customerId: createInvoiceDto.customerId,
						sessionId: createInvoiceDto.sessionId,
					},
				});

				for (const item of invoiceItemsData) {
					await tx.invoiceItem.create({
						data: {
							invoiceId: createdInvoice.id,
							productId: item.productId,
							unitPrice: new Prisma.Decimal(item.unitPrice),
							quantity: item.quantity,
							subtotal: new Prisma.Decimal(item.subtotal),
						},
					});

					await tx.product.update({
						where: { id: item.productId },
						data: {
							stock: {
								decrement: item.quantity,
							},
						},
					});

					await tx.inventoryMovement.create({
						data: {
							productId: item.productId,
							quantity: -item.quantity,
							type: 'SALE',
							userId,
							reason: `Venta en factura ${invoiceNumber} - ${item.productName}`,
						},
					});
				}

				for (const payment of paymentsData) {
					await tx.paymentDetail.create({
						data: {
							invoiceId: createdInvoice.id,
							paymentTypeId: payment.paymentTypeId,
							amountReceived: new Prisma.Decimal(payment.amountReceived),
							amountChange: new Prisma.Decimal(payment.amountChange),
							amountNet: new Prisma.Decimal(payment.amountNet),
							amountNetBs: new Prisma.Decimal(payment.amountNetBs),
							currency: payment.currency as ExchangeRateType,
							...(payment.denominations !== undefined && {
								denominations: payment.denominations,
							}),
						},
					});
				}

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

			await this.sessionsService.refreshSessionTotals(createInvoiceDto.sessionId);

			return {
				message: 'Factura creada correctamente',
				invoice,
			};
		} catch (error) {
			throw error;
		}
	}
}
