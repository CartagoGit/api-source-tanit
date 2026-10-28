/**
 * NestJS users API — the OAuth2 half of the `multi-service` fixture.
 *
 * This is real NestJS code, not a stub: the scanner reads the
 * `@Controller` / `@Get` / `@Post` decorators, and the service
 * declares its own identity (id, host and auth scheme) next to the
 * routes it protects.
 *
 * The OAuth2 signal appears twice on purpose:
 *
 *   - `AuthGuard("oauth2")` is what a reader sees — every route of
 *     this service needs an OAuth2 access token.
 *   - `USERS_API.auth.scheme` is what the pipeline reads to build the
 *     service's `authRef` (see `serviceOverridesFromWorkspaces` in
 *     `packages/core/discovery/generation.pipeline.ts`).
 *
 * The sibling FastAPI service (`../billing-api`) authenticates with
 * an API key against a different host. That difference is the whole
 * point of this fixture: a combined collection must NOT send billing
 * requests to `users.example.com` with the users access token, nor
 * the other way round.
 */
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";

/** Identity of this service: id, host and auth scheme. */
export const USERS_API = {
  serviceId: "users",
  baseUrl: "https://users.example.com",
  auth: { kind: "scheme", scheme: "oauth2" },
} as const;

class CreateUserDto {
  name!: string;
  email!: string;
}

@Controller("api/users")
@UseGuards(AuthGuard("oauth2"))
class UsersController {
  @Get()
  list(): unknown[] {
    return [];
  }

  @Post()
  create(@Body() body: CreateUserDto): { id: number; name: string; email: string } {
    return { id: 1, name: body.name, email: body.email };
  }

  @Get(":id")
  show(@Param("id") id: string): { id: string } {
    return { id };
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3001);
}

void bootstrap();