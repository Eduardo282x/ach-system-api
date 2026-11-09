import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { ExchangeRateType } from 'src/generated/prisma/enums';

export class ProductDto {
    @IsString()
    @IsNotEmpty({ message: 'El nombre del producto es obligatorio' })
    name!: string;

    @IsString()
    presentation!: string;

    @IsString()
    @MinLength(3, { message: 'El código de barras debe tener al menos 3 caracteres' })
    @MaxLength(16, { message: 'El código de barras no puede exceder los 16 caracteres' })
    @IsNotEmpty()
    barcode!: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio debe ser un número positivo' })
    price!: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio de compra debe ser un número positivo' })
    purchasePrice?: number;

    @IsOptional()
    @IsEnum(ExchangeRateType)
    currency?: ExchangeRateType;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 3 })
    @Min(0, { message: 'El stock debe ser un número positivo' })
    stock!: number;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isDetail?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    parentId?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    unitsDetail?: number;
}

export class ProductChildDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    id?: number;

    @IsString()
    @IsNotEmpty({ message: 'El nombre del producto detalle es obligatorio' })
    name!: string;

    @IsString()
    presentation!: string;

    @IsString()
    @MinLength(3, { message: 'El código de barras debe tener al menos 3 caracteres' })
    @MaxLength(16, { message: 'El código de barras no puede exceder los 16 caracteres' })
    @IsNotEmpty()
    barcode!: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio debe ser un número positivo' })
    price!: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio de compra debe ser un número positivo' })
    purchasePrice?: number;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 3 })
    @Min(0, { message: 'El stock debe ser un número positivo' })
    stock!: number;
}

export class UpdateProductDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'El nombre del producto es obligatorio' })
    name?: string;

    @IsOptional()
    @IsString()
    presentation?: string;

    @IsOptional()
    @IsString()
    @MinLength(3, { message: 'El código de barras debe tener al menos 3 caracteres' })
    @MaxLength(16, { message: 'El código de barras no puede exceder los 16 caracteres' })
    @IsNotEmpty()
    barcode?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio debe ser un número positivo' })
    price?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio de compra debe ser un número positivo' })
    purchasePrice?: number;

    @IsOptional()
    @IsEnum(ExchangeRateType)
    currency?: ExchangeRateType;

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 3 })
    @Min(0, { message: 'El stock debe ser un número positivo' })
    stock?: number;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isDetail?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    parentId?: number | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    unitsDetail?: number | null;

    @IsOptional()
    @ValidateNested()
    @Type(() => ProductChildDto)
    child?: ProductChildDto;
}


export class ExchangeRateDto {
    @IsString()
    @IsNotEmpty({ message: 'El nombre de la tasa de cambio es obligatorio' })
    name!: string;
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0, { message: 'La tasa de cambio debe ser un número positivo' })
    rate!: number;

    @IsString()
    @IsEnum(ExchangeRateType)
    currency!: ExchangeRateType;
}

export class DeleteProductDto {
    @Type(() => Number)
    @IsInt()
    @Min(1, { message: 'El ID del producto debe ser un número positivo' })
    id!: number;
    @IsString()
    @IsNotEmpty({ message: 'La contraseña es obligatoria' })
    password!: string;
}