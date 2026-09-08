import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClientExcel, ProductExcel } from './excel.interface';
import { ProductsService } from 'src/products/products.service';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';


interface ProductTemplate {
    name: string;
    presentation: string;
    barcode: string;
    price: number;
    purchasePrice: number;
    stock: number;
    isDetail: boolean;
    parentId: number | null;
    unitsDetail: number | null;
}

@Injectable()
export class ExcelService {

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => ProductsService))
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
            const existingProducts = await this.prismaService.product.findMany({
                where: { deleted: false },
                select: { name: true },
            });
            const existingNames = new Set(existingProducts.map(product => product.name.toLowerCase().trim()));

            const seenNames = new Set<string>();
            const usedBarcodes = new Set<string>();
            const productsToCreate: ProductTemplate[] = [];
            let skipped = 0;

            for (const product of products) {
                const name = product.name?.trim();
                if (!name) {
                    skipped++;
                    continue;
                }

                const normalizedName = name.toLowerCase();
                if (existingNames.has(normalizedName) || seenNames.has(normalizedName)) {
                    skipped++;
                    continue;
                }
                seenNames.add(normalizedName);

                let barcode = product.barcode ? `${product.barcode}` : '';
                while (!barcode || usedBarcodes.has(barcode)) {
                    barcode = await this.productsService.generateBarCode();
                }
                usedBarcodes.add(barcode);

                productsToCreate.push({
                    name,
                    presentation: product.presentation ?? '',
                    barcode,
                    price: Number(product.price) || 0,
                    purchasePrice: Number(product.purchasePrice) || 0,
                    stock: Number(product.stock) || 0,
                    isDetail: false,
                    parentId: null,
                    unitsDetail: null,
                });
            }

            if (productsToCreate.length > 0) {
                await this.prismaService.product.createMany({
                    data: productsToCreate.map(item => ({...item, ivaId: 1, purchasePrice: item.purchasePrice || item.price })),
                    skipDuplicates: true,
                });
            }

            return {
                message: 'Productos subidos exitosamente',
                created: productsToCreate.length,
                skipped,
            }
        } catch (error) {
            console.log(error);

            throw {
                message: 'Error al subir productos. Verifique que el formato del archivo sea correcto y que no haya códigos de barras duplicados.',
                error: error,
            }
        }
    }

    async downloadProductTemplate(res: Response) {
        try {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet('Productos');

            sheet.addRow(['Nombre', 'Presentación', 'Código de Barras', 'Precio', 'Precio de Compra', 'Cantidad']);
            sheet.getRow(1).font = { bold: true };
            sheet.views = [{ state: 'frozen', ySplit: 1 }];
            sheet.columns = [
                { width: 30 },
                { width: 20 },
                { width: 18 },
                { width: 12 },
                { width: 14 },
                { width: 12 },
            ];

            const fileName = 'plantilla-productos.xlsx';
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${fileName}"`,
            );

            await workbook.xlsx.write(res);
            res.end();
        } catch (error) {
            console.log(error);
            throw {
                message: 'Error al generar la plantilla de productos',
                error: error,
            }
        }
    }
}
