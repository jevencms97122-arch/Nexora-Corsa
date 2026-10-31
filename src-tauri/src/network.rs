use igd_next::{PortMappingProtocol, SearchOptions, search_gateway};
use serde::Serialize;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Serialize, Clone, Default)]
pub struct NetworkInfo {
    pub local_ip: Option<String>,
    pub public_ip: Option<String>,
    /// Un routeur compatible UPnP a répondu.
    pub upnp: bool,
    /// IP externe vue par le routeur (peut différer de l'IP publique en cas de CGNAT).
    pub router_ip: Option<String>,
    /// Le fournisseur d'accès partage une même IP entre plusieurs clients : l'ouverture de ports est alors impossible.
    pub cgnat: bool,
}

#[derive(Serialize)]
pub struct PortsResult {
    pub opened: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Default, Clone)]
pub struct NetState(Arc<Mutex<Vec<(PortMappingProtocol, u16)>>>);

impl NetState {
    /// Referme tous les ports ouverts par Nexora-Corsa. Sans effet si aucun UPnP.
    pub fn close_all(&self) {
        let mapped = std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()));
        if mapped.is_empty() {
            return;
        }
        if let Ok(gw) = search_gateway(search_options()) {
            for (proto, port) in mapped {
                let _ = gw.remove_port(proto, port);
            }
        }
    }
}

fn search_options() -> SearchOptions {
    let mut options = SearchOptions::default();
    options.timeout = Some(Duration::from_secs(3));
    options
}

fn local_ipv4() -> Option<Ipv4Addr> {
    // Le « connect » UDP n'envoie aucun paquet : il sert juste à choisir l'interface.
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

fn public_ip() -> Option<Ipv4Addr> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let body = agent.get("https://api.ipify.org").call().ok()?.body_mut().read_to_string().ok()?;
    body.trim().parse().ok()
}

/// 100.64.0.0/10 est la plage réservée au CGNAT ; les plages privées signifient aussi un double NAT.
fn is_shared_or_private(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    ip.is_private() || ip.is_loopback() || ip.is_link_local() || (o[0] == 100 && (64..128).contains(&o[1]))
}

fn gather_network_info() -> NetworkInfo {
    let public = public_ip();
    let (upnp, router_ip) = match search_gateway(search_options()) {
        Ok(gw) => (true, gw.get_external_ip().ok().map(|ip| ip.to_string())),
        Err(_) => (false, None),
    };
    let router_v4 = router_ip.as_deref().and_then(|s| s.parse::<Ipv4Addr>().ok());
    let cgnat = match (router_v4, public) {
        (Some(r), _) if is_shared_or_private(r) => true,
        (Some(r), Some(p)) => r != p,
        _ => false,
    };
    NetworkInfo {
        local_ip: local_ipv4().map(|ip| ip.to_string()),
        public_ip: public.map(|ip| ip.to_string()),
        upnp,
        router_ip,
        cgnat,
    }
}

#[tauri::command]
pub async fn network_info() -> NetworkInfo {
    tauri::async_runtime::spawn_blocking(gather_network_info).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn network_info_runs() {
        let info = super::gather_network_info();
        println!(
            "local={:?} public={:?} upnp={} router={:?} cgnat={}",
            info.local_ip, info.public_ip, info.upnp, info.router_ip, info.cgnat
        );
        assert!(info.local_ip.is_some());
    }

    /// Modifie réellement la box (mapping temporaire, retiré aussitôt) : lancer avec `--ignored`.
    #[test]
    #[ignore]
    fn upnp_roundtrip() {
        use igd_next::PortMappingProtocol::TCP;
        use std::net::{SocketAddr, SocketAddrV4};
        let gw = super::search_gateway(super::search_options()).expect("pas de routeur UPnP");
        let addr = SocketAddr::V4(SocketAddrV4::new(super::local_ipv4().unwrap(), 49777));
        gw.add_port(TCP, 49777, addr, 120, "Nexora-Corsa test").expect("ajout refusé");
        gw.remove_port(TCP, 49777).expect("retrait refusé");
    }

    #[test]
    fn cgnat_ranges() {
        use std::net::Ipv4Addr;
        assert!(super::is_shared_or_private(Ipv4Addr::new(100, 64, 1, 1)));
        assert!(super::is_shared_or_private(Ipv4Addr::new(192, 168, 1, 1)));
        assert!(!super::is_shared_or_private(Ipv4Addr::new(100, 128, 0, 1)));
        assert!(!super::is_shared_or_private(Ipv4Addr::new(8, 8, 8, 8)));
    }
}

/// Ouvre les ports du serveur sur la box via UPnP.
#[tauri::command]
pub async fn open_ports(
    state: tauri::State<'_, NetState>,
    tcp_port: u16,
    udp_port: u16,
    http_port: u16,
) -> Result<PortsResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let local = local_ipv4().ok_or("Adresse locale introuvable.")?;
        let gw = search_gateway(search_options())
            .map_err(|_| "Aucun routeur UPnP détecté : ouvre les ports à la main sur ta box.".to_string())?;
        let wanted = [
            (PortMappingProtocol::TCP, tcp_port),
            (PortMappingProtocol::UDP, udp_port),
            (PortMappingProtocol::TCP, http_port),
        ];
        let mut result = PortsResult { opened: vec![], failed: vec![] };
        for (proto, port) in wanted {
            let label = format!("{} {port}", if proto == PortMappingProtocol::TCP { "TCP" } else { "UDP" });
            let addr = SocketAddr::V4(SocketAddrV4::new(local, port));
            // Certains routeurs refusent un bail illimité (0) : on retente avec une durée.
            let ok = gw.add_port(proto, port, addr, 0, "Nexora-Corsa").is_ok()
                || gw.add_port(proto, port, addr, 86_400, "Nexora-Corsa").is_ok();
            if ok {
                state.0.lock().unwrap_or_else(|e| e.into_inner()).push((proto, port));
                result.opened.push(label);
            } else {
                result.failed.push(label);
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn close_ports(state: tauri::State<'_, NetState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.close_all())
        .await
        .map_err(|e| e.to_string())
}
