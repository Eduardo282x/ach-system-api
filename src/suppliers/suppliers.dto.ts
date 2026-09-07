import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SupplierDto {
	@IsString()
	@IsNotEmpty({ message: 'El nombre del proveedor es obligatorio' })
	@MinLength(3, {
		message: 'El nombre debe tener al menos 3 caracteres',
	})
	@MaxLength(120, {
		message: 'El nombre no puede exceder los 120 caracteres',
	})
	name!: string;

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
