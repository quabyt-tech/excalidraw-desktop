use tauri::{Emitter, Manager};

/// First CLI argument that is an existing .excalidraw file.
fn excalidraw_file_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| a.ends_with(".excalidraw") && std::path::Path::new(a).is_file())
}

#[tauri::command]
fn get_launch_file() -> Option<String> {
    excalidraw_file_arg(std::env::args())
}

/// Move a file or folder to the OS trash / recycle bin.
#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered before deep-link so the running instance receives the URL
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                // File double-clicked while the app is already running
                if let Some(path) = excalidraw_file_arg(argv) {
                    let _ = window.emit("open-file", path);
                }
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
        .invoke_handler(tauri::generate_handler![get_launch_file, move_to_trash])
        .setup(|app| {
            // Ensure app data dir exists (library.json / settings.json live there)
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
