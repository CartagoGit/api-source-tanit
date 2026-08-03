import { Module } from "@nestjs/common";
import { UserController } from "./users/user.controller";
import { OrderController } from "./orders/order.controller";
import { AuthController } from "./auth/auth.controller";

@Module({
  controllers: [UserController, OrderController, AuthController],
})
export class AppModule {}