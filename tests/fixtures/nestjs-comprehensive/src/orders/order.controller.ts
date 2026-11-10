import { Controller, Get, Post, Patch, Body, Param } from "@nestjs/common";
import { CreateOrderDto, UpdateOrderStatusDto } from "./order.dto";

@Controller("orders")
export class OrderController {
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

  @Patch(":id/status")
  updateStatus(@Param("id") id: string, @Body() body: UpdateOrderStatusDto) {
    return { id, ...body };
  }
}