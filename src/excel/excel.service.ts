import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
    ImportSummary,
    InventoryEntryExcel,
    ProductExcel,
} from './excel.interface';
import { ProductsService } from 'src/products/products.service';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import * as XLSX from 'xlsx';
import { parseDateOnly } from 'src/common/utils/time.util';

const NAME_SIMILARITY_THRESHOLD = 0.85;

type ProductRecord = {
    id: number;
    name: string;
    presentation: string;
    barcode: string;
    price: any;
    purchasePrice: any;
    stock: any;
    deleted: boolean;
};

type ImportMode = 'catalog' | 'entry';

interface PreparedRow {
    row: number;
    name: string;
    presentation: string;
    barcode: string;
    barcodeProvided: boolean;
    price?: number;
    purchasePrice?: number;
    quantity: number;
}

interface ImportContext {
    mode: ImportMode;
    userId?: number;
    controlNumber?: string;
    entryId?: number;
    tx: any;
    byBarcode: Map<string, ProductRecord>;
    products: ProductRecord[];
    summary: ImportSummary;
}

@Injectable()
export class ExcelService {

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(forwardRef(() => ProductsService))
        private readonly productsService: ProductsService,
    ) {

    }

    async uploadClientsExcel(clients: any[]) {
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
            };
        } catch (error) {
            throw error;
        }
    }

    async uploadProductsExcel(products: ProductExcel[], userId?: number) {
        try {
            const rows = products.map((product, index) => this.prepareRow(product, index + 2));
            const result = await this.prismaService.$transaction(async (tx) => {
                const context = await this.buildContext('catalog', tx, userId);
                await this.processRows(rows, context, true);
                return context.summary;
            });

            return {
                message: this.buildImportMessage('Productos procesados', result),
                ...result,
            };
        } catch (error) {
            throw error;
        }
    }

    async uploadInventoryEntryExcel(
        entry: InventoryEntryExcel,
        products: ProductExcel[],
        userId?: number,
    ) {
        const controlNumber = this.toStringValue(entry?.controlNumber).trim();
        const title = this.toStringValue(entry?.title).trim();
        const description = this.toStringValue(entry?.description).trim();

        if (!controlNumber) {
            throw new BadRequestException('La hoja Entrada debe tener un N° de Control');
        }

        const parsedDate = this.parseExcelDate(entry?.date);

        if (!parsedDate) {
            throw new BadRequestException('La hoja Entrada debe tener una fecha válida (YYYY-MM-DD)');
        }

        const rows = products.map((product, index) => this.prepareRow(product, index + 2));

        if (rows.length === 0) {
            throw new BadRequestException('La hoja Productos no contiene filas para la entrada');
        }

        const result = await this.prismaService.$transaction(async (tx) => {
            const duplicate = await tx.inventoryEntry.findUnique({
                where: { controlNumber },
            });

            if (duplicate) {
                throw new BadRequestException(
                    `Ya existe una entrada con el número de control ${controlNumber}`,
                );
            }

            const context = await this.buildContext('entry', tx, userId, controlNumber);
            const inventoryEntry = await tx.inventoryEntry.create({
                data: {
                    controlNumber,
                    title,
                    description,
                    date: parsedDate,
                    userId: userId ?? null,
                },
            });

            context.entryId = inventoryEntry.id;

            await this.processRows(rows, context, true);

            if (context.summary.errors.length > 0) {
                throw new BadRequestException(
                    `No se pudo crear la entrada. ${context.summary.errors
                        .map((error) => `Fila ${error.row}: ${error.reason}`)
                        .join(' | ')}`,
                );
            }

            return {
                entry: inventoryEntry,
                summary: context.summary,
            };
        });

        return {
            message: this.buildImportMessage('Entrada de inventario creada', result.summary),
            entry: result.entry,
            summary: result.summary,
        };
    }

    async downloadProductTemplate(res: Response) {
        try {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'ACH System';
            workbook.created = new Date();

            const productsSheet = workbook.addWorksheet('Productos');
            productsSheet.addRow([
                'Nombre',
                'Presentación',
                'Código de Barras',
                'Precio de Compra',
                'Precio de Venta',
                'Cantidad',
            ]);
            productsSheet.getRow(1).font = { bold: true };
            productsSheet.views = [{ state: 'frozen', ySplit: 1 }];
            productsSheet.columns = [
                { width: 32 },
                { width: 20 },
                { width: 22 },
                { width: 16 },
                { width: 16 },
                { width: 12 },
            ];
            productsSheet.getColumn(3).numFmt = '@';

            const entrySheet = workbook.addWorksheet('Entrada');
            entrySheet.addRow(['N° Control', 'Título', 'Descripción', 'Fecha']);
            entrySheet.getRow(1).font = { bold: true };
            entrySheet.views = [{ state: 'frozen', ySplit: 1 }];
            entrySheet.columns = [
                { width: 18 },
                { width: 30 },
                { width: 40 },
                { width: 16 },
            ];

            const instructionsSheet = workbook.addWorksheet('Instrucciones');
            instructionsSheet.columns = [{ width: 110 }];
            instructionsSheet.addRow(['Cómo usar esta plantilla']).font = { bold: true, size: 14 };
            instructionsSheet.addRow([]);
            instructionsSheet.addRow([
                '1. Para cargar o actualizar productos, complete la hoja "Productos" y use la opción "Cargar productos".',
            ]);
            instructionsSheet.addRow([
                '2. Para crear una entrada de inventario, complete la hoja "Entrada" y la hoja "Productos", y use la opción "Cargar entrada de inventario".',
            ]);
            instructionsSheet.addRow([
                '3. Si el código de barras ya existe y el nombre del producto es similar (85% o más), el producto se actualiza y la cantidad se suma al stock.',
            ]);
            instructionsSheet.addRow([
                '4. Si el código de barras ya existe pero el nombre es muy diferente, la fila se reporta como conflicto y no se sobrescribe.',
            ]);
            instructionsSheet.addRow([
                '5. "Precio de Compra" es el costo del producto. "Precio de Venta" es el precio que se cobra al cliente.',
            ]);
            instructionsSheet.addRow([
                '6. Si deja el código de barras vacío, el sistema generará uno automáticamente.',
            ]);
            instructionsSheet.addRow([
                '7. Mantenga la columna "Código de Barras" en formato texto para no perder ceros a la izquierda.',
            ]);
            instructionsSheet.eachRow((row, rowNumber) => {
                row.alignment = { vertical: 'middle', wrapText: true };
                if (rowNumber === 1) {
                    row.font = { bold: true, size: 14 };
                }
            });

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
            };
        }
    }

    private async buildContext(
        mode: ImportMode,
        tx: any,
        userId?: number,
        controlNumber?: string,
    ): Promise<ImportContext> {
        const products = await tx.product.findMany({
            select: {
                id: true,
                name: true,
                presentation: true,
                barcode: true,
                price: true,
                purchasePrice: true,
                stock: true,
                deleted: true,
            },
        });

        const byBarcode = new Map<string, ProductRecord>();
        for (const product of products) {
            byBarcode.set(product.barcode, product);
        }

        return {
            mode,
            userId,
            controlNumber,
            tx,
            byBarcode,
            products,
            summary: {
                created: 0,
                updated: 0,
                skipped: 0,
                errors: [],
                products: [],
            },
        };
    }

    private async processRows(rows: PreparedRow[], context: ImportContext, allowPartial: boolean) {
        for (const row of rows) {
            try {
                await this.processRow(row, context);
            } catch (error: any) {
                if (!allowPartial) {
                    throw error;
                }

                context.summary.errors.push({
                    row: row.row,
                    barcode: row.barcode || undefined,
                    name: row.name || undefined,
                    reason: error?.message || 'Error al procesar la fila',
                });
            }
        }

        context.summary.skipped = context.summary.errors.length;
    }

    private async processRow(row: PreparedRow, context: ImportContext) {
        if (!row.name) {
            throw new BadRequestException('El nombre del producto es obligatorio');
        }

        if (context.mode === 'entry' && row.quantity <= 0) {
            throw new BadRequestException('La cantidad debe ser mayor a 0');
        }

        let existing: ProductRecord | undefined;

        if (row.barcodeProvided && row.barcode) {
            const byBarcode = context.byBarcode.get(row.barcode);

            if (byBarcode) {
                const score = this.similarity(row.name, byBarcode.name);

                if (score < NAME_SIMILARITY_THRESHOLD) {
                    throw new BadRequestException(
                        `El código ${row.barcode} ya pertenece a "${byBarcode.name}" y el nombre no es similar`,
                    );
                }

                existing = byBarcode;
            } else {
                const nameMatch = this.findBestNameMatch(row.name, context.products);

                if (nameMatch) {
                    throw new BadRequestException(
                        `Ya existe un producto con nombre similar: "${nameMatch.name}" (${nameMatch.barcode}). Verifique el código de barras`,
                    );
                }
            }
        } else {
            existing = this.findBestNameMatch(row.name, context.products);
        }

        if (existing) {
            await this.updateExistingProduct(row, existing, context);
            return;
        }

        await this.createProduct(row, context);
    }

    private async updateExistingProduct(
        row: PreparedRow,
        existing: ProductRecord,
        context: ImportContext,
    ) {
        const previous = this.toChangeSnapshot(existing);
        const price = row.price ?? Number(existing.price);
        const purchasePrice = row.purchasePrice ?? Number(existing.purchasePrice);

        const updated = await context.tx.product.update({
            where: { id: existing.id },
            data: {
                name: row.name,
                presentation: row.presentation || existing.presentation,
                price,
                purchasePrice,
                stock: { increment: row.quantity },
                deleted: false,
            },
        });

        Object.assign(existing, updated);

        await this.registerImportMovement(row, existing, context);

        if (context.mode === 'entry') {
            await this.createEntryDetail(row, existing, context, purchasePrice, price);
        }

        context.summary.updated++;
        context.summary.products.push({
            barcode: updated.barcode,
            name: updated.name,
            action: 'updated',
            quantityAdded: row.quantity,
            previous,
            current: this.toChangeSnapshot(updated),
        });
    }

    private async createProduct(row: PreparedRow, context: ImportContext) {
        let barcode = row.barcode;

        if (!barcode) {
            let attempts = 0;

            do {
                barcode = await this.productsService.generateBarCode();
                attempts++;
            } while (context.byBarcode.has(barcode) && attempts < 20);

            if (context.byBarcode.has(barcode)) {
                throw new BadRequestException('No se pudo generar un código de barras único');
            }
        }

        const price = row.price ?? 0;
        const purchasePrice = row.purchasePrice ?? 0;

        const created = await context.tx.product.create({
            data: {
                name: row.name,
                presentation: row.presentation,
                barcode,
                price,
                purchasePrice,
                stock: row.quantity,
                isDetail: false,
                parentId: null,
                unitsDetail: null,
            },
        });

        const record: ProductRecord = {
            id: created.id,
            name: created.name,
            presentation: created.presentation,
            barcode: created.barcode,
            price: created.price,
            purchasePrice: created.purchasePrice,
            stock: created.stock,
            deleted: created.deleted,
        };

        context.byBarcode.set(record.barcode, record);
        context.products.push(record);

        await this.registerImportMovement(row, record, context);

        if (context.mode === 'entry') {
            await this.createEntryDetail(row, record, context, purchasePrice, price);
        }

        context.summary.created++;
        context.summary.products.push({
            barcode: record.barcode,
            name: record.name,
            action: 'created',
            quantityAdded: row.quantity,
            current: this.toChangeSnapshot(record),
        });
    }

    private async registerImportMovement(
        row: PreparedRow,
        product: ProductRecord,
        context: ImportContext,
    ) {
        if (!context.userId || row.quantity <= 0) {
            return;
        }

        await context.tx.inventoryMovement.create({
            data: {
                productId: product.id,
                quantity: row.quantity,
                type: context.mode === 'entry' ? 'RESTOCK' : 'ADJUSTMENT',
                reason: context.mode === 'entry'
                    ? `Entrada de inventario N° ${context.controlNumber}`
                    : 'Carga o actualización masiva por Excel',
                userId: context.userId,
            },
        });
    }

    private async createEntryDetail(
        row: PreparedRow,
        product: ProductRecord,
        context: ImportContext,
        purchasePrice: number,
        salePrice: number,
    ) {
        if (!context.entryId) {
            return;
        }

        await context.tx.inventoryEntryDetail.create({
            data: {
                inventoryEntryId: context.entryId,
                productId: product.id,
                quantity: row.quantity,
                unitPrice: purchasePrice,
                salePrice,
                subtotal: this.toMoney(row.quantity * purchasePrice),
            },
        });
    }

    private prepareRow(product: ProductExcel, rowNumber: number): PreparedRow {
        const rawBarcode = this.toStringValue(product?.barcode).trim();
        const quantity = this.toQuantity(product?.stock);

        return {
            row: rowNumber,
            name: this.toStringValue(product?.name).trim(),
            presentation: this.toStringValue(product?.presentation).trim(),
            barcode: rawBarcode.replace(/\s+/g, ''),
            barcodeProvided: rawBarcode.length > 0,
            price: this.toOptionalNumber(product?.price),
            purchasePrice: this.toOptionalNumber(product?.purchasePrice),
            quantity,
        };
    }

    private findBestNameMatch(name: string, products: ProductRecord[]) {
        let best: ProductRecord | undefined;
        let bestScore = 0;

        for (const product of products) {
            if (product.deleted) {
                continue;
            }

            const score = this.similarity(name, product.name);

            if (score > bestScore) {
                best = product;
                bestScore = score;
            }
        }

        return bestScore >= NAME_SIMILARITY_THRESHOLD ? best : undefined;
    }

    private similarity(a: string, b: string) {
        const normalizedA = this.normalizeName(a);
        const normalizedB = this.normalizeName(b);

        if (!normalizedA || !normalizedB) {
            return 0;
        }

        if (normalizedA === normalizedB) {
            return 1;
        }

        const distance = this.levenshtein(normalizedA, normalizedB);
        const ratio = 1 - distance / Math.max(normalizedA.length, normalizedB.length);

        const tokensA = new Set(normalizedA.split(' ').filter(Boolean));
        const tokensB = new Set(normalizedB.split(' ').filter(Boolean));
        const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
        const union = new Set([...tokensA, ...tokensB]).size;
        const jaccard = union > 0 ? intersection / union : 0;

        return Math.max(ratio, jaccard);
    }

    private normalizeName(value: string) {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    private levenshtein(a: string, b: string) {
        if (a === b) return 0;
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

        for (let i = 0; i < a.length; i++) {
            const current = [i + 1];

            for (let j = 0; j < b.length; j++) {
                const insertion = current[j] + 1;
                const deletion = previous[j + 1] + 1;
                const substitution = previous[j] + (a[i] === b[j] ? 0 : 1);
                current.push(Math.min(insertion, deletion, substitution));
            }

            previous = current;
        }

        return previous[b.length];
    }

    private toChangeSnapshot(product: ProductRecord) {
        return {
            name: product.name,
            presentation: product.presentation,
            barcode: product.barcode,
            price: Number(product.price),
            purchasePrice: Number(product.purchasePrice ?? 0),
            stock: Number(product.stock),
        };
    }

    private toStringValue(value: unknown) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value);
    }

    private toOptionalNumber(value: unknown): number | undefined {
        if (value === null || value === undefined || value === '') {
            return undefined;
        }

        const parsed = Number(value);

        if (!Number.isFinite(parsed) || parsed < 0) {
            return undefined;
        }

        return this.toMoney(parsed);
    }

    private toQuantity(value: unknown) {
        const parsed = Number(value);

        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }

        return Math.round(parsed * 1000) / 1000;
    }

    private toMoney(value: number) {
        return Math.round(value * 100) / 100;
    }

    private parseExcelDate(value: unknown): Date | null {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return parseDateOnly(this.formatDateValue(value));
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            const parsed = XLSX.SSF.parse_date_code(value);

            if (!parsed) {
                return null;
            }

            const dateString = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
            return parseDateOnly(dateString);
        }

        const text = String(value).trim();

        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            return parseDateOnly(text);
        }

        const date = new Date(text);

        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return parseDateOnly(this.formatDateValue(date));
    }

    private formatDateValue(date: Date) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private buildImportMessage(prefix: string, summary: ImportSummary) {
        return `${prefix}: ${summary.created} creados, ${summary.updated} actualizados, ${summary.skipped} omitidos`;
    }
}
