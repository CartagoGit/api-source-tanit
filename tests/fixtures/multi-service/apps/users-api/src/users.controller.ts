/**
 * NestJS users controller — minimal surface for the multi-service
 * fixture in `tests/fixtures/multi-service/`.
 *
 * Routes live under `/api/users` so the scanner produces a stable
 * prefix distinct from the FastAPI billing-api sibling (`/api/invoices`).
 * The monorepo detection treats `apps/users-api/` and `apps/billing-api/`
 * as separate workspaces; this controller is the only NestJS source
 * the scanner walks in that workspace.
 */
import { Body, Controller, Get, Param, Post } from "@nestjs/common";

class CreateUserDto {
  name!: string;
  email!: string;
}

@Controller("api/users")
export class UsersController {
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