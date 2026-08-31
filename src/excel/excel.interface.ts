export interface ClientExcel {
    name: string;
    phone: string;
    identify: string;
}

export interface ProductExcel {
    name: string;
    presentation: string;
    barcode: string;
    price: number;
    stock: number;
}

export const PRODUCT_HEADER_MAP: Record<string, string> = {
    'Nombre': 'name',
    'Presentación': 'presentation',
    'Código de Barras': 'barcode',
    'Precio': 'price',
    'Cantidad': 'stock',
};