import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateInvoiceDto } from './sales.dto';
import { SalesService } from './sales.service';
import { Response } from 'express';

@Controller('sales')
export class SalesController {
    constructor(private readonly salesService: SalesService) { }

    @Get('/invoices')
    async getInvoices(
        @Query('search') search: string,
    ) {
        return await this.salesService.getInvoices(search);
    }

    @Get('/resumen')
    async getResumenSales(
        @Query('date') date: string,
        @Query('sessionId') sessionId?: string,
    ) {
        return await this.salesService.getResumenSales({date, sessionId});
    }

    @Get('/resumen-excel')
    async getResumenSalesExcel(
        @Res() res: Response,
        @Query('date') date: string,
        @Query('sessionId') sessionId?: string,
    ) {
        return await this.salesService.getResumenSalesExcel({date, sessionId}, res);
    }

    @Get('/types-payment')
    async getPaymentTypes() {
        return await this.salesService.getPaymentTypes();
    }

    @Post('/invoices')
    async createInvoice(
        @Body() createInvoiceDto: CreateInvoiceDto,
        @CurrentUser() user,
    ) {
        return await this.salesService.createInvoice(createInvoiceDto, user.id);
    }
}
