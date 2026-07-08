import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class OpenSessionDto {
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	openingBalance!: number;

	@IsNumber()
	cashDrawerId!: number;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	shiftId?: number;
}

export class UpdateOpeningSessionDto {
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	openingBalance!: number;
}

export class CloseSessionDto {
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	closingBalance!: number;
}
