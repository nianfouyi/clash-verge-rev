use super::CmdResult;
use crate::config::Config;
use crate::core::handle::Handle;
use clash_verge_logging::{Type, logging};
use futures::StreamExt as _;
use smartstring::alias::String;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio::time::timeout as tokio_timeout;

// Serialize all speed tests so proxy group switching doesn't conflict.
static SPEED_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

/// Test download speed through a specific proxy node.
///
/// Uses a select-test-restore pattern:
/// 1. Read the current node for the group
/// 2. Switch to the target node
/// 3. Download the test file through the local proxy
/// 4. Restore the original node
///
/// Returns speed in bytes/sec, or 0 on timeout/error.
#[tauri::command]
pub async fn test_proxy_speed(
    name: String,
    group: String,
    url: String,
    timeout: u64,
) -> CmdResult<u64> {
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
        "Speed test start: node={name}, group={group}, url={url}, timeout={timeout}ms"
    );

    // Acquire the global lock — all speed tests run serially.
    let _guard = SPEED_TEST_LOCK.lock().await;

    let mihomo = Handle::mihomo().await;

    // Step 1: Read the currently selected node for this group.
    let original_node = match mihomo.get_proxy_by_name(&group).await {
        Ok(proxy) => proxy.now.unwrap_or_default(),
        Err(e) => {
            logging!(
                error,
                Type::Cmd,
                "Speed test failed to read group {group}: {e}"
            );
            return Ok(0);
        }
    };

    logging!(
        debug,
        Type::Cmd,
        "Speed test: current node={original_node}, switching to {name}"
    );

    // Step 2: Switch to the target node.
    if let Err(e) = mihomo.select_node_for_group(&group, &name).await {
        logging!(
            error,
            Type::Cmd,
            "Speed test failed to switch to {name}: {e}"
        );
        return Ok(0);
    }

    // Drop the mihomo read lock before downloading (we don't hold it during the download).
    drop(mihomo);

    // Step 3: Download through the local proxy.
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

    // Step 4: Restore the original node.
    let mihomo = Handle::mihomo().await;
    if let Err(e) = mihomo.select_node_for_group(&group, &original_node).await {
        logging!(
            error,
            Type::Cmd,
            "Speed test failed to restore {group} -> {original_node}: {e}"
        );
    } else {
        logging!(
            debug,
            Type::Cmd,
            "Speed test: restored {group} -> {original_node}"
        );
    }
    drop(mihomo);

    logging!(info, Type::Cmd, "Speed test result: {name} = {speed} bytes/s");
    Ok(speed)
}
