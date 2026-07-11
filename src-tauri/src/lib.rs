use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered before deep-link so the running instance receives the URL
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Ensure app data dir exists (library.json lives there)
            std::fs::create_dir_all(app.path().app_data_dir()?)?;

            // Linux has no install-time protocol registration (.desktop based); do it at runtime.
            // Windows/macOS register via the installer — registering here in dev would
            // hijack the scheme from the installed app every `tauri dev` run.
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            let window = app.get_webview_window("main").unwrap();

            // Set the window icon (needed for taskbar icon in dev mode)
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;
            window.set_icon(icon)?;

            // Windows/Linux: hide native decorations, we use a custom titlebar
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            window.set_decorations(false)?;

            // macOS: use overlay titlebar with hidden title for native traffic lights
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                window.set_title_bar_style(TitleBarStyle::Overlay)?;
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
