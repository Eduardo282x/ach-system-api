import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import "dotenv/config";

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:Earo282*@localhost:5432/achsystem-base';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Starting seed...');

    // Create type Payment

    const hashedPassword = await bcrypt.hash('admin', 12);

    await prisma.users.create({
        data: {
            email: 'admin@gmail.com',
            password: hashedPassword,
            name: 'Admin',
            username: 'admin',
            role: 'ADMIN',
        }
    });

    await prisma.iva.create({
        data: {
            name: 'IVA 16%',
            percentage: 16.00,
        }
    })

    const paymentTypes: { name: string; currency: 'BS' | 'USD' }[] = [
        {
            name: 'Punto',
            currency: 'BS'
        },
        {
            name: 'Pago Movil',
            currency: 'BS'
        },
        {
            name: 'Transferencia',
            currency: 'BS'
        },
        {
            name: 'Divisas $',
            currency: 'USD'
        },
        {
            name: 'Efectivo BS',
            currency: 'BS'
        },
        {
            name: 'Bio Pago',
            currency: 'BS'
        },
    ];

    await prisma.typePayment.createMany({
        data: paymentTypes
    })

    console.log('🎉 Seed completed!');
}

main()
    .catch(e => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });