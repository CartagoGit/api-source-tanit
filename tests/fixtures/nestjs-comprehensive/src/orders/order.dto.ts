import {
  IsString,
  IsEmail,
  IsInt,
  IsPositive,
  IsEnum,
  IsOptional,
} from "class-validator";

export enum OrderStatus {
  Pending = "pending",
  Paid = "paid",
  Shipped = "shipped",
  Cancelled = "cancelled",
}

export enum Currency {
  EUR = "EUR",
  USD = "USD",
  GBP = "GBP",
}

export class CreateOrderDto {
  @IsString()
  customerName!: string;

  @IsEmail()
  customerEmail!: string;

  @IsInt()
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;
}

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}