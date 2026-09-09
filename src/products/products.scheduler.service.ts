import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductsService } from './products.service';
import { WebsocketGateway } from 'src/web-socket/web-socket.service';
import { SessionsService } from 'src/sessions/sessions.service';

@Injectable()
export class ProductsSchedulerService implements OnApplicationBootstrap {
    private readonly logger = new Logger(ProductsSchedulerService.name);

    constructor(
        private readonly sessionService: SessionsService,
        private readonly productsService: ProductsService,
        private readonly websocketGateway: WebsocketGateway,
    ) { }

    async onApplicationBootstrap() {
        void this.runAutomaticExchangeRate('inicio de la aplicacion');
    }

    @Cron('0 8,13 * * *', {
        timeZone: 'America/Caracas',
    })
    async handleAutomaticExchangeRate() {
        await this.runAutomaticExchangeRate('cron');
    }

    private async runAutomaticExchangeRate(source: string) {
        const attempts = 5;
        const delays = [5_000, 10_000, 20_000, 30_000, 60_000];

        for (let attempt = 0; attempt < attempts; attempt++) {
            try {
                const result = await this.productsService.saveAutomaticExchangeRate();
                const message = result?.message || 'Tasas actualizadas automáticamente.';

                if (this.websocketGateway.server) {
                    this.websocketGateway.emitReminder('exchangeRateUpdate', {
                        data: result.exchangeRate || [],
                        message,
                    });
                }
                this.logger.log(message);
                return;
            } catch (error: any) {
                if (attempt < attempts - 1) {
                    this.logger.warn(
                        `Error ejecutando actualizacion automatica de tasa (${source}), intento ${attempt + 1}/${attempts}`,
                    );
                    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
                } else {
                    this.logger.error(
                        `Error ejecutando actualizacion automatica de tasa (${source})`,
                        error?.stack || error?.message || String(error),
                    );
                }
            }
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
