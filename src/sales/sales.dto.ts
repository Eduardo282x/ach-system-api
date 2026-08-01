import { Type } from 'class-transformer';
import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsInt,
	IsNumber,
	IsObject,
	IsOptional,
	IsString,
	Min,
	ValidateNested,
} from 'class-validator';

export class GetInvoicesFilterDto {
	@IsOptional()
	@IsString()
	credit?: string;

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
	sessionId?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	userId?: number;

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

export class CreateInvoiceItemDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	productId!: number;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 3 })
	@Min(0.001)
	quantity!: number;
}

export class CreatePaymentDetailDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	paymentTypeId!: number;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	amountReceived!: number;

	@IsOptional()
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	amountChange?: number;

	@IsOptional()
	@IsObject()
	denominations?: Record<string, number>;
}

export class CreateInvoiceDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	customerId!: number;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	sessionId!: number;

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => CreateInvoiceItemDto)
	items!: CreateInvoiceItemDto[];

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => CreatePaymentDetailDto)
	payments!: CreatePaymentDetailDto[];

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	exchangeRateUsdId!: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	exchangeRateEurId!: number;
}
