import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { endOfDay, parseDateOnly, startOfDay } from 'src/common/utils/time.util';
import { CreateInventoryEntryDetailDto, CreateInventoryEntryDto, GetInventoryEntriesFilterDto } from './inventory.dto';

@Injectable()
export class InventoryService {

    constructor(private readonly prismaService: PrismaService) { }

    private getStartOfDayUtc(date: string) {
        return startOfDay(date);
    }

    private getEndOfDayUtc(date: string) {
        return endOfDay(date);
    }

    async getInventoryEntries(filter: GetInventoryEntriesFilterDto) {
        const { search, startDate, endDate, page = 1, size = 20 } = filter;
        const skip = (page - 1) * size;
        const take = size;
        const where: any = {};

        if (search) {
            where.OR = [
                { controlNumber: { contains: search, mode: 'insensitive' } },
                { title: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (startDate && endDate) {
            const start = this.getStartOfDayUtc(startDate);
            const end = this.getEndOfDayUtc(endDate);

            where.date = {
                gte: start,
                lte: end,
            };
        }

        try {
            const [inventoryEntries, totalElements] = await Promise.all([
                this.prismaService.inventoryEntry.findMany({
                    where,
                    orderBy: {
                        date: 'desc',
                    },
                    skip,
                    take,
                    include: {
                        inventoryEntryDetails: {
                            include: {
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        presentation: true,
                                        barcode: true,
                                        price: true,
                                        purchasePrice: true,
                                    },
                                },
                            },
                        },
                    },
                }),
                this.prismaService.inventoryEntry.count({ where }),
            ]);

            return {
                inventoryEntries,
                pagination: {
                    page,
                    size,
                    total: totalElements,
                    totalPages: Math.ceil(totalElements / size),
                },
            };
        } catch (error) {
            throw error;
        }
    }

    async getInventoryEntryById(id: number) {
        try {
            const inventoryEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { id },
                include: {
                    inventoryEntryDetails: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    presentation: true,
                                    barcode: true,
                                    price: true,
                                    purchasePrice: true,
                                },
                            },
                        },
                    },
                },
            });

            if (!inventoryEntry) {
                throw new NotFoundException(`Entrada de inventario con ID ${id} no encontrada`);
            }

            return {
                data: inventoryEntry,
            };
        } catch (error) {
            throw error;
        }
    }

    async saveInventoryEntry(createInventoryEntryDto: CreateInventoryEntryDto, userId: number) {
        try {
            const { controlNumber, title = '', description = '', date, details } = createInventoryEntryDto;

            const existingEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { controlNumber },
            });

            if (existingEntry) {
                throw new BadRequestException(`Ya existe una entrada con el número de control ${controlNumber}`);
            }

            const productIds = details.map((detail) => detail.productId);

            if (productIds.length !== new Set(productIds).size) {
                throw new BadRequestException(
                    'Un producto está repetido en el detalle. Agrupe las cantidades antes de guardar.',
                );
            }

            const products = await this.prismaService.product.findMany({
                where: { id: { in: productIds }, deleted: false },
                select: { id: true },
            });

            if (products.length !== productIds.length) {
                throw new BadRequestException('Uno o más productos del detalle no existen');
            }

            const parsedDate = parseDateOnly(date);

            if (Number.isNaN(parsedDate.getTime())) {
                throw new BadRequestException('Formato de fecha inválido. Use YYYY-MM-DD');
            }

            const result = await this.prismaService.$transaction(async (tx) => {
                const inventoryEntry = await tx.inventoryEntry.create({
                    data: {
                        controlNumber,
                        title,
                        description,
                        date: parsedDate,
                        userId,
                    },
                });

                const inventoryEntryDetails: any[] = [];

                for (const detail of details as CreateInventoryEntryDetailDto[]) {
                    const subtotal = Number(detail.quantity) * Number(detail.unitPrice);
                    const salePrice =
                        detail.salePrice !== undefined && detail.salePrice !== null
                            ? Number(detail.salePrice)
                            : undefined;

                    await tx.product.update({
                        where: { id: detail.productId },
                        data: {
                            stock: { increment: detail.quantity },
                            purchasePrice: detail.unitPrice,
                            ...(salePrice !== undefined && { price: salePrice }),
                        },
                    });

                    await tx.inventoryMovement.create({
                        data: {
                            productId: detail.productId,
                            quantity: detail.quantity,
                            type: 'RESTOCK',
                            reason: `Entrada de inventario N° ${controlNumber}`,
                            userId,
                        },
                    });

                    const createdDetail = await tx.inventoryEntryDetail.create({
                        data: {
                            inventoryEntryId: inventoryEntry.id,
                            productId: detail.productId,
                            quantity: detail.quantity,
                            unitPrice: detail.unitPrice,
                            salePrice: salePrice ?? null,
                            subtotal,
                        },
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    name: true,
                                    barcode: true,
                                    price: true,
                                    purchasePrice: true,
                                },
                            },
                        },
                    });

                    inventoryEntryDetails.push(createdDetail);
                }

                return {
                    ...inventoryEntry,
                    inventoryEntryDetails,
                };
            });

            return {
                message: 'Entrada de inventario guardada correctamente',
                data: result,
            };
        } catch (error) {
            throw error;
        }
    }
}