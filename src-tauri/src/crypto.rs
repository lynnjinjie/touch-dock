use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use p256::{ecdh::diffie_hellman, PublicKey, SecretKey};
use qrcode::{render::svg, QrCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::Sha256;
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

const CLIENT_PROOF_DOMAIN: &[u8] = b"touchdock-v1:client-proof";
const RESUME_PROOF_DOMAIN: &[u8] = b"touchdock-v1:resume-proof";
const SERVER_PROOF_DOMAIN: &[u8] = b"touchdock-v1:server-proof";
const KEY_DOMAIN: &[u8] = b"touchdock-v1:session-keys";
const C2S_LABEL: &[u8] = b"client-to-server";
const S2C_LABEL: &[u8] = b"server-to-client";
const C2S_NONCE_PREFIX: [u8; 4] = *b"TDc1";
const S2C_NONCE_PREFIX: [u8; 4] = *b"TDs1";

type HmacSha256 = Hmac<Sha256>;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SessionKeys {
    pub client_to_server: [u8; 32],
    pub server_to_client: [u8; 32],
}

impl SessionKeys {
    pub fn new(client_to_server: [u8; 32], server_to_client: [u8; 32]) -> Self {
        Self {
            client_to_server,
            server_to_client,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EncryptedEnvelope {
    #[serde(rename = "type")]
    pub message_type: EncryptedMessageType,
    pub sequence: u64,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EncryptedMessageType {
    Encrypted,
}

pub struct SecureChannel {
    inbound: Aes256Gcm,
    outbound: Aes256Gcm,
    inbound_nonce_prefix: [u8; 4],
    outbound_nonce_prefix: [u8; 4],
    inbound_label: &'static [u8],
    outbound_label: &'static [u8],
    expected_inbound_sequence: u64,
    next_outbound_sequence: u64,
}

impl SecureChannel {
    #[cfg(test)]
    pub fn client(keys: &SessionKeys) -> Self {
        Self::new(
            keys.server_to_client,
            keys.client_to_server,
            S2C_NONCE_PREFIX,
            C2S_NONCE_PREFIX,
            S2C_LABEL,
            C2S_LABEL,
        )
    }

    pub fn server(keys: &SessionKeys) -> Self {
        Self::new(
            keys.client_to_server,
            keys.server_to_client,
            C2S_NONCE_PREFIX,
            S2C_NONCE_PREFIX,
            C2S_LABEL,
            S2C_LABEL,
        )
    }

    fn new(
        inbound_key: [u8; 32],
        outbound_key: [u8; 32],
        inbound_nonce_prefix: [u8; 4],
        outbound_nonce_prefix: [u8; 4],
        inbound_label: &'static [u8],
        outbound_label: &'static [u8],
    ) -> Self {
        Self {
            inbound: Aes256Gcm::new((&inbound_key).into()),
            outbound: Aes256Gcm::new((&outbound_key).into()),
            inbound_nonce_prefix,
            outbound_nonce_prefix,
            inbound_label,
            outbound_label,
            expected_inbound_sequence: 0,
            next_outbound_sequence: 0,
        }
    }

    pub fn encrypt<T: Serialize>(&mut self, message: &T) -> Result<EncryptedEnvelope, CryptoError> {
        let sequence = self.next_outbound_sequence;
        let plaintext = serde_json::to_vec(message)?;
        let nonce_bytes = sequence_nonce(self.outbound_nonce_prefix, sequence);
        let aad = associated_data(self.outbound_label, sequence);
        let ciphertext = self.outbound.encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        )?;
        self.next_outbound_sequence = sequence
            .checked_add(1)
            .ok_or(CryptoError::SequenceExhausted)?;
        Ok(EncryptedEnvelope {
            message_type: EncryptedMessageType::Encrypted,
            sequence,
            ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
        })
    }

    pub fn decrypt<T: DeserializeOwned>(
        &mut self,
        envelope: &EncryptedEnvelope,
    ) -> Result<T, CryptoError> {
        if envelope.sequence != self.expected_inbound_sequence {
            return Err(CryptoError::UnexpectedSequence {
                expected: self.expected_inbound_sequence,
                actual: envelope.sequence,
            });
        }
        let ciphertext = URL_SAFE_NO_PAD.decode(&envelope.ciphertext)?;
        let nonce_bytes = sequence_nonce(self.inbound_nonce_prefix, envelope.sequence);
        let aad = associated_data(self.inbound_label, envelope.sequence);
        let plaintext = self.inbound.decrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: &ciphertext,
                aad: &aad,
            },
        )?;
        let message = serde_json::from_slice(&plaintext)?;
        self.expected_inbound_sequence = self
            .expected_inbound_sequence
            .checked_add(1)
            .ok_or(CryptoError::SequenceExhausted)?;
        Ok(message)
    }
}

#[cfg(test)]
pub fn create_client_proof(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    client_public_key: &[u8],
) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(token).expect("HMAC accepts any key size");
    mac.update(CLIENT_PROOF_DOMAIN);
    mac.update(client_nonce);
    mac.update(client_public_key);
    mac.finalize().into_bytes().into()
}

pub fn verify_client_proof(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    client_public_key: &[u8],
    proof: &[u8],
) -> bool {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(token).expect("HMAC accepts any key size");
    mac.update(CLIENT_PROOF_DOMAIN);
    mac.update(client_nonce);
    mac.update(client_public_key);
    mac.verify_slice(proof).is_ok()
}

pub fn verify_resume_proof(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    client_public_key: &[u8],
    proof: &[u8],
) -> bool {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(token).expect("HMAC accepts any key size");
    mac.update(RESUME_PROOF_DOMAIN);
    mac.update(client_nonce);
    mac.update(client_public_key);
    mac.verify_slice(proof).is_ok()
}

#[cfg(test)]
pub fn create_resume_proof(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    client_public_key: &[u8],
) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(token).expect("HMAC accepts any key size");
    mac.update(RESUME_PROOF_DOMAIN);
    mac.update(client_nonce);
    mac.update(client_public_key);
    mac.finalize().into_bytes().into()
}

pub fn create_server_proof(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    client_public_key: &[u8],
    server_public_key: &[u8],
    session_id: &str,
) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(token).expect("HMAC accepts any key size");
    mac.update(SERVER_PROOF_DOMAIN);
    mac.update(client_nonce);
    mac.update(client_public_key);
    mac.update(server_public_key);
    mac.update(session_id.as_bytes());
    mac.finalize().into_bytes().into()
}

#[cfg(test)]
pub fn verify_server_proof(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    client_public_key: &[u8],
    server_public_key: &[u8],
    session_id: &str,
    proof: &[u8],
) -> bool {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(token).expect("HMAC accepts any key size");
    mac.update(SERVER_PROOF_DOMAIN);
    mac.update(client_nonce);
    mac.update(client_public_key);
    mac.update(server_public_key);
    mac.update(session_id.as_bytes());
    mac.verify_slice(proof).is_ok()
}

pub fn derive_keys(
    token: &[u8; 32],
    client_nonce: &[u8; 16],
    local_secret: &SecretKey,
    peer_public: &PublicKey,
    client_public_key: &[u8],
    server_public_key: &[u8],
) -> Result<SessionKeys, CryptoError> {
    let shared = diffie_hellman(local_secret.to_nonzero_scalar(), peer_public.as_affine());
    let hkdf = Hkdf::<Sha256>::new(Some(token), shared.raw_secret_bytes().as_ref());
    let mut context = Vec::with_capacity(
        KEY_DOMAIN.len() + client_nonce.len() + client_public_key.len() + server_public_key.len(),
    );
    context.extend_from_slice(KEY_DOMAIN);
    context.extend_from_slice(client_nonce);
    context.extend_from_slice(client_public_key);
    context.extend_from_slice(server_public_key);

    let mut client_to_server = [0_u8; 32];
    let mut server_to_client = [0_u8; 32];
    let mut c2s_info = context.clone();
    c2s_info.extend_from_slice(C2S_LABEL);
    let mut s2c_info = context;
    s2c_info.extend_from_slice(S2C_LABEL);
    hkdf.expand(&c2s_info, &mut client_to_server)
        .map_err(|_| CryptoError::KeyDerivation)?;
    hkdf.expand(&s2c_info, &mut server_to_client)
        .map_err(|_| CryptoError::KeyDerivation)?;
    Ok(SessionKeys::new(client_to_server, server_to_client))
}

pub fn build_pairing_url(address: &str, token: &str) -> String {
    format!("http://{address}/remote#token={token}")
}

pub fn render_pairing_qr(url: &str) -> Result<String, CryptoError> {
    let code = QrCode::new(url.as_bytes()).map_err(|_| CryptoError::QrCode)?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(256, 256)
        .dark_color(svg::Color("#16282c"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

pub fn encode_base64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode_base64(value: &str) -> Result<Vec<u8>, CryptoError> {
    URL_SAFE_NO_PAD.decode(value).map_err(Into::into)
}

fn sequence_nonce(prefix: [u8; 4], sequence: u64) -> [u8; 12] {
    let mut nonce = [0_u8; 12];
    nonce[..4].copy_from_slice(&prefix);
    nonce[4..].copy_from_slice(&sequence.to_be_bytes());
    nonce
}

fn associated_data(direction: &[u8], sequence: u64) -> Vec<u8> {
    let mut aad = Vec::with_capacity(KEY_DOMAIN.len() + direction.len() + 8);
    aad.extend_from_slice(KEY_DOMAIN);
    aad.extend_from_slice(direction);
    aad.extend_from_slice(&sequence.to_be_bytes());
    aad
}

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encrypted handshake value is invalid")]
    InvalidHandshake,
    #[error("message sequence mismatch: expected {expected}, received {actual}")]
    UnexpectedSequence { expected: u64, actual: u64 },
    #[error("message sequence is exhausted")]
    SequenceExhausted,
    #[error("key derivation failed")]
    KeyDerivation,
    #[error("authenticated encryption failed")]
    Aead,
    #[error("base64 value is invalid")]
    Base64(#[from] base64::DecodeError),
    #[error("JSON message is invalid")]
    Json(#[from] serde_json::Error),
    #[error("QR code generation failed")]
    QrCode,
}

impl From<aes_gcm::Error> for CryptoError {
    fn from(_: aes_gcm::Error) -> Self {
        Self::Aead
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::SecretKey;
    use serde_json::json;

    const TOKEN: [u8; 32] = [0x42; 32];
    const NONCE: [u8; 16] = [0x24; 16];

    fn secret(byte: u8) -> SecretKey {
        SecretKey::from_slice(&[byte; 32]).unwrap()
    }

    #[test]
    fn client_proof_rejects_tampering() {
        let client = secret(3).public_key();
        let encoded = client.to_sec1_bytes();
        let proof = create_client_proof(&TOKEN, &NONCE, encoded.as_ref());
        assert!(verify_client_proof(
            &TOKEN,
            &NONCE,
            encoded.as_ref(),
            &proof
        ));

        let mut tampered = proof;
        tampered[0] ^= 1;
        assert!(!verify_client_proof(
            &TOKEN,
            &NONCE,
            encoded.as_ref(),
            &tampered
        ));
    }

    #[test]
    fn server_proof_binds_both_keys_and_the_session() {
        let client = secret(3).public_key().to_sec1_bytes();
        let server = secret(4).public_key().to_sec1_bytes();
        let proof = create_server_proof(
            &TOKEN,
            &NONCE,
            client.as_ref(),
            server.as_ref(),
            "session-1",
        );
        assert!(verify_server_proof(
            &TOKEN,
            &NONCE,
            client.as_ref(),
            server.as_ref(),
            "session-1",
            &proof,
        ));
        assert!(!verify_server_proof(
            &TOKEN,
            &NONCE,
            client.as_ref(),
            server.as_ref(),
            "session-2",
            &proof,
        ));
    }

    #[test]
    fn client_and_server_derive_matching_directional_keys() {
        let client_secret = secret(5);
        let server_secret = secret(7);
        let client_public = client_secret.public_key();
        let server_public = server_secret.public_key();

        let server_keys = derive_keys(
            &TOKEN,
            &NONCE,
            &server_secret,
            &client_public,
            client_public.to_sec1_bytes().as_ref(),
            server_public.to_sec1_bytes().as_ref(),
        )
        .unwrap();
        let client_keys = derive_keys(
            &TOKEN,
            &NONCE,
            &client_secret,
            &server_public,
            client_public.to_sec1_bytes().as_ref(),
            server_public.to_sec1_bytes().as_ref(),
        )
        .unwrap();

        assert_eq!(server_keys.client_to_server, client_keys.client_to_server);
        assert_eq!(server_keys.server_to_client, client_keys.server_to_client);
        assert_ne!(server_keys.client_to_server, server_keys.server_to_client);
    }

    #[test]
    fn encrypted_messages_round_trip_and_reject_replay() {
        let keys = SessionKeys::new([1; 32], [2; 32]);
        let mut client = SecureChannel::client(&keys);
        let mut server = SecureChannel::server(&keys);
        let envelope = client.encrypt(&json!({"type":"ping","nonce":9})).unwrap();
        let plaintext: serde_json::Value = server.decrypt(&envelope).unwrap();
        assert_eq!(plaintext["nonce"], 9);
        assert!(matches!(
            server.decrypt::<serde_json::Value>(&envelope),
            Err(CryptoError::UnexpectedSequence { .. })
        ));
    }

    #[test]
    fn decrypts_browser_crypto_test_vector() {
        let client_secret = secret(3);
        let server_secret = secret(4);
        let client_public = client_secret.public_key().to_sec1_bytes();
        let server_public = server_secret.public_key().to_sec1_bytes();
        let keys = derive_keys(
            &TOKEN,
            &NONCE,
            &server_secret,
            &client_secret.public_key(),
            client_public.as_ref(),
            server_public.as_ref(),
        )
        .unwrap();
        let mut server = SecureChannel::server(&keys);
        let envelope = EncryptedEnvelope {
            message_type: EncryptedMessageType::Encrypted,
            sequence: 0,
            ciphertext: "gqRpw0Yvhg7IxuBcgYwMpk6SmYNzDpWhJtvdVj9lQ6zEMmU-MPP-UoQ".into(),
        };
        let message: serde_json::Value = server.decrypt(&envelope).unwrap();
        assert_eq!(message, json!({"type":"ping","nonce":7}));
    }

    #[test]
    fn pairing_url_keeps_token_out_of_the_http_request() {
        let url = build_pairing_url("192.168.1.20:4816", "secret-token");
        assert_eq!(url, "http://192.168.1.20:4816/remote#token=secret-token");
        let request_part = url.split('#').next().unwrap();
        assert!(!request_part.contains("secret-token"));
        let svg = render_pairing_qr(&url).unwrap();
        assert!(svg.starts_with("<?xml"));
        assert!(svg.contains("<svg"));
    }
}
