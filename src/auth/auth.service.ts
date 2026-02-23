import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoginDto } from './auth.dto';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {

    constructor(
        private prismaService: PrismaService,
        private jwtService: JwtService,
    ) {
    }

    async login(credentials: LoginDto) {
        try {
            // 1. Buscar al usuario
            const findUser = await this.prismaService.users.findFirst({
                where: {
                    username: credentials.username,
                },
            });

            // 2. Si no existe, lanzamos excepción (El Filter la atrapará)
            if (!findUser) {
                throw new UnauthorizedException('Usuario o contraseña incorrectos');
            }

            // 3. Verificar contraseña con bcrypt
            const isValid = await bcrypt.compare(credentials.password, findUser.password);

            // 4. Si la contraseña no coincide, lanzamos la misma excepción
            if (!isValid) {
                throw new UnauthorizedException('Usuario o contraseña incorrectos');
            }

            // 5. Extraer la contraseña para no enviarla en el token ni en la respuesta
            const { password, ...userWithoutPassword } = findUser;

            // 6. El payload del token solo llevará los datos limpios

            const token = await this.jwtService.signAsync(userWithoutPassword);

            // 7. Retornamos los datos del usuario y el token
            // El Interceptor de Éxito los envolverá automáticamente
            return {
                message: `¡Bienvenido, ${userWithoutPassword.name}!`,
                user: userWithoutPassword,
                token
            };
        } catch (error) {
            throw error;
        }
    }
}
