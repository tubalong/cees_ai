import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
    platformJwtAudience,
    platformJwtIssuer,
    requirePlatformAccessTokenSecret,
} from '../auth/auth.config';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAccessTokenPayload, PlatformAuthenticatedPrincipal } from './platform-auth.types';

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
    constructor(private readonly platformAuthService: PlatformAuthService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: requirePlatformAccessTokenSecret(),
            issuer: platformJwtIssuer(),
            audience: platformJwtAudience(),
            algorithms: ['HS256'],
        });
    }

    validate(payload: PlatformAccessTokenPayload): Promise<PlatformAuthenticatedPrincipal> {
        return this.platformAuthService.validateAccessToken(payload);
    }
}
