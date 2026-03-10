import { Body, Controller, Get, Param, ParseEnumPipe, ParseIntPipe, Post, Put, Query, } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { SessionStatus } from 'src/generated/prisma/enums';
import { CloseSessionDto, OpenSessionDto, UpdateOpeningSessionDto, } from './sessions.dto';
import { SessionsService } from './sessions.service';

@Controller('sessions')
export class SessionsController {
    constructor(private readonly sessionsService: SessionsService) { }

    @Get()
    async getSessions(
        @Query('status', new ParseEnumPipe(SessionStatus, { optional: true })) status?: SessionStatus,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        // @Query('cashDrawerId', ParseIntPipe) cashDrawerId?: number,
    ) {
        return await this.sessionsService.getSessions({status, startDate, endDate});
    }

    @Get('/cash-drawer')
    async getCashDrawer() {
        return await this.sessionsService.getCashDrawer();
    }

    @Post('/cash-drawer')
    async createCashDrawer(@Body('name') name: string) {
        return await this.sessionsService.createCashDrawer(name);
    }

    @Put('/cash-drawer/:id')
    async updateCashDrawer(@Param('id', ParseIntPipe) id: number, @Body('name') name: string) {
        return await this.sessionsService.updateCashDrawer(id, name);
    }

    @Get(':id')
    async getSessionById(@Param('id', ParseIntPipe) id: number) {
        return await this.sessionsService.getSessionById(id);
    }

    @Post('/open')
    async openSession(@Body() openSessionDto: OpenSessionDto, @CurrentUser() user) {
        return await this.sessionsService.openSession(openSessionDto, user.id);
    }

    @Put('/:id/open')
    async updateSessionOpening(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateOpeningSessionDto: UpdateOpeningSessionDto,
        @CurrentUser() user,
    ) {
        return await this.sessionsService.updateSessionOpening(
            id,
            updateOpeningSessionDto,
            user.id,
        );
    }

    @Put('/:id/close')
    async closeSession(
        @Param('id', ParseIntPipe) id: number,
        @Body() closeSessionDto: CloseSessionDto,
        @CurrentUser() user,
    ) {
        return await this.sessionsService.closeSession(id, closeSessionDto, user.id);
    }
}
