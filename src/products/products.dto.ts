import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min,
} from 'class-validator';
import { ExchangeRateType } from 'src/generated/prisma/enums';

export class ProductDto {
	@IsString()
	@IsNotEmpty()
	name!: string;

	@IsString()
	@IsNotEmpty()
	presentation!: string;

	@IsString()
	@IsNotEmpty()
	barcode!: string;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	price!: number;

	@IsOptional()
	@IsEnum(ExchangeRateType)
	currency?: ExchangeRateType;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	stock?: number;

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
