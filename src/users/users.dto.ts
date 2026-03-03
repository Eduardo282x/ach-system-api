import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Role } from 'src/generated/prisma/enums';

export class UserDto {
	@IsString()
	@IsNotEmpty()
	name!: string;

	@IsString()
	@IsNotEmpty()
	username!: string;

	@IsString()
	password!: string;

	@IsEnum(Role)
	role!: Role;

	@IsOptional()
	email?: string;
}
