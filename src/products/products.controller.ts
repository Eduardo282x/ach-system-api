import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ProductDto } from './products.dto';
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

    @Post('/breakdown')
    async breakDownParentToChild(@Body('childId') childId: number, @CurrentUser() user,) {
        return await this.productsService.breakDownParentToChild(childId, user.id);
    }

    @Post()
    async createProduct(@Body() createProductDto: ProductDto) {
        return await this.productsService.createProduct(createProductDto);
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
