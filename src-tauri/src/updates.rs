use reqwest::{header::LOCATION, redirect::Policy, Client, Url};
use serde::Serialize;
use std::time::Duration;

const LATEST_RELEASE_URL: &str = "https://github.com/lynnjinjie/touch-dock/releases/latest";
const RELEASE_PATH_PREFIX: &str = "/lynnjinjie/touch-dock/releases/tag/";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    version: String,
    release_url: String,
}

fn valid_version(version: &str) -> bool {
    let core = version.split_once('-').map_or(version, |(value, _)| value);
    let mut parts = core.split('.');
    matches!(
        (parts.next(), parts.next(), parts.next(), parts.next()),
        (Some(major), Some(minor), Some(patch), None)
            if [major, minor, patch].iter().all(|part| !part.is_empty() && part.chars().all(|character| character.is_ascii_digit()))
    )
}

fn parse_release_location(location: &str) -> Option<LatestRelease> {
    let base = Url::parse(LATEST_RELEASE_URL).ok()?;
    let url = base.join(location).ok()?;
    if url.scheme() != "https" || url.host_str() != Some("github.com") {
        return None;
    }
    let tag = url.path().strip_prefix(RELEASE_PATH_PREFIX)?;
    if tag.is_empty() || tag.contains('/') || tag.contains('%') {
        return None;
    }
    let version = tag.strip_prefix('v').unwrap_or(tag);
    valid_version(version).then(|| LatestRelease {
        version: version.to_owned(),
        release_url: url.to_string(),
    })
}

fn is_empty_releases_location(location: &str) -> bool {
    Url::parse(LATEST_RELEASE_URL)
        .ok()
        .and_then(|base| base.join(location).ok())
        .is_some_and(|url| url.scheme() == "https" && url.host_str() == Some("github.com") && url.path() == "/lynnjinjie/touch-dock/releases")
}

pub async fn latest_release() -> Result<Option<LatestRelease>, String> {
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("TouchDock/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "could not prepare the update check".to_owned())?;
    let response = client
        .get(LATEST_RELEASE_URL)
        .send()
        .await
        .map_err(|_| "could not reach the release service".to_owned())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_redirection() {
        return Err("release service returned an unexpected response".to_owned());
    }
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "release service returned an invalid location".to_owned())?;
    if is_empty_releases_location(location) {
        return Ok(None);
    }
    let release = parse_release_location(location)
        .ok_or_else(|| "release service returned an invalid location".to_owned())?;
    Ok(Some(release))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_touchdock_semver_release_locations() {
        assert_eq!(
            parse_release_location("/lynnjinjie/touch-dock/releases/tag/v1.2.3"),
            Some(LatestRelease {
                version: "1.2.3".to_owned(),
                release_url: "https://github.com/lynnjinjie/touch-dock/releases/tag/v1.2.3".to_owned(),
            })
        );
        assert!(parse_release_location("https://example.com/lynnjinjie/touch-dock/releases/tag/v1.2.3").is_none());
        assert!(parse_release_location("/another/project/releases/tag/v1.2.3").is_none());
        assert!(parse_release_location("/lynnjinjie/touch-dock/releases/tag/latest").is_none());
        assert!(parse_release_location("/lynnjinjie/touch-dock/releases/tag/v1.2.3/extra").is_none());
        assert!(is_empty_releases_location("https://github.com/lynnjinjie/touch-dock/releases"));
        assert!(!is_empty_releases_location("https://example.com/lynnjinjie/touch-dock/releases"));
    }

    #[tokio::test]
    #[ignore = "requires GitHub network access"]
    async fn checks_the_live_github_release_redirect() {
        let release = latest_release().await.expect("GitHub release check should succeed");
        assert!(release.is_none() || valid_version(&release.expect("checked above").version));
    }
}
