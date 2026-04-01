// Package db provides the SQLite persistence layer for XDP traffic logs.
package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

const schema = `
CREATE TABLE IF NOT EXISTS traffic_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp_ns INTEGER NOT NULL,
    src_ip       TEXT    NOT NULL,
    dst_ip       TEXT    NOT NULL,
    src_port     INTEGER NOT NULL DEFAULT 0,
    dst_port     INTEGER NOT NULL DEFAULT 0,
    protocol     INTEGER NOT NULL,
    action       INTEGER NOT NULL,
    pkt_len      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ts   ON traffic_logs(timestamp_ns);
CREATE INDEX IF NOT EXISTS idx_act  ON traffic_logs(action);
CREATE INDEX IF NOT EXISTS idx_prot ON traffic_logs(protocol);
`

// TrafficLog is one row in traffic_logs.
type TrafficLog struct {
	ID          int64  `json:"id"`
	TimestampNs int64  `json:"timestamp_ns"`
	SrcIP       string `json:"src_ip"`
	DstIP       string `json:"dst_ip"`
	SrcPort     int    `json:"src_port"`
	DstPort     int    `json:"dst_port"`
	Protocol    int    `json:"protocol"`
	Action      int    `json:"action"`
	PktLen      int    `json:"pkt_len"`
}

// Store wraps a *sql.DB and provides typed query methods.
type Store struct {
	db *sql.DB
}

// Open opens (or creates) the SQLite database at path and applies schema migrations.
// WAL mode is enabled to allow concurrent readers alongside the ring-buffer writer.
func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_busy_timeout=5000&_synchronous=NORMAL", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", path, err)
	}
	// Allow one writer and multiple readers concurrently.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the database connection.
func (s *Store) Close() error {
	return s.db.Close()
}
