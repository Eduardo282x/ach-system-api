import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExchangeRateDto, ProductDto } from './products.dto';
import axios from 'axios';
import { ExchangeRateType } from 'src/generated/prisma/enums';

export interface ExchangeRateApi {
    fuente: string;
    nombre: string;
    moneda: string;
    compra: null;
    venta: null;
    promedio: number;
    fechaActualizacion: Date;
}


@Injectable()
export class ProductsService {
    constructor(private readonly prismaService: PrismaService) { }

    async getProducts(search?: string) {
        try {
            const where: any = {
                deleted: false,
            };

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { barcode: { contains: search, mode: 'insensitive' } },
                ];
            }

            const exchangeRateToday = await this.getExchangeRateToday();

            const products = await this.prismaService.product.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
            }).then(async (products) => {
                const rates = exchangeRateToday.exchangeRate || [];
                return products.map(pro => {
                    return {
                        ...pro,
                        exchangeRates: rates.reduce((acc, rate) => {
                            acc[`${rate.name.toLocaleLowerCase()}${rate.currency}`] = rate.rate;
                            acc[`price${this.capitalizeFirstLetter(rate.name.toLocaleLowerCase())}${rate.currency}`] = Math.round(Number(pro.price) * Number(rate.rate) * 100) / 100; // Precio convertido con dos decimales
                            return acc;
                        }, {})
                    }
                })
            })

            if (products.length === 0) {
                return {
                    message: 'No se encontraron productos',
                    products: [],
                };
            }

            return {
                products,
            };
        } catch (error) {
            throw error;
        }
    }

    async getInventoryHistory() {
        try {
            const history = await this.prismaService.inventoryMovement.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            presentation: true,
                            price: true,
                            currency: true,
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            name: true,
                            username: true,
                            role: true,
                        }
                    },
                },
            });

            if (history.length === 0) {
                return {
                    message: 'No se encontraron movimientos de inventario',
                    history: [],
                };
            }

            return {
                history,
            };

        } catch (error) {
            throw error;
        }
    }

    async generateBarCode() {
        const maxAttempts = 20;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const timestamp = Date.now().toString(); // Usamos el timestamp actual para garantizar unicidad
            const randomDigits = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            const generatedCode = timestamp + randomDigits; // Concatenamos el timestamp con los dígitos aleatorios

            const exists = await this.prismaService.product.findUnique({
                where: { barcode: generatedCode },
                select: { id: true },
            });

            if (!exists) {
                return generatedCode;
            }
        }

        throw new InternalServerErrorException(
            'No se pudo generar un código de barras único, intenta nuevamente',
        );
    }

    capitalizeFirstLetter(str: string) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    async getExchangeRateToday() {
        try {
            const rates = await this.prismaService.exchangeRate.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const latestByNameAndCurrency = new Map<string, (typeof rates)[number]>();

            for (const rate of rates) {
                const key = `${rate.name.toLowerCase()}::${rate.currency}`;

                if (!latestByNameAndCurrency.has(key)) {
                    latestByNameAndCurrency.set(key, rate);
                }
            }

            const exchangeRate = Array.from(latestByNameAndCurrency.values()).map((rate) => ({
                ...rate,
                rate: Math.round(Number(rate.rate) * 100) / 100, // Redondeamos a dos decimales
            }));

            if (exchangeRate.length === 0) {
                return {
                    message: 'No se encontraron las tasas de cambio',
                    exchangeRate: null,
                };
            }
            return {
                exchangeRate,
            };
        } catch (error) {
            throw error;
        }
    }

    async saveManualExchangeRate(exchangeRate: ExchangeRateDto) {
        try {
            await this.prismaService.exchangeRate.updateMany({
                data: { isDefault: false },
            });

            const newRate = await this.prismaService.exchangeRate.create({
                data: {
                    name: exchangeRate.name,
                    rate: exchangeRate.rate,
                    currency: exchangeRate.currency, // Asumimos que el tipo de cambio se guarda con el mismo nombre que la moneda
                    isDefault: true
                },
            });

            return {
                message: 'Tasa de cambio guardada correctamente',
                data: newRate,
            };
        } catch (error) {
            throw error;
        }
    }

    async saveAutomaticExchangeRate() {
        try {
            const urlDolar = 'https://ve.dolarapi.com/v1/dolares/oficial';
            const urlEuro = 'https://ve.dolarapi.com/v1/euros/oficial';

            const responseDolar: ExchangeRateApi = await axios.get(urlDolar).then(res => res.data);
            const responseEuro: ExchangeRateApi = await axios.get(urlEuro).then(res => res.data);

            const rates = [
                {
                    name: responseDolar.fuente.toLocaleLowerCase() == 'oficial' ? 'BCV' : responseDolar.fuente.toUpperCase(),
                    rate: Math.round(responseDolar.promedio * 100) / 100, // Redondeamos a dos decimales
                    currency: 'USD',
                    isDefault: responseDolar.fuente.toLocaleLowerCase() == 'oficial',
                    createdAt: new Date(responseDolar.fechaActualizacion),
                },
                {
                    name: responseEuro.fuente.toLocaleLowerCase() == 'oficial' ? 'BCV' : responseEuro.fuente.toUpperCase(),
                    rate: Math.round(responseEuro.promedio * 100) / 100, // Redondeamos a dos decimales
                    currency: 'EUR',
                    isDefault: false,
                    createdAt: new Date(responseEuro.fechaActualizacion),
                }
            ];

            await this.prismaService.exchangeRate.createMany({
                data: rates.map(rate => ({
                    name: rate.name,
                    rate: rate.rate,
                    currency: rate.currency as ExchangeRateType,
                    isDefault: rate.isDefault,
                    createdAt: rate.createdAt,
                }))
            });

            return {
                message: 'Tasas de cambio guardadas correctamente',
                data: rates,
            }
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

            if (createProductDto.parentId) {
                const parentId = await this.prismaService.product.findUnique({
                    where: { parentId: createProductDto.parentId },
                })

                if (parentId) {
                    throw new BadRequestException('El producto padre ya tiene un producto detalle asociado. Solo se permite un producto detalle por producto padre.');
                }
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

            const product = await this.prismaService.product.update({
                where: { id },
                data: { deleted: true },
            });

            return {
                message: 'Producto eliminado correctamente',
                data: product,
            };
        } catch (error) {
            console.log(error);
            
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
