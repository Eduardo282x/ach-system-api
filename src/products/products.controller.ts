import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ExchangeRateDto, ProductDto } from './products.dto';
import { ProductsService } from './products.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('products')
export class ProductsController {
    constructor(private readonly productsService: ProductsService) { }

    @Get()
    async getProducts(
        @Query('search') search: string,
    ) {
        return await this.productsService.getProducts(search);
    }

    @Get('/inventory/history')
    async getInventoryHistory(
        @Query('page', ParseIntPipe) page: number,
        @Query('size', ParseIntPipe) size: number,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
    ) {
        return await this.productsService.getInventoryHistory({ page, size, startDate, endDate });
    }

    @Get('/exchange-rate/today')
    async getExchangeRateToday() {
        return await this.productsService.getExchangeRateToday();
    }

    @Get('/barcode')
    async generateBarCode() {
        return await this.productsService.generateBarCode();
    }

    @Post('/breakdown')
    async breakDownParentToChild(@Body('childId') childId: number, @CurrentUser() user,) {
        return await this.productsService.breakDownParentToChild(childId, user.id);
    }

    @Post()
    async createProduct(@Body() createProductDto: ProductDto) {
        return await this.productsService.createProduct(createProductDto);
    }

    @Post('/exchange-rate')
    async saveManualExchangeRate(@Body() exchangeRateDto: ExchangeRateDto) {
        return await this.productsService.saveManualExchangeRate(exchangeRateDto);
    }

    @Post('/exchange-rate/automatic')
    async saveAutomaticExchangeRate() {
        return await this.productsService.saveAutomaticExchangeRate();
    }

    @Put('/exchange-rate/default/:id')
    async saveDefaultExchangeRate(@Param('id', ParseIntPipe) id: number) {
        return await this.productsService.saveDefaultExchangeRate(id);
    }

    @Put(':id')
    async updateProduct(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateProductDto: ProductDto,
    ) {
        return await this.productsService.updateProduct(id, updateProductDto);
    }

    @Delete(':id')
    async deleteProduct(@Param('id', ParseIntPipe) id: number) {
        return await this.productsService.deleteProduct(id);
    }
}
