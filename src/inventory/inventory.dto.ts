import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from 'class-validator';

export class GetInventoryEntriesFilterDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsString()
    startDate?: string;

    @IsOptional()
    @IsString()
    endDate?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    size?: number;
}

export class CreateInventoryEntryDetailDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    productId!: number;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 3 })
    @Min(0.001, { message: 'La cantidad debe ser mayor a 0' })
    quantity!: number;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0, { message: 'El precio unitario debe ser un número positivo' })
    unitPrice!: number;
}

export class CreateInventoryEntryDto {
    @IsString()
    @IsNotEmpty({ message: 'El número de control es obligatorio' })
    controlNumber!: string;

    @IsOptional()
    @IsString()
    title?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsString()
    @IsNotEmpty({ message: 'La fecha es obligatoria' })
    date!: string;

    @IsNumber()
    supplierId!: number;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateInventoryEntryDetailDto)
    details!: CreateInventoryEntryDetailDto[];
}
