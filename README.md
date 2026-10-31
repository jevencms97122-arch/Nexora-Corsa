# Nexora-Corsa

Launcher plug and play pour **Assetto Corsa** (le premier) : détection automatique du jeu, sessions solo,
et création / connexion de parties en ligne grâce au `acServer.exe` déjà livré avec le jeu.

## Lancer en développement

```bash
npm install
npm run tauri dev
```

Prérequis : Node 20+, Rust (toolchain MSVC) et les Build Tools Visual Studio.

## Générer l'installeur

```bash
npm run tauri build
```

L'installeur NSIS est créé dans `src-tauri/target/release/bundle/nsis/`.

## Fonctionnement

| Fonction | Détail |
|---|---|
| Détection du jeu | Registre Steam + `libraryfolders.vdf`, ou choix manuel du dossier |
| Solo | Écrit `Documents/Assetto Corsa/cfg/race.ini` (ancienne version sauvegardée en `race.ini.nexora.bak`) puis lance `acs.exe` |
| Héberger | Génère `server_cfg.ini` / `entry_list.ini` dans le dossier de données de l'app et lance `acServer.exe -c … -e …` |
| Rejoindre | Écrit un `race.ini` en mode `[REMOTE]` avec ton SteamID64 (Steam doit être ouvert) |

## Réseau

Au démarrage d'un serveur, Nexora-Corsa ouvre automatiquement sur ta box (UPnP) les ports **TCP/UDP 9600** et
**TCP 8081** (modifiables dans les réglages avancés), puis les referme à l'arrêt ou à la fermeture du launcher.
Il affiche ton IP publique, détecte le CGNAT (dans ce cas aucun ami extérieur ne pourra se connecter sans tunnel/VPN)
et génère des **codes d'invitation** `NXC-…` à coller dans l'onglet « Rejoindre ». Si ta box n'a pas d'UPnP, ouvre les ports à la main.

## Feuille de route

- [x] Phase 1 : détection du jeu, scan voitures / circuits, session solo
- [x] Phase 2 : serveur intégré (création, console, arrêt), rejoindre par IP
- [x] Phase 3 : UPnP, IP publique, détection CGNAT, code d'invitation
- [ ] Phase 3 bis : relais / tunnel pour les connexions bloquées par CGNAT
- [x] Phase 4 : installation de mods par zip (voitures et circuits, désinstallation), historique des sessions avec relance solo
- [ ] Mises à jour automatiques : nécessite un dépôt de publication (ex. GitHub Releases) et une clé de signature, voir `tauri-plugin-updater`
- [ ] Profils pilotes multiples, chronos issus du jeu
