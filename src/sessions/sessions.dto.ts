import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class OpenSessionDto {
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	openingBalance!: number;

	@IsNumber()
	cashDrawerId!: number;
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
