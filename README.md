# Jellyfin en boucle

Lecture aléatoire et continue d'une série Jellyfin sur **Jellyfin MPV Shim**, pilotable depuis le téléphone.
Remplace le script `the-office-random.fish` (et `auth.py`).

- Enchaîne les épisodes au hasard (sans revoir les mêmes avant d'avoir fait le tour de la série) et coupe 30 s avant la fin pour bloquer l'autoplay de Jellyfin.
- **Films déjà vus** : une liste de films gérée dans l'application, lue en aléatoire comme une série. Le **générique de fin est passé automatiquement** (voir [Films déjà vus](#films-déjà-vus-et-passage-du-générique)).
- Interface web mobile : épisode en cours, pause / reprise / passer / stop, barre de progression (seek), volume, mute, piste audio, sous-titres, file des prochains épisodes (retirer, monter, lire maintenant, nouveau tirage), historique avec l'heure, choix de la série, mode auto.
- **QR code** pour ouvrir l'interface sur le téléphone : affiché en grand à l'ouverture de la page sur le PC, à chaque ouverture de session, et dans le journal du service.
- **Assistant de configuration** pour un PC neuf : découverte du serveur Jellyfin sur le réseau, connexion, détection de MPV Shim, choix de la série.
- Linux (service systemd utilisateur) et Windows (tâche planifiée au login).

Un seul process Node (port **8787**). Le token Jellyfin reste sur le PC : le téléphone ne parle qu'à l'application, jamais à Jellyfin.

## Installation

Prérequis : Git. Tout le reste (Node.js, Jellyfin MPV Shim) est installé automatiquement s'il manque, **sans question**. Seuls restent le mot de passe `sudo` (Linux) ou la fenêtre de confirmation administrateur (Windows), puis la connexion de MPV Shim à Jellyfin, guidée par l'interface.

Tout ce que l'installation ajoute est noté dans `install-manifest` (dossier de configuration) : la désinstallation retire exactement ça, et rien d'autre. L'installation peut être relancée autant de fois que voulu (mise à jour, réparation) ; ce qu'elle avait installé la première fois reste « à elle ».

### Linux

```bash
git clone https://github.com/benjosivo/jellyfin-shuffle-tv.git ~/jellyfin-shuffle-tv
cd ~/jellyfin-shuffle-tv
deploy/linux/install.sh
```

Le script (à lancer sans `sudo`, il le demande au besoin) :

1. installe Node.js ≥ 20 s'il manque ou s'il est trop ancien (paquets de la distribution ; dépôt officiel NodeSource sur Debian/Ubuntu) ;
2. installe **Jellyfin MPV Shim** s'il manque (AUR via `paru`/`yay` sur Arch/CachyOS, sinon Flatpak, sinon `pipx`), le lance, et le fait démarrer à l'ouverture de session ;
3. installe les dépendances et compile (`npm ci && npm run build`) ;
4. installe et démarre le service `~/.config/systemd/user/jellyfin-office.service` (`Restart=on-failure`) ;
5. installe le minuteur de [mise à jour automatique](#mise-à-jour-automatique) (`jellyfin-office-update.timer`) ;
6. ouvre le port 8787 si `ufw` ou `firewalld` est actif ;
7. ajoute l'ouverture de la page QR code au login (`~/.config/autostart/jellyfin-en-boucle.desktop`) ;
8. affiche l'**icône d'état** près de l'horloge, et la relance à chaque session ;
9. signale tout lancement automatique de l'ancien script fish **sans rien supprimer** : à désactiver soi-même, sinon les deux pilotent MPV Shim en même temps.

Options : `--ask` (confirmer chaque étape ; propose aussi le démarrage sans session ouverte, « linger »), `--no-mpv-shim`, `--no-open-ui`, `--no-tray`, `--no-auto-update`. Port différent : `PORT=8080 deploy/linux/install.sh`.

### Windows

Dans PowerShell, depuis le dossier du projet :

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1 -Yes
```

Le script demande les droits administrateur (pare-feu, tâche planifiée) ; utiliser un compte qui est lui-même administrateur, pour que la tâche soit créée pour le bon utilisateur. Il :

1. installe Node.js LTS avec `winget` s'il manque ;
2. télécharge la dernière version de **Jellyfin MPV Shim** sur GitHub et l'installe **en silence** s'il manque (repli sur l'installeur normal si besoin), le lance, et l'ajoute au dossier Démarrage ;
3. compile l'application ;
4. crée la tâche planifiée « Jellyfin en boucle » (au login, sans fenêtre, relance automatique en cas de plantage) ;
5. crée la tâche planifiée « Jellyfin en boucle (mise à jour) » ([mise à jour automatique](#mise-à-jour-automatique)) ;
6. ouvre le port 8787 sur les réseaux privés. Si le réseau est en « public », il **demande toujours** avant de le passer en « privé », même avec `-Yes` : à ne faire que pour le réseau de la maison ;
7. ajoute l'ouverture de la page QR code au login (raccourci dans le dossier Démarrage) ;
8. crée le raccourci **« Jellyfin en boucle »** dans le menu Démarrer et sur le bureau ;
9. affiche l'**icône d'état** près de l'horloge, et la relance à chaque session.

Options : `-Yes` (aucune question), `-NoMpvShim`, `-NoOpenUi`, `-NoShortcuts`, `-NoTray`, `-NoAutoUpdate`, `-Port 8080`. Journal : `%APPDATA%\jellyfin-office\service.log`.

### Démarrer / relancer

Rien à lancer à la main en temps normal. À la fin de l'installation, puis à chaque ouverture de session :
- le serveur démarre (service systemd sous Linux, tâche planifiée sous Windows, sans fenêtre) ;
- MPV Shim démarre ;
- le navigateur s'ouvre sur la page du QR code ;
- l'icône d'état apparaît près de l'horloge.

**Savoir si ça tourne** : l'icône près de l'horloge (zone de notification) indique l'état en permanence.

| Couleur | Symbole | État |
|---|---|---|
| vert | ▶ | lecture en cours (l'infobulle donne l'épisode) |
| bleu | ❚❚ | en pause |
| gris | ■ | en attente (entre deux épisodes, ou mode auto désactivé) |
| orange | ! | problème : Jellyfin injoignable, MPV Shim introuvable, configuration à faire… |
| rouge | ✕ | serveur arrêté |

- Clic sur l'icône : ouvrir l'interface ; si le serveur est arrêté, il est d'abord relancé.
- Clic droit : menu (QR code, pause / reprise, épisode suivant, redémarrer le serveur, masquer l'icône).
- Sous Windows, si l'icône est cachée : flèche `^` près de l'horloge, puis la faire glisser dans la barre des tâches.
- Sous Linux, l'icône utilise le protocole standard des zones de notification. KDE Plasma, Xfce et Cinnamon l'affichent directement. GNOME l'affiche seulement avec l'extension « AppIndicator » : paquet `gnome-shell-extension-appindicator`, activée par défaut sur Ubuntu.

Pour y revenir plus tard :
- **Windows** : raccourci **« Jellyfin en boucle »** (menu Démarrer ou bureau). Il relance le serveur s'il est arrêté, puis ouvre l'interface. Si le serveur ne répond toujours pas, une fenêtre indique où trouver le journal.
- **Partout** : ouvrir `http://localhost:8787` sur le PC, ou scanner le QR code avec le téléphone.
- **En dernier recours** :
  - Linux : `systemctl --user restart jellyfin-office` ;
  - Windows (PowerShell) : `Start-ScheduledTask -TaskName "Jellyfin en boucle"`.
- **Journal** : `journalctl --user -u jellyfin-office -f` (Linux), `%APPDATA%\jellyfin-office\service.log` (Windows).

### Mise à jour automatique

L'application se met à jour toute seule depuis le dépôt git : **chaque jour vers 4 h** et peu après chaque ouverture de session (minuteur systemd sous Linux, tâche planifiée sous Windows, sans droits administrateur ni fenêtre). Une mise à jour :

1. récupère la branche suivie par le dossier (`git fetch`, puis `git merge --ff-only`) ;
2. réinstalle les dépendances seulement si `package.json` ou `package-lock.json` ont changé, puis recompile ;
3. relance l'application, si elle tournait.

Si l'installation ou le build échoue, l'ancienne version est rétablie. Rien n'est fait quand le dossier contient des fichiers suivis modifiés ou des commits non publiés, pour ne jamais écraser un travail local. Les fichiers d'installation (service, tâche planifiée, pare-feu) ne sont pas touchés : après une mise à jour qui les modifie, relancer l'installation.

- À la demande : `deploy/linux/update.sh` ou `powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1`.
- Journal : `journalctl --user -u jellyfin-office-update` (Linux), `%APPDATA%\jellyfin-office\update.log` (Windows).
- Désactiver : réinstaller avec `--no-auto-update` / `-NoAutoUpdate` (retire le minuteur ou la tâche), ou arrêter seulement le minuteur : `systemctl --user disable --now jellyfin-office-update.timer` (Linux), `Disable-ScheduledTask -TaskName "Jellyfin en boucle (mise à jour)"` (Windows, en administrateur).

### Désinstallation

```bash
deploy/linux/uninstall.sh                                               # Linux
powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall.ps1    # Windows
```

Par défaut, tout est retiré, secrets compris :

1. **les jetons Jellyfin sont révoqués côté serveur** : celui de l'application et, si MPV Shim est retiré, les siens. Le PC disparaît de la liste des appareils de Jellyfin. Si le serveur est injoignable, les jetons sont quand même effacés du PC ;
2. service / tâches planifiées (dont la mise à jour automatique), icône d'état, démarrages automatiques, raccourcis, règle de pare-feu (et, sous Windows, le mode « privé » du réseau s'il avait été changé) ;
3. **MPV Shim et sa configuration, Node.js et les paquets système**, uniquement s'ils ont été installés par l'installation. Ce qui était déjà là avant est laissé en place ;
4. tout le dossier de configuration : jeton, identifiants, `config.json`, historique, journaux, ancien `history` du script fish ;
5. `node_modules` et `dist`.

Le dossier du projet (code source, sans secret ni état) est conservé pour pouvoir réinstaller d'une commande. Options :
- `--remove-folder` / `-RemoveFolder` : le supprimer aussi ;
- `--keep-third-party` / `-KeepThirdParty` : garder MPV Shim et Node.js ;
- `--yes` / `-Yes` : sans confirmation.

La désinstallation peut être relancée sans risque. Installer puis désinstaller plusieurs fois d'affilée ne laisse rien derrière.

### Première utilisation

Ouvrir `http://localhost:8787` sur le PC (ou scanner le QR code) :

- **PC neuf** : l'assistant demande le serveur (trouvé automatiquement s'il est sur le même réseau), le compte Jellyfin, puis guide la connexion de MPV Shim (lancer MPV Shim, y ajouter le même serveur et le même utilisateur) et le choix de la série.
- **PC qui utilisait déjà le script fish** : rien à refaire. Le token créé par `auth.py` est repris tel quel (serveur `192.168.1.122:8096`, utilisateur `En Boucle`), et l'ancien fichier `history` est importé dans l'historique de *The Office* au premier lancement.

## À faire en premier sur la machine actuelle : le spike

Les commandes à distance (volume, pistes, seek…) n'ont pas pu être testées sur le vrai MPV Shim pendant le développement. Avant de faire confiance à l'interface :

```bash
npm ci
npm run spike            # liste les sessions Jellyfin et indique celle qui sera pilotée, et pourquoi
npm run spike -- --test  # avec un épisode en cours : teste pas à pas SetVolume, Mute, pistes audio,
                         # sous-titres, Seek, Pause, en relisant l'état renvoyé par Jellyfin
```

Le rapport est écrit dans `~/.config/jellyfin-office/spike-report.json`. Si MPV Shim n'est pas reconnu, ou si une commande est refusée ou sans effet, c'est ce fichier qu'il faut transmettre.

L'interface grise d'elle-même les réglages que le lecteur ne déclare pas (`Capabilities.SupportedCommands`).

Pour vérifier la détection du générique d'un film (voir plus bas) :

```bash
npm run spike -- --credits            # liste quelques films et leur ID
npm run spike -- --credits <id>       # affiche les segments « Outro » renvoyés par Jellyfin
```

## Utilisation

- **Mode auto** (réglages) : enchaînement automatique. Désactivé, l'application ne fait plus rien d'elle-même ; les boutons restent utilisables.
- **Stop** arrête la lecture **et désactive le mode auto** (sinon la boucle relancerait un épisode quelques secondes plus tard).
- **Passer** et **Lire maintenant** reprennent toujours la main, même si autre chose a été lancé à la main.
- Un contenu lancé manuellement sur MPV Shim (depuis l'appli Jellyfin, par exemple) n'est pas interrompu : la boucle reprend quand sa lecture s'arrête.
- Un épisode passé compte quand même comme vu.
- Changer de série conserve l'historique et la file de chaque série.

### Films déjà vus et passage du générique

La liste **« Films déjà vus »** est une source comme une série : choisir **Réglages → Source → Films déjà vus**. L'application tire alors des films au hasard dans la liste, avec la même file et le même historique (un film n'est pas rejoué avant d'avoir fait le tour de la liste).

- Un panneau **Films déjà vus** apparaît sous la file : **Ajouter** (recherche par titre dans la bibliothèque, un appui ajoute le film), **✕** pour retirer un film, **Importer les films vus dans Jellyfin** pour ajouter d'un coup tous ceux marqués « vus » dans Jellyfin.
- La liste est propre à l'application (`state.json`), indépendante du statut « vu » de Jellyfin : un film retiré de la bibliothèque est simplement ignoré.
- Un film est toujours relancé depuis le début.

**Générique.** Pour un film lancé par l'application, dès que la position atteint le début du générique de fin, l'application fait `Stop` puis lance le film suivant (même mécanisme que la coupe 30 s avant la fin). Le début du générique vient du plugin **Intro Skipper** : l'application lit le segment `Outro` du film via l'API Media Segments de Jellyfin (≥ 10.10).

- Le repère du générique apparaît sur la barre de progression, avec la ligne « Générique à … ».
- **Sans segment `Outro`** (film pas encore analysé, plugin absent), l'application garde le comportement habituel : changement `Changer à` secondes avant la fin. Un film non analysé est revérifié toutes les 10 minutes.
- Un `Outro` situé **avant la moitié du film** est ignoré (détection jugée fausse).
- Le réglage **Passer le générique des films** (`skipCredits`, activé par défaut) peut être coupé. Les épisodes de série ne sont pas concernés : ils gardent la coupe 30 s avant la fin, pour ne pas rater une scène après le générique.
- Pour que les films aient un `Outro`, Intro Skipper doit analyser les **films** (pas seulement les séries) et détecter le **générique** (« credits »), puis sa tâche planifiée d'analyse doit avoir tourné. `npm run spike -- --credits <id>` montre ce que Jellyfin renvoie pour un film.
- Selon `MaxResumePct` de Jellyfin, un film arrêté au début du générique peut apparaître avec un point de reprise dans l'interface de Jellyfin. L'application n'en tient pas compte.

## Fonctionnement

À chaque relevé (toutes les 3 s), l'application lit `GET /Sessions`, repère MPV Shim, puis :

| Situation | Action |
|---|---|
| Rien en lecture depuis 6 s | lance la tête de file |
| En pause | rien |
| Contenu lancé à la main | rien, jusqu'à l'arrêt |
| Durée inconnue (`RunTimeTicks` absent ou 0) | rien |
| Moins de 30 s restantes sur un épisode lancé par l'application | `Stop` puis, 2 s après, `PlayNow` de la tête de file |
| Film lancé par l'application, position ≥ début du générique (`Outro`) | idem (si `skipCredits` et générique détecté) |
| Moins de 8 s depuis le dernier changement | rien (la session renvoie encore l'ancien épisode) |

**File et historique**, par série : la file contient 5 épisodes tirés hors historique ; l'historique garde 95 % des épisodes de la série (borné pour qu'il reste toujours de quoi tirer, quelle que soit la taille de la série).

### Corrections par rapport au script fish

- La session pilotée était repérée par `Client == "CachyOS Office Auto"`, qui est le client de `auth.py`, donc la session du token elle-même. Elle est maintenant repérée par : contrôle à distance possible, même utilisateur, `DeviceId` différent de celui de l'application, et `Client`/`DeviceName` contenant « mpv ».
- Le `Stop` de la boucle partait sans token (`$TOKEN` vide hors des fonctions fish) : il est authentifié.
- `HISTORY_LIMIT = 190` était calibré pour *The Office* : la taille de l'historique dépend maintenant de la série.

## Configuration

Fichiers dans `~/.config/jellyfin-office/` (Windows : `%APPDATA%\jellyfin-office\`) :

| Fichier | Contenu |
|---|---|
| `config.json` | serveur, utilisateur, identité de ce PC dans Jellyfin (écrit par l'assistant) |
| `token`, `user_id` | connexion Jellyfin (droits 600) ; le mot de passe n'est jamais enregistré |
| `state.json` | source courante (série ou `films-vus`), réglages, liste des films déjà vus, file et historique de chaque source, dernier épisode lancé |
| `office.log` | journal (comme avant) |
| `history` | ancien historique du script fish, importé une fois puis ignoré |
| `install-manifest` | ce que l'installation a ajouté (lu par la désinstallation) |

Chaque PC reçoit son propre `DeviceId` (`jellyfin-boucle-…`) : deux PC ne se déconnectent pas l'un l'autre.

Variables d'environnement (dans l'unité systemd, ou avant `npm start`) ; elles priment sur `config.json` :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8787` | port de l'interface |
| `HOST` | `0.0.0.0` | adresse d'écoute (doit inclure `localhost` et l'IP du réseau local) |
| `PUBLIC_URL` | déduite | adresse affichée dans le QR code, si la détection choisit la mauvaise interface |
| `JELLYFIN_URL` | `config.json` | serveur Jellyfin |
| `JELLYFIN_USER` | `config.json` | utilisateur dont la session MPV Shim est pilotée |
| `PLAYER_DEVICE_ID` | — | `DeviceId` exact de MPV Shim (voir `npm run spike`) ; prioritaire sur la détection |
| `PLAYER_MATCH` | `mpv` | motif (regex) cherché dans `Client` / `DeviceName` |
| `DEFAULT_SERIES` | `The Office` | série choisie au premier lancement |
| `JELLYFIN_OFFICE_DIR` | voir plus haut | dossier de configuration |

Le choix manuel du lecteur est aussi possible dans l'assistant (Réglages → Serveur & compte → MPV Shim).

## Dépannage

- **« MPV Shim introuvable »** : MPV Shim doit être lancé et connecté avec le même utilisateur. Sinon, `npm run spike` montre toutes les sessions et la raison de chaque refus.
- **Le téléphone n'arrive pas à ouvrir la page** : même Wi-Fi que le PC ? Port 8787 ouvert dans le pare-feu ? Sous Windows, réseau en mode « privé » ? Si le QR code pointe vers une mauvaise adresse (VPN, machine virtuelle…), en choisir une autre sous le QR code ou fixer `PUBLIC_URL`.
- **Journal** : `journalctl --user -u jellyfin-office -f` (Linux), `%APPDATA%\jellyfin-office\service.log` (Windows), ou Réglages → Journal dans l'interface.
- **Redémarrer** : `systemctl --user restart jellyfin-office` (Linux) ; sous Windows, fermer la session ou relancer la tâche « Jellyfin en boucle ».
- **Désinstaller** : voir [Désinstallation](#désinstallation).

**Sécurité** : l'interface n'a pas de mot de passe. Toute personne sur le réseau local peut piloter la lecture et changer la configuration. Ne pas exposer le port 8787 sur Internet.

## Développement

```bash
npm install
npm run dev        # backend (tsx watch) sur :8787
npm run dev:web    # front Vite avec rechargement à chaud (proxy /api vers :8787)
npm test           # tests (vitest)
npm run typecheck
npm run build      # dist/server + dist/web
npm start          # node dist/server/index.js
```

```
src/
  config.ts             config.json, chemins, identité du client
  jellyfin/client.ts    API Jellyfin typée (auth, erreurs, délais)
  jellyfin/session.ts   reconnaissance de la session MPV Shim
  jellyfin/discovery.ts découverte UDP des serveurs
  player/loop.ts        boucle de surveillance + actions
  player/queue.ts       file, historique, tirage (fonctions pures)
  player/library.ts     caches séries / épisodes / films / pistes / génériques
  store.ts              state.json (écriture atomique, migration)
  setup.ts              assistant de configuration
  revoke.ts, cli/       révocation des jetons Jellyfin (désinstallation, déconnexion)
  tray/                 icône d'état : résumé (GET /api/tray), dessin, version Linux (D-Bus)
  api/routes.ts         API REST
  api/events.ts         SSE
web/                    front React (Vite)
scripts/spike.ts        vérification de MPV Shim
deploy/linux, deploy/windows   install / uninstall, icône d'état Windows (tray.ps1)
```

### API

```
GET    /api/state                 état complet (aussi poussé en SSE sur /api/events)
POST   /api/player/pause | resume | skip | stop
POST   /api/player/seek           { positionSec }
POST   /api/player/volume         { volume } | { muted }
POST   /api/player/audio          { index }
POST   /api/player/subtitle       { index }      -1 = désactivés
POST   /api/auto                  { enabled }
PATCH  /api/settings              { changeBeforeEndSec?, queueSize?, historyRatio?, pollIntervalMs?, skipCredits? }
GET    /api/series                la source « films-vus » est en tête de liste
PUT    /api/series                { seriesId, playNow? }      seriesId = "films-vus" pour la liste de films
GET    /api/movies                films de la bibliothèque (+ played, inList)
POST   /api/movies/list           { ids: string[] }      → { added }
DELETE /api/movies/list/:id
POST   /api/movies/import-played  → { added }
GET    /api/queue
POST   /api/queue/reroll
POST   /api/queue/play-now        { episodeId }
DELETE /api/queue/:episodeId
PATCH  /api/queue                 { order: string[] }
GET    /api/history?limit=50
DELETE /api/history
GET    /api/image/:itemId         proxy des images Jellyfin
GET    /api/access, /api/qr.svg   adresses et QR code d'accès
GET    /api/setup, /api/setup/discover
POST   /api/setup/server | login | logout | player
GET    /api/tray                  résumé pour l'icône d'état
GET    /api/logs, /api/debug/sessions, /api/health
```
