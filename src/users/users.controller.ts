import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { UserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    async getAllUsers() {
        return await this.usersService.getAllUsers();
    }

    @Get('/roles')
    async getRoles() {
        return await this.usersService.getRoles();
    }

    @Post()
    async createUser(@Body() createUserDto: UserDto) {
        return await this.usersService.createUser(createUserDto);
    }

    @Put(':id')
    async updateUser(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateUserDto: UserDto,
    ) {
        return await this.usersService.updateUser(id, updateUserDto);
    }

    @Delete(':id')
    async deleteUser(@Param('id', ParseIntPipe) id: number) {
        return await this.usersService.deleteUser(id);
    }
}
