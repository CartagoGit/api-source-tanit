import { Body, Controller, Get, Post, Param } from "@nestjs/common";
import { IsString, IsEmail, IsInt, IsPositive, IsArray } from "class-validator";

class CreateOrderDto {
  @IsString()
  customerName: string;

  @IsEmail()
  customerEmail: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsArray()
  items: string[];
}

@Controller("orders")
export class OrdersController {
  @Get()
  list() {
    return [];
  }

  @Post()
  create(@Body() body: CreateOrderDto) {
    return { id: 1, ...body };
  }

  @Get(":id")
  show(@Param("id") id: string) {
    return { id };
  }
}
