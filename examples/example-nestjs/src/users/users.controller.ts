import { Body, Controller, Get, Post, Param, Query } from "@nestjs/common";
import { IsString, IsEmail, IsInt, IsOptional, IsEnum, MinLength, MaxLength, Min, Max } from "class-validator";

class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;

  @IsOptional()
  @IsEnum(["admin", "user", "guest"])
  role?: string;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsInt()
  age?: number;
}

@Controller("users")
export class UsersController {
  @Get()
  list(@Query("page") page: number) {
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

  @Post(":id")
  update(@Param("id") id: string, @Body() body: UpdateUserDto) {
    return { id, ...body };
  }
}
