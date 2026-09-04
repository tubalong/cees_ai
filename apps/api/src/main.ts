import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiResponseInterceptor } from './common/api-response.interceptor';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('api/v1');
    app.enableCors();
    app.use((request: Request, response: Response, next: NextFunction) => {
        const incomingRequestId = request.headers['x-request-id'];
        const requestId = typeof incomingRequestId === 'string' && incomingRequestId.trim()
            ? incomingRequestId
            : randomUUID();
        request.headers['x-request-id'] = requestId;
        response.setHeader('x-request-id', requestId);
        next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());

    const swaggerConfig = new DocumentBuilder()
        .setTitle('AI Enterprise Workbench API')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
    await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();
