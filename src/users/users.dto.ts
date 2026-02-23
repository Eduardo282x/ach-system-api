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
	@IsNotEmpty()
	password!: string;

	@IsEnum(Role)
	role!: Role;

	@IsOptional()
	@IsEmail()
	email?: string;
}
