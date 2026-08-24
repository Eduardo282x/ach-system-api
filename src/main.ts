import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { FileLoggerService } from './common/logger/file-logger.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

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

    await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
    console.log(`Aplicacion corriendo en el puerto ${process.env.PORT ?? 3000}`)
}
bootstrap();
