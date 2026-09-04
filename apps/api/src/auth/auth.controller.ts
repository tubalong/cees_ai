import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoginDto, RefreshTokenDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    @Post('login')
    login(@Body() input: LoginDto): { status: string; email: string } {
        return { status: 'AUTH_PROVIDER_TODO', email: input.email };
    }

    @Post('refresh')
    refresh(@Body() input: RefreshTokenDto): { status: string } {
        void input;
        return { status: 'REFRESH_TOKEN_ROTATION_TODO' };
    }
}