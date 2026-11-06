import { BadRequestException, Controller, Get, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ClientExcel, INVENTORY_ENTRY_HEADER_MAP, InventoryEntryExcel, ProductExcel, PRODUCT_HEADER_MAP } from './excel.interface';
import { ExcelService } from './excel.service';
import { Response } from 'express';

@Controller('excel')
export class ExcelController {

    constructor(
        private readonly excelService: ExcelService,
    ) {

    }

    @Get('/products/template')
    async downloadProductTemplate(@Res() res: Response) {
        return await this.excelService.downloadProductTemplate(res);
    }

    @Post('/clients/upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadClientExcel(@UploadedFile() file: { buffer: Buffer }) {
        if (!file?.buffer) {
            throw new BadRequestException('Archivo no enviado');
        }

        const clientsData: ClientExcel[] = this.parseExcelToJson(file.buffer, 0) as ClientExcel[];

        return this.excelService.uploadClientsExcel(clientsData);
    }

    @Post('/products/upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadProductExcel(@UploadedFile() file: { buffer: Buffer }, @CurrentUser() user?: { id?: number }) {
        if (!file?.buffer) {
            throw new BadRequestException('Archivo no enviado');
        }

        const productsData: ProductExcel[] = this.parseSheetByName(
            file.buffer,
            'Productos',
            PRODUCT_HEADER_MAP,
        ) as ProductExcel[];

        return this.excelService.uploadProductsExcel(productsData, user?.id);
    }

    @Post('/inventory-entries/upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadInventoryEntryExcel(
        @UploadedFile() file: { buffer: Buffer },
        @CurrentUser() user?: { id?: number },
    ) {
        if (!file?.buffer) {
            throw new BadRequestException('Archivo no enviado');
        }

        const productsData: ProductExcel[] = this.parseSheetByName(
            file.buffer,
            'Productos',
            PRODUCT_HEADER_MAP,
            false,
        ) as ProductExcel[];

        const entryRows: InventoryEntryExcel[] = this.parseSheetByName(
            file.buffer,
            'Entrada',
            INVENTORY_ENTRY_HEADER_MAP,
            false,
        ) as InventoryEntryExcel[];

        return this.excelService.uploadInventoryEntryExcel(
            entryRows[0] ?? {},
            productsData,
            user?.id,
        );
    }

    parseExcelToJson(fileBuffer: Buffer, indexFile: number, headerMap?: Record<string, string>) {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
        const sheetName = workbook.SheetNames[indexFile];
        return this.parseSheet(workbook.Sheets[sheetName], headerMap);
    }

    parseSheetByName(
        fileBuffer: Buffer,
        sheetName: string,
        headerMap?: Record<string, string>,
        fallbackToFirstSheet = true,
    ) {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
        const sheet = workbook.Sheets[sheetName]
            ?? (fallbackToFirstSheet ? workbook.Sheets[workbook.SheetNames[0]] : undefined);

        if (!sheet) {
            throw new BadRequestException(`El archivo no contiene la hoja "${sheetName}"`);
        }

        return this.parseSheet(sheet, headerMap);
    }

    private parseSheet(sheet: XLSX.WorkSheet | undefined, headerMap?: Record<string, string>) {
        if (!sheet) {
            return [];
        }

        const normalizedHeaderMap = new Map(
            Object.entries(headerMap ?? {}).map(([key, value]) => [this.normalizeHeader(key), value]),
        );

        const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: null,
        });

        const cleanedData = rawData
            .map((row) => {
                return Object.fromEntries(
                    Object.entries(row)
                        .filter(([key, value]) => {
                            const isEmptyColumn = key.startsWith('__');
                            if (isEmptyColumn) {
                                return false;
                            }

                            return value !== null && value !== '';
                        })
                        .map(([key, value]) => {
                            const mappedKey = headerMap?.[key]
                                ?? normalizedHeaderMap.get(this.normalizeHeader(key))
                                ?? key;

                            return [mappedKey, value];
                        }),
                );
            })
            .filter((row) => Object.keys(row).length > 0);

        return Array.isArray(cleanedData) ? cleanedData : Object.values(cleanedData);
    }

    private normalizeHeader(value: string) {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\?/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }
}
