import { Controller, Get, Post, Put, Delete, Body, Param } from "@nestjs/common";

@Controller("users")
export class UserController {
  @Get()       list()                          { return []; }
  @Post()      create(@Body() body: unknown)   { return body; }
  @Get(":id")  show(@Param("id") id: string)   { return { id }; }
  @Put(":id")  update(@Param("id") id: string, @Body() body: unknown) { return body; }
  @Delete(":id") remove(@Param("id") id: string) { return {}; }
}
