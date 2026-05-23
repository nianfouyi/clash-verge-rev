use super::CmdResult;
use crate::config::Config;
use clash_verge_logging::{Type, logging};
use futures::StreamExt as _;
use smartstring::alias::String;
use std::time::{Duration, Instant};
use tokio::time::timeout as tokio_timeout;

/// Test download speed through the mihomo proxy.
/// Downloads the given URL via the local HTTP proxy and returns speed in bytes/sec.
/// Returns 0 on timeout or error.
#[tauri::command]
pub async fn test_proxy_speed(url: String, timeout: u64) -> CmdResult<u64> {
    let port = {
        let verge = Config::verge().await.latest_arc();
        match verge.verge_mixed_port {
            Some(p) => p,
            None => Config::clash().await.data_arc().get_mixed_port(),
        }
    };

    let proxy_url = format!("http://127.0.0.1:{port}");
    logging!(
        debug,
        Type::Cmd,
        "Speed test start: url={url}, timeout={timeout}ms, proxy={proxy_url}"
    );

    let speed = match tokio_timeout(Duration::from_millis(timeout), async {
        let client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all(&proxy_url).map_err(|e| e.to_string())?)
            .no_proxy()
            .build()
            .map_err(|e| e.to_string())?;

        let response = client
            .get(&*url)
            .header("User-Agent", "clash-verge-speedtest")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let start = Instant::now();
        let mut total_bytes: u64 = 0;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            total_bytes += chunk.len() as u64;
        }

        let elapsed = start.elapsed().as_secs_f64();
        if elapsed < 0.001 || total_bytes == 0 {
            return Ok::<u64, String>(0);
        }

        Ok((total_bytes as f64 / elapsed) as u64)
    })
    .await
    {
        Ok(Ok(speed)) => speed,
        Ok(Err(e)) => {
            logging!(error, Type::Cmd, "Speed test download error: {e}");
            0
        }
        Err(_) => {
            logging!(warn, Type::Cmd, "Speed test timed out after {timeout}ms");
            0
        }
    };

    logging!(info, Type::Cmd, "Speed test result: {speed} bytes/s");
    Ok(speed)
}
