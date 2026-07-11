use std::time::Instant;

pub struct TokenBucket {
    capacity: f64,
    refill_per_second: f64,
    tokens: f64,
    updated_at: Instant,
}

impl TokenBucket {
    pub fn new(capacity: u32, refill_per_second: u32) -> Self {
        Self {
            capacity: capacity as f64,
            refill_per_second: refill_per_second as f64,
            tokens: capacity as f64,
            updated_at: Instant::now(),
        }
    }

    pub fn allow(&mut self, cost: u32) -> bool {
        self.allow_at(cost, Instant::now())
    }

    fn allow_at(&mut self, cost: u32, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.updated_at).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_per_second).min(self.capacity);
        self.updated_at = now;

        if self.tokens < cost as f64 {
            return false;
        }
        self.tokens -= cost as f64;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn limits_bursts_and_refills_over_time() {
        let start = Instant::now();
        let mut bucket = TokenBucket::new(10, 10);
        assert!(bucket.allow_at(10, start));
        assert!(!bucket.allow_at(1, start));
        assert!(bucket.allow_at(5, start + Duration::from_millis(500)));
        assert!(!bucket.allow_at(1, start + Duration::from_millis(500)));
    }
}
