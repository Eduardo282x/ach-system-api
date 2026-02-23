import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserDto } from './users.dto';

@Injectable()
export class UsersService {
    constructor(private readonly prismaService: PrismaService) { }

    async getAllUsers() {
        try {
            const users = await this.prismaService.users.findMany({
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const usersWithoutPassword = users.map(({ password, ...user }) => user);

            return {
                users: usersWithoutPassword,
            };
        } catch (error) {
            throw error;
        }
    }

    async getRoles() {
        try {
            const roles = [
                { name: 'Administrador', role: 'ADMIN' },
                { name: 'Cajero', role: 'CAJERO' },
                { name: 'Supervisor', role: 'SUPERVISOR' },
            ];

            return {
                roles: roles,
            };
        } catch (error) {
            throw error;
        }
    }

    async createUser(createUserDto: UserDto) {
        try {
            const existingUser = await this.prismaService.users.findFirst({
                where: {
                    username: createUserDto.username,
                },
            });

            if (existingUser) {
                throw new ConflictException('El nombre de usuario ya está registrado');
            }

            const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

            const user = await this.prismaService.users.create({
                data: {
                    name: createUserDto.name,
                    username: createUserDto.username,
                    password: hashedPassword,
                    role: createUserDto.role,
                    email: createUserDto.email
                },
            });

            const { password, ...userWithoutPassword } = user;

            return {
                message: 'Usuario creado correctamente',
                data: userWithoutPassword,
            };
        } catch (error) {
            throw error;
        }
    }

    async updateUser(id: number, updateUserDto: UserDto) {
        try {
            const user = await this.prismaService.users.findUnique({
                where: { id },
            });

            if (!user) {
                throw new NotFoundException(`Usuario con id ${id} no encontrado`);
            }

            if (updateUserDto.username && updateUserDto.username !== user.username) {
                const existingUser = await this.prismaService.users.findFirst({
                    where: {
                        username: updateUserDto.username,
                    },
                });

                if (existingUser) {
                    throw new ConflictException('El nombre de usuario ya está registrado');
                }
            }

            const hashedPassword = updateUserDto.password
                ? await bcrypt.hash(updateUserDto.password, 10)
                : undefined;

            const updatedUser = await this.prismaService.users.update({
                where: { id },
                data: {
                    ...(updateUserDto.name !== undefined && {
                        name: updateUserDto.name,
                    }),
                    ...(updateUserDto.username !== undefined && {
                        username: updateUserDto.username,
                    }),
                    ...(hashedPassword !== undefined && {
                        password: hashedPassword,
                    }),
                    ...(updateUserDto.role !== undefined && {
                        role: updateUserDto.role,
                    }),
                    ...(updateUserDto.email !== undefined && {
                        email: updateUserDto.email,
                    }),
                },
            });

            const { password, ...userWithoutPassword } = updatedUser;

            return {
                message: 'Usuario actualizado correctamente',
                data: userWithoutPassword,
            };
        } catch (error) {
            throw error;
        }
    }

    async deleteUser(id: number) {
        try {
            const user = await this.prismaService.users.findUnique({
                where: { id },
            });

            if (!user) {
                throw new NotFoundException(`Usuario con id ${id} no encontrado`);
            }

            const deletedUser = await this.prismaService.users.delete({
                where: { id },
            });

            const { password, ...userWithoutPassword } = deletedUser;

            return {
                message: 'Usuario eliminado correctamente',
                data: userWithoutPassword,
            };
        } catch (error) {
            throw error;
        }
    }
}
