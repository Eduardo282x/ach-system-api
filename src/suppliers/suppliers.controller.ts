import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { SupplierDto } from './suppliers.dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
export class SuppliersController {
    constructor(private readonly suppliersService: SuppliersService) { }

    @Get()
    async getSuppliers(@Query('search') search: string) {
        return await this.suppliersService.getSuppliers(search);
    }

    @Post()
    async createSupplier(@Body() createSupplierDto: SupplierDto) {
        return await this.suppliersService.createSupplier(createSupplierDto);
    }

    @Put(':id')
    async updateSupplier(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateSupplierDto: SupplierDto,
    ) {
        return await this.suppliersService.updateSupplier(id, updateSupplierDto);
    }

    @Delete(':id')
    async deleteSupplier(@Param('id', ParseIntPipe) id: number) {
        return await this.suppliersService.deleteSupplier(id);
    }
}
