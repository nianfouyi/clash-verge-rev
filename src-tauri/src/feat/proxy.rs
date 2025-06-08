use crate::{
    config::{Config, IVerge},
    core::handle,
};
use serde_yaml::Mapping;
use std::env;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::time::{Duration, Instant};

/// Toggle system proxy on/off
pub fn toggle_system_proxy() {
    let enable = Config::verge().draft().enable_system_proxy;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match super::patch_verge(
            IVerge {
                enable_system_proxy: Some(!enable),
                ..IVerge::default()
            },
            false,
        )
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

/// Toggle TUN mode on/off
pub fn toggle_tun_mode(not_save_file: Option<bool>) {
    let enable = Config::verge().data().enable_tun_mode;
    let enable = enable.unwrap_or(false);

    tauri::async_runtime::spawn(async move {
        match super::patch_verge(
            IVerge {
                enable_tun_mode: Some(!enable),
                ..IVerge::default()
            },
            not_save_file.unwrap_or(false),
        )
        .await
        {
            Ok(_) => handle::Handle::refresh_verge(),
            Err(err) => log::error!(target: "app", "{err}"),
        }
    });
}

/// Copy proxy environment variables to clipboard
pub fn copy_clash_env() {
    let clash_verge_rev_ip =
        env::var("CLASH_VERGE_REV_IP").unwrap_or_else(|_| "127.0.0.1".to_string());

    let app_handle = handle::Handle::global().app_handle().unwrap();
    let port = { Config::verge().latest().verge_mixed_port.unwrap_or(7897) };
    let http_proxy = format!("http://{clash_verge_rev_ip}:{}", port);
    let socks5_proxy = format!("socks5://{clash_verge_rev_ip}:{}", port);

    let cliboard = app_handle.clipboard();
    let env_type = { Config::verge().latest().env_type.clone() };
    let env_type = match env_type {
        Some(env_type) => env_type,
        None => {
            #[cfg(not(target_os = "windows"))]
            let default = "bash";
            #[cfg(target_os = "windows")]
            let default = "powershell";

            default.to_string()
        }
    };

    let export_text = match env_type.as_str() {
        "bash" => format!(
            "export https_proxy={http_proxy} http_proxy={http_proxy} all_proxy={socks5_proxy}"
        ),
        "cmd" => format!("set http_proxy={http_proxy}\r\nset https_proxy={http_proxy}"),
        "powershell" => {
            format!("$env:HTTP_PROXY=\"{http_proxy}\"; $env:HTTPS_PROXY=\"{http_proxy}\"")
        }
        "nushell" => {
            format!("load-env {{ http_proxy: \"{http_proxy}\", https_proxy: \"{http_proxy}\" }}")
        }
        "fish" => format!("set -x http_proxy {http_proxy}; set -x https_proxy {http_proxy}"),
        _ => {
            log::error!(target: "app", "copy_clash_env: Invalid env type! {env_type}");
            return;
        }
    };

    if cliboard.write_text(export_text).is_err() {
        log::error!(target: "app", "Failed to write to clipboard");
    }
}

/// Clash API helper for proxy operations
struct ClashApi {
    client: reqwest::Client,
    base_url: String,
}

impl ClashApi {
    fn new() -> Self {
        let clash_port = Config::clash()
            .latest()
            .0
            .get("external-controller")
            .and_then(|v| v.as_str())
            .and_then(|s| s.split(':').last())
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(9090);

        Self {
            client: reqwest::Client::new(),
            base_url: format!("http://127.0.0.1:{}", clash_port),
        }
    }

    async fn get_current_proxy(&self) -> Result<String, String> {
        let url = format!("{}/proxies/GLOBAL", self.base_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get current proxy: {}", e))?;

        let proxy_info: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse proxy info: {}", e))?;

        Ok(proxy_info
            .get("now")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }

    async fn switch_proxy(&self, proxy_name: &str) -> Result<(), String> {
        let url = format!("{}/proxies/GLOBAL", self.base_url);
        self.client
            .put(&url)
            .json(&serde_json::json!({"name": proxy_name}))
            .send()
            .await
            .map_err(|e| format!("Failed to switch proxy: {}", e))?;

        // 等待代理切换生效
        tokio::time::sleep(Duration::from_millis(500)).await;
        Ok(())
    }
}

/// Download speed test configuration
#[derive(Clone)]
struct SpeedTestConfig {
    test_duration: Duration,        // 测试持续时间（而不是固定字节数）
    min_test_bytes: u64,           // 最小测试字节数
    max_test_bytes: u64,           // 最大测试字节数
    chunk_size: u64,               // 每次下载的块大小
    test_urls: Vec<String>,        // 多个测试URL备选
    user_agent: String,
}

impl Default for SpeedTestConfig {
    fn default() -> Self {
        Self {
            test_duration: Duration::from_secs(10),  // 10秒测试时间
            min_test_bytes: 1024 * 1024,             // 最少1MB
            max_test_bytes: 50 * 1024 * 1024,        // 最多50MB
            chunk_size: 1024 * 1024,                 // 1MB块大小
            test_urls: vec![
                "https://speed.cloudflare.com/__down?bytes=20971520".to_string(), // Cloudflare 20MB
                "http://speedtest.ftp.otenet.gr/files/test20Mb.db".to_string(),   // SpeedTest.net 20MB
                "https://proof.ovh.net/files/100Mb.dat".to_string(),              // OVH 100MB  
                "https://proof.ovh.net/files/10Mb.dat".to_string(),               // OVH 10MB
                "https://download.microsoft.com/download/2/0/E/20E90413-712F-438C-988E-FDAA79A8AC3D/dotnetfx35.exe".to_string(), // Microsoft 35MB
            ],
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0".to_string(),
        }
    }
}

/// Create HTTP client with optional proxy
fn create_http_client(use_proxy: bool) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::ClientBuilder::new()
        .use_rustls_tls()
        .timeout(Duration::from_millis(60000));

    if use_proxy {
        let port = Config::verge().latest().verge_mixed_port.unwrap_or(7897);
        let tun_mode = Config::verge().latest().enable_tun_mode.unwrap_or(false);

        if !tun_mode {
            let proxy_scheme = format!("http://127.0.0.1:{}", port);

            // 尝试设置各种代理类型
            if let Ok(proxy) = reqwest::Proxy::all(&proxy_scheme) {
                builder = builder.proxy(proxy);
            } else {
                // 如果all失败，尝试分别设置
                if let Ok(proxy) = reqwest::Proxy::http(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
                if let Ok(proxy) = reqwest::Proxy::https(&proxy_scheme) {
                    builder = builder.proxy(proxy);
                }
            }
        } else {
            builder = builder.no_proxy();
        }
    } else {
        builder = builder.no_proxy();
    }

    builder
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// Core download speed test function
async fn perform_speed_test(
    client: reqwest::Client,
    config: SpeedTestConfig,
) -> Result<u64, String> {
    log::info!(target: "app", "Starting intelligent speed test");
    
    // Select the best test URL
    let test_url = select_best_test_url(&client, &config).await?;
    log::info!(target: "app", "Selected test URL: {}", test_url);
    
    let mut total_bytes = 0u64;
    let mut samples: Vec<(Duration, u64)> = Vec::new(); // (time, bytes) samples
    let test_start = Instant::now();
    
    // Continue downloading until time limit is reached
    while test_start.elapsed() < config.test_duration && total_bytes < config.max_test_bytes {
        let chunk_start = Instant::now();
        
        // Send Range request to download a chunk
        let range_start = total_bytes;
        let range_end = total_bytes + config.chunk_size - 1;
        
        let request = client
            .get(&test_url)
            .header("User-Agent", &config.user_agent)
            .header("Range", format!("bytes={}-{}", range_start, range_end));
        
        match download_chunk(request).await {
            Ok(chunk_bytes) => {
                if chunk_bytes == 0 {
                    log::warn!(target: "app", "Downloaded 0 bytes, stopping test");
                    break;
                }
                
                total_bytes += chunk_bytes;
                let chunk_time = chunk_start.elapsed();
                samples.push((test_start.elapsed(), total_bytes));
                
                log::debug!(target: "app", "Downloaded chunk: {} bytes in {:?}", chunk_bytes, chunk_time);
            }
            Err(e) => {
                log::warn!(target: "app", "Chunk download failed: {}, continuing with next chunk", e);
                // Brief delay before continuing
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        }
        
        // Early exit check: end test early if speed is too slow
        if total_bytes >= config.min_test_bytes && samples.len() >= 3 {
            let avg_speed = calculate_average_speed(&samples);
            if avg_speed < 1024 { // End early if average speed < 1KB/s
                log::warn!(target: "app", "Speed too slow ({} bps), ending test early", avg_speed);
                break;
            }
        }
    }
    
    let total_time = test_start.elapsed();
    
    // Check if sufficient data was downloaded
    if total_bytes < config.min_test_bytes {
        let error_msg = format!("Insufficient data downloaded: {} bytes in {:.2}s (minimum required: {} bytes)", 
            total_bytes, total_time.as_secs_f64(), config.min_test_bytes);
        log::error!(target: "app", "{}", error_msg);
        return Err(error_msg);
    }
    
    if total_time.as_millis() == 0 {
        return Err("Test completed too quickly".into());
    }

    // Calculate more accurate average speed using sample data
    let final_speed = if samples.len() >= 3 {
        calculate_stable_speed(&samples)
    } else {
        (total_bytes as f64 / total_time.as_secs_f64()) as u64
    };
    
    log::info!(target: "app", "Speed test completed: {} bytes in {:.2}s, final speed: {} bps ({:.2} Mbps)", 
        total_bytes, total_time.as_secs_f64(), final_speed, final_speed as f64 / (1024.0 * 1024.0));
    
    Ok(final_speed)
}

/// Select the best test URL by trying to connect to each one
async fn select_best_test_url(client: &reqwest::Client, config: &SpeedTestConfig) -> Result<String, String> {
    // Try each URL in priority order
    for (index, url) in config.test_urls.iter().enumerate() {
        let url_type = match index {
            0 => "Cloudflare 20MB",
            1 => "SpeedTest.net 20MB", 
            2 => "OVH 100MB",
            3 => "OVH 10MB",
            _ => "Fallback",
        };
        
        log::debug!(target: "app", "Testing URL {}: {} - {}", index + 1, url_type, url);
        
        let request = client
            .head(url)
            .header("User-Agent", &config.user_agent)
            .timeout(Duration::from_secs(5));
        
        if let Ok(response) = request.send().await {
            if response.status().is_success() {
                log::info!(target: "app", "Selected test URL: {} - {}", url_type, url);
                return Ok(url.clone());
            }
        }
        log::debug!(target: "app", "URL unavailable: {} - {}", url_type, url);
    }
    
    // If all URLs fail, use Cloudflare as fallback
    log::warn!(target: "app", "All test URLs failed, using Cloudflare as fallback");
    Ok(config.test_urls[0].clone())
}

/// Download a single chunk of data
async fn download_chunk(request: reqwest::RequestBuilder) -> Result<u64, String> {
    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() && response.status().as_u16() != 206 {
        return Err(format!("HTTP error: {}", response.status()));
    }
    
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    
    Ok(bytes.len() as u64)
}

/// Calculate average speed from samples
fn calculate_average_speed(samples: &[(Duration, u64)]) -> u64 {
    if samples.len() < 2 {
        return 0;
    }
    
    let total_time = samples.last().unwrap().0.as_secs_f64();
    let total_bytes = samples.last().unwrap().1;
    
    if total_time > 0.0 {
        (total_bytes as f64 / total_time) as u64
    } else {
        0
    }
}

/// Calculate stable speed using the middle portion of samples (exclude initial ramp-up)
fn calculate_stable_speed(samples: &[(Duration, u64)]) -> u64 {
    if samples.len() < 4 {
        return calculate_average_speed(samples);
    }
    
    // Use middle 70% of samples to calculate stable speed (exclude initial ramp-up and end)
    let skip_count = samples.len() / 6; // Skip first and last 1/6 of samples
    let stable_samples = &samples[skip_count..samples.len() - skip_count];
    
    if stable_samples.len() < 2 {
        return calculate_average_speed(samples);
    }
    
    let start_sample = stable_samples.first().unwrap();
    let end_sample = stable_samples.last().unwrap();
    
    let time_diff = (end_sample.0 - start_sample.0).as_secs_f64();
    let bytes_diff = end_sample.1 - start_sample.1;
    
    if time_diff > 0.0 {
        (bytes_diff as f64 / time_diff) as u64
    } else {
        calculate_average_speed(samples)
    }
}

/// Helper function to restore proxy
async fn restore_proxy_if_needed(clash_api: &ClashApi, original_proxy: &str, current_proxy: &str) {
    if !original_proxy.is_empty() && original_proxy != current_proxy {
        let _ = clash_api.switch_proxy(original_proxy).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

/// Test proxy download speed via Clash API
pub async fn test_download_speed(name: String, _proxy: Mapping) -> Result<u64, String> {
    log::info!(target: "app", "Starting download speed test for proxy: {}", name);
    
    // Direct connection test doesn't need proxy switching
    if name == "DIRECT" {
        log::info!(target: "app", "Testing direct connection");
        let client = create_http_client(false)?;
        let config = SpeedTestConfig::default();
        return perform_speed_test(client, config).await;
    }

    let clash_api = ClashApi::new();

    // Get current proxy for later restoration
    log::info!(target: "app", "Getting current proxy configuration");
    let original_proxy = match clash_api.get_current_proxy().await {
        Ok(proxy) => proxy,
        Err(e) => {
            log::error!(target: "app", "Failed to get current proxy: {}", e);
            return Err(e);
        }
    };
    
    log::info!(target: "app", "Current proxy: {}, switching to: {}", original_proxy, name);

    // Switch to test proxy
    if let Err(e) = clash_api.switch_proxy(&name).await {
        log::error!(target: "app", "Failed to switch to proxy {}: {}", name, e);
        restore_proxy_if_needed(&clash_api, &original_proxy, &name).await;
        return Err(e);
    }

    // Create HTTP client with proxy
    log::info!(target: "app", "Creating HTTP client with proxy");
    let client = match create_http_client(true) {
        Ok(client) => client,
        Err(e) => {
            log::error!(target: "app", "Failed to create HTTP client: {}", e);
            restore_proxy_if_needed(&clash_api, &original_proxy, &name).await;
            return Err(e);
        }
    };

    // Execute speed test
    log::info!(target: "app", "Starting speed test");
    let config = SpeedTestConfig::default();
    let result = perform_speed_test(client, config).await;

    // Restore original proxy
    log::info!(target: "app", "Restoring original proxy: {}", original_proxy);
    restore_proxy_if_needed(&clash_api, &original_proxy, &name).await;

    match &result {
        Ok(speed) => log::info!(target: "app", "Speed test completed successfully: {} bps", speed),
        Err(e) => log::error!(target: "app", "Speed test failed: {}", e),
    }

    result
}
