import { Type } from 'class-transformer';
import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
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

	@IsOptional()
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	unitPrice?: number;
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

	@IsBoolean()
	hasDiscount!: boolean;

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

export enum ReturnConditionEnum {
	GOOD = 'GOOD',
	DEFECTIVE = 'DEFECTIVE',
}

export class ReturnItemDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	invoiceItemId!: number;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 3 })
	@Min(0.001)
	quantity!: number;

	@IsEnum(ReturnConditionEnum)
	condition!: ReturnConditionEnum;
}

export class RefundPaymentDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	paymentTypeId!: number;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	amount!: number;
}

export class CreateReturnDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	invoiceId!: number;

	@IsString()
	reason!: string;

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => ReturnItemDto)
	items!: ReturnItemDto[];

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => RefundPaymentDto)
	payments!: RefundPaymentDto[];
}

export class ReplacementItemDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	productId!: number;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 3 })
	@Min(0.001)
	quantity!: number;
}

export class CreateChangeDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	invoiceId!: number;

	@IsString()
	reason!: string;

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => ReturnItemDto)
	returnedItems!: ReturnItemDto[];

	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => ReplacementItemDto)
	replacementItems!: ReplacementItemDto[];

	@Type(() => Number)
	@IsInt()
	@Min(1)
	sessionId!: number;

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
