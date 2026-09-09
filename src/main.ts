import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { FileLoggerService } from './common/logger/file-logger.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaService } from './prisma/prisma.service';

async function waitForDatabase(prisma: PrismaService, logger: Logger, maxAttempts = 30, baseDelay = 2_000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await prisma.$queryRaw`SELECT 1`;
            logger.log('Conexión a la base de datos establecida.');
            return;
        } catch (error: any) {
            const delay = baseDelay * attempt;
            logger.warn(
                `Base de datos no disponible (intento ${attempt}/${maxAttempts}). Reintentando en ${delay / 1000}s. ${error?.message || ''}`,
            );
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error(`No se pudo conectar a la base de datos después de ${maxAttempts} intentos.`);
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // const logger = app.get(FileLoggerService);

    app.setGlobalPrefix('/api');
    app.enableCors('*');

    app.useGlobalGuards(new AuthGuard(app.get(JwtService)))

    app.useGlobalInterceptors(
        // new LoggingInterceptor(logger),
        new ResponseInterceptor(),
    );

    // app.useGlobalFilters(new AllExceptionsFilter(logger));

    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => {
            const message = errors
                .map(
                    (error) =>
                        `${Object.values(error.constraints ?? {}).join(', ')}`
                )
                .join('; ');

            return new BadRequestException(`${message}`);
        },
    }));

    await waitForDatabase(app.get(PrismaService), new Logger('Database'));

    await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
    console.log(`Aplicacion corriendo en el puerto ${process.env.PORT ?? 3000}`)
}
bootstrap();
