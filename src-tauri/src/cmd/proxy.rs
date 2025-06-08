use super::CmdResult;
use crate::module::mihomo::MihomoManager;

#[tauri::command]
pub async fn get_proxies() -> CmdResult<serde_json::Value> {
    let mannager = MihomoManager::global();

    mannager
        .refresh_proxies()
        .await
        .map(|_| mannager.get_proxies())
        .or_else(|_| Ok(mannager.get_proxies()))
}

#[tauri::command]
pub async fn get_providers_proxies() -> CmdResult<serde_json::Value> {
    let mannager = MihomoManager::global();

    mannager
        .refresh_providers_proxies()
        .await
        .map(|_| mannager.get_providers_proxies())
        .or_else(|_| Ok(mannager.get_providers_proxies()))
}

#[tauri::command]
pub async fn cmd_test_download_speed(name: String) -> Result<u64, String> {
    println!("🚀 [DEBUG] cmd_test_download_speed 被调用，代理名称: {}", name);
    eprintln!("🚀 [DEBUG] cmd_test_download_speed 被调用，代理名称: {}", name);
    
    // 统一使用API策略：直接通过Clash API切换代理然后测试
    // 这样更简洁、可靠，且不依赖配置文件的同步状态
    let result = crate::feat::test_download_speed(name.clone(), serde_yaml::Mapping::new()).await;
    
    match &result {
        Ok(speed) => {
            println!("✅ [DEBUG] 下载速度测试成功，代理: {}, 速度: {} bps", name, speed);
            eprintln!("✅ [DEBUG] 下载速度测试成功，代理: {}, 速度: {} bps", name, speed);
        }
        Err(err) => {
            println!("❌ [DEBUG] 下载速度测试失败，代理: {}, 错误: {}", name, err);
            eprintln!("❌ [DEBUG] 下载速度测试失败，代理: {}, 错误: {}", name, err);
        }
    }
    
    result
}
