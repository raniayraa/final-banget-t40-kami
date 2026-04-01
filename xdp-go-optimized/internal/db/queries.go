package db

import (
	"context"
	"fmt"
	"strings"
)

// LogQuery holds filter parameters for QueryLogs.
// Nil pointer fields mean "no filter".
type LogQuery struct {
	Action   *int   // 0=DROP 1=PASS 2=TX 3=REDIRECT 4=TTL_EXCEEDED
	Protocol *int   // IPPROTO_* value
	FromNs   *int64 // lower bound on timestamp_ns (inclusive)
	ToNs     *int64 // upper bound on timestamp_ns (inclusive)
	Limit    int    // max rows; 0 defaults to 1000
}

// BatchInsert inserts multiple TrafficLog rows in a single transaction.
func (s *Store) BatchInsert(ctx context.Context, logs []TrafficLog) error {
	if len(logs) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO traffic_logs
		 (timestamp_ns, src_ip, dst_ip, src_port, dst_port, protocol, action, pkt_len)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, l := range logs {
		if _, err := stmt.ExecContext(ctx,
			l.TimestampNs, l.SrcIP, l.DstIP,
			l.SrcPort, l.DstPort, l.Protocol, l.Action, l.PktLen,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// QueryLogs returns traffic log rows matching the given filters, ordered
// by timestamp_ns DESC (most recent first).
func (s *Store) QueryLogs(ctx context.Context, q LogQuery) ([]TrafficLog, error) {
	var where []string
	var args []any

	if q.Action != nil {
		where = append(where, "action = ?")
		args = append(args, *q.Action)
	}
	if q.Protocol != nil {
		where = append(where, "protocol = ?")
		args = append(args, *q.Protocol)
	}
	if q.FromNs != nil {
		where = append(where, "timestamp_ns >= ?")
		args = append(args, *q.FromNs)
	}
	if q.ToNs != nil {
		where = append(where, "timestamp_ns <= ?")
		args = append(args, *q.ToNs)
	}

	limit := q.Limit
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}

	query := "SELECT id, timestamp_ns, src_ip, dst_ip, src_port, dst_port, protocol, action, pkt_len FROM traffic_logs"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += fmt.Sprintf(" ORDER BY timestamp_ns DESC LIMIT %d", limit)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TrafficLog
	for rows.Next() {
		var l TrafficLog
		if err := rows.Scan(
			&l.ID, &l.TimestampNs, &l.SrcIP, &l.DstIP,
			&l.SrcPort, &l.DstPort, &l.Protocol, &l.Action, &l.PktLen,
		); err != nil {
			return nil, err
		}
		result = append(result, l)
	}
	return result, rows.Err()
}
