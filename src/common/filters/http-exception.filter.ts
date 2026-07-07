// src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: any, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();

        const status = exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;

        const httpResponse = exception instanceof HttpException
            ? exception.getResponse()
            : null;

        const message = exception instanceof HttpException
            ? (typeof httpResponse === 'string'
                ? httpResponse
                : httpResponse?.['message'] || exception.message)
            : 'Error interno del servidor';

        const data = exception instanceof HttpException
            ? (typeof httpResponse === 'string'
                ? { detail: httpResponse }
                : {
                    ...httpResponse,
                    exceptionMessage: exception.message,
                })
            : {
                exceptionMessage: exception?.message,
                stack: exception?.stack,
            };

        response.status(status).json({
            success: false,
            statusCode: status,
            message: Array.isArray(message) ? message[0] : message, // Maneja errores de validación
            data,
        });
    }
}