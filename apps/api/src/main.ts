import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiResponseInterceptor } from './common/api-response.interceptor';

const localEnvFile = resolve(__dirname, '../../../.env');
if (!process.env.NODE_ENV && existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('api/v1');
    app.enableCors();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    app.useGlobalInterceptors(new ApiResponseInterceptor());

    const swaggerConfig = new DocumentBuilder()
        .setTitle('CEES AI API')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
    await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();
