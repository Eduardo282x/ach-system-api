import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateChangeDto, CreateInvoiceDto, CreateReturnDto, GetInvoicesFilterDto } from './sales.dto';
import { SalesService } from './sales.service';
import { Response } from 'express';

@Controller('sales')
export class SalesController {
    constructor(private readonly salesService: SalesService) { }

    @Get('/invoices')
    async getInvoices(
        @Query() filter: GetInvoicesFilterDto,
    ) {
        return await this.salesService.getInvoices(filter);
    }

    @Get('/invoices/:invoiceId')
    async getInvoiceById(
        @Param('invoiceId', ParseIntPipe) invoiceId: number,
    ) {
        return await this.salesService.getInvoiceById(invoiceId);
    }

    @Get('/resumen')
    async getResumenSales(
        @Query('date') date: string,
        @Query('sessionId') sessionId?: string,
        @Query('cashDrawerId') cashDrawerId?: string,
    ) {
        return await this.salesService.getResumenSales({date, sessionId, cashDrawerId});
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
        try {
            return await this.salesService.createInvoice(createInvoiceDto, user.id);
        } catch (error) {
            console.log('Error in createInvoice:', error);
            throw error;
        }
    }

    @Put('/pay-invoice-credit/:invoiceId') 
    async payInvoiceCredit(
        @Param('invoiceId', ParseIntPipe) invoiceId: number,
        @CurrentUser() user,
    ) {
        return await this.salesService.payInvoiceCredit(invoiceId, user.id);
    }

    @Post('/return')
    async returnInvoice(
        @Body() createReturnDto: CreateReturnDto,
        @CurrentUser() user,
    ) {
        return await this.salesService.returnInvoice(createReturnDto, user.id);
    }

    @Post('/change')
    async changeInvoice(
        @Body() createChangeDto: CreateChangeDto,
        @CurrentUser() user,
    ) {
        return await this.salesService.changeInvoice(createChangeDto, user.id);
    }
    
}
