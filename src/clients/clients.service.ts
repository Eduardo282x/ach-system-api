import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClientDto } from './clients.dto';

@Injectable()
export class ClientsService {
	constructor(private readonly prismaService: PrismaService) {}

	async getClients(search?: string) {
		try {
			const where: any = {};

			if (search) {
				where.OR = [
					{ fullName: { contains: search, mode: 'insensitive' } },
					{ identify: { contains: search, mode: 'insensitive' } },
				];
			}

			const clients = await this.prismaService.clients.findMany({
				where,
				orderBy: {
					createdAt: 'desc',
				},
			});

			if (clients.length === 0) {
				return {
					message: 'No se encontraron clientes',
					clients: [],
				};
			}

			return {
				clients,
			};
		} catch (error) {
			throw error;
		}
	}

	async createClient(createClientDto: ClientDto) {
		try {
            const existingClient = await this.prismaService.clients.findFirst({
                where: {
                    identify: createClientDto.identify,
                },
            });

            if (existingClient) {
                throw new NotFoundException('Ya existe un cliente con esa cédula.');
            }

			const newClient = await this.prismaService.clients.create({
				data: {
					fullName: createClientDto.fullName,
					identify: createClientDto.identify || '',
					phone: createClientDto.phone || '',
				},
			});

			return {
				message: 'Cliente creado exitosamente',
				data: newClient,
			};
		} catch (error) {
			throw error;
		}
	}

	async updateClient(id: number, updateClientDto: ClientDto) {
		try {
			const client = await this.prismaService.clients.findUnique({
				where: { id },
			});

			if (!client) {
				throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
			}

            if(updateClientDto.identify && updateClientDto.identify !== client.identify) {
                const existingClient = await this.prismaService.clients.findFirst({
                    where: {
                        identify: updateClientDto.identify,
                    },
                });

                if (existingClient) {
                    throw new NotFoundException('Ya existe un cliente con esa cédula.');
                }
            }

			const updatedClient = await this.prismaService.clients.update({
				where: { id },
				data: {
					fullName: updateClientDto.fullName,
					identify: updateClientDto.identify || '',
					phone: updateClientDto.phone || '',
				},
			});

			return {
				message: 'Cliente actualizado correctamente',
				data: updatedClient,
			};
		} catch (error) {
			throw error;
		}
	}

	async deleteClient(id: number) {
		try {
			const exists = await this.prismaService.clients.findUnique({
				where: { id },
			});

			if (!exists) {
				throw new NotFoundException(`Cliente con id ${id} no encontrado`);
			}

			const client = await this.prismaService.clients.delete({
				where: { id },
			});

			return {
				message: 'Cliente eliminado correctamente',
				data: client,
			};
		} catch (error) {
			throw error;
		}
	}
}
