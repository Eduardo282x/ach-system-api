import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductDto } from './products.dto';

@Injectable()
export class ProductsService {
    constructor(private readonly prismaService: PrismaService) { }

    async getProducts(search?: string) {
        try {
            const where: any = {};

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { barcode: { contains: search, mode: 'insensitive' } },
                ];
            }

            const products = await this.prismaService.product.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return {
                message: 'Productos obtenidos correctamente',
                products,
            };
        } catch (error) {
            throw error;
        }
    }

    async createProduct(createProductDto: ProductDto) {
        try {
            // 1. Verificar si el código de barras ya existe
            const exists = await this.prismaService.product.findUnique({
                where: { barcode: createProductDto.barcode },
            });

            if (exists) {
                throw new BadRequestException('El código de barras ya está registrado para el producto: ' + exists.name);
            }

            // 2. Crear el producto
            const newProduct = await this.prismaService.product.create({
                data: {
                    name: createProductDto.name,
                    presentation: createProductDto.presentation,
                    barcode: createProductDto.barcode,
                    price: createProductDto.price,
                    currency: createProductDto.currency,
                    stock: createProductDto.stock,
                    isDetail: createProductDto.isDetail,
                    parentId: createProductDto.parentId || null,
                    unitsDetail: createProductDto.unitsDetail || null,
                },
                include: {
                    productParent: true, // Incluimos info del padre si existe
                },
            });

            return {
                message: 'Producto creado exitosamente',
                data: newProduct,
            };
        } catch (error: any) {
            throw error;
        }
    }

    async updateProduct(id: number, updateProductDto: ProductDto) {
        try {
            // 1. Verificar existencia
            const product = await this.prismaService.product.findUnique({ where: { id } });
            if (!product) {
                throw new NotFoundException(`Producto con ID ${id} no encontrado`);
            }

            const exists = await this.prismaService.product.findUnique({
                where: { barcode: updateProductDto.barcode },
            });

            if (exists && exists.id !== id) {
                throw new BadRequestException(`El código de barras ya está registrado para el producto: ${exists.name}`);
            }

            // 2. Actualizar
            const updatedProduct = await this.prismaService.product.update({
                where: { id },
                data: updateProductDto,
                include: {
                    productParent: true,
                    productChild: true,
                },
            });

            return {
                message: 'Producto actualizado correctamente',
                data: updatedProduct,
            };
        } catch (error: any) {
            throw error;
        }
    }

    async deleteProduct(id: number) {
        try {
            const exists = await this.prismaService.product.findUnique({
                where: { id },
            });

            if (!exists) {
                throw new NotFoundException(`Producto con id ${id} no encontrado`);
            }

            const product = await this.prismaService.product.delete({
                where: { id },
            });

            return {
                message: 'Producto eliminado correctamente',
                data: product,
            };
        } catch (error) {
            throw error;
        }
    }

    //Metodo para pasar el producto a detalle, es decir, convertir un producto padre en un producto hijo
    async breakDownParentToChild(childId: number, userId: number) {
        try {
            // 1. Buscar el producto hijo y verificar que tenga un padre asociado
            const childProduct = await this.prismaService.product.findUnique({
                where: { id: childId },
                include: { productParent: true },
            });

            if (!childProduct || !childProduct.productParent) {
                throw new BadRequestException('Este producto no tiene una unidad mayor (padre) asociada.');
            }

            const parent = childProduct.productParent;

            // 2. Verificar si hay stock en el padre para desglosar
            if (parent.stock <= 0) {
                throw new BadRequestException(`No hay stock disponible en ${parent.name} para desglosar.`);
            }

            // 3. Ejecutar la transacción
            const result = await this.prismaService.$transaction(async (tx) => {
                // A. Restar 1 al Padre
                await tx.product.update({
                    where: { id: parent.id },
                    data: { stock: { decrement: 1 } },
                });

                console.log(childProduct);
                
                // B. Sumar unidades al Hijo
                const updatedChild = await tx.product.update({
                    where: { id: childId },
                    data: { stock: { increment: childProduct?.productParent?.unitsDetail || 0 } },
                });

                // C. Registrar el movimiento de salida del Padre
                await tx.inventoryMovement.create({
                    data: {
                        productId: parent.id,
                        quantity: -1,
                        type: 'CONVERSION',
                        userId: userId,
                        reason: `Desglose: 1 unidad enviada a ${childProduct.name}`,
                    },
                });

                // D. Registrar el movimiento de entrada del Hijo
                await tx.inventoryMovement.create({
                    data: {
                        productId: childId,
                        quantity: childProduct.productParent?.unitsDetail || 0,
                        type: 'CONVERSION',
                        userId: userId,
                        reason: `Desglose: Recibidas unidades desde ${parent.name}`,
                    },
                });

                return updatedChild;
            });

            return {
                message: `Se ha desglosado 1 ${parent.name}. Ahora tienes ${result.stock} unidades de ${result.name}.`,
                data: result,
            };
        } catch (error) {
            throw error;
        }
    }
}
