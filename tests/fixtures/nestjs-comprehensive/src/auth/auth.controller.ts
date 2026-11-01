import { Controller, Post, Body } from "@nestjs/common";
import { LoginDto, RefreshTokenDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  @Post("login")
  login(@Body() body: LoginDto) {
    return { token: "fake", ...body };
  }

  @Post("refresh")
  refresh(@Body() body: RefreshTokenDto) {
    return { token: "fake", ...body };
  }

  @Post("logout")
  logout() {
    return { ok: true };
  }
}