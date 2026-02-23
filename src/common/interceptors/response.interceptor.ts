// src/common/interceptors/response.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor {
    intercept(context: ExecutionContext, next: CallHandler) {
        const statusCode = context.switchToHttp().getResponse().statusCode;

        return next.handle().pipe(
            map((data) => ({
                success: true,
                statusCode: statusCode,
                message: data?.message || '', // Mensaje por defecto
                data: data || null,
            })),
        );
    }
}