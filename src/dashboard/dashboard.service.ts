import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

interface SummaryFilter {
	startDate: string;
	endDate: string;
}

@Injectable()
export class DashboardService {
	constructor(private readonly prismaService: PrismaService) { }

	private toTwoDecimals(value: number) {
		return Math.round(value * 100) / 100;
	}

	private getStartOfDayUtc(date: string) {
		return new Date(`${date}T00:00:00.000Z`);
	}

	private getEndOfDayUtc(date: string) {
		return new Date(`${date}T23:59:59.999Z`);
	}

	async getSummaryByDateRange(filter: SummaryFilter) {
		const { startDate, endDate } = filter;

		if (!startDate || !endDate) {
			throw new BadRequestException('startDate y endDate son requeridos');
		}

		const start = this.getStartOfDayUtc(startDate);
		const end = this.getEndOfDayUtc(endDate);

		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			throw new BadRequestException('Formato de fecha inválido. Use YYYY-MM-DD');
		}

		if (start > end) {
			throw new BadRequestException('startDate no puede ser mayor que endDate');
		}

		const invoiceWhere: any = {
			createdAt: {
				gte: start,
				lte: end,
			},
		};

		const [
			invoices,
			totalInvoices,
			customerFrequency,
			productSales,
			lowStockProducts,
		] = await Promise.all([
			this.prismaService.invoice.findMany({
				where: invoiceWhere,
				orderBy: {
					createdAt: 'desc',
				},
				include: {
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
							quantity: true,
							unitPrice: true,
							subtotal: true,
							product: {
								select: {
									id: true,
									name: true,
									barcode: true,
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
				},
			}),
			this.prismaService.invoice.count({ where: invoiceWhere }),
			this.prismaService.invoice.groupBy({
				by: ['customerId'],
				where: invoiceWhere,
				_count: {
					customerId: true,
				},
				orderBy: {
					_count: {
						customerId: 'desc',
					},
				},
				take: 10,
			}),
			this.prismaService.invoiceItem.groupBy({
				by: ['productId'],
				where: {
					invoice: invoiceWhere,
				},
				_sum: {
					quantity: true,
					subtotal: true,
				},
				_count: {
					productId: true,
				},
				orderBy: {
					_sum: {
						quantity: 'desc',
					},
				},
				take: 10,
			}),
			this.prismaService.product.findMany({
				where: {
					deleted: false,
					stock: {
						lte: 10,
					},
				},
				orderBy: {
					stock: 'asc',
				},
				select: {
					id: true,
					name: true,
					barcode: true,
					stock: true,
					presentation: true,
					price: true,
					currency: true,
				},
			}),
		]);

		const customerIds = customerFrequency.map((item) => item.customerId);
		const productIds = productSales.map((item) => item.productId);

		const [customers, products] = await Promise.all([
			this.prismaService.clients.findMany({
				where: {
					id: {
						in: customerIds.length > 0 ? customerIds : [-1],
					},
				},
				select: {
					id: true,
					fullName: true,
					identify: true,
				},
			}),
			this.prismaService.product.findMany({
				where: {
					id: {
						in: productIds.length > 0 ? productIds : [-1],
					},
				},
				select: {
					id: true,
					name: true,
					barcode: true,
					presentation: true,
					price: true,
					currency: true,
				},
			}),
		]);

		const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
		const productMap = new Map(products.map((product) => [product.id, product]));

		const ingresos = invoices.reduce(
			(acc, invoice) => {
				const amountBs = Number(invoice.totalReceivedBs);
				const changeBs = Number(invoice.totalChangeBs);
				const usdRate = Number(invoice.exchangeRateUsd);

				acc.amountBs += amountBs;
				acc.changeAmountBs += changeBs;

				if (usdRate > 0) {
					acc.amountUsd += amountBs / usdRate;
					acc.changeAmountUsd += changeBs / usdRate;
				}

				return acc;
			},
			{
				amountBs: 0,
				changeAmountBs: 0,
				amountUsd: 0,
				changeAmountUsd: 0,
			},
		);

		const totalSales = invoices.reduce(
			(acc, invoice) => {
				const amountBs = Number(invoice.totalAmountBs);
				const amountUsd = Number(invoice.totalAmountUsd);

				acc.amountBs += amountBs;
				acc.amountUsd += amountUsd;

				return acc;
			},
			{
				amountBs: 0,
				amountUsd: 0,
			},
		);

		const frequentCustomers = customerFrequency.map((item) => ({
			customerId: item.customerId,
			fullName: customerMap.get(item.customerId)?.fullName || 'N/A',
			identify: customerMap.get(item.customerId)?.identify || '',
			totalInvoices: item._count.customerId,
		}));

		const topProducts = productSales.map((item) => ({
			productId: item.productId,
			name: productMap.get(item.productId)?.name || 'N/A',
			barcode: productMap.get(item.productId)?.barcode || '',
			presentation: productMap.get(item.productId)?.presentation || '',
			totalQuantitySold: item._sum.quantity ?? 0,
			totalAmountBs: this.toTwoDecimals(Number(item._sum.subtotal ?? 0)),
			totalInvoices: item._count.productId,
		}));

		return {
			range: {
				startDate,
				endDate,
			},
			ingresos: {
				amountBs: this.toTwoDecimals(ingresos.amountBs),
				changeAmountBs: this.toTwoDecimals(ingresos.changeAmountBs),
				totalNetBs: this.toTwoDecimals(ingresos.amountBs - ingresos.changeAmountBs),
				amountUsd: this.toTwoDecimals(ingresos.amountUsd),
				changeAmountUsd: this.toTwoDecimals(ingresos.changeAmountUsd),
				totalNetUsd: this.toTwoDecimals(ingresos.amountUsd - ingresos.changeAmountUsd),
			},
			totalSales: {
				amountBs: this.toTwoDecimals(totalSales.amountBs),
				amountUsd: this.toTwoDecimals(totalSales.amountUsd),
			},
			totalInvoices,
			invoices,
			frequentCustomers,
			topProducts,
			lowStockProducts,
		};
	}
}
