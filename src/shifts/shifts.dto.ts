import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class CreateShiftDto {
	@IsString()
	name!: string;

	@IsString()
	@Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'startTime debe tener formato HH:mm (24h)' })
	startTime!: string;

	@IsString()
	@Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'endTime debe tener formato HH:mm (24h)' })
	endTime!: string;
}

export class UpdateShiftDto {
	@IsOptional()
	@IsString()
	name?: string;

	@IsOptional()
	@IsString()
	@Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'startTime debe tener formato HH:mm (24h)' })
	startTime?: string;

	@IsOptional()
	@IsString()
	@Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'endTime debe tener formato HH:mm (24h)' })
	endTime?: string;

	@IsOptional()
	@IsBoolean()
	active?: boolean;
}
