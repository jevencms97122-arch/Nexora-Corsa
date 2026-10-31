mod assists;
mod config;
mod controls;
mod csp;
mod csp_config;
mod game;
mod gpu;
mod graphics;
mod history;
mod ini;
mod mods;
mod network;
mod race;
mod server;

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Emitter, Manager, RunEvent, WebviewWindowBuilder};

#[derive(Serialize, Clone)]
struct DownloadStarted {
    url: String,
    name: String,
}

#[derive(Serialize, Clone)]
struct DownloadFinished {
    url: String,
    name: String,
    path: Option<String>,
    success: bool,
}

fn file_name(path: &std::path::Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(server::ServerState::default())
        .manage(network::NetState::default())
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_ac_path,
            config::set_player_name,
            config::set_assists,
            assists::assist_presets,
            csp_config::csp_modules,
            csp_config::csp_module,
            csp_config::set_csp_values,
            csp_config::reset_csp_module,
            controls::controls_state,
            controls::set_controls,
            controls::restore_controls,
            gpu::gpu_info,
            gpu::set_gpu_preference,
            graphics::graphics_state,
            graphics::apply_graphics_profile,
            graphics::restore_graphics,
            graphics::list_filters,
            graphics::set_filter,
            graphics::weather_options,
            graphics::set_weather,
            csp::csp_status,
            csp::csp_source,
            csp::download_csp,
            csp::uninstall_csp,
            game::detect_game,
            game::check_game_path,
            game::list_cars,
            game::list_tracks,
            game::list_weathers,
            race::launch_solo,
            race::join_server,
            server::start_server,
            server::stop_server,
            server::server_status,
            server::server_log,
            history::get_history,
            history::clear_history,
            mods::inspect_mod,
            mods::install_mod,
            mods::list_mods,
            mods::recent_downloads,
            mods::uninstall_mod,
            network::network_info,
            network::open_ports,
            network::close_ports,
        ])
        .setup(|app| {
            // Un site affiché dans le Garage qui demande une nouvelle fenêtre (target=_blank, window.open)
            // ne l'obtiendrait pas : on la refuse et on demande à l'interface d'ouvrir un onglet intégré.
            if let Some(ac) = config::load(app.handle()).ac_path {
                config::allow_game_assets(app.handle(), std::path::Path::new(&ac));
            }
            let handle = app.handle().clone();
            let download_handle = app.handle().clone();
            let config = app.config().app.windows.first().cloned().ok_or("fenêtre principale absente de la config")?;
            WebviewWindowBuilder::from_config(app, &config)?
                .initialization_script_for_all_frames(include_str!("new_tab.js"))
                // Les téléchargements du Garage restent dans le dossier Téléchargements, mais l'interface
                // est prévenue au début et à la fin pour afficher un retour et proposer l'installation.
                .on_download(move |_webview, event| {
                    match event {
                        DownloadEvent::Requested { url, destination } => {
                            let _ = download_handle.emit(
                                "download-started",
                                DownloadStarted { url: url.to_string(), name: file_name(destination) },
                            );
                        }
                        DownloadEvent::Finished { url, path, success } => {
                            let _ = download_handle.emit(
                                "download-finished",
                                DownloadFinished {
                                    url: url.to_string(),
                                    name: path.as_deref().map(file_name).unwrap_or_default(),
                                    path: path.map(|p| p.to_string_lossy().into_owned()),
                                    success,
                                },
                            );
                        }
                        _ => {}
                    }
                    true
                })
                .on_new_window(move |url, _features| {
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = handle.emit("garage-new-tab", url.to_string());
                    }
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de Nexora-Corsa");

    app.run(|handle, event| {
        // Ne jamais laisser un acServer.exe orphelin quand le launcher se ferme.
        if let RunEvent::Exit = event {
            handle.state::<server::ServerState>().stop();
            handle.state::<network::NetState>().close_all();
        }
    });
}
