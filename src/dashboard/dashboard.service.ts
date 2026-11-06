import { BadRequestException, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import isoWeek from 'dayjs/plugin/isoWeek';
import { PrismaService } from 'src/prisma/prisma.service';
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
						netIncomeBs: 0,
						netIncomeUsd: 0,
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
				items: {
					select: {
						quantity: true,
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

			period.totalInvoices += 1;
			period.totalItems += invoice.items.reduce(
				(acc, item) => acc + Number(item.quantity),
				0,
			);
			period.totalSalesBs += Number(invoice.totalAmountBs);
			period.totalSalesUsd += Number(invoice.totalAmountUsd);
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
			netIncomeBs: this.toTwoDecimals(period.receivedBs - period.changeBs),
			netIncomeUsd: this.toTwoDecimals(period.receivedUsd - period.changeUsd),
		}));

		const totals = mappedPeriods.reduce(
			(acc, period) => ({
				totalInvoices: acc.totalInvoices + period.totalInvoices,
				totalItems: acc.totalItems + period.totalItems,
				totalSalesBs: acc.totalSalesBs + period.totalSalesBs,
				totalSalesUsd: acc.totalSalesUsd + period.totalSalesUsd,
				netIncomeBs: acc.netIncomeBs + period.netIncomeBs,
				netIncomeUsd: acc.netIncomeUsd + period.netIncomeUsd,
			}),
			{
				totalInvoices: 0,
				totalItems: 0,
				totalSalesBs: 0,
				totalSalesUsd: 0,
				netIncomeBs: 0,
				netIncomeUsd: 0,
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
				netIncomeBs: this.toTwoDecimals(totals.netIncomeBs),
				netIncomeUsd: this.toTwoDecimals(totals.netIncomeUsd),
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
				const amountUsd = Number(invoice.totalReceivedUsd);
				const changeUsd = Number(invoice.totalChangeUsd);

				acc.amountBs += amountBs;
				acc.changeAmountBs += changeBs;
				acc.amountUsd += amountUsd;
				acc.changeAmountUsd += changeUsd;

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
