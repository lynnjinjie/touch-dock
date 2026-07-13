use crate::input::InputCommand;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    ClientHello {
        client_public_key: String,
        client_nonce: String,
        proof: String,
    },
    ResumeHello {
        client_public_key: String,
        client_nonce: String,
        proof: String,
    },
    Command {
        request_id: u64,
        command: InputCommand,
    },
    Ping {
        nonce: u64,
    },
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    ServerHello {
        protocol_version: u16,
        session_id: String,
        server_public_key: String,
        proof: String,
    },
    SessionReady {
        resume_token: String,
    },
    Ack {
        request_id: u64,
    },
    Pong {
        nonce: u64,
    },
    Error {
        code: ErrorCode,
        message: &'static str,
        retryable: bool,
        request_id: Option<u64>,
    },
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    AuthenticationRequired,
    AuthenticationFailed,
    SessionBusy,
    InvalidMessage,
    InvalidCommand,
    RateLimited,
    PermissionRequired,
    InputRejected,
    Unsupported,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::{Key, Modifier};

    #[test]
    fn parses_a_typed_shortcut_command() {
        let message: ClientMessage = serde_json::from_str(
            r#"{
                "type":"command",
                "request_id":7,
                "command":{"kind":"shortcut","modifiers":["meta"],"key":"tab"}
            }"#,
        )
        .unwrap();

        assert_eq!(
            message,
            ClientMessage::Command {
                request_id: 7,
                command: InputCommand::Shortcut {
                    modifiers: vec![Modifier::Meta],
                    key: Key::Tab,
                },
            }
        );
    }

    #[test]
    fn rejects_unknown_fields() {
        let result = serde_json::from_str::<ClientMessage>(
            r#"{
                "type":"client_hello",
                "client_public_key":"key",
                "client_nonce":"nonce",
                "proof":"proof",
                "admin":true
            }"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn rejects_raw_key_codes() {
        let result = serde_json::from_str::<ClientMessage>(
            r#"{
                "type":"command",
                "request_id":8,
                "command":{"kind":"key","key":65535,"state":"down"}
            }"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn parses_only_a_named_system_action() {
        let message: ClientMessage = serde_json::from_str(
            r#"{"type":"command","request_id":9,"command":{"kind":"system","action":"mute"}}"#,
        )
        .unwrap();
        assert_eq!(
            message,
            ClientMessage::Command {
                request_id: 9,
                command: InputCommand::System {
                    action: crate::input::SystemAction::Mute,
                },
            }
        );
        assert!(serde_json::from_str::<ClientMessage>(
            r#"{"type":"command","request_id":10,"command":{"kind":"system","action":"shell"}}"#
        )
        .is_err());
    }
}
