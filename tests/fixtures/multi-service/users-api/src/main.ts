import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Controller("users")
class UsersController {
  @Get()
  list() {
    return [{ id: "user-1" }];
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("v1");
  await app.listen(3001);
}

void bootstrap();