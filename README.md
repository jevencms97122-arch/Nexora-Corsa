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

## Publier une version (mises à jour automatiques)

Les mises à jour passent par les Releases GitHub, signées avec une clé que toi seul possèdes.

1. **Une seule fois** : dans GitHub, `Settings → Secrets and variables → Actions`, crée le secret
   `TAURI_SIGNING_PRIVATE_KEY` avec le contenu du fichier `%USERPROFILE%\.tauri\nexora-corsa.key`
   (la clé privée reste hors du dépôt : ne la partage jamais, et sauvegarde-la, sans elle plus aucune mise à jour ne peut être signée).
2. Augmente `version` dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`.
3. Publie : `git tag v0.2.0 && git push origin v0.2.0`.

GitHub Actions compile l'installeur, le signe et crée la release avec `latest.json`. Les launchers déjà installés
détectent la nouvelle version au démarrage (bouton « Mettre à jour » dans la barre latérale).

## Fonctionnement

| Fonction | Détail |
|---|---|
| Détection du jeu | Registre Steam + `libraryfolders.vdf`, ou choix manuel du dossier |
| Solo | Écrit `Documents/Assetto Corsa/cfg/race.ini` (ancienne version sauvegardée en `race.ini.nexora.bak`) puis lance `acs.exe` |
| Héberger | Génère `server_cfg.ini` / `entry_list.ini` dans le dossier de données de l'app et lance `acServer.exe -c … -e …` |
| Rejoindre | Écrit un `race.ini` en mode `[REMOTE]` avec ton SteamID64 (Steam doit être ouvert) |

## Archives de mods

Les mods se téléchargent en `.zip`, `.7z` ou `.rar` : le format est reconnu automatiquement, le contenu est analysé
(`ui_car.json` / `ui_track.json`) puis copié dans `content/cars` ou `content/tracks`. Les `.rar` protégés par mot de passe
ou répartis en plusieurs parties ne sont pas pris en charge.

Composants tiers : `sevenz-rust2` (7z, Apache-2.0) et `unrar` (RAR, lecture seule, code source UnRAR de RARLAB sous la
[licence UnRAR](https://www.rarlab.com/rar/unrarsrc-license.txt) : extraction uniquement, jamais de création d'archives RAR).

## Graphismes

La page **Graphismes** regroupe quatre réglages :

- **Profils de qualité** (Équilibré, Élevé, Ultra, Cinéma) : écrivent `video.ini` et des fichiers de surcharge de Custom Shaders Patch dans
  `Documents/Assetto Corsa/cfg` (et `cfg/extension`), jamais dans le dossier du jeu. Les clés viennent des fichiers de CSP 0.2.x
  (Extra FX, SSLR, ASSAO, lumières volumétriques, herbe, reflets, distance d'affichage…). Les fichiers d'origine sont sauvegardés avant la
  première modification et se restaurent d'un clic ; sans CSP, seule la partie vidéo est appliquée.
- **Carte graphique** : active le réglage Windows « Haute performance » pour `acs.exe`, `AssettoCorsa.exe` et `acs_x86.exe`
  (`HKCU\Software\Microsoft\DirectX\UserGpuPreferences`). Utile sur un portable avec puce intégrée.
- **Filtres d'image** : liste les filtres de `system/cfg/ppfilters`, choisit le filtre actif (`video.ini`, `[POST_PROCESS] FILTER`).
  Un filtre (fichier `.ini` ou archive) s'installe depuis l'onglet Mods.
- **Ciel et météo** : choix du contrôleur et du style de ciel de WeatherFX (`weather_fx.ini`). Un mod de ciel (Sol, Pure…) téléchargé est reconnu
  et installé ; seuls `content/weather`, `extension/weather` et `extension/weather-controllers` sont copiés, le reste de l'archive est ignoré.

## Aides à la conduite

Dans **Paramètres → Aides à la conduite**, trois profils reprennent ceux du lanceur d'Assetto Corsa : **Gamer** (toutes les
aides), **Intermédiaire** et **Pro** (aucune aide). Le profil choisi est écrit dans `Documents/Assetto Corsa/cfg/assists.ini`
à chaque lancement (solo ou en ligne). Seules les clés du profil sont modifiées (ligne idéale, boîte, embrayage, auto-blip, ABS,
anti-patinage, stabilité, carburant, usure des pneus) ; dégâts, chauffe-pneus et aspiration restent ceux du jeu. L'ancien fichier est
sauvegardé une fois en `assists.ini.nexora.bak`.

## Custom Shaders Patch

Nexora-Corsa détecte Custom Shaders Patch (`dwrite.dll` + dossier `extension`, version lue dans `extension/installed.log`).
S'il manque, l'accueil propose de l'installer : le bouton ouvre la page de téléchargement de la **v0.2.11** sur modland.net
(miroir tiers, pas le site de l'auteur), l'application repère l'archive dans Téléchargements puis l'installe à la racine du jeu
après confirmation (l'ancien `dwrite.dll` est conservé en `dwrite.dll.nexora-bak`). Les fichiers de CSP ne sont pas redistribués
avec Nexora-Corsa. L'adresse se change dans `src-tauri/src/csp.rs` (`DOWNLOAD_URL`).

## Filtre des voitures

Les voitures sont classées « jeu de base », « DLC » (avec le nom du pack) ou « mod » grâce à la liste officielle fournie par
CSP dans `extension/config/data_standard_content.ini`, ou à une copie de secours intégrée (`src-tauri/src/official_cars.ini`,
sans aucune clé) quand CSP n'est pas installé. Toute voiture absente de cette liste est un mod.

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
- [x] Mises à jour automatiques via GitHub Releases (voir « Publier une version »)
- [ ] Profils pilotes multiples, chronos issus du jeu
