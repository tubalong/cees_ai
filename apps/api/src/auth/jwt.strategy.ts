import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtAudience, jwtIssuer, requireAccessTokenSecret } from './auth.config';
import { AuthService } from './auth.service';
import { AccessTokenPayload, AuthenticatedPrincipal } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly authService: AuthService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: requireAccessTokenSecret(),
            issuer: jwtIssuer(),
            audience: jwtAudience(),
            algorithms: ['HS256'],
        });
    }

    validate(payload: AccessTokenPayload): Promise<AuthenticatedPrincipal> {
        return this.authService.validateAccessToken(payload);
    }
}
