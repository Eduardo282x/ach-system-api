import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsService } from 'src/products/products.service';
import { ClientExcel, ProductExcel } from './excel.interface';
import { ExchangeRateType } from 'src/generated/prisma/enums';

@Injectable()
export class ExcelService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productsService: ProductsService,
    ) {

    }

    async uploadClientsExcel(clients: ClientExcel[]) {
        try {
            const clientsToCreate = clients.map(client => ({
                fullName: client.name,
                identify: `V${client.identify}`,
                phone: `0${client.phone}`,
            }));
            await this.prismaService.clients.createMany({
                data: clientsToCreate,
                skipDuplicates: true,
            });

            return {
                message: 'Clientes subidos exitosamente',
            }
        } catch (error) {
            throw error;
        }
    }

    async uploadProductsExcel(products: ProductExcel[]) {
        try {
            const productsToCreate = products.filter(item => item.barcode !== null && item.barcode !== undefined && item.barcode !== '').map(product => ({
                name: product.name,
                presentation: product.presentation ? product.presentation : '',
                barcode: product.barcode.toString(),
                price: product.price,
                discountPrice: product.discountPrice,
                currency: 'USD' as ExchangeRateType,
                stock: product.stock,
                serialNumber: product.serialNumber ? product.serialNumber : '',
                lote: product.lote ? product.lote : '',
                brand: product.brand ? product.brand : '',
                type: product.type ? product.type : '',
                description: product.description ? product.description : '',
            }));
            await this.prismaService.product.createMany({
                data: productsToCreate,
                skipDuplicates: true,
            });

            return {
                message: 'Productos subidos exitosamente',
            }
        } catch (error) {
            console.log(error);

            throw {
                message: 'Error al subir productos. Verifique que el formato del archivo sea correcto y que no haya códigos de barras duplicados.',
                error: error,
            }
        }
    }

    async updateOrCreateProductsExcel(products: ProductExcel[]) {
        try {
            let updated = 0;
            let created = 0;

            for (const product of products) {
                const existing = await this.prismaService.product.findFirst({
                    where: {
                        name: { equals: product.name, mode: 'insensitive' },
                        deleted: false,
                    },
                });

                if (existing) {
                    await this.prismaService.product.update({
                        where: { id: existing.id },
                        data: { price: Number(product.price) || 0 },
                    });
                    updated++;
                    continue;
                }

                const barcode = await this.productsService.generateBarCode();
                await this.prismaService.product.create({
                    data: {
                        name: product.name,
                        presentation: product.presentation,
                        barcode,
                        price: Number(product.price) || 0,
                        stock: Number(product.stock) || 0,
                        isDetail: false,
                        parentId: null,
                        unitsDetail: null,
                    },
                });
                created++;
            }

            return {
                message: `Procesamiento completado: ${updated} producto(s) actualizado(s), ${created} producto(s) creado(s).`,
                updated,
                created,
            };
        } catch (error) {
            console.log(error);

            throw {
                message: 'Error al procesar los productos. Verifique que el formato del archivo sea correcto.',
                error: error,
            }
        }
    }
}
