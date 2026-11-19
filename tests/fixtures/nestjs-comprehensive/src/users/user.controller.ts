import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from "@nestjs/common";
import { CreateUserDto, UpdateUserDto, AddressDto } from "./user.dto";

@Controller("users")
export class UserController {
  @Get()
  list() {
    return [];
  }

  @Post()
  create(@Body() body: CreateUserDto) {
    return { id: 1, ...body };
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return { id };
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: UpdateUserDto) {
    return { id, ...body };
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    return { deleted: id };
  }

  @Put(":id/address")
  updateAddress(@Param("id") id: string, @Body() body: AddressDto) {
    return { id, address: body };
  }
}