import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductsService } from './products.service';

@Injectable()
export class ProductsSchedulerService {
    private readonly logger = new Logger(ProductsSchedulerService.name);

    constructor(private readonly productsService: ProductsService) { }

    @Cron('0 8,13 * * *', {
        timeZone: 'America/Caracas',
    })
    async handleAutomaticExchangeRate() {
        try {
            const result = await this.productsService.saveAutomaticExchangeRate();
            this.logger.log(result?.message || 'Tasas automáticas actualizadas');
        } catch (error: any) {
            this.logger.error(
                'Error ejecutando cron de tasa automática',
                error?.stack || error?.message || String(error),
            );
        }
    }
}
