package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"lit-tree-viewer/internal/db"
)

// listSeries handles GET /series
func listSeries(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		series, err := store.GetAllSeries(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch series"})
			return
		}
		c.JSON(http.StatusOK, series)
	}
}

// getSeries handles GET /series/:id
func getSeries(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}

		series, err := store.GetSeriesByID(c.Request.Context(), id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch series"})
			return
		}

		c.JSON(http.StatusOK, series)
	}
}

// getCompiledGraph handles GET /series/:id/compiled
// Returns the full graph history in CompileSuccess shape for LTG source emission.
func getCompiledGraph(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}

		graph, err := store.GetCompiledGraph(c.Request.Context(), id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build compiled graph"})
			return
		}

		c.JSON(http.StatusOK, graph)
	}
}

// getGraphSnapshot handles GET /series/:id/graph?at=N
func getGraphSnapshot(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}

		atStr := c.DefaultQuery("at", "1")
		atUnit, err := strconv.Atoi(atStr)
		if err != nil || atUnit < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "at must be a positive integer"})
			return
		}

		snapshot, err := store.GetGraphSnapshot(c.Request.Context(), id, atUnit)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build graph snapshot"})
			return
		}

		c.JSON(http.StatusOK, snapshot)
	}
}
