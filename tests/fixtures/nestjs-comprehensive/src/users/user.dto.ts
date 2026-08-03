import {
  IsString,
  IsEmail,
  IsInt,
  IsEnum,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
} from "class-validator";

export enum UserRole {
  Admin = "admin",
  User = "user",
  Guest = "guest",
}

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsInt()
  @Min(0)
  @Max(120)
  age!: number;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}

export class UpdateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;
}

export class AddressDto {
  @IsString()
  @MinLength(1)
  street!: string;

  @IsString()
  @MinLength(1)
  city!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country!: string;

  @IsString()
  postalCode!: string;
}