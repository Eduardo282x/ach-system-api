import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { ExchangeRateType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInvoiceDto } from './sales.dto';

@Injectable()
export class SalesService {
	constructor(private readonly prismaService: PrismaService) {}

	private toTwoDecimals(value: number) {
		return Math.round(value * 100) / 100;
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

        if(search) {
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

			const aggregatedItemsMap = new Map<number, number>();
			for (const item of createInvoiceDto.items) {
				aggregatedItemsMap.set(
					item.productId,
					(aggregatedItemsMap.get(item.productId) ?? 0) + item.quantity,
				);
			}

			const productIds = Array.from(aggregatedItemsMap.keys());
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

			for (const [productId, quantity] of aggregatedItemsMap.entries()) {
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

			const latestUsdRate = await this.prismaService.exchangeRate.findFirst({
				where: {
					currency: 'USD',
					isDefault: true,
				},
				orderBy: {
					createdAt: 'desc',
				},
			});

			const latestEurRate = await this.prismaService.exchangeRate.findFirst({
				where: {
					currency: 'EUR',
					isDefault: true,
				},
				orderBy: {
					createdAt: 'desc',
				},
			});

			const exchangeRateUsd = this.toTwoDecimals(
				createInvoiceDto.exchangeRateUsd ?? Number(latestUsdRate?.rate ?? 0),
			);
			const exchangeRateEur = this.toTwoDecimals(
				createInvoiceDto.exchangeRateEur ?? Number(latestEurRate?.rate ?? 0),
			);

			if (exchangeRateUsd <= 0 || exchangeRateEur <= 0) {
				throw new BadRequestException(
					'Debes enviar las tasas USD/EUR o tener tasas por defecto registradas',
				);
			}

			const ratesToBs: Record<ExchangeRateType, number> = {
				BS: 1,
				USD: exchangeRateUsd,
				EUR: exchangeRateEur,
			};

			let totalAmountBs = 0;
			const invoiceItemsData = Array.from(aggregatedItemsMap.entries()).map(
				([productId, quantity]) => {
					const product = productsMap.get(productId)!;
					const unitPrice = Number(product.price);
					const factor = ratesToBs[product.currency as ExchangeRateType] ?? 1;
					const subtotal = this.toTwoDecimals(unitPrice * quantity * factor);

					totalAmountBs += subtotal;

					return {
						productId,
						quantity,
						unitPrice,
						subtotal,
						productName: product.name,
					};
				},
			);

			totalAmountBs = this.toTwoDecimals(totalAmountBs);
			const totalAmountUsd = this.toTwoDecimals(totalAmountBs / exchangeRateUsd);

			let totalReceivedBs = 0;
			let totalChangeBs = 0;
			const paymentsData = createInvoiceDto.payments.map((payment) => {
				const received = this.toTwoDecimals(payment.amountReceived);
				const change = this.toTwoDecimals(payment.amountChange ?? 0);
				const net = this.toTwoDecimals(received - change);

				if (net < 0) {
					throw new BadRequestException(
						'El monto neto de un pago no puede ser negativo',
					);
				}

				const factor = ratesToBs[payment.currency];
				const receivedBs = this.toTwoDecimals(received * factor);
				const changeBs = this.toTwoDecimals(change * factor);
				const netBs = this.toTwoDecimals(net * factor);

				totalReceivedBs += receivedBs;
				totalChangeBs += changeBs;

				return {
					paymentTypeId: payment.paymentTypeId,
					currency: payment.currency,
					amountReceived: received,
					amountChange: change,
					amountNet: net,
					amountNetBs: netBs,
					denominations: payment.denominations,
				};
			});

			totalReceivedBs = this.toTwoDecimals(totalReceivedBs);
			totalChangeBs = this.toTwoDecimals(totalChangeBs);
			const totalNetBs = this.toTwoDecimals(totalReceivedBs - totalChangeBs);

			if (totalNetBs < totalAmountBs) {
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
						exchangeRateUsd: new Prisma.Decimal(exchangeRateUsd),
						exchangeRateEur: new Prisma.Decimal(exchangeRateEur),
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
							currency: payment.currency,
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

			return {
				message: 'Factura creada correctamente',
				invoice,
			};
		} catch (error) {
			throw error;
		}
	}
}
