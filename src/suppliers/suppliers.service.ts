import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SupplierDto } from './suppliers.dto';

@Injectable()
export class SuppliersService {
	constructor(private readonly prismaService: PrismaService) {}

	async getSuppliers(search?: string) {
		try {
			const where: any = {
				deleted: false,
			};

			if (search) {
				where.OR = [
					{ name: { contains: search, mode: 'insensitive' } },
					{ identify: { contains: search, mode: 'insensitive' } },
				];
			}

			const suppliers = await this.prismaService.supplier.findMany({
				where,
				orderBy: {
					createdAt: 'desc',
				},
				select: {
					id: true,
					identify: true,
					phone: true,
					name: true,
					address: true,
				}
			});

			if (suppliers.length === 0) {
				return {
					message: 'No se encontraron proveedores',
					suppliers: [],
				};
			}

			return {
				suppliers,
			};
		} catch (error) {
			throw error;
		}
	}

	async createSupplier(createSupplierDto: SupplierDto) {
		try {
			const existingSupplier = await this.prismaService.supplier.findFirst({
				where: {
					identify: createSupplierDto.identify,
				},
			});

			if (existingSupplier) {
				throw new NotFoundException('Ya existe un proveedor con esa cédula.');
			}

			const newSupplier = await this.prismaService.supplier.create({
				data: {
					name: createSupplierDto.name,
					identify: createSupplierDto.identify || '',
					phone: createSupplierDto.phone || '',
					address: createSupplierDto.address || '',
				},
			});

			return {
				message: 'Proveedor creado exitosamente',
				data: newSupplier,
			};
		} catch (error) {
			throw error;
		}
	}

	async updateSupplier(id: number, updateSupplierDto: SupplierDto) {
		try {
			const supplier = await this.prismaService.supplier.findUnique({
				where: { id },
			});

			if (!supplier) {
				throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
			}

			if (updateSupplierDto.identify && updateSupplierDto.identify !== supplier.identify) {
				const existingSupplier = await this.prismaService.supplier.findFirst({
					where: {
						identify: updateSupplierDto.identify,
					},
				});

				if (existingSupplier) {
					throw new NotFoundException('Ya existe un proveedor con esa cédula.');
				}
			}

			const updatedSupplier = await this.prismaService.supplier.update({
				where: { id },
				data: {
					name: updateSupplierDto.name,
					identify: updateSupplierDto.identify || '',
					phone: updateSupplierDto.phone || '',
					address: updateSupplierDto.address || '',
				},
			});

			return {
				message: 'Proveedor actualizado correctamente',
				data: updatedSupplier,
			};
		} catch (error) {
			throw error;
		}
	}

	async deleteSupplier(id: number) {
		try {
			const exists = await this.prismaService.supplier.findUnique({
				where: { id },
			});

			if (!exists) {
				throw new NotFoundException(`Proveedor con id ${id} no encontrado`);
			}

			const supplier = await this.prismaService.supplier.update({
				where: { id },
				data: { deleted: true },
			});

			return {
				message: 'Proveedor eliminado correctamente',
				data: supplier,
			};
		} catch (error) {
			throw error;
		}
	}
}
