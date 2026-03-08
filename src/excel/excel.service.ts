import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClientExcel, ProductExcel } from './excel.interface';

@Injectable()
export class ExcelService {

    constructor(private readonly prismaService: PrismaService) {

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
                presentation: product.presentation,
                barcode: `${product.barcode}`,
                price: Number(product.price) || 0,
                stock: Number(product.stock) || 0,
                isDetail: false,
                parentId: null,
                unitsDetail: null
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
}
