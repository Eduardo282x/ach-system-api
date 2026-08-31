import { Controller, Get, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { ClientExcel, ProductExcel, PRODUCT_HEADER_MAP } from './excel.interface';
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
        const clientsData: ClientExcel[] = this.parseExcelToJson(file.buffer, 0) as ClientExcel[];
        
        return this.excelService.uploadClientsExcel(clientsData);
    }

    @Post('/products/upload')
    @UseInterceptors(FileInterceptor('file'))
    uploadProductExcel(@UploadedFile() file: { buffer: Buffer }) {
        const productsData: ProductExcel[] = this.parseExcelToJson(file.buffer, 0, PRODUCT_HEADER_MAP) as ProductExcel[];
        return this.excelService.uploadProductsExcel(productsData);
    }

    parseExcelToJson(fileBuffer: Buffer, indexFile: number, headerMap?: Record<string, string>) {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[indexFile];
        const sheet = workbook.Sheets[sheetName];

        const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: null,
        });

        const cleanedData = rawData.map((row) => {
            const cleanedRow = Object.fromEntries(
                Object.entries(row)
                    .filter(([key, value]) => {
                        const isEmptyColumn = key.startsWith('__EMPTY');
                        if (isEmptyColumn) {
                            return false;
                        }

                        return value !== null && value !== '';
                    })
                    .map(([key, value]) => [headerMap?.[key] ?? key, value]),
            );

            return cleanedRow;
        });

        return Array.isArray(cleanedData) ? cleanedData : Object.values(cleanedData);
    };
}
