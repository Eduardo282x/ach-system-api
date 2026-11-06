export interface ClientExcel {
    name: string;
    phone: string;
    identify: string;
}

export interface ProductExcel {
    name?: string;
    presentation?: string;
    barcode?: string | number;
    price?: number | string;
    purchasePrice?: number | string;
    stock?: number | string;
}

export interface InventoryEntryExcel {
    controlNumber?: string;
    title?: string;
    description?: string;
    date?: string | Date | number;
}

export interface ImportedProductChange {
    barcode: string;
    name: string;
    action: 'created' | 'updated';
    quantityAdded: number;
    previous?: {
        name: string;
        presentation: string;
        barcode: string;
        price: number;
        purchasePrice: number;
        stock: number;
    };
    current: {
        name: string;
        presentation: string;
        barcode: string;
        price: number;
        purchasePrice: number;
        stock: number;
    };
}

export interface ImportError {
    row: number;
    barcode?: string;
    name?: string;
    reason: string;
}

export interface ImportSummary {
    created: number;
    updated: number;
    skipped: number;
    errors: ImportError[];
    products: ImportedProductChange[];
}

export interface InventoryEntryImportResult {
    entry: {
        id: number;
        controlNumber: string;
        title: string;
        description: string;
        date: Date;
    };
    summary: ImportSummary;
}

export const PRODUCT_HEADER_MAP: Record<string, string> = {
    'Nombre': 'name',
    'Presentación': 'presentation',
    'Presentacion': 'presentation',
    'Código de Barras': 'barcode',
    'Codigo de Barras': 'barcode',
    'Código': 'barcode',
    'Codigo': 'barcode',
    'Precio': 'price',
    'Precio de Venta': 'price',
    'Precio Venta': 'price',
    'Precio de Compra': 'purchasePrice',
    'Precio Compra': 'purchasePrice',
    'Cantidad': 'stock',
};

export const INVENTORY_ENTRY_HEADER_MAP: Record<string, string> = {
    'N° Control': 'controlNumber',
    'N Control': 'controlNumber',
    'Número de Control': 'controlNumber',
    'Numero de Control': 'controlNumber',
    'Control': 'controlNumber',
    'Título': 'title',
    'Titulo': 'title',
    'Descripción': 'description',
    'Descripcion': 'description',
    'Fecha': 'date',
};
