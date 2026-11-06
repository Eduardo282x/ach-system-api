import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
	constructor(private readonly dashboardService: DashboardService) { }

	@Get('/summary')
	async getSummary(
		@Query('startDate') startDate: string,
		@Query('endDate') endDate: string,
	) {
		return await this.dashboardService.getSummaryByDateRange({ startDate, endDate });
	}

	@Get('/sales-trend')
	async getSalesTrend(
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Query('groupBy') groupBy?: string,
	) {
		return await this.dashboardService.getSalesTrend({ startDate, endDate, groupBy });
	}
}
