import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('/login')
    async login(@Body() credentials: LoginDto) {
        return this.authService.login(credentials);
    }

    @Post('/logout')
    async logout(@CurrentUser() user) {
        return this.authService.logout(user.id);
    }
}
