import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiResponseInterceptor } from './common/api-response.interceptor';

const localEnvFile = resolve(__dirname, '../../../.env');
if (!process.env.NODE_ENV && existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);
    app.useBodyParser('json', { limit: '2mb' });
    app.setGlobalPrefix('api/v1');
    // 跨域下浏览器默认只向 JS 暴露少数「安全」响应头，Content-Disposition 不在其中。
    // 若不显式暴露，前端读取导出文件名会得到 null，只能回退成 document.pdf 之类的
    // 通用名；导出接口用 filename*=UTF-8'' 携带的文档标题因此永远拿不到。
    app.enableCors({
        exposedHeaders: ['Content-Disposition', 'x-request-id'],
    });
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
        .setTitle('CEES AI API')
        .setVersion('1.0')
        .addBearerAuth()
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'platformBearerAuth')
        .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));
    await app.listen(Number(process.env.API_PORT ?? 3000));
}

void bootstrap();
