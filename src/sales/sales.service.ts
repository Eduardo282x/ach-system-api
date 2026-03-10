import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { ExchangeRateType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { SessionsService } from 'src/sessions/sessions.service';
import { CreateInvoiceDto } from './sales.dto';

@Injectable()
export class SalesService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly sessionsService: SessionsService,
	) { }

	private toTwoDecimals(value: number) {
		return Math.round(value * 100) / 100;
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

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const generated = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)
				.toString()
				.padStart(3, '0')}`;

			const exists = await this.prismaService.invoice.findUnique({
				where: { invoiceNumber: generated },
				select: { id: true },
			});

			if (!exists) {
				return generated;
			}
		}

		throw new BadRequestException('No se pudo generar un número de factura único');
	}

	async getInvoices(search?: string) {
		const where: any = {};

		if (search) {
			where.OR = [
				{ invoiceNumber: { contains: search, mode: 'insensitive' } },
			]
		}

		try {
			const invoices = await this.prismaService.invoice.findMany({
				where,
				orderBy: {
					createdAt: 'desc',
				},
				include: {
					customer: true,
					user: true,
					session: true,
					items: {
						include: {
							product: true,
						},
					},
					paymentDetails: {
						include: {
							paymentType: true,
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

			if(session.closedAt !== null) {
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
						customer: true,
						user: true,
						session: true,
						items: {
							include: {
								product: true,
							},
						},
						paymentDetails: {
							include: {
								paymentType: true,
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
