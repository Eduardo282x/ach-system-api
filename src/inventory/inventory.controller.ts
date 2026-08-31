import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateInventoryEntryDto, GetInventoryEntriesFilterDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {

    constructor(private readonly inventoryService: InventoryService) { }

    @Get('/entries')
    async getInventoryEntries(@Query() filter: GetInventoryEntriesFilterDto) {
        return await this.inventoryService.getInventoryEntries(filter);
    }

    @Get('/entries/:id')
    async getInventoryEntryById(@Param('id', ParseIntPipe) id: number) {
        return await this.inventoryService.getInventoryEntryById(id);
    }

    @Post('/entries')
    async saveInventoryEntry(
        @Body() createInventoryEntryDto: CreateInventoryEntryDto,
        @CurrentUser() user,
    ) {
        return await this.inventoryService.saveInventoryEntry(createInventoryEntryDto, user.id);
    }
}
