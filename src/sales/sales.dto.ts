import { Type } from 'class-transformer';
import {
	ArrayMinSize,
	IsArray,
	IsInt,
	IsNumber,
	IsObject,
	IsOptional,
	Min,
	ValidateNested,
} from 'class-validator';

export class CreateInvoiceItemDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	productId!: number;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	quantity!: number;
}

export class CreatePaymentDetailDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	paymentTypeId!: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	amountReceived!: number;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
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
	exchangeRateUsdId?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	exchangeRateEurId?: number;
}
