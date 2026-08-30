import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ClientDto {
	@IsString()
	@IsNotEmpty({ message: 'El nombre completo del cliente es obligatorio' })
	@MinLength(3, {
		message: 'El nombre completo debe tener al menos 3 caracteres',
	})
	@MaxLength(120, {
		message: 'El nombre completo no puede exceder los 120 caracteres',
	})
	fullName!: string;

	@IsOptional()
	@IsString()
	@MaxLength(10, {
		message: 'La cédula o identificación no puede exceder 10 caracteres',
	})
	identify?: string;

	@IsOptional()
	@IsString()
	@MaxLength(12, {
		message: 'El teléfono no puede exceder 12 caracteres',
	})
	phone?: string;

	@IsOptional()
	@IsString()
	address?: string;
}
