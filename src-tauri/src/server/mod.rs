mod pairing;
mod rate_limit;

use crate::{
    control_layout::{ControlLayout, ControlLayoutStore},
    crypto::{
        build_pairing_url, create_server_proof, decode_base64, derive_keys, encode_base64,
        render_pairing_qr, CryptoError, EncryptedEnvelope, SecureChannel,
    },
    input::{
        DriverStatus, InputCommand, InputDriver, InputError, Key, KeyState, Modifier, MouseButton,
    },
    protocol::{ClientMessage, ErrorCode, ServerMessage, PROTOCOL_VERSION},
};
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header, HeaderValue, Response as HttpResponse, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get},
    Json, Router,
};
use local_ip_address::local_ip;
use p256::{elliptic_curve::rand_core::OsRng, PublicKey, SecretKey};
use pairing::{PairingError, PairingManager};
use rate_limit::TokenBucket;
use serde::Serialize;
use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{Arc, Mutex},
    time::Duration,
};
use thiserror::Error;
use tokio::{net::TcpListener, sync::oneshot, time::timeout};

const DEFAULT_PORT: u16 = 4816;
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);
const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
const PAIRING_TTL: Duration = Duration::from_secs(120);
const MAX_MESSAGE_BYTES: usize = 4 * 1024;
const COMMAND_BURST: u32 = 240;
const COMMANDS_PER_SECOND: u32 = 240;
// Embedding keeps the reconnectable, resizable iOS controller available without another runtime server.
const MOBILE_HTML: &str = include_str!("../../../mobile/index.html");
const MOBILE_CSS: &str = include_str!("../../../mobile/style.css");
const MOBILE_APP_JS: &str = include_str!("../../../mobile/app.js");

#[derive(Default)]
struct HeldInputs {
    keys: HashSet<Key>,
    modifiers: HashSet<Modifier>,
    mouse_buttons: HashSet<MouseButton>,
}

impl HeldInputs {
    fn observe(&mut self, command: &InputCommand) {
        match command {
            InputCommand::Key { key, state } => match state {
                KeyState::Down => {
                    self.keys.insert(*key);
                }
                KeyState::Up => {
                    self.keys.remove(key);
                }
            },
            InputCommand::MouseButton { button, state } => match state {
                KeyState::Down => {
                    self.mouse_buttons.insert(*button);
                }
                KeyState::Up => {
                    self.mouse_buttons.remove(button);
                }
            },
            InputCommand::Modifier { modifier, state } => match state {
                KeyState::Down => {
                    self.modifiers.insert(*modifier);
                }
                KeyState::Up => {
                    self.modifiers.remove(modifier);
                }
            },
            _ => {}
        }
    }

    fn release_all(&mut self, driver: &dyn InputDriver) {
        for key in self.keys.drain() {
            let _ = driver.key(key, KeyState::Up);
        }
        for modifier in self.modifiers.drain() {
            let _ = driver.modifier(modifier, KeyState::Up);
        }
        for button in self.mouse_buttons.drain() {
            let _ = driver.mouse_button(button, KeyState::Up);
        }
    }
}

#[derive(Clone)]
struct ServiceState {
    driver: Arc<dyn InputDriver>,
    pairing: Arc<PairingManager>,
    control_layout: Arc<ControlLayoutStore>,
}

pub struct RemoteServer {
    state: Arc<ServiceState>,
    address: SocketAddr,
    lan_available: bool,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteServiceInfo {
    pub protocol_version: u16,
    pub platform: &'static str,
    pub address: String,
    pub port: u16,
    pub websocket_url: String,
    pub pairing_token: Option<String>,
    pub pairing_url: Option<String>,
    pub pairing_qr_svg: Option<String>,
    pub pairing_expires_at_unix_ms: u64,
    pub session_active: bool,
    pub lan_available: bool,
    pub transport_encrypted: bool,
    pub driver_status: DriverStatus,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    protocol_version: u16,
    session_active: bool,
    driver_status: DriverStatus,
}

impl RemoteServer {
    pub async fn start(
        driver: Arc<dyn InputDriver>,
        config_path: std::path::PathBuf,
    ) -> Result<Self, ServerError> {
        let (ip, lan_available) = service_ip();
        Self::start_with_bind(
            driver,
            IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            ip,
            DEFAULT_PORT,
            lan_available,
            Some(config_path),
        )
        .await
    }

    #[cfg(test)]
    async fn start_on(
        driver: Arc<dyn InputDriver>,
        ip: IpAddr,
        port: u16,
        lan_available: bool,
    ) -> Result<Self, ServerError> {
        Self::start_with_bind(driver, ip, ip, port, lan_available, None).await
    }

    async fn start_with_bind(
        driver: Arc<dyn InputDriver>,
        bind_ip: IpAddr,
        advertised_ip: IpAddr,
        port: u16,
        lan_available: bool,
        config_path: Option<std::path::PathBuf>,
    ) -> Result<Self, ServerError> {
        let listener = match TcpListener::bind(SocketAddr::new(bind_ip, port)).await {
            Ok(listener) => listener,
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => {
                TcpListener::bind(SocketAddr::new(bind_ip, 0)).await?
            }
            Err(error) => return Err(error.into()),
        };
        let port = listener.local_addr()?.port();
        let address = SocketAddr::new(advertised_ip, port);
        let state = Arc::new(ServiceState {
            driver,
            pairing: PairingManager::new(PAIRING_TTL)?,
            control_layout: Arc::new(ControlLayoutStore::load(config_path)),
        });
        let app = Router::new()
            .route("/health", get(health))
            .route("/remote", get(remote_html))
            .route("/remote/style.css", get(remote_css))
            .route("/remote/app.js", get(remote_app_js))
            .route("/remote/config.json", get(remote_config))
            .route("/ws", any(websocket))
            .with_state(Arc::clone(&state));
        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        Ok(Self {
            state,
            address,
            lan_available,
            shutdown: Mutex::new(Some(shutdown_tx)),
        })
    }

    pub fn info(&self) -> Result<RemoteServiceInfo, ServerError> {
        let pairing = self.state.pairing.snapshot()?;
        let pairing_url = pairing
            .token
            .as_ref()
            .map(|token| build_pairing_url(&self.address.to_string(), token));
        let pairing_qr_svg = pairing_url.as_deref().map(render_pairing_qr).transpose()?;
        Ok(RemoteServiceInfo {
            protocol_version: PROTOCOL_VERSION,
            platform: std::env::consts::OS,
            address: self.address.ip().to_string(),
            port: self.address.port(),
            websocket_url: format!("ws://{}/ws", self.address),
            pairing_token: pairing.token,
            pairing_url,
            pairing_qr_svg,
            pairing_expires_at_unix_ms: pairing.expires_at_unix_ms,
            session_active: pairing.session_active,
            lan_available: self.lan_available,
            transport_encrypted: true,
            driver_status: self.state.driver.status(),
        })
    }

    pub fn refresh_pairing(&self) -> Result<RemoteServiceInfo, ServerError> {
        self.state.pairing.rotate()?;
        self.info()
    }

    pub fn request_input_permission(&self) -> DriverStatus {
        self.state.driver.request_permission()
    }

    pub fn control_layout(&self) -> ControlLayout {
        self.state.control_layout.get()
    }

    pub fn set_control_layout(&self, layout: ControlLayout) -> Result<ControlLayout, ServerError> {
        self.state.control_layout.set(layout)?;
        Ok(self.state.control_layout.get())
    }
}

impl Drop for RemoteServer {
    fn drop(&mut self) {
        if let Some(sender) = self
            .shutdown
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            let _ = sender.send(());
        }
    }
}

fn service_ip() -> (IpAddr, bool) {
    match local_ip() {
        Ok(ip) if ip.is_ipv4() && !ip.is_loopback() && !ip.is_unspecified() => (ip, true),
        _ => (IpAddr::V4(Ipv4Addr::LOCALHOST), false),
    }
}

async fn health(State(state): State<Arc<ServiceState>>) -> Json<HealthResponse> {
    let session_active = state
        .pairing
        .snapshot()
        .map(|snapshot| snapshot.session_active)
        .unwrap_or(false);
    Json(HealthResponse {
        status: "ok",
        protocol_version: PROTOCOL_VERSION,
        session_active,
        driver_status: state.driver.status(),
    })
}

async fn remote_html() -> Response {
    static_response(MOBILE_HTML, "text/html; charset=utf-8")
}

async fn remote_css() -> Response {
    static_response(MOBILE_CSS, "text/css; charset=utf-8")
}

async fn remote_app_js() -> Response {
    static_response(MOBILE_APP_JS, "text/javascript; charset=utf-8")
}

async fn remote_config(State(state): State<Arc<ServiceState>>) -> Json<ControlLayout> {
    Json(state.control_layout.get())
}

fn static_response(body: &'static str, content_type: &'static str) -> Response {
    let mut response = HttpResponse::new(Body::from(body));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src ws: wss:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
        ),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

async fn websocket(State(state): State<Arc<ServiceState>>, upgrade: WebSocketUpgrade) -> Response {
    upgrade
        .max_message_size(MAX_MESSAGE_BYTES)
        .max_frame_size(MAX_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state))
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: Arc<ServiceState>) {
    let hello = match timeout(AUTH_TIMEOUT, socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<ClientMessage>(&text) {
            Ok(ClientMessage::ClientHello {
                client_public_key,
                client_nonce,
                proof,
            }) => (client_public_key, client_nonce, proof, false),
            Ok(ClientMessage::ResumeHello {
                client_public_key,
                client_nonce,
                proof,
            }) => (client_public_key, client_nonce, proof, true),
            _ => {
                send_plain_error(
                    &mut socket,
                    ErrorCode::AuthenticationRequired,
                    "the first message must establish an encrypted session",
                    false,
                    None,
                )
                .await;
                return;
            }
        },
        _ => {
            send_plain_error(
                &mut socket,
                ErrorCode::AuthenticationRequired,
                "encrypted session handshake timed out",
                true,
                None,
            )
            .await;
            return;
        }
    };

    let client_public_key_bytes = match decode_base64(&hello.0) {
        Ok(value) => value,
        Err(_) => {
            send_authentication_failed(&mut socket).await;
            return;
        }
    };
    let client_nonce: [u8; 16] = match decode_base64(&hello.1)
        .and_then(|value| value.try_into().map_err(|_| CryptoError::InvalidHandshake))
    {
        Ok(value) => value,
        Err(_) => {
            send_authentication_failed(&mut socket).await;
            return;
        }
    };
    let proof = match decode_base64(&hello.2) {
        Ok(value) => value,
        Err(_) => {
            send_authentication_failed(&mut socket).await;
            return;
        }
    };
    let client_public_key = match PublicKey::from_sec1_bytes(&client_public_key_bytes) {
        Ok(value) => value,
        Err(_) => {
            send_authentication_failed(&mut socket).await;
            return;
        }
    };

    let grant_result = if hello.3 {
        state
            .pairing
            .resume(&client_public_key_bytes, &client_nonce, &proof)
    } else {
        state
            .pairing
            .acquire(&client_public_key_bytes, &client_nonce, &proof)
    };
    let grant = match grant_result {
        Ok(grant) => grant,
        Err(PairingError::Busy) => {
            send_plain_error(
                &mut socket,
                ErrorCode::SessionBusy,
                "another remote session is already active",
                true,
                None,
            )
            .await;
            return;
        }
        Err(_) => {
            send_authentication_failed(&mut socket).await;
            return;
        }
    };

    let server_secret = SecretKey::random(&mut OsRng);
    let server_public_key_bytes = server_secret.public_key().to_sec1_bytes();
    let session_id = grant.session_id().to_owned();
    let keys = match derive_keys(
        grant.token(),
        &client_nonce,
        &server_secret,
        &client_public_key,
        &client_public_key_bytes,
        server_public_key_bytes.as_ref(),
    ) {
        Ok(keys) => keys,
        Err(_) => return,
    };
    let server_proof = create_server_proof(
        grant.token(),
        &client_nonce,
        &client_public_key_bytes,
        server_public_key_bytes.as_ref(),
        &session_id,
    );
    if send_plain_json(
        &mut socket,
        &ServerMessage::ServerHello {
            protocol_version: PROTOCOL_VERSION,
            session_id,
            server_public_key: encode_base64(server_public_key_bytes.as_ref()),
            proof: encode_base64(&server_proof),
        },
    )
    .await
    .is_err()
    {
        return;
    }

    let mut channel = SecureChannel::server(&keys);
    if send_secure_json(
        &mut socket,
        &mut channel,
        &ServerMessage::SessionReady {
            resume_token: encode_base64(grant.resume_token()),
        },
    )
    .await
    .is_err()
    {
        return;
    }
    let mut rate_limit = TokenBucket::new(COMMAND_BURST, COMMANDS_PER_SECOND);
    let mut held_inputs = HeldInputs::default();
    loop {
        let message = match timeout(SESSION_IDLE_TIMEOUT, socket.recv()).await {
            Ok(Some(message)) => message,
            _ => break,
        };
        let text = match message {
            Ok(Message::Text(text)) => text,
            Ok(Message::Ping(data)) => {
                if socket.send(Message::Pong(data)).await.is_err() {
                    break;
                }
                continue;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {
                send_secure_error(
                    &mut socket,
                    &mut channel,
                    ErrorCode::InvalidMessage,
                    "only encrypted JSON text messages are accepted",
                    false,
                    None,
                )
                .await;
                continue;
            }
        };

        let parsed = serde_json::from_str::<EncryptedEnvelope>(&text)
            .map_err(CryptoError::from)
            .and_then(|envelope| channel.decrypt::<ClientMessage>(&envelope));
        let parsed = match parsed {
            Ok(message) => message,
            Err(_) => {
                send_secure_error(
                    &mut socket,
                    &mut channel,
                    ErrorCode::InvalidMessage,
                    "encrypted message is invalid or out of sequence",
                    false,
                    None,
                )
                .await;
                break;
            }
        };

        match parsed {
            ClientMessage::Command {
                request_id,
                command,
            } => {
                if command.validate().is_err() {
                    send_secure_error(
                        &mut socket,
                        &mut channel,
                        ErrorCode::InvalidCommand,
                        "command values are outside the allowed bounds",
                        false,
                        Some(request_id),
                    )
                    .await;
                    continue;
                }
                if !rate_limit.allow(command.rate_cost()) {
                    send_secure_error(
                        &mut socket,
                        &mut channel,
                        ErrorCode::RateLimited,
                        "command rate exceeded the session limit",
                        true,
                        Some(request_id),
                    )
                    .await;
                    continue;
                }
                match state.driver.execute(&command) {
                    Ok(()) => {
                        held_inputs.observe(&command);
                        if send_secure_json(
                            &mut socket,
                            &mut channel,
                            &ServerMessage::Ack { request_id },
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        let should_disconnect = matches!(error, InputError::PermissionRequired);
                        let (code, message, retryable) = input_error_response(error);
                        send_secure_error(
                            &mut socket,
                            &mut channel,
                            code,
                            message,
                            retryable,
                            Some(request_id),
                        )
                        .await;
                        if should_disconnect {
                            break;
                        }
                    }
                }
            }
            ClientMessage::Ping { nonce } => {
                if send_secure_json(&mut socket, &mut channel, &ServerMessage::Pong { nonce })
                    .await
                    .is_err()
                {
                    break;
                }
            }
            ClientMessage::ClientHello { .. } | ClientMessage::ResumeHello { .. } => {
                send_secure_error(
                    &mut socket,
                    &mut channel,
                    ErrorCode::InvalidMessage,
                    "encrypted session is already established",
                    false,
                    None,
                )
                .await;
            }
        }
    }

    held_inputs.release_all(state.driver.as_ref());
    drop(grant);
}

async fn send_authentication_failed(socket: &mut WebSocket) {
    send_plain_error(
        socket,
        ErrorCode::AuthenticationFailed,
        "pairing proof is invalid or expired",
        true,
        None,
    )
    .await;
}

fn input_error_response(error: InputError) -> (ErrorCode, &'static str, bool) {
    match error {
        InputError::PermissionRequired => (
            ErrorCode::PermissionRequired,
            "desktop input permission is required",
            true,
        ),
        InputError::Unsupported(_) => (
            ErrorCode::Unsupported,
            "input operation is unsupported on this platform",
            false,
        ),
        InputError::Rejected | InputError::EventCreation => (
            ErrorCode::InputRejected,
            "the operating system rejected the input operation",
            true,
        ),
    }
}

async fn send_plain_error(
    socket: &mut WebSocket,
    code: ErrorCode,
    message: &'static str,
    retryable: bool,
    request_id: Option<u64>,
) {
    let _ = send_plain_json(
        socket,
        &ServerMessage::Error {
            code,
            message,
            retryable,
            request_id,
        },
    )
    .await;
}

async fn send_secure_error(
    socket: &mut WebSocket,
    channel: &mut SecureChannel,
    code: ErrorCode,
    message: &'static str,
    retryable: bool,
    request_id: Option<u64>,
) {
    let _ = send_secure_json(
        socket,
        channel,
        &ServerMessage::Error {
            code,
            message,
            retryable,
            request_id,
        },
    )
    .await;
}

async fn send_plain_json(
    socket: &mut WebSocket,
    message: &ServerMessage,
) -> Result<(), axum::Error> {
    let json = serde_json::to_string(message).expect("server messages must serialize");
    socket.send(Message::Text(json.into())).await
}

async fn send_secure_json(
    socket: &mut WebSocket,
    channel: &mut SecureChannel,
    message: &ServerMessage,
) -> Result<(), SendSecureError> {
    let envelope = channel.encrypt(message)?;
    let json = serde_json::to_string(&envelope)?;
    socket.send(Message::Text(json.into())).await?;
    Ok(())
}

#[derive(Debug, Error)]
enum SendSecureError {
    #[error(transparent)]
    Crypto(#[from] CryptoError),
    #[error(transparent)]
    WebSocket(#[from] axum::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Error)]
pub enum ServerError {
    #[error("failed to bind the remote service: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to initialize pairing: {0}")]
    Pairing(#[from] PairingError),
    #[error("failed to prepare pairing data: {0}")]
    Crypto(#[from] CryptoError),
    #[error("invalid control layout: {0}")]
    Layout(#[from] crate::control_layout::LayoutError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        crypto::{
            create_client_proof, derive_keys, verify_server_proof, EncryptedEnvelope, SecureChannel,
        },
        input::{Modifier, SystemAction},
    };
    use futures_util::{SinkExt, StreamExt};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio_tungstenite::{connect_async, tungstenite::Message as ClientWsMessage};

    #[derive(Default)]
    struct RecordingDriver {
        clicks: AtomicUsize,
        releases: AtomicUsize,
    }

    #[test]
    fn mobile_assets_disable_caching_and_apply_security_headers() {
        let response = static_response("remote", "text/plain; charset=utf-8");
        let headers = response.headers();
        assert_eq!(headers[header::CACHE_CONTROL], "no-store");
        assert_eq!(headers[header::REFERRER_POLICY], "no-referrer");
        assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert!(headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("connect-src ws: wss:"));
    }

    #[test]
    fn delegates_input_permission_requests_to_the_platform_driver() {
        let driver = Arc::new(RecordingDriver::default());
        let server = RemoteServer {
            state: Arc::new(ServiceState {
                driver,
                pairing: PairingManager::new(Duration::from_secs(60)).unwrap(),
                control_layout: Arc::new(ControlLayoutStore::load(None)),
            }),
            address: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 4816),
            lan_available: false,
            shutdown: Mutex::new(None),
        };
        assert_eq!(server.request_input_permission(), DriverStatus::Ready);
    }

    #[test]
    fn releases_held_inputs_when_a_session_ends() {
        let driver = RecordingDriver::default();
        let mut held = HeldInputs::default();
        held.observe(&InputCommand::MouseButton {
            button: MouseButton::Left,
            state: KeyState::Down,
        });
        held.observe(&InputCommand::Key {
            key: Key::ArrowUp,
            state: KeyState::Down,
        });
        held.release_all(&driver);
        assert_eq!(driver.releases.load(Ordering::SeqCst), 2);
        assert!(held.keys.is_empty());
        assert!(held.mouse_buttons.is_empty());
    }

    impl InputDriver for RecordingDriver {
        fn status(&self) -> DriverStatus {
            DriverStatus::Ready
        }

        fn move_pointer(&self, _dx: f64, _dy: f64) -> Result<(), InputError> {
            Ok(())
        }

        fn click(&self, _button: MouseButton) -> Result<(), InputError> {
            self.clicks.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn mouse_button(&self, _button: MouseButton, state: KeyState) -> Result<(), InputError> {
            if state == KeyState::Up {
                self.releases.fetch_add(1, Ordering::SeqCst);
            }
            Ok(())
        }

        fn scroll(&self, _dx: f64, _dy: f64) -> Result<(), InputError> {
            Ok(())
        }

        fn key(&self, _key: Key, state: KeyState) -> Result<(), InputError> {
            if state == KeyState::Up {
                self.releases.fetch_add(1, Ordering::SeqCst);
            }
            Ok(())
        }

        fn modifier(&self, _modifier: Modifier, state: KeyState) -> Result<(), InputError> {
            if state == KeyState::Up {
                self.releases.fetch_add(1, Ordering::SeqCst);
            }
            Ok(())
        }

        fn system_action(&self, _action: SystemAction) -> Result<(), InputError> {
            Ok(())
        }

        fn shortcut(&self, _modifiers: &[Modifier], _key: Key) -> Result<(), InputError> {
            Ok(())
        }

        fn text(&self, _text: &str) -> Result<(), InputError> {
            Ok(())
        }
    }

    #[tokio::test]
    #[ignore = "requires loopback socket permission"]
    async fn establishes_encryption_and_executes_a_websocket_command() {
        let driver = Arc::new(RecordingDriver::default());
        let server =
            RemoteServer::start_on(driver.clone(), IpAddr::V4(Ipv4Addr::LOCALHOST), 0, false)
                .await
                .unwrap();
        let info = server.info().unwrap();
        let token: [u8; 32] = hex::decode(info.pairing_token.unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let (mut socket, _) = connect_async(&info.websocket_url).await.unwrap();
        let client_secret = SecretKey::from_slice(&[3; 32]).unwrap();
        let client_public = client_secret.public_key().to_sec1_bytes();
        let client_nonce = [4_u8; 16];
        let proof = create_client_proof(&token, &client_nonce, client_public.as_ref());

        socket
            .send(ClientWsMessage::Text(
                serde_json::json!({
                    "type":"client_hello",
                    "client_public_key":encode_base64(client_public.as_ref()),
                    "client_nonce":encode_base64(&client_nonce),
                    "proof":encode_base64(&proof)
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        let hello = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let hello: serde_json::Value = serde_json::from_str(&hello).unwrap();
        let server_public_bytes =
            decode_base64(hello["server_public_key"].as_str().unwrap()).unwrap();
        let server_public = PublicKey::from_sec1_bytes(&server_public_bytes).unwrap();
        let session_id = hello["session_id"].as_str().unwrap();
        let server_proof = decode_base64(hello["proof"].as_str().unwrap()).unwrap();
        assert!(verify_server_proof(
            &token,
            &client_nonce,
            client_public.as_ref(),
            &server_public_bytes,
            session_id,
            &server_proof,
        ));

        let keys = derive_keys(
            &token,
            &client_nonce,
            &client_secret,
            &server_public,
            client_public.as_ref(),
            &server_public_bytes,
        )
        .unwrap();
        let mut channel = SecureChannel::client(&keys);
        let ready = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let ready: EncryptedEnvelope = serde_json::from_str(&ready).unwrap();
        let ready: serde_json::Value = channel.decrypt(&ready).unwrap();
        assert_eq!(ready["type"], "session_ready");
        assert_eq!(
            decode_base64(ready["resume_token"].as_str().unwrap())
                .unwrap()
                .len(),
            32
        );
        let command = ClientMessage::Command {
            request_id: 42,
            command: InputCommand::Click {
                button: MouseButton::Left,
            },
        };
        let envelope = channel.encrypt(&command).unwrap();
        socket
            .send(ClientWsMessage::Text(
                serde_json::to_string(&envelope).unwrap().into(),
            ))
            .await
            .unwrap();
        let ack = socket.next().await.unwrap().unwrap().into_text().unwrap();
        let ack: EncryptedEnvelope = serde_json::from_str(&ack).unwrap();
        let ack: serde_json::Value = channel.decrypt(&ack).unwrap();
        assert_eq!(ack["type"], "ack");
        assert_eq!(ack["request_id"], 42);
        assert_eq!(driver.clicks.load(Ordering::SeqCst), 1);
    }
}
