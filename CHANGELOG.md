# Journal des versions

Les changements notables de « Jellyfin en boucle ». Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), numéros de version [SemVer](https://semver.org/lang/fr/).

## [Non publié]

## [0.3.0] - 2026-10-27

### Ajouté

- **Serveur ou écran à l'installation** : `install.sh` et `install.ps1` cherchent un serveur déjà installé sur le réseau local, puis demandent « 1) Serveur » ou « 2) Écran ». « Écran » est proposé quand un serveur existe déjà, et n'installe que Jellyfin MPV Shim (sans droits administrateur sous Windows). Drapeaux `--server` / `--client` / `--server-url` (`-Server` / `-Client` / `-ServerUrl`).
- **Ajouter un écran en une commande** : Réglages → Ajouter un écran affiche la commande à coller sur un nouveau PC (`irm …/lecteur.ps1 | iex` ou `curl -fsSL …/lecteur.sh | bash`). Elle installe MPV Shim, le fait démarrer à l'ouverture de session, puis affiche le serveur Jellyfin et l'utilisateur à y saisir.
- **Bouton « Reprendre »** après un Stop : la carte « En cours » garde l'épisode arrêté et propose de le relancer 30 s avant l'arrêt, ce qui réactive aussi le mode auto.
- **Container** : un Dockerfile permet d'héberger le serveur sur une machine du réseau (Coolify, Docker), les PC ne gardant que MPV Shim. Voir le [guide Coolify](docs/coolify.md).
- README : section « Serveur ou écran ? » avec le schéma des connexions et l'ordre d'installation.

### Modifié

- `/api/health` indique aussi le nom de l'application et sa version, pour qu'un script d'installation reconnaisse une instance.

### Corrigé

- Réglages : une liste déroulante au choix trop long (nom de série, sortie audio) ne déborde plus de sa carte. Le nom complet s'affiche au survol.

[Non publié]: https://github.com/benjosivo/jellyfin-shuffle-tv/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/benjosivo/jellyfin-shuffle-tv/releases/tag/v0.3.0
