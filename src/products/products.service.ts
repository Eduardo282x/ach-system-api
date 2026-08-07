import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
    UnauthorizedException,
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

export interface InventoryHistoryQuery {
    page: number;
    size: number;
    startDate?: string;
    endDate?: string;
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
        return new Date(`${date}T00:00:00.000Z`);
    }

    private getEndOfDayUtc(date: string) {
        return new Date(`${date}T23:59:59.999Z`);
    }

    async getInventoryHistory(query: InventoryHistoryQuery) {
        const { page, size, startDate, endDate } = query;
        const where: any = {};
        const skip = (page - 1) * size;
        const take = size;

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

    private normalizeString(value: string): string {
        return value.trim().replace(/\s+/g, ' ');
    }

    private toTitleCase(value: string): string {
        return value.replace(/\b\w/g, char => char.toUpperCase());
    }

    private async resolveBrand(value: string): Promise<string> {
        const normalized = this.normalizeString(value);
        const existing = await this.prismaService.product.findFirst({
            where: { brand: { equals: normalized, mode: 'insensitive' }, deleted: false },
            select: { brand: true },
        });
        return existing ? existing.brand : this.toTitleCase(normalized);
    }

    private async resolveType(value: string): Promise<string> {
        const normalized = this.normalizeString(value);
        const existing = await this.prismaService.product.findFirst({
            where: { type: { equals: normalized, mode: 'insensitive' }, deleted: false },
            select: { type: true },
        });
        return existing ? existing.type : this.toTitleCase(normalized);
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
            // 1. Verificar si el código de barras ya existe
            const exists = await this.prismaService.product.findUnique({
                where: { barcode: createProductDto.barcode },
            });

            if (exists) {
                throw new BadRequestException('El código de barras ya está registrado para el producto: ' + exists.name);
            }

            // 2. Normalizar brand y type
            const [resolvedBrand, resolvedType] = await Promise.all([
                this.resolveBrand(createProductDto.brand),
                this.resolveType(createProductDto.type),
            ]);

            if (createProductDto.discountPrice !== undefined && createProductDto.discountPrice > createProductDto.price) {
                throw new BadRequestException(
                    'El precio de descuento no puede ser mayor al precio del producto',
                );
            }

            // 3. Crear el producto
            const newProduct = await this.prismaService.product.create({
                data: {
                    name: createProductDto.name,
                    presentation: createProductDto.presentation,
                    barcode: createProductDto.barcode,
                    price: createProductDto.price,
                    discountPrice: createProductDto.discountPrice,
                    currency: createProductDto.currency,
                    stock: createProductDto.stock,
                    serialNumber: createProductDto.serialNumber,
                    lote: createProductDto.lote,
                    brand: resolvedBrand,
                    type: resolvedType,
                    description: createProductDto.description,
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

            // 2. Normalizar brand y type
            const [resolvedBrand, resolvedType] = await Promise.all([
                this.resolveBrand(updateProductDto.brand),
                this.resolveType(updateProductDto.type),
            ]);

            if (updateProductDto.discountPrice !== undefined && updateProductDto.discountPrice > updateProductDto.price) {
                throw new BadRequestException(
                    'El precio de descuento no puede ser mayor al precio del producto',
                );
            }

            // 3. Actualizar
            const updatedProduct = await this.prismaService.product.update({
                where: { id },
                data: {
                    name: updateProductDto.name,
                    presentation: updateProductDto.presentation,
                    barcode: updateProductDto.barcode,
                    price: updateProductDto.price,
                    discountPrice: updateProductDto.discountPrice,
                    currency: updateProductDto.currency,
                    stock: updateProductDto.stock,
                    serialNumber: updateProductDto.serialNumber,
                    lote: updateProductDto.lote,
                    brand: resolvedBrand,
                    type: resolvedType,
                    description: updateProductDto.description,
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

    async validatePassword({ password }: { password: string }): Promise<boolean> {
        if (password !== process.env.PASSWORD_ADMIN) {
            throw new UnauthorizedException('Contraseña de administrador incorrecta');
        }
        return true;
    }

    async deleteProduct({ id, password }: { id: number, password: string }) {
        try {
            const exists = await this.prismaService.product.findUnique({
                where: { id },
            });

            if(password !== process.env.PASSWORD_ADMIN) {
                throw new UnauthorizedException('Contraseña de administrador incorrecta');
            } 

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

    async getProductAttributes() {
        const [brands, types] = await Promise.all([
            this.prismaService.product.findMany({
                where: { deleted: false },
                distinct: ['brand'],
                select: { brand: true },
            }),
            this.prismaService.product.findMany({
                where: { deleted: false },
                distinct: ['type'],
                select: { type: true },
            }),
        ]);

        return {
            brands: brands.map(b => b.brand).sort(),
            types: types.map(t => t.type).sort(),
        };
    }
}
