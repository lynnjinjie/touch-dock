use crate::crypto::{verify_client_proof, verify_resume_proof};
use getrandom::fill;
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use zeroize::Zeroizing;

const TOKEN_BYTES: usize = 32;
const RESUME_TTL: Duration = Duration::from_secs(24 * 60 * 60);

pub struct PairingManager {
    ttl: Duration,
    inner: Mutex<PairingState>,
}

struct PairingState {
    token: Option<Zeroizing<[u8; TOKEN_BYTES]>>,
    expires_at: Instant,
    expires_at_unix_ms: u64,
    active_session: Option<String>,
    resume_token: Option<Zeroizing<[u8; TOKEN_BYTES]>>,
    resume_expires_at: Option<Instant>,
}

#[derive(Debug, Clone)]
pub struct PairingSnapshot {
    pub token: Option<String>,
    pub expires_at_unix_ms: u64,
    pub session_active: bool,
}

pub struct SessionLease {
    manager: Arc<PairingManager>,
    session_id: String,
}

pub struct PairingGrant {
    lease: SessionLease,
    token: Zeroizing<[u8; TOKEN_BYTES]>,
    resume_token: Zeroizing<[u8; TOKEN_BYTES]>,
}

impl PairingGrant {
    pub fn session_id(&self) -> &str {
        self.lease.id()
    }

    pub fn token(&self) -> &[u8; TOKEN_BYTES] {
        &self.token
    }

    pub fn resume_token(&self) -> &[u8; TOKEN_BYTES] {
        &self.resume_token
    }
}

impl SessionLease {
    fn id(&self) -> &str {
        &self.session_id
    }
}

impl Drop for SessionLease {
    fn drop(&mut self) {
        self.manager.release(&self.session_id);
    }
}

impl PairingManager {
    pub fn new(ttl: Duration) -> Result<Arc<Self>, PairingError> {
        Ok(Arc::new(Self {
            ttl,
            inner: Mutex::new(fresh_state(ttl)?),
        }))
    }

    pub fn snapshot(&self) -> Result<PairingSnapshot, PairingError> {
        let mut state = self.lock();
        self.refresh_if_expired(&mut state)?;
        Ok(PairingSnapshot {
            token: state.token.as_ref().map(|token| hex::encode(**token)),
            expires_at_unix_ms: state.expires_at_unix_ms,
            session_active: state.active_session.is_some(),
        })
    }

    pub fn acquire(
        self: &Arc<Self>,
        client_public_key: &[u8],
        client_nonce: &[u8; 16],
        proof: &[u8],
    ) -> Result<PairingGrant, PairingError> {
        let mut state = self.lock();
        self.refresh_if_expired(&mut state)?;
        if state.active_session.is_some() {
            return Err(PairingError::Busy);
        }
        let token = state.token.as_ref().ok_or(PairingError::Invalid)?;
        if !verify_client_proof(token, client_nonce, client_public_key, proof) {
            return Err(PairingError::Invalid);
        }

        let session_id = random_hex(16)?;
        let token = state.token.take().ok_or(PairingError::Invalid)?;
        let resume_token = Zeroizing::new(random_bytes::<TOKEN_BYTES>()?);
        state.resume_token = Some(Zeroizing::new(*resume_token));
        state.resume_expires_at = Some(Instant::now() + RESUME_TTL);
        state.active_session = Some(session_id.clone());
        Ok(PairingGrant {
            lease: SessionLease {
                manager: Arc::clone(self),
                session_id,
            },
            token,
            resume_token,
        })
    }

    pub fn resume(
        self: &Arc<Self>,
        client_public_key: &[u8],
        client_nonce: &[u8; 16],
        proof: &[u8],
    ) -> Result<PairingGrant, PairingError> {
        let mut state = self.lock();
        self.refresh_if_expired(&mut state)?;
        if state.active_session.is_some() {
            return Err(PairingError::Busy);
        }
        let token = state.resume_token.as_ref().ok_or(PairingError::Invalid)?;
        if state
            .resume_expires_at
            .is_none_or(|expires| Instant::now() >= expires)
            || !verify_resume_proof(token, client_nonce, client_public_key, proof)
        {
            state.resume_token = None;
            state.resume_expires_at = None;
            return Err(PairingError::Invalid);
        }
        let token = **token;
        let session_id = random_hex(16)?;
        state.active_session = Some(session_id.clone());
        Ok(PairingGrant {
            lease: SessionLease {
                manager: Arc::clone(self),
                session_id,
            },
            token: Zeroizing::new(token),
            resume_token: Zeroizing::new(token),
        })
    }

    pub fn rotate(&self) -> Result<(), PairingError> {
        let mut state = self.lock();
        if state.active_session.is_some() {
            return Err(PairingError::Busy);
        }
        *state = fresh_state(self.ttl)?;
        Ok(())
    }

    fn release(&self, session_id: &str) {
        let mut state = self.lock();
        if state.active_session.as_deref() != Some(session_id) {
            return;
        }
        state.active_session = None;
        if let Ok((token, expires_at, expires_at_unix_ms)) = fresh_pairing(self.ttl) {
            state.token = Some(token);
            state.expires_at = expires_at;
            state.expires_at_unix_ms = expires_at_unix_ms;
        } else {
            state.token = None;
        }
    }

    fn refresh_if_expired(&self, state: &mut PairingState) -> Result<(), PairingError> {
        if state.active_session.is_none() && Instant::now() >= state.expires_at {
            let (token, expires_at, expires_at_unix_ms) = fresh_pairing(self.ttl)?;
            state.token = Some(token);
            state.expires_at = expires_at;
            state.expires_at_unix_ms = expires_at_unix_ms;
        }
        if state
            .resume_expires_at
            .is_some_and(|expires| Instant::now() >= expires)
        {
            state.resume_token = None;
            state.resume_expires_at = None;
        }
        Ok(())
    }

    fn lock(&self) -> MutexGuard<'_, PairingState> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn fresh_state(ttl: Duration) -> Result<PairingState, PairingError> {
    let (token, expires_at, expires_at_unix_ms) = fresh_pairing(ttl)?;
    Ok(PairingState {
        token: Some(token),
        expires_at,
        expires_at_unix_ms,
        active_session: None,
        resume_token: None,
        resume_expires_at: None,
    })
}

fn fresh_pairing(
    ttl: Duration,
) -> Result<(Zeroizing<[u8; TOKEN_BYTES]>, Instant, u64), PairingError> {
    let token = Zeroizing::new(random_bytes::<TOKEN_BYTES>()?);
    let expires_at_unix_ms = SystemTime::now()
        .checked_add(ttl)
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .ok_or(PairingError::Clock)?;
    Ok((token, Instant::now() + ttl, expires_at_unix_ms))
}

fn random_hex(bytes: usize) -> Result<String, PairingError> {
    let mut random = vec![0_u8; bytes];
    fill(&mut random).map_err(|_| PairingError::Random)?;
    Ok(hex::encode(random))
}

fn random_bytes<const N: usize>() -> Result<[u8; N], PairingError> {
    let mut random = [0_u8; N];
    fill(&mut random).map_err(|_| PairingError::Random)?;
    Ok(random)
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PairingError {
    #[error("pairing proof is invalid or expired")]
    Invalid,
    #[error("another remote session is already active")]
    Busy,
    #[error("secure random generation failed")]
    Random,
    #[error("system clock is unavailable")]
    Clock,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{create_client_proof, create_resume_proof};
    use p256::SecretKey;

    fn hello(token: &str) -> (Vec<u8>, [u8; 16], [u8; 32]) {
        let token: [u8; 32] = hex::decode(token).unwrap().try_into().unwrap();
        let client_public_key = SecretKey::from_slice(&[3; 32])
            .unwrap()
            .public_key()
            .to_sec1_bytes()
            .to_vec();
        let nonce = [4; 16];
        let proof = create_client_proof(&token, &nonce, &client_public_key);
        (client_public_key, nonce, proof)
    }

    #[test]
    fn token_is_single_use_and_rotates_after_disconnect() {
        let manager = PairingManager::new(Duration::from_secs(60)).unwrap();
        let first = manager.snapshot().unwrap().token.unwrap();
        let (key, nonce, proof) = hello(&first);
        let grant = manager.acquire(&key, &nonce, &proof).unwrap();
        assert!(manager.snapshot().unwrap().token.is_none());
        assert!(matches!(
            manager.acquire(&key, &nonce, &proof),
            Err(PairingError::Busy)
        ));
        drop(grant);

        let second = manager.snapshot().unwrap().token.unwrap();
        assert_ne!(first, second);
        let (_, _, stale_proof) = hello(&first);
        assert!(matches!(
            manager.acquire(&key, &nonce, &stale_proof),
            Err(PairingError::Invalid)
        ));
    }

    #[test]
    fn disconnected_client_can_resume_without_reusing_pairing_token() {
        let manager = PairingManager::new(Duration::from_secs(60)).unwrap();
        let pairing_token = manager.snapshot().unwrap().token.unwrap();
        let (key, nonce, proof) = hello(&pairing_token);
        let grant = manager.acquire(&key, &nonce, &proof).unwrap();
        let resume_token = *grant.resume_token();
        drop(grant);

        let resume_nonce = [9; 16];
        let resume_proof = create_resume_proof(&resume_token, &resume_nonce, &key);
        let resumed = manager.resume(&key, &resume_nonce, &resume_proof).unwrap();
        assert_eq!(resumed.token(), &resume_token);
        drop(resumed);

        let fresh_pairing = manager.snapshot().unwrap().token.unwrap();
        assert_ne!(fresh_pairing, pairing_token);
    }

    #[test]
    fn rotating_pairing_revokes_resume_access() {
        let manager = PairingManager::new(Duration::from_secs(60)).unwrap();
        let pairing_token = manager.snapshot().unwrap().token.unwrap();
        let (key, nonce, proof) = hello(&pairing_token);
        let grant = manager.acquire(&key, &nonce, &proof).unwrap();
        let resume_token = *grant.resume_token();
        drop(grant);
        manager.rotate().unwrap();

        let resume_nonce = [9; 16];
        let resume_proof = create_resume_proof(&resume_token, &resume_nonce, &key);
        assert!(matches!(
            manager.resume(&key, &resume_nonce, &resume_proof),
            Err(PairingError::Invalid)
        ));
    }

    #[test]
    fn automatic_qr_expiry_keeps_resume_access() {
        let manager = PairingManager::new(Duration::from_secs(60)).unwrap();
        let pairing_token = manager.snapshot().unwrap().token.unwrap();
        let (key, nonce, proof) = hello(&pairing_token);
        let grant = manager.acquire(&key, &nonce, &proof).unwrap();
        let resume_token = *grant.resume_token();
        drop(grant);
        manager.lock().expires_at = Instant::now();
        let _ = manager.snapshot().unwrap();

        let resume_nonce = [9; 16];
        let resume_proof = create_resume_proof(&resume_token, &resume_nonce, &key);
        assert!(manager.resume(&key, &resume_nonce, &resume_proof).is_ok());
    }

    #[test]
    fn rejects_invalid_proofs() {
        let manager = PairingManager::new(Duration::from_secs(60)).unwrap();
        let key = SecretKey::from_slice(&[3; 32])
            .unwrap()
            .public_key()
            .to_sec1_bytes();
        assert!(matches!(
            manager.acquire(key.as_ref(), &[0; 16], &[0; 32]),
            Err(PairingError::Invalid)
        ));
    }

    #[test]
    fn rotates_an_idle_pairing_token_on_demand() {
        let manager = PairingManager::new(Duration::from_secs(60)).unwrap();
        let first = manager.snapshot().unwrap().token.unwrap();
        manager.rotate().unwrap();
        let second = manager.snapshot().unwrap().token.unwrap();
        assert_ne!(first, second);
    }
}
