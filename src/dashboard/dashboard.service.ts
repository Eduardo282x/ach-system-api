import { BadRequestException, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExchangeRateType } from 'src/generated/prisma/enums';
import { APP_TIMEZONE, endOfDay, localDateString, startOfDay } from 'src/common/utils/time.util';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

interface SummaryFilter {
	startDate: string;
	endDate: string;
}

type TrendGroupBy = 'month' | 'week' | 'day' | 'weekday';

const TREND_GROUP_BY: TrendGroupBy[] = ['month', 'week', 'day', 'weekday'];

const WEEKDAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

interface TrendFilter {
	startDate?: string;
	endDate?: string;
	groupBy?: string;
}

interface TrendAccumulator {
	key: string;
	label: string;
	startDate: string | null;
	endDate: string | null;
	totalInvoices: number;
	totalItems: number;
	totalSalesBs: number;
	totalSalesUsd: number;
	totalCostBs: number;
	totalCostUsd: number;
	receivedBs: number;
	receivedUsd: number;
	changeBs: number;
	changeUsd: number;
}

@Injectable()
export class DashboardService {
	constructor(private readonly prismaService: PrismaService) { }

	private toTwoDecimals(value: number) {
		return Math.round(value * 100) / 100;
	}

	private toThreeDecimals(value: number) {
		return Math.round(value * 1000) / 1000;
	}

	private getStartOfDayUtc(date: string) {
		return startOfDay(date);
	}

	private getEndOfDayUtc(date: string) {
		return endOfDay(date);
	}

	private capitalize(value: string) {
		return value.charAt(0).toUpperCase() + value.slice(1);
	}

	private formatMonthLabel(date: Date) {
		const label = new Intl.DateTimeFormat('es-VE', {
			month: 'long',
			year: 'numeric',
			timeZone: APP_TIMEZONE,
		}).format(date);

		return this.capitalize(label);
	}

	private formatDayLabel(date: Date) {
		const label = new Intl.DateTimeFormat('es-VE', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			timeZone: APP_TIMEZONE,
		})
			.format(date)
			.replace(/\./g, '');

		return this.capitalize(label);
	}

	private formatWeekLabel(start: Date, end: Date) {
		const day = (value: Date) =>
			new Intl.DateTimeFormat('es-VE', {
				day: '2-digit',
				timeZone: APP_TIMEZONE,
			}).format(value);

		const month = (value: Date) =>
			new Intl.DateTimeFormat('es-VE', {
				month: 'short',
				timeZone: APP_TIMEZONE,
			})
				.format(value)
				.replace(/\./g, '');

		const startMonth = month(start);
		const endMonth = month(end);
		const sameMonth =
			new Intl.DateTimeFormat('es-VE', { month: 'numeric', year: 'numeric', timeZone: APP_TIMEZONE }).format(start) ===
			new Intl.DateTimeFormat('es-VE', { month: 'numeric', year: 'numeric', timeZone: APP_TIMEZONE }).format(end);

		if (sameMonth) {
			return `Semana ${day(start)}–${day(end)} ${startMonth}`;
		}

		return `Semana ${day(start)} ${startMonth} – ${day(end)} ${endMonth}`;
	}

	private getTrendKey(date: dayjs.Dayjs, groupBy: TrendGroupBy) {
		switch (groupBy) {
			case 'month':
				return date.format('YYYY-MM');
			case 'week':
				return date.startOf('isoWeek').format('YYYY-MM-DD');
			case 'day':
				return date.format('YYYY-MM-DD');
			case 'weekday':
				return String(date.isoWeekday());
			default:
				return date.format('YYYY-MM-DD');
		}
	}

	private createAccumulator(
		key: string,
		label: string,
		startDate: string | null,
		endDate: string | null,
	): TrendAccumulator {
		return {
			key,
			label,
			startDate,
			endDate,
			totalInvoices: 0,
			totalItems: 0,
			totalSalesBs: 0,
			totalSalesUsd: 0,
			totalCostBs: 0,
			totalCostUsd: 0,
			receivedBs: 0,
			receivedUsd: 0,
			changeBs: 0,
			changeUsd: 0,
		};
	}

	private buildTrendPeriods(
		groupBy: TrendGroupBy,
		rangeStart: dayjs.Dayjs,
		rangeEnd: dayjs.Dayjs,
	): TrendAccumulator[] {
		if (groupBy === 'weekday') {
			return WEEKDAY_LABELS.map((label, index) =>
				this.createAccumulator(String(index + 1), label, null, null),
			);
		}

		const periods: TrendAccumulator[] = [];

		let cursor = rangeStart.startOf('day');
		if (groupBy === 'month') cursor = rangeStart.startOf('month');
		if (groupBy === 'week') cursor = rangeStart.startOf('isoWeek');

		let last = rangeEnd.startOf('day');
		if (groupBy === 'month') last = rangeEnd.startOf('month');
		if (groupBy === 'week') last = rangeEnd.startOf('isoWeek');

		while (!cursor.isAfter(last)) {
			let periodStart: dayjs.Dayjs;
			let periodEnd: dayjs.Dayjs;
			let key: string;
			let label: string;

			if (groupBy === 'month') {
				periodStart = cursor.startOf('month');
				periodEnd = cursor.endOf('month');
				key = cursor.format('YYYY-MM');
				label = '';
			} else if (groupBy === 'week') {
				periodStart = cursor.startOf('isoWeek');
				periodEnd = cursor.endOf('isoWeek');
				key = periodStart.format('YYYY-MM-DD');
				label = '';
			} else {
				periodStart = cursor.startOf('day');
				periodEnd = cursor.endOf('day');
				key = cursor.format('YYYY-MM-DD');
				label = '';
			}

			const clippedStart = periodStart.isBefore(rangeStart) ? rangeStart : periodStart;
			const clippedEnd = periodEnd.isAfter(rangeEnd) ? rangeEnd : periodEnd;

			if (groupBy === 'month') {
				label = this.formatMonthLabel(clippedStart.toDate());
			} else if (groupBy === 'week') {
				label = this.formatWeekLabel(clippedStart.toDate(), clippedEnd.toDate());
			} else {
				label = this.formatDayLabel(clippedStart.toDate());
			}

			periods.push(
				this.createAccumulator(
					key,
					label,
					clippedStart.format('YYYY-MM-DD'),
					clippedEnd.format('YYYY-MM-DD'),
				),
			);

			cursor =
				groupBy === 'month'
					? cursor.add(1, 'month')
					: groupBy === 'week'
						? cursor.add(1, 'week')
						: cursor.add(1, 'day');
		}

		return periods;
	}

	async getSalesTrend(filter: TrendFilter) {
		const groupBy = (filter.groupBy || 'month') as TrendGroupBy;

		if (!TREND_GROUP_BY.includes(groupBy)) {
			throw new BadRequestException(
				`groupBy inválido. Valores permitidos: ${TREND_GROUP_BY.join(', ')}`,
			);
		}

		const bounds = await this.prismaService.invoice.aggregate({
			where: { status: { not: 'CANCELLED' } },
			_min: { createdAt: true },
			_max: { createdAt: true },
		});

		const firstInvoice = bounds._min.createdAt;
		const lastInvoice = bounds._max.createdAt;

		let start: Date;
		let end: Date;

		if (!filter.startDate && !filter.endDate) {
			if (!firstInvoice || !lastInvoice) {
				return {
					range: { startDate: '', endDate: '' },
					groupBy,
					bounds: { firstInvoice: null, lastInvoice: null },
					periods: [],
					totals: {
						totalInvoices: 0,
						totalItems: 0,
						totalSalesBs: 0,
						totalSalesUsd: 0,
						totalCostBs: 0,
						totalCostUsd: 0,
						profitBs: 0,
						profitUsd: 0,
						netCashBs: 0,
						netCashUsd: 0,
					},
				};
			}

			start = this.getStartOfDayUtc(localDateString(firstInvoice));
			end = this.getEndOfDayUtc(localDateString(lastInvoice));
		} else {
			if (!filter.startDate || !filter.endDate) {
				throw new BadRequestException('startDate y endDate son requeridos juntos');
			}

			start = this.getStartOfDayUtc(filter.startDate);
			end = this.getEndOfDayUtc(filter.endDate);
		}

		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			throw new BadRequestException('Formato de fecha inválido. Use YYYY-MM-DD');
		}

		if (start > end) {
			throw new BadRequestException('startDate no puede ser mayor que endDate');
		}

		const invoices = await this.prismaService.invoice.findMany({
			where: {
				createdAt: { gte: start, lte: end },
				status: { not: 'CANCELLED' },
			},
			select: {
				createdAt: true,
				totalAmountBs: true,
				totalAmountUsd: true,
				totalReceivedBs: true,
				totalReceivedUsd: true,
				totalChangeBs: true,
				totalChangeUsd: true,
				exchangeRateUsd: {
					select: {
						rate: true,
					},
				},
				items: {
					select: {
						quantity: true,
						subtotal: true,
						costSubtotal: true,
					},
				},
			},
		});

		const rangeStart = dayjs(start).tz(APP_TIMEZONE);
		const rangeEnd = dayjs(end).tz(APP_TIMEZONE);
		const periods = this.buildTrendPeriods(groupBy, rangeStart, rangeEnd);
		const periodMap = new Map(periods.map((period) => [period.key, period]));

		for (const invoice of invoices) {
			const key = this.getTrendKey(dayjs(invoice.createdAt).tz(APP_TIMEZONE), groupBy);
			const period = periodMap.get(key);

			if (!period) {
				continue;
			}

			const usdRate = Number(invoice.exchangeRateUsd?.rate ?? 0);
			const invoiceCostBs = invoice.items.reduce(
				(acc, item) => acc + Number(item.costSubtotal),
				0,
			);

			period.totalInvoices += 1;
			period.totalItems += invoice.items.reduce(
				(acc, item) => acc + Number(item.quantity),
				0,
			);
			period.totalSalesBs += Number(invoice.totalAmountBs);
			period.totalSalesUsd += Number(invoice.totalAmountUsd);
			period.totalCostBs += invoiceCostBs;
			period.totalCostUsd += usdRate > 0 ? invoiceCostBs / usdRate : 0;
			period.receivedBs += Number(invoice.totalReceivedBs);
			period.receivedUsd += Number(invoice.totalReceivedUsd);
			period.changeBs += Number(invoice.totalChangeBs);
			period.changeUsd += Number(invoice.totalChangeUsd);
		}

		const mappedPeriods = periods.map((period) => ({
			key: period.key,
			label: period.label,
			startDate: period.startDate,
			endDate: period.endDate,
			totalInvoices: period.totalInvoices,
			totalItems: this.toThreeDecimals(period.totalItems),
			totalSalesBs: this.toTwoDecimals(period.totalSalesBs),
			totalSalesUsd: this.toTwoDecimals(period.totalSalesUsd),
			totalCostBs: this.toTwoDecimals(period.totalCostBs),
			totalCostUsd: this.toTwoDecimals(period.totalCostUsd),
			profitBs: this.toTwoDecimals(period.totalSalesBs - period.totalCostBs),
			profitUsd: this.toTwoDecimals(period.totalSalesUsd - period.totalCostUsd),
			netCashBs: this.toTwoDecimals(period.receivedBs - period.changeBs),
			netCashUsd: this.toTwoDecimals(period.receivedUsd - period.changeUsd),
		}));

		const totals = mappedPeriods.reduce(
			(acc, period) => ({
				totalInvoices: acc.totalInvoices + period.totalInvoices,
				totalItems: acc.totalItems + period.totalItems,
				totalSalesBs: acc.totalSalesBs + period.totalSalesBs,
				totalSalesUsd: acc.totalSalesUsd + period.totalSalesUsd,
				totalCostBs: acc.totalCostBs + period.totalCostBs,
				totalCostUsd: acc.totalCostUsd + period.totalCostUsd,
				profitBs: acc.profitBs + period.profitBs,
				profitUsd: acc.profitUsd + period.profitUsd,
				netCashBs: acc.netCashBs + period.netCashBs,
				netCashUsd: acc.netCashUsd + period.netCashUsd,
			}),
			{
				totalInvoices: 0,
				totalItems: 0,
				totalSalesBs: 0,
				totalSalesUsd: 0,
				totalCostBs: 0,
				totalCostUsd: 0,
				profitBs: 0,
				profitUsd: 0,
				netCashBs: 0,
				netCashUsd: 0,
			},
		);

		return {
			range: {
				startDate: rangeStart.format('YYYY-MM-DD'),
				endDate: rangeEnd.format('YYYY-MM-DD'),
			},
			groupBy,
			bounds: {
				firstInvoice: firstInvoice ? localDateString(firstInvoice) : null,
				lastInvoice: lastInvoice ? localDateString(lastInvoice) : null,
			},
			periods: mappedPeriods,
			totals: {
				totalInvoices: totals.totalInvoices,
				totalItems: this.toThreeDecimals(totals.totalItems),
				totalSalesBs: this.toTwoDecimals(totals.totalSalesBs),
				totalSalesUsd: this.toTwoDecimals(totals.totalSalesUsd),
				totalCostBs: this.toTwoDecimals(totals.totalCostBs),
				totalCostUsd: this.toTwoDecimals(totals.totalCostUsd),
				profitBs: this.toTwoDecimals(totals.profitBs),
				profitUsd: this.toTwoDecimals(totals.profitUsd),
				netCashBs: this.toTwoDecimals(totals.netCashBs),
				netCashUsd: this.toTwoDecimals(totals.netCashUsd),
			},
		};
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
			status: { not: 'CANCELLED' },
		};

		const [
			invoices,
			totalInvoices,
			customerFrequency,
			productSales,
			lowStockProducts,
			paymentTypes,
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
					exchangeRateUsd: {
						select: {
							id: true,
							rate: true,
						},
					},
					exchangeRateEur: {
						select: {
							id: true,
							rate: true,
						},
					},
					items: {
						select: {
							id: true,
							quantity: true,
							unitPrice: true,
							unitCost: true,
							subtotal: true,
							costSubtotal: true,
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
					costSubtotal: true,
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

		// Facturado, costo y ganancia. Incluye facturas PAID y PENDING (crédito).
		let totalCostBs = 0;
		let totalCostUsd = 0;
		let itemsWithoutCost = 0;

		const totalSales = invoices.reduce(
			(acc, invoice) => {
				const amountBs = Number(invoice.totalAmountBs);
				const amountUsd = Number(invoice.totalAmountUsd);
				const usdRate = Number(invoice.exchangeRateUsd?.rate ?? 0);

				acc.amountBs += amountBs;
				acc.amountUsd += amountUsd;

				for (const item of invoice.items) {
					const itemCostBs = Number(item.costSubtotal);

					totalCostBs += itemCostBs;
					totalCostUsd += usdRate > 0 ? itemCostBs / usdRate : 0;

					if (Number(item.unitCost) <= 0) {
						itemsWithoutCost += 1;
					}
				}

				return acc;
			},
			{
				amountBs: 0,
				amountUsd: 0,
			},
		);

		const profitBs = totalSales.amountBs - totalCostBs;
		const profitUsd = totalSales.amountUsd - totalCostUsd;
		const marginPercent =
			totalSales.amountBs > 0 ? (profitBs / totalSales.amountBs) * 100 : 0;

		const paidInvoices = invoices.filter((invoice) => invoice.status === 'PAID').length;
		const pendingInvoices = invoices.filter((invoice) => invoice.status === 'PENDING').length;

		const receivable = invoices
			.filter((invoice) => invoice.status === 'PENDING')
			.reduce(
				(acc, invoice) => {
					acc.amountBs += Number(invoice.totalAmountBs);
					acc.amountUsd += Number(invoice.totalAmountUsd);
					return acc;
				},
				{
					amountBs: 0,
					amountUsd: 0,
				},
			);

		// Cobros reales agrupados por método de pago. Los equivalentes usan la
		// tasa USD/EUR de cada factura, igual que el cierre de caja.
		type PaymentAccumulator = {
			paymentTypeId: number;
			payment: string;
			currency: ExchangeRateType;
			received: number;
			change: number;
			net: number;
			receivedBs: number;
			changeBs: number;
			netBs: number;
			receivedUsd: number;
			changeUsd: number;
			netUsd: number;
		};

		const paymentMap = new Map<number, PaymentAccumulator>();

		for (const paymentType of paymentTypes) {
			paymentMap.set(paymentType.id, {
				paymentTypeId: paymentType.id,
				payment: paymentType.name,
				currency: paymentType.currency as ExchangeRateType,
				received: 0,
				change: 0,
				net: 0,
				receivedBs: 0,
				changeBs: 0,
				netBs: 0,
				receivedUsd: 0,
				changeUsd: 0,
				netUsd: 0,
			});
		}

		for (const invoice of invoices) {
			const usdRate = Number(invoice.exchangeRateUsd?.rate ?? 0);
			const eurRate = Number(invoice.exchangeRateEur?.rate ?? 0);

			for (const payment of invoice.paymentDetails) {
				const isCreditPayment = payment.paymentType.name
					.toLowerCase()
					.includes('credito');

				// En una factura a crédito pendiente, el "pago" de tipo crédito
				// representa el saldo por cobrar, no dinero cobrado.
				if (invoice.status === 'PENDING' && isCreditPayment) {
					continue;
				}

				const currency = payment.currency as ExchangeRateType;
				const rateToBs =
					currency === 'BS' ? 1 : currency === 'USD' ? usdRate : eurRate;
				const received = Number(payment.amountReceived);
				const change = Number(payment.amountChange);
				const net = received - change;
				const receivedBs = received * rateToBs;
				const changeBs = change * rateToBs;
				const netBs = net * rateToBs;
				const receivedUsd = usdRate > 0 ? receivedBs / usdRate : 0;
				const changeUsd = usdRate > 0 ? changeBs / usdRate : 0;
				const netUsd = usdRate > 0 ? netBs / usdRate : 0;

				const current = paymentMap.get(payment.paymentTypeId) ?? {
					paymentTypeId: payment.paymentTypeId,
					payment: payment.paymentType.name,
					currency,
					received: 0,
					change: 0,
					net: 0,
					receivedBs: 0,
					changeBs: 0,
					netBs: 0,
					receivedUsd: 0,
					changeUsd: 0,
					netUsd: 0,
				};

				current.received += received;
				current.change += change;
				current.net += net;
				current.receivedBs += receivedBs;
				current.changeBs += changeBs;
				current.netBs += netBs;
				current.receivedUsd += receivedUsd;
				current.changeUsd += changeUsd;
				current.netUsd += netUsd;

				paymentMap.set(payment.paymentTypeId, current);
			}
		}

		const paymentBreakdown = Array.from(paymentMap.values())
			.map((item) => ({
				...item,
				received: this.toTwoDecimals(item.received),
				change: this.toTwoDecimals(item.change),
				net: this.toTwoDecimals(item.net),
				receivedBs: this.toTwoDecimals(item.receivedBs),
				changeBs: this.toTwoDecimals(item.changeBs),
				netBs: this.toTwoDecimals(item.netBs),
				receivedUsd: this.toTwoDecimals(item.receivedUsd),
				changeUsd: this.toTwoDecimals(item.changeUsd),
				netUsd: this.toTwoDecimals(item.netUsd),
			}))
			.sort((a, b) => b.netBs - a.netBs);

		type CollectedCurrency = {
			received: number;
			change: number;
			net: number;
		};

		const collected = paymentBreakdown.reduce(
			(acc, item) => {
				if (item.currency === 'BS') {
					acc.original.bs.received += item.received;
					acc.original.bs.change += item.change;
					acc.original.bs.net += item.net;
					acc.conversions.bsToUsd += item.netUsd;
				} else if (item.currency === 'USD') {
					acc.original.usd.received += item.received;
					acc.original.usd.change += item.change;
					acc.original.usd.net += item.net;
					acc.conversions.usdToBs += item.netBs;
				} else {
					acc.original.eur.received += item.received;
					acc.original.eur.change += item.change;
					acc.original.eur.net += item.net;
				}

				acc.equivalents.totalBs.received += item.receivedBs;
				acc.equivalents.totalBs.change += item.changeBs;
				acc.equivalents.totalBs.net += item.netBs;
				acc.equivalents.totalUsd.received += item.receivedUsd;
				acc.equivalents.totalUsd.change += item.changeUsd;
				acc.equivalents.totalUsd.net += item.netUsd;

				return acc;
			},
			{
				original: {
					bs: { received: 0, change: 0, net: 0 },
					usd: { received: 0, change: 0, net: 0 },
					eur: { received: 0, change: 0, net: 0 },
				} as Record<'bs' | 'usd' | 'eur', CollectedCurrency>,
				equivalents: {
					totalBs: { received: 0, change: 0, net: 0 },
					totalUsd: { received: 0, change: 0, net: 0 },
				} as Record<'totalBs' | 'totalUsd', CollectedCurrency>,
				conversions: {
					bsToUsd: 0,
					usdToBs: 0,
				},
				grandTotal: {
					bs: 0,
					usd: 0,
				},
			},
		);

		collected.grandTotal.bs = collected.equivalents.totalBs.net;
		collected.grandTotal.usd = collected.equivalents.totalUsd.net;

		const collectedResponse = {
			original: {
				bs: {
					received: this.toTwoDecimals(collected.original.bs.received),
					change: this.toTwoDecimals(collected.original.bs.change),
					net: this.toTwoDecimals(collected.original.bs.net),
				},
				usd: {
					received: this.toTwoDecimals(collected.original.usd.received),
					change: this.toTwoDecimals(collected.original.usd.change),
					net: this.toTwoDecimals(collected.original.usd.net),
				},
				eur: {
					received: this.toTwoDecimals(collected.original.eur.received),
					change: this.toTwoDecimals(collected.original.eur.change),
					net: this.toTwoDecimals(collected.original.eur.net),
				},
			},
			equivalents: {
				totalBs: {
					received: this.toTwoDecimals(collected.equivalents.totalBs.received),
					change: this.toTwoDecimals(collected.equivalents.totalBs.change),
					net: this.toTwoDecimals(collected.equivalents.totalBs.net),
				},
				totalUsd: {
					received: this.toTwoDecimals(collected.equivalents.totalUsd.received),
					change: this.toTwoDecimals(collected.equivalents.totalUsd.change),
					net: this.toTwoDecimals(collected.equivalents.totalUsd.net),
				},
			},
			conversions: {
				bsToUsd: this.toTwoDecimals(collected.conversions.bsToUsd),
				usdToBs: this.toTwoDecimals(collected.conversions.usdToBs),
			},
			grandTotal: {
				bs: this.toTwoDecimals(collected.grandTotal.bs),
				usd: this.toTwoDecimals(collected.grandTotal.usd),
			},
		};

		const frequentCustomers = customerFrequency.map((item) => ({
			customerId: item.customerId,
			fullName: customerMap.get(item.customerId)?.fullName || 'N/A',
			identify: customerMap.get(item.customerId)?.identify || '',
			totalInvoices: item._count.customerId,
		}));

		const topProducts = productSales.map((item) => {
			const totalAmountBs = this.toTwoDecimals(Number(item._sum.subtotal ?? 0));
			const totalCostBs = this.toTwoDecimals(Number(item._sum.costSubtotal ?? 0));

			return {
				productId: item.productId,
				name: productMap.get(item.productId)?.name || 'N/A',
				barcode: productMap.get(item.productId)?.barcode || '',
				presentation: productMap.get(item.productId)?.presentation || '',
				totalQuantitySold: item._sum.quantity ?? 0,
				totalAmountBs,
				totalCostBs,
				totalProfitBs: this.toTwoDecimals(totalAmountBs - totalCostBs),
				totalInvoices: item._count.productId,
			};
		});

		return {
			range: {
				startDate,
				endDate,
			},
			totalSales: {
				amountBs: this.toTwoDecimals(totalSales.amountBs),
				amountUsd: this.toTwoDecimals(totalSales.amountUsd),
			},
			totalCost: {
				amountBs: this.toTwoDecimals(totalCostBs),
				amountUsd: this.toTwoDecimals(totalCostUsd),
			},
			profit: {
				amountBs: this.toTwoDecimals(profitBs),
				amountUsd: this.toTwoDecimals(profitUsd),
				marginPercent: this.toTwoDecimals(marginPercent),
				itemsWithoutCost,
			},
			totalInvoices,
			paidInvoices,
			pendingInvoices,
			receivable: {
				amountBs: this.toTwoDecimals(receivable.amountBs),
				amountUsd: this.toTwoDecimals(receivable.amountUsd),
			},
			collected: collectedResponse,
			paymentBreakdown,
			invoices,
			frequentCustomers,
			topProducts,
			lowStockProducts,
		};
	}
}
