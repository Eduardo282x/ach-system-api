import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ClientDto } from './clients.dto';
import { ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
    constructor(private readonly clientsService: ClientsService) { }

    @Get()
    async getClients(@Query('search') search: string) {
        return await this.clientsService.getClients(search);
    }

    @Post()
    async createClient(@Body() createClientDto: ClientDto) {
        return await this.clientsService.createClient(createClientDto);
    }

    @Put(':id')
    async updateClient(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateClientDto: ClientDto,
    ) {
        return await this.clientsService.updateClient(id, updateClientDto);
    }

    @Delete(':id')
    async deleteClient(@Param('id', ParseIntPipe) id: number) {
        return await this.clientsService.deleteClient(id);
    }
}
