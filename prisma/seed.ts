import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:Earo282*@localhost:5432/medclinical';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting seed...');

  // Create type Payment

  const hashedPassword = await bcrypt.hash('admin', 12);

  const existingAdmin = await prisma.users.findFirst({
    where: { username: 'admin' },
  });

  if (!existingAdmin) {
    await prisma.users.create({
      data: {
        email: 'admin@gmail.com',
        password: hashedPassword,
        name: 'Admin',
        username: 'admin',
        role: 'ADMIN',
      }
    });
  }

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
    {
      name: 'Devolución $',
      currency: 'USD'
    },
    {
      name: 'Devolución Efectivo Bs',
      currency: 'BS'
    },
  ];

  for (const paymentType of paymentTypes) {
    const existing = await prisma.typePayment.findFirst({
      where: {
        name: { equals: paymentType.name, mode: 'insensitive' },
        currency: paymentType.currency,
      },
    });

    if (!existing) {
      await prisma.typePayment.create({
        data: paymentType,
      });
    }
  }

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