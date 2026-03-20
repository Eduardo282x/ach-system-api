import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductsService } from './products.service';
import { WebsocketGateway } from 'src/web-socket/web-socket.service';
import { SessionsService } from 'src/sessions/sessions.service';

@Injectable()
export class ProductsSchedulerService {
    private readonly logger = new Logger(ProductsSchedulerService.name);

    constructor(
        private readonly sessionService: SessionsService,
        private readonly productsService: ProductsService,
        private readonly websocketGateway: WebsocketGateway,
    ) { }

    @Cron('0 8,13 * * *', {
        timeZone: 'America/Caracas',
    })
    async handleAutomaticExchangeRate() {
        try {
            const result = await this.productsService.saveAutomaticExchangeRate();
            this.websocketGateway.emitReminder('exchangeRateUpdate', { data: result.data, message: 'Tasas actualizadas automáticamente.' });
            this.logger.log(result?.message || 'Tasas automáticas actualizadas');
        } catch (error: any) {
            this.logger.error(
                'Error ejecutando cron de tasa automática',
                error?.stack || error?.message || String(error),
            );
        }
    }

    @Cron('0 20 * * *', {
        timeZone: 'America/Caracas',
    })
    async handleDailyTask() {
        try {
            const openSessions = await this.sessionService.getSessions({ status: 'OPEN' });
            const reminder = {
                type: 'DAILY_REMINDER',
                title: 'Recordatorio diario',
                message: openSessions.sessions.length > 0
                    ? `La siguientes cajas aun estan abiertas: ${openSessions.sessions.map(session => session.cashDrawer.name).join(', ')}`
                    : 'Todo bien.',
                status: openSessions.sessions.length > 0
                    ? 'warning'
                    : 'success',
                data: openSessions.sessions || [],
                createdAt: new Date().toISOString(),
            };

            this.websocketGateway.emitReminder('daily-reminder', reminder);
            this.logger.log('Recordatorio diario emitido por websocket');
        } catch (error: any) {
            this.logger.error(
                'Error ejecutando cron de tarea diaria',
                error?.stack || error?.message || String(error),
            );
        }
    }
}
