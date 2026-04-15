package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"lit-tree-viewer/internal/db"
	"lit-tree-viewer/internal/domain"
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

// getFullGraph handles GET /series/:id/graph/full
// Returns all characters and all relationships with no temporal filtering.
func getFullGraph(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}

		graph, err := store.GetFullGraph(c.Request.Context(), id)
		if errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to build full graph"})
			return
		}

		c.JSON(http.StatusOK, graph)
	}
}

// validateImportPayload enforces basic constraints on an import payload.
func validateImportPayload(p domain.ImportPayload) error {
	if strings.TrimSpace(p.Series.Title) == "" {
		return fmt.Errorf("series title is required")
	}
	if p.Series.TotalUnits < 1 {
		return fmt.Errorf("totalUnits must be >= 1")
	}
	switch p.Series.MediaType {
	case domain.MediaBook, domain.MediaShow, domain.MediaFilm:
	default:
		return fmt.Errorf("invalid mediaType: %s", p.Series.MediaType)
	}
	charIDs := make(map[uuid.UUID]struct{}, len(p.Characters))
	for _, c := range p.Characters {
		if c.IntroducedAt < 1 {
			return fmt.Errorf("character %s: introducedAt must be >= 1", c.ID)
		}
		charIDs[c.ID] = struct{}{}
	}
	for _, r := range p.Relationships {
		if r.IntroducedAt < 1 {
			return fmt.Errorf("relationship %s: introducedAt must be >= 1", r.ID)
		}
		if _, ok := charIDs[r.FromID]; !ok {
			return fmt.Errorf("relationship %s: unknown fromId %s", r.ID, r.FromID)
		}
		if _, ok := charIDs[r.ToID]; !ok {
			return fmt.Errorf("relationship %s: unknown toId %s", r.ID, r.ToID)
		}
	}
	return nil
}

// createSeries handles POST /series
func createSeries(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		var payload domain.ImportPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
			return
		}
		if err := validateImportPayload(payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		id, err := store.CreateGraph(c.Request.Context(), payload)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create graph"})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"id": id.String()})
	}
}

// patchSeries handles PATCH /series/:id
func patchSeries(store Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid series id"})
			return
		}
		if _, err := store.GetSeriesByID(c.Request.Context(), id); errors.Is(err, db.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "series not found"})
			return
		} else if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to look up series"})
			return
		}
		var payload domain.ImportPayload
		if err := c.ShouldBindJSON(&payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body: " + err.Error()})
			return
		}
		if err := validateImportPayload(payload); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := store.ReplaceGraph(c.Request.Context(), id, payload); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update graph"})
			return
		}
		updated, err := store.GetSeriesByID(c.Request.Context(), id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch updated series"})
			return
		}
		c.JSON(http.StatusOK, updated)
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
