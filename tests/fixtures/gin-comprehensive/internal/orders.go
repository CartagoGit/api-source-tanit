package internal

import "github.com/gin-gonic/gin"

type Order struct {
	CustomerName  string `json:"customer_name" binding:"required"`
	CustomerEmail string `json:"customer_email" binding:"required,email"`
	Amount        int    `json:"amount" binding:"required,gt=0"`
	Currency      string `json:"currency" binding:"required,oneof=EUR USD GBP"`
}

func RegisterOrderRoutes(rg *gin.RouterGroup) {}