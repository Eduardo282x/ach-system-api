import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {
    constructor() {
        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL as string,
            max: 10,
            connectionTimeoutMillis: 10_000,
            idleTimeoutMillis: 30_000,
            statement_timeout: 15_000,
        });
        super({ adapter });
    }
}
