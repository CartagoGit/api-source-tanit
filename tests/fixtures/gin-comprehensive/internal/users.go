package internal

import "github.com/gin-gonic/gin"

type User struct {
	Name  string `json:"name" binding:"required,min=1,max=100"`
	Email string `json:"email" binding:"required,email"`
	Age   int    `json:"age" binding:"required,gte=0,lte=120"`
	Role  string `json:"role" binding:"required,oneof=admin user guest"`
}

type Address struct {
	Street     string `json:"street" binding:"required"`
	City       string `json:"city" binding:"required"`
	Country    string `json:"country" binding:"required,len=2"`
	PostalCode string `json:"postal_code" binding:"required"`
}

func RegisterUserRoutes(rg *gin.RouterGroup) {}

func ListUsers(c *gin.Context) {}
func CreateUser(c *gin.Context) {}
func GetUser(c *gin.Context) {}
func UpdateUser(c *gin.Context) {}
func DeleteUser(c *gin.Context) {}
func UpdateUserAddress(c *gin.Context) {}