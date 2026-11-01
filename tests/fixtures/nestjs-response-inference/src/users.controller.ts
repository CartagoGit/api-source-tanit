import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiOkResponse, ApiCreatedResponse } from "@nestjs/swagger";

class UserDto {
  id: number;
  name: string;
}

@Controller("users")
export class UsersController {
  @Get()
  @ApiOkResponse({ type: UserDto })
  list() {
    return [];
  }

  @Post()
  @ApiCreatedResponse({ type: UserDto })
  create(@Body() body: UserDto) {
    return body;
  }
}
