import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard';
import { JwtService } from '@nestjs/jwt';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.setGlobalPrefix('/api');
    app.enableCors();

    app.useGlobalGuards(new AuthGuard(app.get(JwtService)))

    // Aplicar el formato global de respuestas exitosas
    app.useGlobalInterceptors(new ResponseInterceptor());

    // Aplicar el formato global de errores
    app.useGlobalFilters(new AllExceptionsFilter());

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

    await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
