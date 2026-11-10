import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeleteProductDto, ExchangeRateDto, ProductDto, UpdateProductDto } from './products.dto';
import axios from 'axios';
import { ExchangeRateType } from 'src/generated/prisma/enums';
import { endOfDay, startOfDay } from 'src/common/utils/time.util';

export interface ExchangeRateApi {
    fuente: string;
    nombre: string;
    moneda: string;
    compra: null;
    venta: null;
    promedio: number;
    fechaActualizacion: Date;
}

export interface InventoryHistoryQuery {
    page: number;
    size: number;
    startDate?: string;
    endDate?: string;
    search?: string;
}


@Injectable()
export class ProductsService {
    constructor(private readonly prismaService: PrismaService) { }

    async getProducts(query: { search?: string, page?: number, size?: number }) {
        const { search, page = 1, size = 10 } = query;
        const skip = (page - 1) * size;
        const take = size;
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

            const totalElements = await this.prismaService.product.count({ where });

            const products = await this.prismaService.product.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
                skip,
                take,
                include: {
                    productChild: {
                        where: { deleted: false },
                        orderBy: { createdAt: 'asc' },
                    },
                    productParent: true,
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
                    pagination: {
                        total: totalElements,
                        page,
                        size,
                    }
                };
            }

            return {
                products,
                pagination: {
                    total: totalElements,
                    page,
                    size,
                },
            };
        } catch (error) {
            throw error;
        }
    }

    private getStartOfDayUtc(date: string) {
        return startOfDay(date);
    }

    private getEndOfDayUtc(date: string) {
        return endOfDay(date);
    }

    async getInventoryHistory(query: InventoryHistoryQuery) {
        const { page, size, startDate, endDate, search } = query;
        const where: any = {};
        const skip = (page - 1) * size;
        const take = size;

        if (search) {
            where.product = {
                is: {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { barcode: { contains: search, mode: 'insensitive' } },
                    ],
                },
            };
        }

        if (startDate && endDate) {
            const start = this.getStartOfDayUtc(startDate);
            const end = this.getEndOfDayUtc(endDate);

            where.createdAt = {
                gte: start,
                lte: end,
            };
        }

        try {
            const history = await this.prismaService.inventoryMovement.findMany({
                skip,
                take,
                where,
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            presentation: true,
                            barcode: true,
                            price: true,
                            purchasePrice: true,
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

            const totalElements = await this.prismaService.inventoryMovement.count({ where });

            if (history.length === 0) {
                return {
                    message: 'No se encontraron movimientos de inventario',
                    history: [],
                    pagination: {
                        total: 0,
                        page,
                        size,
                    }
                };
            }

            return {
                history,
                pagination: {
                    total: totalElements,
                    page,
                    size,
                }
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

    private assertPurchasePriceNotGreaterThanPrice(
        purchasePrice: number | null | undefined,
        price: number | null | undefined,
        label: string,
    ) {
        const purchase = Number(purchasePrice ?? 0);
        const sale = Number(price ?? 0);

        if (!Number.isFinite(purchase) || !Number.isFinite(sale)) {
            return;
        }

        if (purchase > sale) {
            throw new BadRequestException(
                `El precio de compra ${label} no puede ser mayor al precio de venta.`,
            );
        }
    }

    async getExchangeRateToday() {
        try {
            const rates = await this.prismaService.exchangeRate.findMany({
                orderBy: {
                    createdAt: 'asc',
                },
            });

            const closestByNameAndCurrency = new Map<string, (typeof rates)[number]>();
            const now = Date.now();

            for (const rate of rates) {
                const key = `${rate.name.toLowerCase()}::${rate.currency}`;
                const currentDiff = Math.abs(new Date(rate.createdAt).getTime() - now);
                const existing = closestByNameAndCurrency.get(key);

                if (!existing) {
                    closestByNameAndCurrency.set(key, rate);
                    continue;
                }

                const existingDiff = Math.abs(new Date(existing.createdAt).getTime() - now);

                // Si hay empate en distancia, conservamos el mas reciente.
                if (
                    currentDiff < existingDiff ||
                    (currentDiff === existingDiff && new Date(rate.createdAt) > new Date(existing.createdAt))
                ) {
                    closestByNameAndCurrency.set(key, rate);
                }
            }

            const exchangeRate = Array.from(closestByNameAndCurrency.values()).map((rate) => ({
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
                    date: new Date(responseDolar.fechaActualizacion),
                    isDefault: responseDolar.fuente.toLocaleLowerCase() == 'oficial',
                },
                {
                    name: responseEuro.fuente.toLocaleLowerCase() == 'oficial' ? 'BCV' : responseEuro.fuente.toUpperCase(),
                    rate: Math.round(responseEuro.promedio * 100) / 100, // Redondeamos a dos decimales
                    currency: 'EUR',
                    date: new Date(responseEuro.fechaActualizacion),
                    isDefault: false,
                }
            ];

            await this.prismaService.exchangeRate.createMany({
                data: rates.map(rate => ({
                    name: rate.name,
                    rate: rate.rate,
                    currency: rate.currency as ExchangeRateType,
                    isDefault: rate.isDefault,
                    date: rate.date,
                }))
            });

            return await this.getExchangeRateToday();
        } catch (error) {
            throw error;
        }
    }

    async saveDefaultExchangeRate(id: number) {
        try {
            await this.prismaService.exchangeRate.updateMany({
                data: { isDefault: false },
            });
            const rateToSetDefault = await this.prismaService.exchangeRate.update({
                where: { id },
                data: { isDefault: true },
            });
            return {
                message: 'Tasa de cambio predeterminada actualizada correctamente',
                data: rateToSetDefault,
            };
        } catch (error) {
            throw error;
        }
    }

    async createProduct(createProductDto: ProductDto) {
        try {
            if (createProductDto.isDetail && !createProductDto.parentId) {
                throw new BadRequestException('Un producto detalle debe tener un producto padre asociado.');
            }

            if (!createProductDto.isDetail && createProductDto.parentId) {
                throw new BadRequestException('Un producto padre no puede tener un producto padre asociado.');
            }

            this.assertPurchasePriceNotGreaterThanPrice(
                createProductDto.purchasePrice,
                createProductDto.price,
                createProductDto.isDetail ? 'del producto detalle' : 'del producto',
            );

            // 1. Verificar si el código de barras ya existe
            const exists = await this.prismaService.product.findUnique({
                where: { barcode: createProductDto.barcode },
            });

            if (exists) {
                throw new BadRequestException('El código de barras ya está registrado para el producto: ' + exists.name);
            }

            let parent: any = null;
            if (createProductDto.parentId) {
                parent = await this.prismaService.product.findUnique({
                    where: { id: createProductDto.parentId },
                    include: {
                        productChild: {
                            where: { deleted: false },
                        },
                    },
                });

                if (!parent || parent.deleted) {
                    throw new BadRequestException('El producto padre no existe o fue eliminado.');
                }

                if (parent.isDetail) {
                    throw new BadRequestException('El producto padre no puede ser un producto detalle.');
                }

                if (parent.productChild.length > 0) {
                    throw new BadRequestException('El producto padre ya tiene un producto detalle asociado. Solo se permite un producto detalle por producto padre.');
                }
            }

            // 2. Crear el producto
            return await this.prismaService.$transaction(async (tx) => {
                if (parent) {
                    const unitsDetail = Math.max(
                        1,
                        Number(createProductDto.unitsDetail ?? parent.unitsDetail ?? createProductDto.stock ?? 1),
                    );

                    await tx.product.update({
                        where: { id: parent.id },
                        data: { unitsDetail },
                    });
                }

                const newProduct = await tx.product.create({
                    data: {
                        name: createProductDto.name,
                        presentation: createProductDto.presentation,
                        barcode: createProductDto.barcode,
                        price: createProductDto.price,
                        purchasePrice: createProductDto.purchasePrice ?? 0,
                        currency: createProductDto.currency,
                        stock: createProductDto.stock,
                        isDetail: createProductDto.isDetail ?? false,
                        parentId: createProductDto.parentId || null,
                        unitsDetail: createProductDto.parentId ? null : (createProductDto.unitsDetail ?? null),
                    },
                    include: {
                        productParent: true, // Incluimos info del padre si existe
                    },
                });

                return {
                    message: 'Producto creado exitosamente',
                    data: newProduct,
                };
            });
        } catch (error: any) {
            throw error;
        }
    }

    async updateProduct(id: number, updateProductDto: UpdateProductDto) {
        try {
            return await this.prismaService.$transaction(async (tx) => {
                // 1. Verificar existencia y relaciones actuales
                const product = await tx.product.findUnique({
                    where: { id },
                    include: {
                        productChild: {
                            where: { deleted: false },
                            orderBy: { createdAt: 'asc' },
                        },
                        productParent: true,
                    },
                });

                if (!product) {
                    throw new NotFoundException(`Producto con ID ${id} no encontrado`);
                }

                const { child, ...productData } = updateProductDto;
                const existingChild = product.productChild[0] ?? null;

                const nextPrice =
                    productData.price !== undefined
                        ? Number(productData.price)
                        : Number(product.price);
                const nextPurchasePrice =
                    productData.purchasePrice !== undefined
                        ? Number(productData.purchasePrice)
                        : Number(product.purchasePrice);

                this.assertPurchasePriceNotGreaterThanPrice(
                    nextPurchasePrice,
                    nextPrice,
                    `del producto ${product.name}`,
                );

                if (child) {
                    const childPrice =
                        child.price !== undefined
                            ? Number(child.price)
                            : Number(existingChild?.price ?? 0);
                    const childPurchasePrice =
                        child.purchasePrice !== undefined
                            ? Number(child.purchasePrice)
                            : Number(existingChild?.purchasePrice ?? 0);

                    this.assertPurchasePriceNotGreaterThanPrice(
                        childPurchasePrice,
                        childPrice,
                        `del producto detalle ${child.name}`,
                    );
                }

                if (productData.barcode) {
                    const exists = await tx.product.findUnique({
                        where: { barcode: productData.barcode },
                    });

                    if (exists && exists.id !== id) {
                        throw new BadRequestException(`El código de barras ya está registrado para el producto: ${exists.name}`);
                    }
                }

                if (productData.parentId != null) {
                    if (productData.parentId === id) {
                        throw new BadRequestException('Un producto no puede ser su propio producto padre.');
                    }

                    const parent = await tx.product.findUnique({
                        where: { id: productData.parentId },
                    });

                    if (!parent || parent.deleted) {
                        throw new BadRequestException('El producto padre no existe o fue eliminado.');
                    }

                    if (parent.isDetail) {
                        throw new BadRequestException('El producto padre no puede ser un producto detalle.');
                    }

                    if (existingChild) {
                        throw new BadRequestException('El producto tiene un producto detalle asociado y no puede convertirse en detalle.');
                    }

                    const otherChild = await tx.product.findFirst({
                        where: {
                            parentId: productData.parentId,
                            deleted: false,
                            id: {
                                not: id,
                            },
                        },
                    });

                    if (otherChild) {
                        throw new BadRequestException('El producto padre ya tiene un producto detalle asociado. Solo se permite un producto detalle por producto padre.');
                    }
                }

                if (child) {
                    if (product.isDetail) {
                        throw new BadRequestException('Un producto detalle no puede tener un producto hijo.');
                    }

                    if (product.parentId != null) {
                        throw new BadRequestException('Un producto que pertenece a un producto padre no puede tener un producto hijo.');
                    }

                    if (child.id != null && existingChild?.id !== child.id) {
                        throw new BadRequestException('El producto detalle indicado no pertenece a este producto.');
                    }

                    if (existingChild && child.id == null) {
                        throw new BadRequestException('El producto padre ya tiene un producto detalle asociado. Envía el id del producto detalle para actualizarlo.');
                    }

                    const childBarcodeExists = await tx.product.findUnique({
                        where: { barcode: child.barcode },
                    });

                    if (childBarcodeExists && childBarcodeExists.id !== existingChild?.id) {
                        throw new BadRequestException(`El código de barras ya está registrado para el producto: ${childBarcodeExists.name}`);
                    }
                }

                const data: any = { ...productData };

                if (child) {
                    data.isDetail = false;
                    data.parentId = null;
                } else if (data.parentId != null) {
                    data.isDetail = true;
                } else if (data.isDetail === true) {
                    throw new BadRequestException('Un producto detalle debe tener un producto padre asociado.');
                } else if (data.isDetail === false) {
                    data.parentId = null;
                }

                if (existingChild && data.isDetail === true) {
                    throw new BadRequestException('El producto tiene un producto detalle asociado y no puede convertirse en detalle.');
                }

                if (product.parentId != null && data.parentId == null && data.isDetail === false) {
                    throw new BadRequestException('No se permite desvincular un producto detalle desde la edición.');
                }

                if (Object.keys(data).length > 0) {
                    await tx.product.update({
                        where: { id },
                        data,
                    });
                }

                if (child) {
                    const childData = {
                        name: child.name,
                        presentation: child.presentation,
                        barcode: child.barcode,
                        price: child.price,
                        purchasePrice: child.purchasePrice ?? 0,
                        stock: child.stock,
                        currency: productData.currency ?? product.currency,
                        isDetail: true,
                        parentId: id,
                        unitsDetail: null,
                    };

                    if (existingChild) {
                        await tx.product.update({
                            where: { id: existingChild.id },
                            data: childData,
                        });
                    } else {
                        await tx.product.create({
                            data: childData,
                        });
                    }

                    const unitsDetail = Math.max(
                        1,
                        Number(updateProductDto.unitsDetail ?? product.unitsDetail ?? 1),
                    );

                    await tx.product.update({
                        where: { id },
                        data: { unitsDetail },
                    });
                }

                // 3. Devolver el producto con sus relaciones actualizadas
                const updatedProduct = await tx.product.findUnique({
                    where: { id },
                    include: {
                        productParent: true,
                        productChild: {
                            where: { deleted: false },
                            orderBy: { createdAt: 'asc' },
                        },
                    },
                });

                return {
                    message: 'Producto actualizado correctamente',
                    data: updatedProduct,
                };
            });
        } catch (error: any) {
            throw error;
        }
    }

        async validatePassword({ password }: { password: string }): Promise<boolean> {
        if (password !== process.env.PASSWORD_ADMIN) {
            throw new BadRequestException('Contraseña de administrador incorrecta');
        }
        return true;
    }

    async deleteProduct(deleteProduct: DeleteProductDto) {
        try {
            if (deleteProduct.password !== process.env.PASSWORD_ADMIN) {
                throw new BadRequestException('Contraseña de administrador incorrecta');
            }

            const exists = await this.prismaService.product.findUnique({
                where: { id: deleteProduct.id },
                include: {
                    productChild: {
                        where: { deleted: false },
                    },
                },
            });

            if (!exists) {
                throw new NotFoundException(`Producto con id ${deleteProduct.id} no encontrado`);
            }

            if (exists.productChild.length > 0) {
                throw new BadRequestException('No se puede eliminar un producto padre que tiene un producto detalle asociado. Elimina primero el producto detalle.');
            }

            const product = await this.prismaService.$transaction(async (tx) => {
                const deletedProduct = await tx.product.update({
                    where: { id: deleteProduct.id },
                    data: { deleted: true },
                });

                if (exists.parentId) {
                    await tx.product.update({
                        where: { id: exists.parentId },
                        data: { unitsDetail: null },
                    });
                }

                return deletedProduct;
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
            if (Number(parent.stock) <= 0) {
                throw new BadRequestException(`No hay stock disponible en ${parent.name} para desglosar.`);
            }

            const unitsDetail = Number(parent.unitsDetail ?? 0);
            if (!Number.isFinite(unitsDetail) || unitsDetail <= 0) {
                throw new BadRequestException(`El producto ${parent.name} no tiene configuradas las unidades por detalle. Edita el producto padre y define ese valor.`);
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
                    data: { stock: { increment: unitsDetail } },
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
                        quantity: unitsDetail,
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
