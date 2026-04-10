package api

import (
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(pool *pgxpool.Pool) *gin.Engine {
	r := gin.Default()

	r.Use(corsMiddleware())

	v1 := r.Group("/api")
	{
		v1.GET("/series", listSeries(pool))
		v1.GET("/series/:id", getSeries(pool))
		v1.GET("/series/:id/graph", getGraphSnapshot(pool))
	}

	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "http://localhost:5173")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
