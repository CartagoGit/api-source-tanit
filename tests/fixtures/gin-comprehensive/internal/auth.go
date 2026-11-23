package internal

import "github.com/gin-gonic/gin"

type Login struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8,max=128"`
}

type RefreshToken struct {
	Token string `json:"refresh_token" binding:"required"`
}

func RegisterAuthRoutes(rg *gin.RouterGroup) {}

func LoginHandler(c *gin.Context) {}
func RefreshHandler(c *gin.Context) {}
func LogoutHandler(c *gin.Context) {}