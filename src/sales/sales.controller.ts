import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateInvoiceDto } from './sales.dto';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
    constructor(private readonly salesService: SalesService) { }

    @Get('/invoices')
    async getInvoices(
        @Query('search') search: string,
    ) {
        return await this.salesService.getInvoices(search);
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
