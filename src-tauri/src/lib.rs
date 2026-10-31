mod config;
mod game;
mod history;
mod mods;
mod network;
mod race;
mod server;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(server::ServerState::default())
        .manage(network::NetState::default())
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_ac_path,
            config::set_player_name,
            game::detect_game,
            game::check_game_path,
            game::list_cars,
            game::list_tracks,
            game::list_weathers,
            game::car_preview,
            game::track_preview,
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
            mods::uninstall_mod,
            network::network_info,
            network::open_ports,
            network::close_ports,
        ])
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
