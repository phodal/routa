use chrono::Utc;

use crate::db::Database;
use crate::error::ServerError;
use crate::models::message::{Message, MessageRole};

pub struct ConversationStore {
    db: Database,
}

impl ConversationStore {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn append(&self, message: &Message) -> Result<(), ServerError> {
        let m = message.clone();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "INSERT INTO messages (id, agent_id, role, content, timestamp, tool_name, tool_args, turn)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        m.id,
                        m.agent_id,
                        m.role.as_str(),
                        m.content,
                        m.timestamp.timestamp_millis(),
                        m.tool_name,
                        m.tool_args,
                        m.turn,
                    ],
                )?;
                Ok(())
            })
            .await
    }

    pub async fn get_conversation(&self, agent_id: &str) -> Result<Vec<Message>, ServerError> {
        let aid = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, agent_id, role, content, timestamp, tool_name, tool_args, turn
                     FROM messages WHERE agent_id = ?1 ORDER BY timestamp ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![aid], |row| Ok(row_to_message(row)))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn get_last_n(&self, agent_id: &str, n: usize) -> Result<Vec<Message>, ServerError> {
        let aid = agent_id.to_string();
        let limit = n as i64;
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, agent_id, role, content, timestamp, tool_name, tool_args, turn
                     FROM messages WHERE agent_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
                )?;
                let mut rows: Vec<Message> = stmt
                    .query_map(rusqlite::params![aid, limit], |row| {
                        Ok(row_to_message(row))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows.reverse();
                Ok(rows)
            })
            .await
    }

    pub async fn get_by_turn_range(
        &self,
        agent_id: &str,
        start_turn: i32,
        end_turn: i32,
    ) -> Result<Vec<Message>, ServerError> {
        let aid = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let mut stmt = conn.prepare(
                    "SELECT id, agent_id, role, content, timestamp, tool_name, tool_args, turn
                     FROM messages WHERE agent_id = ?1 AND turn >= ?2 AND turn <= ?3 ORDER BY timestamp ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![aid, start_turn, end_turn], |row| {
                        Ok(row_to_message(row))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .await
    }

    pub async fn get_message_count(&self, agent_id: &str) -> Result<usize, ServerError> {
        let aid = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM messages WHERE agent_id = ?1",
                    rusqlite::params![aid],
                    |row| row.get(0),
                )?;
                Ok(count as usize)
            })
            .await
    }

    pub async fn delete_conversation(&self, agent_id: &str) -> Result<(), ServerError> {
        let aid = agent_id.to_string();
        self.db
            .with_conn_async(move |conn| {
                conn.execute(
                    "DELETE FROM messages WHERE agent_id = ?1",
                    rusqlite::params![aid],
                )?;
                Ok(())
            })
            .await
    }
}

use rusqlite::Row;

fn row_to_message(row: &Row<'_>) -> Message {
    let ts_ms: i64 = row.get(4).unwrap_or(0);

    Message {
        id: row.get(0).unwrap_or_default(),
        agent_id: row.get(1).unwrap_or_default(),
        role: MessageRole::from_str(&row.get::<_, String>(2).unwrap_or_default())
            .unwrap_or(MessageRole::User),
        content: row.get(3).unwrap_or_default(),
        timestamp: chrono::DateTime::from_timestamp_millis(ts_ms).unwrap_or_else(|| Utc::now()),
        tool_name: row.get(5).unwrap_or(None),
        tool_args: row.get(6).unwrap_or(None),
        turn: row.get(7).unwrap_or(None),
    }
}
